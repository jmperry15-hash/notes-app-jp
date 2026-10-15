import type { NotesDB } from './db';
import { TABLES, type TableName } from './types';

export const RECENTLY_DELETED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const PURGE_AFTER_MS = RECENTLY_DELETED_DAYS * DAY_MS;

function toMs(deletedAt: string | number): number {
  return typeof deletedAt === 'number' ? deletedAt : Date.parse(deletedAt);
}

export function isExpired(deletedAt: string | number | null, now: number): boolean {
  if (deletedAt === null) return false;
  const ms = toMs(deletedAt);
  return Number.isFinite(ms) && now - ms >= PURGE_AFTER_MS;
}

/** Whole days left before an item in Recently Deleted is removed for good. */
export function daysLeft(deletedAt: string | number, now: number): number {
  return Math.max(0, Math.ceil((toMs(deletedAt) + PURGE_AFTER_MS - now) / DAY_MS));
}

export type PurgeResult = Record<TableName, string[]>;

/**
 * Permanently removes anything that has been in Recently Deleted for 30 days. Items that never
 * reached the server vanish immediately; the rest are queued so the next sync deletes them there too.
 */
export async function purgeExpired(db: NotesDB, now: number = Date.now()): Promise<PurgeResult> {
  const result: PurgeResult = { notes: [], folders: [] };
  for (const table of TABLES) {
    const records = db.records(table);
    await db.transaction('rw', records, async () => {
      const expired = await records.filter((r) => r.state !== 2 && isExpired(r.deleted_at, now)).toArray();
      for (const record of expired) {
        if (record.updated_at === null) await records.delete(record.id);
        else await records.put({ ...record, state: 2, rev: record.rev + 1 });
        result[table].push(record.id);
      }
    });
  }
  return result;
}
