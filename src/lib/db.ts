import Dexie, { type EntityTable, type Table } from 'dexie';
import type { LocalRecord, TableName, VaultSettings } from './types';
import type { Sealed } from './crypto';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * The local, offline copy of the vault. It only ever holds ciphertext plus non-sensitive metadata,
 * exactly like the server.
 */
export class NotesDB extends Dexie {
  notes!: Table<LocalRecord, string>;
  folders!: Table<LocalRecord, string>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'folio') {
    super(name);
    this.version(1).stores({
      notes: 'id, state',
      folders: 'id, state',
      meta: 'key',
    });
  }

  records(table: TableName): Table<LocalRecord, string> {
    return table === 'notes' ? this.notes : this.folders;
  }
}

const SETTINGS_KEY = 'settings';
const ACCOUNT_KEY = 'account';
export const cursorKey = (table: TableName) => `cursor:${table}`;

export async function getMeta<T>(db: NotesDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: NotesDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const getSettings = (db: NotesDB) => getMeta<VaultSettings>(db, SETTINGS_KEY);
export const setSettings = (db: NotesDB, settings: VaultSettings) => setMeta(db, SETTINGS_KEY, settings);

export interface AccountInfo {
  userId: string;
  email: string;
}
export const getAccount = (db: NotesDB) => getMeta<AccountInfo>(db, ACCOUNT_KEY);
export const setAccount = (db: NotesDB, account: AccountInfo) => setMeta(db, ACCOUNT_KEY, account);

export async function resetCursors(db: NotesDB): Promise<void> {
  await db.meta.bulkDelete([cursorKey('notes'), cursorKey('folders')]);
}

/** Saves a locally edited record and marks it for upload. */
export async function writeLocal(
  db: NotesDB,
  table: TableName,
  id: string,
  sealed: Sealed,
  deletedAt: string | null,
): Promise<void> {
  const records = db.records(table);
  await db.transaction('rw', records, async () => {
    const current = await records.get(id);
    if (current?.state === 2) return; // already permanently deleted
    await records.put({
      id,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      updated_at: current?.updated_at ?? null,
      deleted_at: deletedAt,
      state: 1,
      rev: (current?.rev ?? 0) + 1,
    });
  });
}

/** Permanently deletes records: immediately if they never reached the server, otherwise once the deletion is uploaded. */
export async function markPurged(db: NotesDB, table: TableName, ids: string[]): Promise<void> {
  const records = db.records(table);
  await db.transaction('rw', records, async () => {
    for (const id of ids) {
      const current = await records.get(id);
      if (!current) continue;
      if (current.updated_at === null) await records.delete(id);
      else await records.put({ ...current, state: 2, rev: current.rev + 1 });
    }
  });
}

export async function countPending(db: NotesDB): Promise<number> {
  const [notes, folders] = await Promise.all([
    db.notes.where('state').above(0).count(),
    db.folders.where('state').above(0).count(),
  ]);
  return notes + folders;
}
