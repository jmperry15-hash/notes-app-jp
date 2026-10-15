import { describe, expect, it } from 'vitest';
import { CONFLICT_SUFFIX, resolveFolderConflict, resolveNoteConflict } from '../src/lib/conflict';
import { countPending, markPurged } from '../src/lib/db';
import { MemoryServer } from '../src/lib/memoryRemote';
import { openFolderPayload } from '../src/lib/records';
import { createVault, makeDevice, notePayload, readNotes, saveFolder, saveNote, sleep, titles } from './helpers';

async function twoDevices() {
  const server = new MemoryServer();
  const { key, settings } = await createVault(server);
  const mac = await makeDevice(server, key, settings);
  const phone = await makeDevice(server, key, settings);
  return { server, mac, phone };
}

describe('conflict rules', () => {
  const version = (lines: string[], updatedAt: number, deletedAt: string | null = null) => ({
    payload: notePayload(lines, { updatedAt }),
    deletedAt,
  });

  it('keeps the newer edit and preserves the older one as a conflicted copy', () => {
    const result = resolveNoteConflict(version(['Plan', 'A'], 2000), version(['Plan', 'B'], 1000));
    expect(result.winner).toBe('local');
    expect(result.copy?.payload.title).toBe(`Plan${CONFLICT_SUFFIX}`);
    expect(result.copy?.payload.preview).toBe('B');
  });

  it('makes no copy when both sides ended up with the same text', () => {
    const result = resolveNoteConflict(version(['Same', 'text'], 1000), version(['Same', 'text'], 2000));
    expect(result).toEqual({ winner: 'remote', copy: null });
  });

  it('keeps live edits even when a newer delete wins', () => {
    const deleted = version(['Draft', 'old'], 1000, new Date(5000).toISOString());
    const edited = version(['Draft', 'new words'], 3000);
    const result = resolveNoteConflict(edited, deleted);
    expect(result.winner).toBe('remote');
    expect(result.copy?.deletedAt).toBeNull();
    expect(result.copy?.payload.preview).toBe('new words');
  });

  it('uses last-write-wins for folders', () => {
    const a = { payload: { name: 'Work', createdAt: 0, updatedAt: 100 }, deletedAt: null };
    const b = { payload: { name: 'Job', createdAt: 0, updatedAt: 200 }, deletedAt: null };
    expect(resolveFolderConflict(a, b)).toBe('remote');
    expect(resolveFolderConflict(b, a)).toBe('local');
  });
});

