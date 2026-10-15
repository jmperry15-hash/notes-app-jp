import type { Note } from './types';

export interface NoteGroup {
  key: string;
  label: string;
  notes: Note[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date, daysAgo = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo).getTime();
}

/** Groups notes like: Pinned, Today, Yesterday, Previous 7 Days, Previous 30 Days, then by month. */
export function groupNotes(notes: Note[], now: Date = new Date()): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const today = startOfDay(now);
  const yesterday = startOfDay(now, 1);
  const week = startOfDay(now, 7);
  const month = startOfDay(now, 30);

  const groups: NoteGroup[] = [];
  const byKey = new Map<string, NoteGroup>();
  const add = (key: string, label: string, note: Note) => {
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, notes: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.notes.push(note);
  };

  const pinned = sorted.filter((n) => n.pinned && n.deletedAt === null);
  if (pinned.length) {
    const group = { key: 'pinned', label: 'Pinned', notes: pinned };
    groups.push(group);
    byKey.set('pinned', group);
  }

  for (const note of sorted) {
    if (note.pinned && note.deletedAt === null) continue;
    const t = note.updatedAt;
    if (t >= today) add('today', 'Today', note);
    else if (t >= yesterday) add('yesterday', 'Yesterday', note);
    else if (t >= week) add('week', 'Previous 7 Days', note);
    else if (t >= month) add('month', 'Previous 30 Days', note);
    else {
      const d = new Date(t);
      const label = d.toLocaleDateString(undefined, {
        month: 'long',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
      });
      add(`${d.getFullYear()}-${d.getMonth()}`, label, note);
    }
  }
  return groups;
}

/** Short date for a list row: a time today, "Yesterday", a weekday this week, else a numeric date. */
export function formatListDate(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  if (ms >= startOfDay(now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ms >= startOfDay(now, 1)) return 'Yesterday';
  if (ms >= startOfDay(now, 6)) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
}

/** "October 14, 2026 at 6:36 PM" for the top of the editor. */
export function formatEditorDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

export function formatRelative(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(ms).toLocaleDateString();
}
