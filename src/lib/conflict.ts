import { appendToFirstLine, deriveNoteText } from './noteText';
import type { FolderPayload, NotePayload } from './types';

export const CONFLICT_SUFFIX = ' (conflicted copy)';

export interface NoteVersion {
  payload: NotePayload;
  deletedAt: string | null;
}

export interface NoteResolution {
  /** Which version keeps the original note (last write wins by its edit time). */
  winner: 'local' | 'remote';
  /** The other version, preserved as "Title (conflicted copy)", or null if nothing would be lost. */
  copy: NoteVersion | null;
}

/** The moment a version was last written: its last edit, or when it was deleted if that came later. */
export function versionTime(version: NoteVersion): number {
  const deleted = version.deletedAt ? Date.parse(version.deletedAt) : 0;
  return Math.max(version.payload.updatedAt, deleted);
}

function sameContent(a: NotePayload, b: NotePayload): boolean {
  return a.title === b.title && JSON.stringify(a.body) === JSON.stringify(b.body);
}

export function makeConflictCopy(payload: NotePayload): NotePayload {
  const body = appendToFirstLine(payload.body, CONFLICT_SUFFIX);
  const { title, preview } = deriveNoteText(body);
  return { ...payload, body, title, preview, pinned: false };
}

/**
 * Called when the same note changed on this device and on the server since the last sync.
 * Last write wins, but if the two versions have different text the older one is kept as a
 * conflicted copy rather than silently discarded.
 */
export function resolveNoteConflict(local: NoteVersion, remote: NoteVersion): NoteResolution {
  const winner = versionTime(local) > versionTime(remote) ? 'local' : 'remote';
  const kept = winner === 'local' ? local : remote;
  const other = winner === 'local' ? remote : local;
  // A losing deletion needs no copy: the person chose to throw that version away.
  if (other.deletedAt || sameContent(kept.payload, other.payload)) return { winner, copy: null };
  return { winner, copy: { payload: makeConflictCopy(other.payload), deletedAt: other.deletedAt } };
}

export interface FolderVersion {
  payload: FolderPayload;
  deletedAt: string | null;
}

/** Folders hold no free text worth duplicating, so plain last-write-wins applies. */
export function resolveFolderConflict(local: FolderVersion, remote: FolderVersion): 'local' | 'remote' {
  const time = (v: FolderVersion) => Math.max(v.payload.updatedAt, v.deletedAt ? Date.parse(v.deletedAt) : 0);
  return time(local) > time(remote) ? 'local' : 'remote';
}