describe('sync', () => {
  it('copies notes between devices and applies later edits (last write wins)', async () => {
    const { mac, phone } = await twoDevices();
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Groceries', 'Milk'], { updatedAt: 1000 }));
    expect(await mac.engine.sync()).toBe('ok');
    expect(await phone.engine.sync()).toBe('ok');
    expect(await titles(phone)).toEqual(['Groceries']);

    await saveNote(phone, id, notePayload(['Groceries', 'Milk, eggs'], { updatedAt: 2000 }));
    await phone.engine.sync();
    await mac.engine.sync();
    const notes = await readNotes(mac);
    expect(notes.size).toBe(1);
    expect(notes.get(id)?.preview).toBe('Milk, eggs');
    expect(await countPending(mac.db)).toBe(0);
    expect(await countPending(phone.db)).toBe(0);
  });

  it('keeps both versions when the same note was edited on two devices since the last sync', async () => {
    const { server, mac, phone } = await twoDevices();
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Trip plan', 'Pack bags'], { updatedAt: 1000 }));
    await mac.engine.sync();
    await phone.engine.sync();

    // Both devices edit while offline. The phone's edit is the more recent one.
    mac.remote.online = false;
    phone.remote.online = false;
    await saveNote(mac, id, notePayload(['Trip plan', 'Pack bags', 'Book hotel'], { updatedAt: 2000 }));
    await saveNote(phone, id, notePayload(['Trip plan', 'Pack bags', 'Buy sunscreen'], { updatedAt: 3000 }));
    expect(await mac.engine.sync()).toBe('offline');
    mac.remote.online = true;
    phone.remote.online = true;

    await mac.engine.sync(); // uploads first
    await phone.engine.sync(); // discovers the conflict
    await mac.engine.sync(); // receives the outcome

    for (const device of [mac, phone]) {
      const notes = [...(await readNotes(device)).values()];
      expect(notes).toHaveLength(2);
      expect(notes.find((n) => n.title === 'Trip plan')?.preview).toBe('Pack bags Buy sunscreen');
      expect(notes.find((n) => n.title === `Trip plan${CONFLICT_SUFFIX}`)?.preview).toBe('Pack bags Book hotel');
      expect(await countPending(device.db)).toBe(0);
    }
    expect(Object.keys(server.state.rows.notes)).toHaveLength(2);
  });

  it('keeps the original for the newer edit even if the older edit uploaded second', async () => {
    const { mac, phone } = await twoDevices();
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['List', 'one'], { updatedAt: 1000 }));
    await mac.engine.sync();
    await phone.engine.sync();

    await saveNote(mac, id, notePayload(['List', 'one', 'newer'], { updatedAt: 5000 }));
    await saveNote(phone, id, notePayload(['List', 'one', 'older'], { updatedAt: 4000 }));
    await mac.engine.sync();
    await phone.engine.sync();
    await mac.engine.sync();

    for (const device of [mac, phone]) {
      const notes = await readNotes(device);
      expect(notes.get(id)?.preview).toBe('one newer');
      const copy = [...notes.values()].find((n) => n.title.endsWith(CONFLICT_SUFFIX));
      expect(copy?.preview).toBe('one older');
    }
  });

  it('does not create a copy when both devices made the identical change', async () => {
    const { mac, phone } = await twoDevices();
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Note', 'a'], { updatedAt: 1000 }));
    await mac.engine.sync();
    await phone.engine.sync();
    await saveNote(mac, id, notePayload(['Note', 'b'], { updatedAt: 2000 }));
    await saveNote(phone, id, notePayload(['Note', 'b'], { updatedAt: 2500 }));
    await mac.engine.sync();
    await phone.engine.sync();
    expect(await titles(phone)).toEqual(['Note']);
  });

  it('recovers from a lost upload response without duplicating the note', async () => {
    const { server, mac } = await twoDevices();
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Hello'], { updatedAt: 1000 }));
    const record = (await mac.db.notes.get(id))!;
    // The insert reached the server, but the reply never came back.
    await mac.remote.insert('notes', { id, ciphertext: record.ciphertext, iv: record.iv, deleted_at: null });
    expect(await mac.engine.sync()).toBe('ok');
    expect(Object.keys(server.state.rows.notes)).toEqual([id]);
    expect(await countPending(mac.db)).toBe(0);
    expect(await titles(mac)).toEqual(['Hello']);
  });

  it('resolves folder renames with last-write-wins', async () => {
    const { mac, phone } = await twoDevices();
    const id = crypto.randomUUID();
    await saveFolder(mac, id, 'Ideas', 1000);
    await mac.engine.sync();
    await phone.engine.sync();
    await saveFolder(mac, id, 'Projects', 3000);
    await saveFolder(phone, id, 'Someday', 2000);
    await mac.engine.sync();
    await phone.engine.sync();
    const folder = (await phone.db.folders.get(id))!;
    expect((await openFolderPayload(phone.key!, folder)).name).toBe('Projects');
    expect(await phone.db.folders.count()).toBe(1);
  });

  it('propagates permanent deletes to other devices', async () => {
    const { server, mac, phone } = await twoDevices();
    const keep = crypto.randomUUID();
    const remove = crypto.randomUUID();
    await saveNote(mac, keep, notePayload(['Keep']));
    await saveNote(mac, remove, notePayload(['Remove']));
    await mac.engine.sync();
    await phone.engine.sync();
    expect(await titles(phone)).toEqual(['Keep', 'Remove']);

    await markPurged(mac.db, 'notes', [remove]);
    await mac.engine.sync();
    expect(Object.keys(server.state.rows.notes)).toEqual([keep]);

    await phone.engine.sync({ full: true });
    expect(await titles(phone)).toEqual(['Keep']);
  });

  it('applies realtime notifications from another device', async () => {
    const { mac, phone } = await twoDevices();
    const unsubscribe = phone.remote.subscribe((change) => {
      if (change.type === 'delete') void phone.engine.applyRemoteDelete(change);
      else void phone.engine.sync();
    });
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['From the Mac']));
    await mac.engine.sync();
    await sleep(20);
    await phone.engine.sync(); // wait for any in-flight realtime sync
    expect(await titles(phone)).toEqual(['From the Mac']);
    unsubscribe();
  });

  it('stops and reports when the passcode was changed elsewhere', async () => {
    const { server, phone } = await twoDevices();
    const settings = Object.values(server.state.settings)[0];
    settings.verifier_iv = 'changed-elsewhere';
    expect(await phone.engine.sync()).toBe('vault-changed');
    expect(phone.vaultChanged).toBe(1);
  });
});
