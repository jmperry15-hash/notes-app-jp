import { RemoteError, type InsertResult, type NewRemoteRow, type RekeyRequest, type RemoteChange, type RemoteStore } from './remote';
import { microsToIso, tsMicros } from './timestamps';
import type { RemoteRow, RemoteSettingsRow, TableName } from './types';

export interface MemoryServerState {
  settings: Record<string, RemoteSettingsRow>;
  rows: Record<TableName, Record<string, RemoteRow & { user_id: string }>>;
}

/**
 * An in-memory stand-in for the Supabase backend, used by the tests (and by the local demo mode
 * during development). It mirrors the server rules: `updated_at` is assigned by the server,
 * updates are conditional, and a re-key swaps everything atomically.
 */
export class MemoryServer {
  state: MemoryServerState = { settings: {}, rows: { notes: {}, folders: {} } };
  private lastMicros = 0;
  private listeners = new Set<(change: RemoteChange, userId: string) => void>();
  /** Test hook: make the next re-key fail, as if the request never reached the server. */
  failNextRekey = false;

  constructor(private readonly onPersist?: (state: MemoryServerState) => void) {}

  load(state: MemoryServerState): void {
    this.state = state;
    for (const table of ['notes', 'folders'] as const) {
      for (const row of Object.values(state.rows[table])) {
        this.lastMicros = Math.max(this.lastMicros, tsMicros(row.updated_at));
      }
    }
  }

  /** Strictly increasing server clock with microsecond precision, like `clock_timestamp()`. */
  stamp(): string {
    this.lastMicros = Math.max(Date.now() * 1000, this.lastMicros + 1);
    return microsToIso(this.lastMicros);
  }

  changed(change: RemoteChange, userId: string): void {
    this.onPersist?.(this.state);
    for (const listener of this.listeners) queueMicrotask(() => listener(change, userId));
  }

  listen(listener: (change: RemoteChange, userId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const strip = ({ id, ciphertext, iv, updated_at, deleted_at }: RemoteRow): RemoteRow => ({
  id,
  ciphertext,
  iv,
  updated_at,
  deleted_at,
});

export class MemoryRemote implements RemoteStore {
  /** Simulates losing the network connection. */
  online = true;

  constructor(
    readonly server: MemoryServer,
    private readonly userId: string,
  ) {}

  private guard(): void {
    if (!this.online) throw new RemoteError('Failed to fetch', '', true);
  }

  private rows(table: TableName) {
    return Object.values(this.server.state.rows[table]).filter((r) => r.user_id === this.userId);
  }

  async getSettings(): Promise<RemoteSettingsRow | null> {
    this.guard();
    const row = this.server.state.settings[this.userId];
    return row ? clone(row) : null;
  }

  async createSettings(row: Omit<RemoteSettingsRow, 'user_id' | 'created_at'>): Promise<'created' | 'exists'> {
    this.guard();
    if (this.server.state.settings[this.userId]) return 'exists';
    this.server.state.settings[this.userId] = { ...row, user_id: this.userId, created_at: new Date().toISOString() };
    this.server.changed({ table: 'notes', type: 'upsert', id: 'settings' }, this.userId);
    return 'created';
  }

  async pullSince(table: TableName, since: string | null, offset: number, limit: number): Promise<RemoteRow[]> {
    this.guard();
    const min = since ? tsMicros(since) : -Infinity;
    return this.rows(table)
      .filter((r) => tsMicros(r.updated_at) >= min)
      .sort((a, b) => tsMicros(a.updated_at) - tsMicros(b.updated_at) || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
      .map((r) => clone(strip(r)));
  }

  async listIds(table: TableName): Promise<string[]> {
    this.guard();
    return this.rows(table).map((r) => r.id);
  }

  async getRows(table: TableName, ids: string[]): Promise<RemoteRow[]> {
    this.guard();
    const wanted = new Set(ids);
    return this.rows(table)
      .filter((r) => wanted.has(r.id))
      .map((r) => clone(strip(r)));
  }

  async insert(table: TableName, row: NewRemoteRow): Promise<InsertResult> {
    this.guard();
    if (this.server.state.rows[table][row.id]) return { status: 'exists' };
    const stored = { ...row, user_id: this.userId, updated_at: this.server.stamp() };
    this.server.state.rows[table][row.id] = stored;
    this.server.changed({ table, type: 'upsert', id: row.id }, this.userId);
    return { status: 'ok', row: clone(strip(stored)) };
  }

  async updateIfUnchanged(table: TableName, row: NewRemoteRow, expectedUpdatedAt: string): Promise<RemoteRow | null> {
    this.guard();
    const current = this.server.state.rows[table][row.id];
    if (!current || current.user_id !== this.userId) return null;
    if (tsMicros(current.updated_at) !== tsMicros(expectedUpdatedAt)) return null;
    const stored = { ...current, ciphertext: row.ciphertext, iv: row.iv, deleted_at: row.deleted_at, updated_at: this.server.stamp() };
    this.server.state.rows[table][row.id] = stored;
    this.server.changed({ table, type: 'upsert', id: row.id }, this.userId);
    return clone(strip(stored));
  }

  async remove(table: TableName, ids: string[]): Promise<void> {
    this.guard();
    for (const id of ids) {
      const current = this.server.state.rows[table][id];
      if (!current || current.user_id !== this.userId) continue;
      delete this.server.state.rows[table][id];
      this.server.changed({ table, type: 'delete', id }, this.userId);
    }
  }

  async rekey(request: RekeyRequest): Promise<void> {
    this.guard();
    if (this.server.failNextRekey) {
      this.server.failNextRekey = false;
      throw new RemoteError('Failed to fetch', '', true);
    }
    const settings = this.server.state.settings[this.userId];
    if (!settings || settings.verifier_iv !== request.expectedVerifierIv) {
      throw new RemoteError('vault settings changed; sync and try again', 'P0001', false);
    }
    // Validate everything first so the swap is all-or-nothing, like the SQL function.
    for (const table of ['notes', 'folders'] as const) {
      const expected = new Map(request[table].map((r) => [r.id, r.expected_updated_at]));
      for (const row of this.rows(table)) {
        const at = expected.get(row.id);
        if (!at || tsMicros(at) !== tsMicros(row.updated_at)) {
          throw new RemoteError(`${table} changed during passcode change; try again`, 'P0001', false);
        }
      }
    }
    this.server.state.settings[this.userId] = {
      ...settings,
      kdf_salt: request.salt,
      kdf_iterations: request.iterations,
      verifier_ciphertext: request.verifierCiphertext,
      verifier_iv: request.verifierIv,
    };
    for (const table of ['notes', 'folders'] as const) {
      for (const record of request[table]) {
        const current = this.server.state.rows[table][record.id];
        if (!current) continue;
        // Re-encryption is not an edit, so the timestamp is kept (as in schema.sql).
        this.server.state.rows[table][record.id] = { ...current, ciphertext: record.ciphertext, iv: record.iv };
      }
    }
    this.server.changed({ table: 'notes', type: 'upsert', id: 'rekey' }, this.userId);
  }

  subscribe(onChange: (change: RemoteChange) => void): () => void {
    return this.server.listen((change, userId) => {
      if (userId === this.userId && this.online) onChange(change);
    });
  }
}
