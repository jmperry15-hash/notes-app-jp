import { resolveFolderConflict, resolveNoteConflict } from './conflict';
import { cursorKey, getMeta, getSettings, setMeta, type NotesDB } from './db';
import { purgeExpired } from './purge';
import { openFolderPayload, openNotePayload, sealNote } from './records';
import { isNetworkError, type RemoteChange, type RemoteStore } from './remote';
import { compareTs, tsMinus } from './timestamps';
import { TABLES, sameVault, settingsFromRow, type LocalRecord, type RemoteRow, type TableName } from './types';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export type SyncResult = 'ok' | 'offline' | 'error' | 'locked' | 'vault-changed';

/** Ids whose local copy changed (re-read them) or disappeared (drop them). */
export interface SyncChanges {
  updated: Record<TableName, Set<string>>;
  removed: Record<TableName, Set<string>>;
}

export function emptyChanges(): SyncChanges {
  return {
    updated: { notes: new Set(), folders: new Set() },
    removed: { notes: new Set(), folders: new Set() },
  };
}

export function hasChanges(changes: SyncChanges): boolean {
  return TABLES.some((t) => changes.updated[t].size > 0 || changes.removed[t].size > 0);
}

export interface SyncDeps {
  db: NotesDB;
  remote: RemoteStore;
  getKey: () => CryptoKey | null;
  isOnline?: () => boolean;
  onChanges?: (changes: SyncChanges) => void;
  onStatus?: (status: SyncStatus, error?: string) => void;
  /** The passcode was changed on another device; this device must lock and re-derive its key. */
  onVaultChanged?: () => void;
  now?: () => number;
}

const PAGE = 500;
/** Re-read a few seconds before the cursor so rows committed slightly out of order are never missed. */
const OVERLAP_MS = 5_000;
const MAX_PUSH_ATTEMPTS = 3;

class VaultChangedError extends Error {}

function fromRemote(row: RemoteRow, previous?: LocalRecord): LocalRecord {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    iv: row.iv,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    state: 0,
    rev: (previous?.rev ?? 0) + 1,
  };
}

/**
 * Two-way sync between IndexedDB and the server.
 *
 * Pull: fetch rows changed since the last sync. A row is applied directly unless this device also
 * changed it since its last sync, in which case the conflict rules in conflict.ts decide.
 * Push: each local change is uploaded with an optimistic check ("only if the server row is still the
 * version I based my edit on"), so concurrent edits are always detected rather than overwritten.
 */
export class SyncEngine {
  private chain: Promise<unknown> = Promise.resolve();
  private queued: Promise<SyncResult> | null = null;
  private queuedFull = false;
  private stopped = false;

  constructor(private readonly deps: SyncDeps) {}

  stop(): void {
    this.stopped = true;
  }

