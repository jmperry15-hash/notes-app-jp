import type { JSONContent } from '@tiptap/core';
import { createKeyMaterial } from '../src/lib/crypto';
import { NotesDB, setSettings, writeLocal } from '../src/lib/db';
import { MemoryRemote, MemoryServer } from '../src/lib/memoryRemote';
import { deriveNoteText } from '../src/lib/noteText';
import { openNotePayload, sealFolder, sealNote, toIso } from '../src/lib/records';
import { SyncEngine, type SyncChanges } from '../src/lib/sync';
import type { NotePayload, VaultSettings } from '../src/lib/types';

/** The lowest iteration count the app accepts; keeps tests fast. Production uses 600,000. */
export const TEST_ITERATIONS = 100_000;
export const USER_ID = '6f1d1b2c-1111-4c3a-9a55-000000000001';

let dbCounter = 0;

export function doc(...lines: string[]): JSONContent {
  return {
    type: 'doc',
    content: lines.map((text, i) =>
      i === 0
        ? { type: 'heading', attrs: { level: 1 }, content: text ? [{ type: 'text', text }] : [] }
        : { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
    ),
  };
}

export function notePayload(lines: string[], overrides: Partial<NotePayload> = {}): NotePayload {
  const body = doc(...lines);
  const { title, preview } = deriveNoteText(body);
  const now = Date.now();
  return { title, body, preview, folderId: null, pinned: false, createdAt: now, updatedAt: now, ...overrides };
}

/** Creates the vault on the server (like first-run setup) and returns its key. */
export async function createVault(server: MemoryServer, passcode = 'correct horse') {
  const material = await createKeyMaterial(passcode, TEST_ITERATIONS);
  const remote = new MemoryRemote(server, USER_ID);
  await remote.createSettings({
    kdf_salt: material.salt,
    kdf_iterations: material.iterations,
    verifier_ciphertext: material.verifier.ciphertext,
    verifier_iv: material.verifier.iv,
  });
  const settings: VaultSettings = {
    userId: USER_ID,
    salt: material.salt,
    iterations: material.iterations,
    verifierCiphertext: material.verifier.ciphertext,
    verifierIv: material.verifier.iv,
  };
  return { key: material.key, settings };
}

export interface Device {
  db: NotesDB;
  remote: MemoryRemote;
  engine: SyncEngine;
  key: CryptoKey | null;
  changes: SyncChanges[];
  vaultChanged: number;
}

/** A simulated device: its own IndexedDB, its own connection, its own sync engine. */
export async function makeDevice(server: MemoryServer, key: CryptoKey, settings: VaultSettings): Promise<Device> {
  const db = new NotesDB(`test-device-${++dbCounter}-${Math.random()}`);
  await setSettings(db, settings);
  const remote = new MemoryRemote(server, USER_ID);
  const device: Device = { db, remote, key, changes: [], vaultChanged: 0, engine: undefined as unknown as SyncEngine };
  device.engine = new SyncEngine({
    db,
    remote,
    getKey: () => device.key,
    onChanges: (c) => device.changes.push(c),
    onVaultChanged: () => device.vaultChanged++,
  });
  return device;
}

export async function saveNote(device: Device, id: string, payload: NotePayload, deletedAt: number | null = null) {
  const sealed = await sealNote(device.key!, id, payload);
  await writeLocal(device.db, 'notes', id, sealed, toIso(deletedAt));
}

export async function saveFolder(device: Device, id: string, name: string, updatedAt = Date.now()) {
  const sealed = await sealFolder(device.key!, id, { name, createdAt: updatedAt, updatedAt });
  await writeLocal(device.db, 'folders', id, sealed, null);
}

export async function readNotes(device: Device): Promise<Map<string, NotePayload & { deletedAt: string | null }>> {
  const out = new Map<string, NotePayload & { deletedAt: string | null }>();
  for (const record of await device.db.notes.toArray()) {
    if (record.state === 2) continue;
    out.set(record.id, { ...(await openNotePayload(device.key!, record)), deletedAt: record.deleted_at });
  }
  return out;
}

export const titles = async (device: Device) =>
  [...(await readNotes(device)).values()].map((n) => n.title).sort();

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
