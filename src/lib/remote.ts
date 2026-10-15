import type { SupabaseClient } from '@supabase/supabase-js';
import { TABLES, type RemoteRow, type RemoteSettingsRow, type TableName } from './types';

export interface NewRemoteRow {
  id: string;
  ciphertext: string;
  iv: string;
  deleted_at: string | null;
}

export type InsertResult = { status: 'ok'; row: RemoteRow } | { status: 'exists' };

export interface RekeyRecord {
  id: string;
  ciphertext: string;
  iv: string;
  /** The server version this re-encryption was based on; the swap aborts if the row changed since. */
  expected_updated_at: string;
}

export interface RekeyRequest {
  expectedVerifierIv: string;
  salt: string;
  iterations: number;
  verifierCiphertext: string;
  verifierIv: string;
  notes: RekeyRecord[];
  folders: RekeyRecord[];
}

export interface RemoteChange {
  table: TableName;
  type: 'upsert' | 'delete';
  id: string;
}

/**
 * Everything the app needs from the server. Only ciphertext and non-sensitive metadata ever
 * cross this boundary. Implemented for Supabase below and in memory for tests.
 */
export interface RemoteStore {
  getSettings(): Promise<RemoteSettingsRow | null>;
  createSettings(row: Omit<RemoteSettingsRow, 'user_id' | 'created_at'>): Promise<'created' | 'exists'>;
  /** Rows changed at or after `since` (all rows if null), oldest first. */
  pullSince(table: TableName, since: string | null, offset: number, limit: number): Promise<RemoteRow[]>;
  listIds(table: TableName): Promise<string[]>;
  getRows(table: TableName, ids: string[]): Promise<RemoteRow[]>;
  insert(table: TableName, row: NewRemoteRow): Promise<InsertResult>;
  /** Updates the row only if its `updated_at` still equals `expectedUpdatedAt`; returns null otherwise. */
  updateIfUnchanged(table: TableName, row: NewRemoteRow, expectedUpdatedAt: string): Promise<RemoteRow | null>;
  remove(table: TableName, ids: string[]): Promise<void>;
  /** Atomically replaces the key settings and every row's ciphertext (passcode change). */
  rekey(request: RekeyRequest): Promise<void>;
  subscribe(onChange: (change: RemoteChange) => void): () => void;
}

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly network: boolean,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

const NETWORK_PATTERNS = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

export function isNetworkError(error: unknown): boolean {
  if (error instanceof RemoteError) return error.network;
  if (error instanceof TypeError) return true;
  return error instanceof Error && NETWORK_PATTERNS.test(error.message);
}

function check(error: { message: string; code?: string } | null): void {
  if (!error) return;
  throw new RemoteError(error.message, error.code, NETWORK_PATTERNS.test(error.message) || error.code === '');
}

const COLUMNS = 'id, ciphertext, iv, updated_at, deleted_at';
const CHUNK = 100;

export class SupabaseRemote implements RemoteStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async getSettings(): Promise<RemoteSettingsRow | null> {
    const { data, error } = await this.client
      .from('user_settings')
      .select('user_id, kdf_salt, kdf_iterations, verifier_ciphertext, verifier_iv, created_at')
      .eq('user_id', this.userId)
      .maybeSingle();
    check(error);
    return (data as RemoteSettingsRow | null) ?? null;
  }

  async createSettings(row: Omit<RemoteSettingsRow, 'user_id' | 'created_at'>): Promise<'created' | 'exists'> {
    const { error } = await this.client.from('user_settings').insert({ ...row, user_id: this.userId });
    if (error?.code === '23505') return 'exists';
    check(error);
    return 'created';
  }

  async pullSince(table: TableName, since: string | null, offset: number, limit: number): Promise<RemoteRow[]> {
    let query = this.client.from(table).select(COLUMNS).eq('user_id', this.userId);
    if (since) query = query.gte('updated_at', since);
    const { data, error } = await query
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    check(error);
    return (data ?? []) as RemoteRow[];
  }

  async listIds(table: TableName): Promise<string[]> {
    const ids: string[] = [];
    const page = 1000;
    for (let offset = 0; ; offset += page) {
      const { data, error } = await this.client
        .from(table)
        .select('id')
        .eq('user_id', this.userId)
        .order('id', { ascending: true })
        .range(offset, offset + page - 1);
      check(error);
      const rows = (data ?? []) as { id: string }[];
      ids.push(...rows.map((r) => r.id));
      if (rows.length < page) return ids;
    }
  }

  async getRows(table: TableName, ids: string[]): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await this.client
        .from(table)
        .select(COLUMNS)
        .in('id', ids.slice(i, i + CHUNK));
      check(error);
      rows.push(...((data ?? []) as RemoteRow[]));
    }
    return rows;
  }

  async insert(table: TableName, row: NewRemoteRow): Promise<InsertResult> {
    const { data, error } = await this.client
      .from(table)
      .insert({ ...row, user_id: this.userId })
      .select(COLUMNS)
      .single();
    if (error?.code === '23505') return { status: 'exists' };
    check(error);
    return { status: 'ok', row: data as RemoteRow };
  }

  async updateIfUnchanged(table: TableName, row: NewRemoteRow, expectedUpdatedAt: string): Promise<RemoteRow | null> {
    const { data, error } = await this.client
      .from(table)
      .update({ ciphertext: row.ciphertext, iv: row.iv, deleted_at: row.deleted_at })
      .eq('id', row.id)
      .eq('updated_at', expectedUpdatedAt)
      .select(COLUMNS);
    check(error);
    return ((data ?? []) as RemoteRow[])[0] ?? null;
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await this.client.from(table).delete().in('id', ids.slice(i, i + CHUNK));
      check(error);
    }
  }

  async rekey(request: RekeyRequest): Promise<void> {
    const { error } = await this.client.rpc('rekey_vault', {
      p_expected_verifier_iv: request.expectedVerifierIv,
      p_kdf_salt: request.salt,
      p_kdf_iterations: request.iterations,
      p_verifier_ciphertext: request.verifierCiphertext,
      p_verifier_iv: request.verifierIv,
      p_notes: request.notes,
      p_folders: request.folders,
    });
    check(error);
  }

  subscribe(onChange: (change: RemoteChange) => void): () => void {
    const channel = this.client.channel(`folio-sync-${this.userId}`);
    for (const table of TABLES) {
      const filter = `user_id=eq.${this.userId}`;
      const upsert = (payload: { new: unknown }) => {
        const id = (payload.new as { id?: string } | null)?.id;
        if (id) onChange({ table, type: 'upsert', id });
      };
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, upsert)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, upsert)
        // Postgres cannot filter DELETE events by column, so these arrive unfiltered (id only).
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
          const id = (payload.old as { id?: string } | null)?.id;
          if (id) onChange({ table, type: 'delete', id });
        });
    }
    channel.subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
