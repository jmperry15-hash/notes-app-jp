import { groupNotes, type NoteGroup } from '../lib/dates';
import type { Folder, Note } from '../lib/types';

export type FolderView = { kind: 'all' } | { kind: 'deleted' } | { kind: 'folder'; id: string };

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function noteMatches(note: Note, query: string): boolean {
  if (!query) return true;
  return note.title.toLowerCase().includes(query) || note.text.toLowerCase().includes(query);
}

/** Notes shown in the list for the current view. A search covers every folder. */
export function visibleNotes(notes: Map<string, Note>, view: FolderView, search: string): Note[] {
  const query = normalizeQuery(search);
  const out: Note[] = [];
  for (const note of notes.values()) {
    if (view.kind === 'deleted') {
      if (note.deletedAt === null) continue;
    } else {
      if (note.deletedAt !== null) continue;
      if (!query && view.kind === 'folder' && note.folderId !== view.id) continue;
    }
    if (noteMatches(note, query)) out.push(note);
  }
  return out;
}

export function listGroups(notes: Note[], view: FolderView): NoteGroup[] {
  if (view.kind === 'deleted') {
    const sorted = [...notes].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    return sorted.length ? [{ key: 'deleted', label: '', notes: sorted }] : [];
  }
  return groupNotes(notes);
}

/** The order notes appear in the list, used to pick the next note after a delete. */
export function displayOrder(notes: Map<string, Note>, view: FolderView, search: string): Note[] {
  return listGroups(visibleNotes(notes, view, search), view).flatMap((g) => g.notes);
}

export function liveFolders(folders: Map<string, Folder>): Folder[] {
  return [...folders.values()]
    .filter((f) => f.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

export function viewTitle(view: FolderView, folders: Map<string, Folder>): string {
  if (view.kind === 'all') return 'All Notes';
  if (view.kind === 'deleted') return 'Recently Deleted';
  return folders.get(view.id)?.name ?? 'Folder';
}

export interface Counts {
  all: number;
  deleted: number;
  byFolder: Map<string, number>;
}

export function countNotes(notes: Map<string, Note>): Counts {
  const counts: Counts = { all: 0, deleted: 0, byFolder: new Map() };
  for (const note of notes.values()) {
    if (note.deletedAt !== null) {
      counts.deleted++;
      continue;
    }
    counts.all++;
    if (note.folderId) counts.byFolder.set(note.folderId, (counts.byFolder.get(note.folderId) ?? 0) + 1);
  }
  return counts;
}

export function sameView(a: FolderView, b: FolderView): boolean {
  return a.kind === b.kind && (a.kind !== 'folder' || a.id === (b as { id: string }).id);
}