  /** Runs a sync. Calls made while one is already waiting to run are merged into it. */
  sync(options: { full?: boolean } = {}): Promise<SyncResult> {
    if (options.full) this.queuedFull = true;
    if (this.queued) return this.queued;
    const run = this.chain.then(async () => {
      this.queued = null;
      const full = this.queuedFull;
      this.queuedFull = false;
      return this.syncOnce(full);
    });
    this.queued = run;
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Runs `task` with syncing paused (used while changing the passcode). */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Applies a realtime DELETE: drop the local copy unless it has unsynced edits. */
  async applyRemoteDelete(change: RemoteChange): Promise<void> {
    const records = this.deps.db.records(change.table);
    const removed = await this.deps.db.transaction('rw', records, async () => {
      const local = await records.get(change.id);
      if (!local || local.state === 1) return false;
      await records.delete(change.id);
      return true;
    });
    if (removed) {
      const changes = emptyChanges();
      changes.removed[change.table].add(change.id);
      this.deps.onChanges?.(changes);
    }
  }

  private setStatus(status: SyncStatus, error?: string): void {
    if (!this.stopped) this.deps.onStatus?.(status, error);
  }

  private async syncOnce(full: boolean): Promise<SyncResult> {
    const { db, remote } = this.deps;
    const key = this.deps.getKey();
    if (this.stopped || !key) return 'locked';
    if (this.deps.isOnline && !this.deps.isOnline()) {
      this.setStatus('offline');
      return 'offline';
    }
    this.setStatus('syncing');
    const changes = emptyChanges();
    try {
      // 1. Make sure the passcode wasn't changed on another device. Pushing data encrypted with an
      //    old key on top of re-keyed data would make it unreadable.
      const [remoteSettings, localSettings] = await Promise.all([remote.getSettings(), getSettings(db)]);
      if (!remoteSettings || !localSettings || !sameVault(settingsFromRow(remoteSettings), localSettings)) {
        throw new VaultChangedError();
      }

      // 2. Queue anything that has been in Recently Deleted for 30 days for permanent removal.
      const purged = await purgeExpired(db, this.now());
      for (const table of TABLES) for (const id of purged[table]) changes.removed[table].add(id);

      // 3. Pull, then 4. push. Folders first so notes never point at a folder we don't know yet.
      for (const table of TABLES) await this.pull(table, key, changes, full);
      for (const table of TABLES) await this.push(table, key, changes);

      // 5. On a full sync, drop local copies of rows that were permanently deleted elsewhere.
      if (full) for (const table of TABLES) await this.reconcile(table, changes);

      this.emit(changes);
      this.setStatus('synced');
      return 'ok';
    } catch (error) {
      this.emit(changes);
      if (error instanceof VaultChangedError) {
        if (!this.stopped) this.deps.onVaultChanged?.();
        return 'vault-changed';
      }
      if (isNetworkError(error)) {
        this.setStatus('offline');
        return 'offline';
      }
      this.setStatus('error', error instanceof Error ? error.message : String(error));
      return 'error';
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private emit(changes: SyncChanges): void {
    if (hasChanges(changes) && !this.stopped) this.deps.onChanges?.(changes);
  }

  private async pull(table: TableName, key: CryptoKey, changes: SyncChanges, full: boolean): Promise<void> {
    const { db, remote } = this.deps;
    const cursor = full ? undefined : await getMeta<string>(db, cursorKey(table));
    const since = cursor ? tsMinus(cursor, OVERLAP_MS) : null;
    let newest = cursor ?? null;
    for (let offset = 0; ; offset += PAGE) {
      const rows = await remote.pullSince(table, since, offset, PAGE);
      for (const row of rows) {
        await this.applyRemote(table, row, key, changes);
        if (!newest || compareTs(row.updated_at, newest) > 0) newest = row.updated_at;
      }
      if (rows.length < PAGE) break;
    }
    if (newest && newest !== cursor) await setMeta(db, cursorKey(table), newest);
  }

  /** Applies one server row to the local copy, resolving a conflict if both sides changed. */
  async applyRemote(table: TableName, row: RemoteRow, key: CryptoKey, changes: SyncChanges): Promise<void> {
    const { db } = this.deps;
    const records = db.records(table);
    const outcome = await db.transaction('rw', records, async () => {
      const local = await records.get(row.id);
      if (!local) {
        await records.put(fromRemote(row));
        return 'applied';
      }
      if (local.state === 2) return 'skip'; // our pending permanent delete will win
      if (local.updated_at && compareTs(row.updated_at, local.updated_at) <= 0) return 'skip'; // not newer
      if (local.state === 0) {
        await records.put(fromRemote(row, local));
        return 'applied';
      }
      return 'conflict'; // edited here AND on the server since our last sync
    });
    if (outcome === 'applied') changes.updated[table].add(row.id);
    if (outcome === 'conflict') await this.resolveConflict(table, row, key, changes);
  }

  private async resolveConflict(table: TableName, row: RemoteRow, key: CryptoKey, changes: SyncChanges): Promise<void> {
    const { db } = this.deps;
    const records = db.records(table);
    const local = await records.get(row.id);
    if (!local || local.state !== 1) return;

    let remotePayload;
    try {
      remotePayload =
        table === 'notes' ? await openNotePayload(key, row) : await openFolderPayload(key, row);
    } catch {
      throw new VaultChangedError(); // server data is under a key we don't have
    }

    let winner: 'local' | 'remote';
    let copy: { id: string; record: LocalRecord } | null = null;
    if (table === 'folders') {
      const localPayload = await openFolderPayload(key, local);
      winner = resolveFolderConflict(
        { payload: localPayload, deletedAt: local.deleted_at },
        { payload: remotePayload as Awaited<ReturnType<typeof openFolderPayload>>, deletedAt: row.deleted_at },
      );
    } else {
      const localPayload = await openNotePayload(key, local);
      const resolution = resolveNoteConflict(
        { payload: localPayload, deletedAt: local.deleted_at },
        { payload: remotePayload as Awaited<ReturnType<typeof openNotePayload>>, deletedAt: row.deleted_at },
      );
      winner = resolution.winner;
      if (resolution.copy) {
        const id = crypto.randomUUID();
        const sealed = await sealNote(key, id, resolution.copy.payload);
        copy = {
          id,
          record: { id, ...sealed, updated_at: null, deleted_at: resolution.copy.deletedAt, state: 1, rev: 1 },
        };
      }
    }

    const applied = await db.transaction('rw', records, async () => {
      const current = await records.get(row.id);
      if (!current || current.rev !== local.rev) return false; // edited again meanwhile; retry next sync
      if (winner === 'remote') await records.put(fromRemote(row, current));
      else await records.put({ ...current, updated_at: row.updated_at }); // rebase: our upload will now succeed
      if (copy) await records.put(copy.record);
      return true;
    });
    if (applied) {
      changes.updated[table].add(row.id);
      if (copy) changes.updated[table].add(copy.id);
    }
  }

  private async push(table: TableName, key: CryptoKey, changes: SyncChanges): Promise<void> {
    const pending = await this.deps.db.records(table).where('state').above(0).toArray();
    for (const record of pending) await this.pushOne(table, record, key, changes);
  }

  private async pushOne(table: TableName, record: LocalRecord, key: CryptoKey, changes: SyncChanges): Promise<void> {
    const { db, remote } = this.deps;
    const records = db.records(table);

    if (record.state === 2) {
      if (record.updated_at !== null) await remote.remove(table, [record.id]);
      await db.transaction('rw', records, async () => {
        const current = await records.get(record.id);
        if (current?.state === 2) await records.delete(record.id);
      });
      changes.removed[table].add(record.id);
      return;
    }

    let current: LocalRecord = record;
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      const body = { id: current.id, ciphertext: current.ciphertext, iv: current.iv, deleted_at: current.deleted_at };
      let saved: RemoteRow | null = null;
      if (current.updated_at === null) {
        const inserted = await remote.insert(table, body);
        if (inserted.status === 'ok') saved = inserted.row;
      } else {
        saved = await remote.updateIfUnchanged(table, body, current.updated_at);
      }

      if (saved) {
        const uploaded = current;
        const stored = saved;
        await db.transaction('rw', records, async () => {
          const latest = await records.get(uploaded.id);
          if (!latest || latest.state === 2) return;
          // If the note was edited again while uploading, keep it pending but based on what we just wrote.
          const clean = latest.rev === uploaded.rev;
          await records.put({ ...latest, updated_at: stored.updated_at, state: clean ? 0 : 1 });
        });
        return;
      }

      // The server row changed (or vanished) since our edit was based on it.
      const [serverRow] = await remote.getRows(table, [current.id]);
      if (!serverRow) {
        if (current.deleted_at) {
          // Deleted here, permanently deleted elsewhere: nothing left to keep.
          await records.delete(current.id);
          changes.removed[table].add(current.id);
          return;
        }
        // Permanently deleted elsewhere while edited here: re-create it so the edits survive.
        const snapshot = current;
        await db.transaction('rw', records, async () => {
          const latest = await records.get(snapshot.id);
          if (latest && latest.state === 1) await records.put({ ...latest, updated_at: null });
        });
      } else {
        await this.applyRemote(table, serverRow, key, changes);
      }
      const latest = await records.get(current.id);
      if (!latest || latest.state !== 1) return;
      current = latest;
    }
  }

  private async reconcile(table: TableName, changes: SyncChanges): Promise<void> {
    const { db, remote } = this.deps;
    const serverIds = new Set(await remote.listIds(table));
    const records = db.records(table);
    await db.transaction('rw', records, async () => {
      const gone = await records
        .filter((r) => r.state === 0 && r.updated_at !== null && !serverIds.has(r.id))
        .toArray();
      for (const record of gone) {
        await records.delete(record.id);
        changes.removed[table].add(record.id);
      }
    });
  }
}
