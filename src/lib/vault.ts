import { createKeyMaterial, decryptJSON, encryptJSON, KDF_ITERATIONS } from './crypto';
import { getSettings, resetCursors, setSettings, type NotesDB } from './db';
import { aadFor } from './records';
import type { RekeyRecord, RemoteStore } from './remote';
import { TABLES, type LocalRecord, type TableName, type VaultSettings } from './types';

export class PendingChangesError extends Error {
  constructor() {
    super('Some changes have not synced yet. Connect to the internet and try again.');
  }
}

async function reencrypt(record: LocalRecord, table: TableName, from: CryptoKey, to: CryptoKey): Promise<LocalRecord> {
  const aad = aadFor(table, record.id);
  const value = await decryptJSON<unknown>(from, record, aad);
  const sealed = await encryptJSON(to, value, aad);
  return { ...record, ciphertext: sealed.ciphertext, iv: sealed.iv };
}

/**
 * Changes the passcode by re-encrypting every note and folder under a new key.
 *
 * Interruption-safe by construction:
 *   1. Everything is re-encrypted in memory first. Nothing has been written yet.
 *   2. The server swaps the key settings and every row in ONE database transaction
 *      (rekey_vault in schema.sql). It refuses if anything changed since step 1.
 *   3. This device swaps its local copy and settings in ONE IndexedDB transaction.
 * If the app dies between 2 and 3, the next unlock notices the server has newer key settings and
 * re-downloads everything (see adoptRemoteSettings), so no data is lost at any point.
 *
 * Call it with syncing paused and right after a successful sync, so nothing is pending.
 */
export async function changePasscode(options: {
  db: NotesDB;
  remote: RemoteStore;
  oldKey: CryptoKey;
  newPasscode: string;
  iterations?: number;
}): Promise<{ key: CryptoKey; settings: VaultSettings }> {
  const { db, remote, oldKey, newPasscode, iterations = KDF_ITERATIONS } = options;
  const current = await getSettings(db);
  if (!current) throw new Error('This device has no vault settings.');

  const snapshot: Record<TableName, LocalRecord[]> = {
    notes: await db.notes.toArray(),
    folders: await db.folders.toArray(),
  };
  if (TABLES.some((t) => snapshot[t].some((r) => r.state !== 0 || r.updated_at === null))) {
    throw new PendingChangesError();
  }

  // 1. Re-encrypt in memory.
  const material = await createKeyMaterial(newPasscode, iterations);
  const rekeyed: Record<TableName, LocalRecord[]> = { notes: [], folders: [] };
  for (const table of TABLES) {
    for (const record of snapshot[table]) rekeyed[table].push(await reencrypt(record, table, oldKey, material.key));
  }
  const settings: VaultSettings = {
    userId: current.userId,
    salt: material.salt,
    iterations: material.iterations,
    verifierCiphertext: material.verifier.ciphertext,
    verifierIv: material.verifier.iv,
  };

  // 2. Atomic swap on the server.
  const toRequest = (records: LocalRecord[]): RekeyRecord[] =>
    records.map((r) => ({ id: r.id, ciphertext: r.ciphertext, iv: r.iv, expected_updated_at: r.updated_at as string }));
  await remote.rekey({
    expectedVerifierIv: current.verifierIv,
    salt: settings.salt,
    iterations: settings.iterations,
    verifierCiphertext: settings.verifierCiphertext,
    verifierIv: settings.verifierIv,
    notes: toRequest(rekeyed.notes),
    folders: toRequest(rekeyed.folders),
  });

  // 3. Atomic swap locally.
  await db.transaction('rw', db.notes, db.folders, db.meta, async () => {
    await db.notes.bulkPut(rekeyed.notes.map((r) => ({ ...r, rev: r.rev + 1 })));
    await db.folders.bulkPut(rekeyed.folders.map((r) => ({ ...r, rev: r.rev + 1 })));
    await setSettings(db, settings);
  });

  return { key: material.key, settings };
}

export interface AdoptResult {
  /** Unsynced local edits that are encrypted with a previous passcode we don't have. */
  stranded: number;
}

/**
 * Switches this device to key settings that changed elsewhere (passcode changed on another device,
 * or a passcode change here was interrupted after the server step).
 *
 * Unsynced local edits are kept: they are re-encrypted with the new key, using `oldKey` when they
 * were made under the previous passcode. If that's needed but `oldKey` is missing, nothing is
 * changed and `stranded` reports how many edits need the old passcode (unless `discardStranded`).
 * Synced local copies are simply dropped and downloaded again.
 */
export async function adoptRemoteSettings(options: {
  db: NotesDB;
  settings: VaultSettings;
  newKey: CryptoKey;
  oldKey: CryptoKey | null;
  discardStranded?: boolean;
}): Promise<AdoptResult> {
  const { db, settings, newKey, oldKey, discardStranded = false } = options;
  const keep: Record<TableName, LocalRecord[]> = { notes: [], folders: [] };
  let stranded = 0;

  for (const table of TABLES) {
    const pending = await db.records(table).where('state').equals(1).toArray();
    for (const record of pending) {
      try {
        await decryptJSON(newKey, record, aadFor(table, record.id));
        keep[table].push(record); // already under the new key
        continue;
      } catch {
        // made under the previous passcode
      }
      if (oldKey) {
        try {
          keep[table].push(await reencrypt(record, table, oldKey, newKey));
          continue;
        } catch {
          // not decryptable with either key; fall through
        }
      }
      stranded++;
    }
  }
  if (stranded > 0 && !discardStranded) return { stranded };

  await db.transaction('rw', db.notes, db.folders, db.meta, async () => {
    for (const table of TABLES) {
      const records = db.records(table);
      const keepIds = new Set(keep[table].map((r) => r.id));
      const drop = await records.filter((r) => !keepIds.has(r.id) && r.state !== 2).primaryKeys();
      await records.bulkDelete(drop);
      // Kept edits stay pending. Re-keying keeps server timestamps, so an edit based on the latest
      // version uploads normally; if the note also changed elsewhere, conflict handling keeps both.
      await records.bulkPut(keep[table].map((r) => ({ ...r, rev: r.rev + 1 })));
    }
    await setSettings(db, settings);
    await resetCursors(db);
  });
  return { stranded: 0 };
}
