import type { JSONContent } from '@tiptap/core';

export type TableName = 'notes' | 'folders';
export const TABLES: readonly TableName[] = ['folders', 'notes'];

/** 0 = matches the server, 1 = local changes waiting to upload, 2 = permanently deleted, removal waiting to upload. */
export type RecordState = 0 | 1 | 2;

/**
 * A note or folder as stored in IndexedDB. Everything sensitive lives inside `ciphertext`;
 * the remaining fields are the non-sensitive metadata the sync engine needs.
 */
export interface LocalRecord {
  id: string;
  ciphertext: string;
  iv: string;
  /** Server `updated_at` of the version this record is based on (null = never uploaded). */
  updated_at: string | null;
  /** When the item was moved to Recently Deleted (ISO string), or null. */
  deleted_at: string | null;
  state: RecordState;
  /** Bumped on every local write so a sync never overwrites edits made while it was running. */
  rev: number;
}

/** A row in the Supabase `notes` or `folders` table. */
export interface RemoteRow {
  id: string;
  ciphertext: string;
  iv: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Decrypted note contents. Everything here is encrypted before it leaves memory. */
export interface NotePayload {
  title: string;
  /** TipTap document JSON. */
  body: JSONContent;
  /** One-line plain-text preview shown in the note list. */
  preview: string;
  folderId: string | null;
  pinned: boolean;
  createdAt: number;
  /** When the content was last edited (ms since epoch). */
  updatedAt: number;
}

export interface FolderPayload {
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** A decrypted note held in memory while the app is unlocked. */
export interface Note extends NotePayload {
  id: string;
  deletedAt: number | null;
  /** Full plain text, derived on decrypt for search. Never stored. */
  text: string;
  /** In memory only: bumped when another device changed this note, so an open editor reloads it. */
  syncRev?: number;
}

export interface Folder extends FolderPayload {
  id: string;
  deletedAt: number | null;
}

/** Key-derivation parameters plus the encrypted verifier, cached locally so unlocking works offline. */
export interface VaultSettings {
  userId: string;
  salt: string;
  iterations: number;
  verifierCiphertext: string;
  verifierIv: string;
}

/** Shape of a row in the Supabase `user_settings` table. */
export interface RemoteSettingsRow {
  user_id: string;
  kdf_salt: string;
  kdf_iterations: number;
  verifier_ciphertext: string;
  verifier_iv: string;
  created_at?: string;
}

export function settingsFromRow(row: RemoteSettingsRow): VaultSettings {
  return {
    userId: row.user_id,
    salt: row.kdf_salt,
    iterations: row.kdf_iterations,
    verifierCiphertext: row.verifier_ciphertext,
    verifierIv: row.verifier_iv,
  };
}

export function sameVault(a: VaultSettings, b: VaultSettings): boolean {
  return a.salt === b.salt && a.verifierIv === b.verifierIv && a.verifierCiphertext === b.verifierCiphertext;
}
