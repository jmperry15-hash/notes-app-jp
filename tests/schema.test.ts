import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs supabase/schema.sql against a real Postgres (PGlite) with a minimal stand-in for the parts
 * of Supabase it depends on: the anon/authenticated roles, auth.users, auth.uid() and the
 * realtime publication. This checks the SQL is valid and that Row Level Security holds.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants everything to both roles by default; the schema must lock it down itself.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create publication supabase_realtime;
`;

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const schema = readFileSync(join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');

let db: PGlite;

async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const insertNote = (user: string, id: string, ownerColumn = user) =>
  as(user, `insert into public.notes (id, user_id, ciphertext, iv) values ($1, $2, 'ct', 'iv') returning updated_at::text`, [
    id,
    ownerColumn,
  ]);

describe('supabase/schema.sql', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(schema);
    await db.exec(schema); // must be safe to run twice
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [ALICE, BOB]);
  });

  it('adds both tables to the realtime publication', async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
    );
    expect(rows.rows.map((r) => r.tablename)).toEqual(['folders', 'notes']);
  });

  it('lets each user see and change only their own rows', async () => {
    const aliceNote = crypto.randomUUID();
    const bobNote = crypto.randomUUID();
    await insertNote(ALICE, aliceNote);
    await insertNote(BOB, bobNote);

    expect((await as(ALICE, 'select id from public.notes')).map((r) => r.id)).toEqual([aliceNote]);
    expect((await as(BOB, 'select id from public.notes')).map((r) => r.id)).toEqual([bobNote]);

    // Bob cannot touch Alice's note.
    expect(await as(BOB, `update public.notes set ciphertext = 'x' where id = $1 returning id`, [aliceNote])).toEqual([]);
    expect(await as(BOB, `delete from public.notes where id = $1 returning id`, [aliceNote])).toEqual([]);
    // ...nor create rows that claim to be hers, or hand his rows to her.
    await expect(insertNote(BOB, crypto.randomUUID(), ALICE)).rejects.toThrow(/row-level security/);
    await expect(as(BOB, `update public.notes set user_id = $1 where id = $2`, [ALICE, bobNote])).rejects.toThrow(
      /row-level security/,
    );
    expect((await as(ALICE, 'select ciphertext from public.notes'))[0].ciphertext).toBe('ct');
  });

  it('gives signed-out visitors no access at all', async () => {
    await expect(as(null, 'select * from public.notes')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select * from public.user_settings')).rejects.toThrow(/permission denied/);
    await expect(
      as(null, `select public.rekey_vault('a', 'b', 600000, 'c', 'd', '[]'::jsonb, '[]'::jsonb)`),
    ).rejects.toThrow(/permission denied/);
  });

  it('assigns updated_at on the server, ignoring the client clock', async () => {
    const id = crypto.randomUUID();
    const [row] = await as<{ updated_at: string }>(
      ALICE,
      `insert into public.folders (id, user_id, ciphertext, iv, updated_at)
       values ($1, $2, 'ct', 'iv', '2000-01-01') returning updated_at::text`,
      [id, ALICE],
    );
    expect(row.updated_at.startsWith('2000')).toBe(false);
  });

  it('re-keys everything atomically, and refuses if anything changed meanwhile', async () => {
    await as(ALICE, `delete from public.notes`);
    await as(
      ALICE,
      `insert into public.user_settings (user_id, kdf_salt, kdf_iterations, verifier_ciphertext, verifier_iv)
       values ($1, 'salt1', 600000, 'v1', 'iv1')`,
      [ALICE],
    );
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) await insertNote(ALICE, id);
    const notes = await as<{ id: string; updated_at: string }>(ALICE, `select id, updated_at::text from public.notes`);
    const folders = await as<{ id: string; updated_at: string }>(ALICE, `select id, updated_at::text from public.folders`);
    const payload = (rows: { id: string; updated_at: string }[]) =>
      JSON.stringify(rows.map((r) => ({ id: r.id, ciphertext: `new-${r.id}`, iv: 'new-iv', expected_updated_at: r.updated_at })));
    const rekey = (expectedIv: string, notesJson: string) =>
      as(ALICE, `select public.rekey_vault($1, 'salt2', 600000, 'v2', 'iv2', $2::jsonb, $3::jsonb)`, [
        expectedIv,
        notesJson,
        payload(folders),
      ]);

    // A note missing from the request (e.g. added by another device) aborts the whole swap.
    await expect(rekey('iv1', payload(notes.slice(1)))).rejects.toThrow(/changed during the passcode change/);
    // So does a stale view of the key settings.
    await expect(rekey('stale', payload(notes))).rejects.toThrow(/changed on another device/);
    expect((await as(ALICE, `select kdf_salt from public.user_settings`))[0].kdf_salt).toBe('salt1');
    expect((await as(ALICE, `select ciphertext from public.notes`)).map((r) => r.ciphertext)).toEqual(['ct', 'ct']);

    await rekey('iv1', payload(notes));
    expect((await as(ALICE, `select kdf_salt, verifier_iv from public.user_settings`))[0]).toEqual({
      kdf_salt: 'salt2',
      verifier_iv: 'iv2',
    });
    const after = await as<{ id: string; ciphertext: string; updated_at: string }>(
      ALICE,
      `select id, ciphertext, updated_at::text from public.notes order by id`,
    );
    for (const row of after) {
      expect(row.ciphertext).toBe(`new-${row.id}`);
      // Re-encryption keeps timestamps, so other devices' pending edits still apply cleanly.
      expect(row.updated_at).toBe(notes.find((n) => n.id === row.id)?.updated_at);
    }

    // Normal edits still get a fresh timestamp afterwards.
    const [edited] = await as<{ updated_at: string }>(
      ALICE,
      `update public.notes set ciphertext = 'edit' where id = $1 returning updated_at::text`,
      [ids[0]],
    );
    expect(edited.updated_at).not.toBe(notes.find((n) => n.id === ids[0])?.updated_at);

    // Bob's rows are never touched by Alice's re-key.
    expect((await as(BOB, `select ciphertext from public.notes`))[0].ciphertext).toBe('ct');
  });
});
