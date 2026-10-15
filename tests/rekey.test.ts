import { describe, expect, it } from 'vitest';
import { decryptJSON, unlockKey } from '../src/lib/crypto';
import { getSettings, type NotesDB } from '../src/lib/db';
import { MemoryServer } from '../src/lib/memoryRemote';
import { aadFor } from '../src/lib/records';
import { settingsFromRow } from '../src/lib/types';
import { adoptRemoteSettings, changePasscode, PendingChangesError } from '../src/lib/vault';
import { createVault, makeDevice, notePayload, readNotes, saveFolder, saveNote, TEST_ITERATIONS, titles } from './helpers';

const OLD = 'old passcode 1';
const NEW = 'new passcode 2';

async function vaultWithNotes() {
  const server = new MemoryServer();
  const { key, settings } = await createVault(server, OLD);
  const mac = await makeDevice(server, key, settings);
  for (const title of ['Alpha', 'Beta', 'Gamma']) await saveNote(mac, crypto.randomUUID(), notePayload([title, 'body']));
  await saveFolder(mac, crypto.randomUUID(), 'Work');
  await mac.engine.sync();
  return { server, mac, oldKey: key, settings };
}

async function decryptsAll(rows: { id: string; ciphertext: string; iv: string }[], table: 'notes' | 'folders', key: CryptoKey) {
  const results = await Promise.all(
    rows.map((r) => decryptJSON(key, r, aadFor(table, r.id)).then(() => true, () => false)),
  );
  return results.every(Boolean);
}

async function localRows(db: NotesDB) {
  return { notes: await db.notes.toArray(), folders: await db.folders.toArray() };
}

describe('change passcode', () => {
  it('re-encrypts every note and folder, locally and on the server', async () => {
    const { server, mac, oldKey } = await vaultWithNotes();
    const before = await titles(mac);

    const { key: newKey, settings } = await changePasscode({
      db: mac.db,
      remote: mac.remote,
      oldKey,
      newPasscode: NEW,
      iterations: TEST_ITERATIONS,
    });

    // Only the new passcode unlocks the vault now.
    const serverSettings = settingsFromRow(Object.values(server.state.settings)[0]);
    expect(serverSettings).toEqual(settings);
    expect(await getSettings(mac.db)).toEqual(settings);
    expect(await unlockKey(OLD, serverSettings)).toBeNull();
    expect(await unlockKey(NEW, serverSettings)).not.toBeNull();

    // Server and local rows are readable with the new key and no longer with the old one.
    const serverNotes = Object.values(server.state.rows.notes);
    const serverFolders = Object.values(server.state.rows.folders);
    expect(await decryptsAll(serverNotes, 'notes', newKey)).toBe(true);
    expect(await decryptsAll(serverFolders, 'folders', newKey)).toBe(true);
    expect(await decryptsAll(serverNotes, 'notes', oldKey)).toBe(false);
    const local = await localRows(mac.db);
    expect(await decryptsAll(local.notes, 'notes', newKey)).toBe(true);
    expect(await decryptsAll(local.folders, 'folders', newKey)).toBe(true);

    // Content is unchanged and syncing continues normally.
    mac.key = newKey;
    expect(await titles(mac)).toEqual(before);
    expect(await mac.engine.sync()).toBe('ok');
  });

  it('changes nothing if interrupted before the server swap', async () => {
    const { server, mac, oldKey, settings } = await vaultWithNotes();
    const serverBefore = structuredClone(server.state);
    const localBefore = await localRows(mac.db);

    server.failNextRekey = true;
    await expect(
      changePasscode({ db: mac.db, remote: mac.remote, oldKey, newPasscode: NEW, iterations: TEST_ITERATIONS }),
    ).rejects.toThrow();

    expect(server.state).toEqual(serverBefore);
    expect(await localRows(mac.db)).toEqual(localBefore);
    expect(await getSettings(mac.db)).toEqual(settings);
    expect(await unlockKey(OLD, settings)).not.toBeNull();
    expect((await titles(mac)).length).toBe(3);
  });

  it('recovers without data loss if interrupted after the server swap', async () => {
    const { server, mac, oldKey } = await vaultWithNotes();
    const before = await titles(mac);

    // Simulate the app being killed right before the local swap is written.
    const realTransaction = mac.db.transaction.bind(mac.db);
    mac.db.transaction = (() => Promise.reject(new Error('app was closed'))) as unknown as typeof mac.db.transaction;
    await expect(
      changePasscode({ db: mac.db, remote: mac.remote, oldKey, newPasscode: NEW, iterations: TEST_ITERATIONS }),
    ).rejects.toThrow('app was closed');
    mac.db.transaction = realTransaction;

    // Next launch: the old passcode still opens the local copy, but sync notices the change...
    expect(await mac.engine.sync()).toBe('vault-changed');

    // ...and the new passcode (checked against the server) adopts the new settings.
    const remoteSettings = settingsFromRow(Object.values(server.state.settings)[0]);
    const newKey = await unlockKey(NEW, remoteSettings);
    expect(newKey).not.toBeNull();
    const adopted = await adoptRemoteSettings({ db: mac.db, settings: remoteSettings, newKey: newKey!, oldKey: null });
    expect(adopted.stranded).toBe(0);
    mac.key = newKey;
    expect(await mac.engine.sync({ full: true })).toBe('ok');
    expect(await titles(mac)).toEqual(before);
  });

  it('refuses to start while changes are waiting to sync', async () => {
    const { mac, oldKey } = await vaultWithNotes();
    await saveNote(mac, crypto.randomUUID(), notePayload(['Unsynced']));
    await expect(
      changePasscode({ db: mac.db, remote: mac.remote, oldKey, newPasscode: NEW, iterations: TEST_ITERATIONS }),
    ).rejects.toBeInstanceOf(PendingChangesError);
  });

  it('lets another device keep unsynced edits made under the old passcode', async () => {
    const { server, mac, oldKey, settings } = await vaultWithNotes();
    const phone = await makeDevice(server, oldKey, settings);
    await phone.engine.sync();

    // The phone makes an edit offline, then the Mac changes the passcode.
    const [id] = [...(await readNotes(phone)).keys()];
    await saveNote(phone, id, notePayload(['Alpha', 'edited on the phone'], { updatedAt: Date.now() + 60_000 }));
    const { key: newKey } = await changePasscode({
      db: mac.db,
      remote: mac.remote,
      oldKey,
      newPasscode: NEW,
      iterations: TEST_ITERATIONS,
    });

    expect(await phone.engine.sync()).toBe('vault-changed');
    const remoteSettings = settingsFromRow(Object.values(server.state.settings)[0]);
    const phoneNewKey = (await unlockKey(NEW, remoteSettings))!;

    // Without the old passcode the edit can't be read, so nothing is changed yet.
    const first = await adoptRemoteSettings({ db: phone.db, settings: remoteSettings, newKey: phoneNewKey, oldKey: null });
    expect(first.stranded).toBe(1);

    // With it, the edit is re-encrypted and survives.
    const phoneOldKey = await unlockKey(OLD, (await getSettings(phone.db))!);
    const second = await adoptRemoteSettings({ db: phone.db, settings: remoteSettings, newKey: phoneNewKey, oldKey: phoneOldKey });
    expect(second.stranded).toBe(0);
    phone.key = phoneNewKey;
    expect(await phone.engine.sync({ full: true })).toBe('ok');

    mac.key = newKey;
    await mac.engine.sync();
    const notes = await readNotes(mac);
    expect(notes.get(id)?.preview).toBe('edited on the phone');
    expect(notes.size).toBe(3);
  });
});
