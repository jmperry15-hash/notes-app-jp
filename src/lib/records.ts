import type { JSONContent } from '@tiptap/core';
import { decryptJSON, encryptJSON, type Sealed } from './crypto';
import { deriveNoteText, emptyNoteDoc } from './noteText';
import type { Folder, FolderPayload, Note, NotePayload, TableName } from './types';

/** Binds each ciphertext to its table and id. */
export const aadFor = (table: TableName, id: string) => `${table}:${id}`;

interface CipherRecord {
  id: string;
  ciphertext: string;
  iv: string;
  deleted_at: string | null;
}

export function toNotePayload(note: NotePayload): NotePayload {
  return {
    title: note.title,
    body: note.body,
    preview: note.preview,
    folderId: note.folderId,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function toFolderPayload(folder: FolderPayload): FolderPayload {
  return { name: folder.name, createdAt: folder.createdAt, updatedAt: folder.updatedAt };
}

export function sealNote(key: CryptoKey, id: string, note: NotePayload): Promise<Sealed> {
  return encryptJSON(key, toNotePayload(note), aadFor('notes', id));
}

export function sealFolder(key: CryptoKey, id: string, folder: FolderPayload): Promise<Sealed> {
  return encryptJSON(key, toFolderPayload(folder), aadFor('folders', id));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Decrypts a note payload, filling in defaults so a malformed payload can never crash the UI. */
export async function openNotePayload(key: CryptoKey, record: CipherRecord): Promise<NotePayload> {
  const raw = await decryptJSON<Partial<NotePayload>>(key, record, aadFor('notes', record.id));
  const body: JSONContent = raw.body && typeof raw.body === 'object' ? raw.body : emptyNoteDoc();
  const derived = deriveNoteText(body);
  return {
    title: typeof raw.title === 'string' ? raw.title : derived.title,
    body,
    preview: typeof raw.preview === 'string' ? raw.preview : derived.preview,
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    pinned: raw.pinned === true,
    createdAt: asNumber(raw.createdAt, Date.now()),
    updatedAt: asNumber(raw.updatedAt, asNumber(raw.createdAt, Date.now())),
  };
}

export async function openNote(key: CryptoKey, record: CipherRecord): Promise<Note> {
  const payload = await openNotePayload(key, record);
  return {
    ...payload,
    id: record.id,
    deletedAt: record.deleted_at ? Date.parse(record.deleted_at) : null,
    text: deriveNoteText(payload.body).text,
  };
}

export async function openFolderPayload(key: CryptoKey, record: CipherRecord): Promise<FolderPayload> {
  const raw = await decryptJSON<Partial<FolderPayload>>(key, record, aadFor('folders', record.id));
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled Folder',
    createdAt: asNumber(raw.createdAt, Date.now()),
    updatedAt: asNumber(raw.updatedAt, asNumber(raw.createdAt, Date.now())),
  };
}

export async function openFolder(key: CryptoKey, record: CipherRecord): Promise<Folder> {
  const payload = await openFolderPayload(key, record);
  return { ...payload, id: record.id, deletedAt: record.deleted_at ? Date.parse(record.deleted_at) : null };
}

export const toIso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
