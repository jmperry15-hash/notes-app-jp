import { unlockKey } from './crypto';
import { getSettings, writeLocal, type NotesDB } from './db';
import { openFolderPayload, openNotePayload, sealFolder, sealNote } from './records';
import { TABLES, type FolderPayload, type NotePayload, type TableName } from './types';

/**
 * Encrypted backups contain exactly what the server stores (ciphertext + IV) plus the salt and
 * verifier needed to re-derive the key. They can only be opened with the passcode that was in
 * use when the backup was made.
 */
export interface BackupRecord {
  id: string;
  ciphertext: string;
  iv: string;
  deleted_at: string | null;
}

export interface BackupFile {
  app: 'folio';
  kind: 'encrypted-backup';
  version: 1;
  createdAt: string;
  kdf: { algorithm: 'PBKDF2-SHA256'; salt: string; iterations: number };
  verifier: { ciphertext: string; iv: string };
  cipher: 'AES-GCM-256';
  notes: BackupRecord[];
  folders: BackupRecord[];
}

export async function createBackup(db: NotesDB): Promise<BackupFile> {
  const settings = await getSettings(db);
  if (!settings) throw new Error('No vault on this device.');
  const pick = async (table: TableName): Promise<BackupRecord[]> =>
    (await db.records(table).toArray())
      .filter((r) => r.state !== 2)
      .map(({ id, ciphertext, iv, deleted_at }) => ({ id, ciphertext, iv, deleted_at }));
  return {
    app: 'folio',
    kind: 'encrypted-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    kdf: { algorithm: 'PBKDF2-SHA256', salt: settings.salt, iterations: settings.iterations },
    verifier: { ciphertext: settings.verifierCiphertext, iv: settings.verifierIv },
    cipher: 'AES-GCM-256',
    notes: await pick('notes'),
    folders: await pick('folders'),
  };
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `folio-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

const isRecord = (r: unknown): r is BackupRecord => {
  const v = r as BackupRecord;
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.ciphertext === 'string' &&
    typeof v.iv === 'string' &&
    (v.deleted_at === null || typeof v.deleted_at === 'string')
  );
};

export function parseBackup(text: string): BackupFile {
  let data: BackupFile;
  try {
    data = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error('This file is not a Folio backup.');
  }
  if (data?.app !== 'folio' || data.kind !== 'encrypted-backup') throw new Error('This file is not a Folio backup.');
  if (data.version !== 1) throw new Error('This backup was made by a newer version of Folio.');
  if (
    typeof data.kdf?.salt !== 'string' ||
    typeof data.kdf.iterations !== 'number' ||
    typeof data.verifier?.ciphertext !== 'string' ||
    typeof data.verifier.iv !== 'string' ||
    !Array.isArray(data.notes) ||
    !Array.isArray(data.folders) ||
    !data.notes.every(isRecord) ||
    !data.folders.every(isRecord)
  ) {
    throw new Error('This backup file is damaged.');
  }
  return data;
}

/** Returns the key for this backup if `passcode` is the one it was made with. */
export function unlockBackup(backup: BackupFile, passcode: string): Promise<CryptoKey | null> {
  return unlockKey(passcode, {
    salt: backup.kdf.salt,
    iterations: backup.kdf.iterations,
    verifierCiphertext: backup.verifier.ciphertext,
    verifierIv: backup.verifier.iv,
  });
}

export interface RestoreResult {
  added: number;
  updated: number;
  unchanged: number;
  failed: number;
  changed: Record<TableName, string[]>;
}

/**
 * Merges a backup into the vault: items missing here are added, items edited more recently in the
 * backup replace the local copy, everything else is left alone. Restored items are re-encrypted
 * with the current key and then sync like any other edit.
 */
export async function restoreBackup(options: {
  db: NotesDB;
  backup: BackupFile;
  backupKey: CryptoKey;
  currentKey: CryptoKey;
}): Promise<RestoreResult> {
  const { db, backup, backupKey, currentKey } = options;
  const result: RestoreResult = { added: 0, updated: 0, unchanged: 0, failed: 0, changed: { notes: [], folders: [] } };

  for (const table of TABLES) {
    for (const item of backup[table]) {
      try {
        const payload =
          table === 'notes' ? await openNotePayload(backupKey, item) : await openFolderPayload(backupKey, item);
        const local = await db.records(table).get(item.id);
        if (local?.state === 2) {
          result.unchanged++;
          continue;
        }
        if (local) {
          const current =
            table === 'notes' ? await openNotePayload(currentKey, local) : await openFolderPayload(currentKey, local);
          const sameDeletion = (local.deleted_at === null) === (item.deleted_at === null);
          if (payload.updatedAt <= current.updatedAt && (sameDeletion || payload.updatedAt < current.updatedAt)) {
            result.unchanged++;
            continue;
          }
        }
        const sealed =
          table === 'notes'
            ? await sealNote(currentKey, item.id, payload as NotePayload)
            : await sealFolder(currentKey, item.id, payload as FolderPayload);
        await writeLocal(db, table, item.id, sealed, item.deleted_at);
        if (local) result.updated++;
        else result.added++;
        result.changed[table].push(item.id);
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
