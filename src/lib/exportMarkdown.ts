import { docToMarkdown } from './markdown';
import { displayTitle } from './noteText';
import type { Folder, Note } from './types';
import { createZip } from './zip';

function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return cleaned || 'Untitled';
}

/** Builds an UNENCRYPTED .zip with one Markdown file per note, in a folder per Folio folder. */
export function buildMarkdownZip(notes: Note[], folders: Map<string, Folder>): Uint8Array<ArrayBuffer> {
  const used = new Set<string>();
  const entries = notes
    .filter((note) => note.deletedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((note) => {
      const folder = note.folderId ? folders.get(note.folderId) : undefined;
      const dir = folder && folder.deletedAt === null ? `${safeName(folder.name)}/` : '';
      const base = safeName(displayTitle(note.title));
      let path = `${dir}${base}.md`;
      for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}${base} ${n}.md`;
      used.add(path.toLowerCase());
      return { name: path, data: docToMarkdown(note.body), date: new Date(note.updatedAt) };
    });
  return createZip(entries);
}

export function markdownZipName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `folio-notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}
