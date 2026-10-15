import { describe, expect, it } from 'vitest';
import { MemoryServer } from '../src/lib/memoryRemote';
import { daysLeft, isExpired, PURGE_AFTER_MS, purgeExpired } from '../src/lib/purge';
import { createVault, makeDevice, notePayload, saveNote, titles } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('Recently Deleted 30-day purge', () => {
  it('knows when an item expires', () => {
    const now = Date.UTC(2026, 9, 14);
    expect(PURGE_AFTER_MS).toBe(30 * DAY);
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(now - 29 * DAY, now)).toBe(false);
    expect(isExpired(now - 30 * DAY, now)).toBe(true);
    expect(isExpired(new Date(now - 45 * DAY).toISOString(), now)).toBe(true);
    expect(daysLeft(now - 1 * DAY, now)).toBe(29);
    expect(daysLeft(now - 31 * DAY, now)).toBe(0);
  });

  it('permanently removes notes deleted more than 30 days ago, locally and on the server', async () => {
    const server = new MemoryServer();
    const { key, settings } = await createVault(server);
    const mac = await makeDevice(server, key, settings);
    const phone = await makeDevice(server, key, settings);
    const now = Date.now();

    const old = crypto.randomUUID();
    const recent = crypto.randomUUID();
    const live = crypto.randomUUID();
    await saveNote(mac, old, notePayload(['Old']), now - 2 * DAY);
    await saveNote(mac, recent, notePayload(['Recent']), now);
    await saveNote(mac, live, notePayload(['Live']));
    await mac.engine.sync();
    await phone.engine.sync();
    expect(await titles(phone)).toEqual(['Live', 'Old', 'Recent']);

    // A deleted note that never reached the server disappears immediately.
    const neverSynced = crypto.randomUUID();
    await saveNote(mac, neverSynced, notePayload(['Never synced']), now - 10 * DAY);

    // 29 days later: "Old" has been in Recently Deleted for 31 days, "Recent" for 29.
    const later = now + 29 * DAY;
    const purged = await purgeExpired(mac.db, later);
    expect(purged.notes.sort()).toEqual([old, neverSynced].sort());
    expect(await mac.db.notes.get(neverSynced)).toBeUndefined();
    expect((await mac.db.notes.get(old))?.state).toBe(2);
    expect(await titles(mac)).toEqual(['Live', 'Recent']);

    // The next sync deletes it from the server...
    await mac.engine.sync();
    expect(Object.keys(server.state.rows.notes).sort()).toEqual([recent, live].sort());
    expect(await mac.db.notes.get(old)).toBeUndefined();

    // ...and other devices drop their copy too.
    await phone.engine.sync({ full: true });
    expect(await titles(phone)).toEqual(['Live', 'Recent']);
  });

  it('runs automatically as part of every sync', async () => {
    const server = new MemoryServer();
    const { key, settings } = await createVault(server);
    const mac = await makeDevice(server, key, settings);
    const id = crypto.randomUUID();
    await saveNote(mac, id, notePayload(['Expired']), Date.now() - 60 * DAY);
    await mac.engine.sync();
    expect(await mac.db.notes.count()).toBe(0);
    expect(Object.keys(server.state.rows.notes)).toHaveLength(0);
  });
});
