-- =============================================================================
-- Folio — Supabase schema
--
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- It is safe to run more than once.
--
-- Everything sensitive (titles, note bodies, folder names, pinned state, ...) is
-- encrypted on your devices before it is uploaded. The server only ever stores
-- ciphertext, the IV used to encrypt it, and non-sensitive metadata.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Key-derivation salt and an encrypted "verifier" used to detect a wrong passcode.
-- The passcode itself never leaves your devices.
create table if not exists public.user_settings (
  user_id              uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kdf_salt             text not null check (char_length(kdf_salt) <= 64),
  kdf_iterations       integer not null check (kdf_iterations between 100000 and 10000000),
  verifier_ciphertext  text not null check (char_length(verifier_ciphertext) <= 1024),
  verifier_iv          text not null check (char_length(verifier_iv) <= 64),
  created_at           timestamptz not null default now()
);

create table if not exists public.folders (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ciphertext  text not null check (char_length(ciphertext) <= 1000000),
  iv          text not null check (char_length(iv) <= 64),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ciphertext  text not null check (char_length(ciphertext) <= 8000000),
  iv          text not null check (char_length(iv) <= 64),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);


-- -----------------------------------------------------------------------------
-- Indexes (sync asks for "my rows changed since X")
-- -----------------------------------------------------------------------------

create index if not exists folders_user_id_updated_at_idx on public.folders (user_id, updated_at);
create index if not exists notes_user_id_updated_at_idx on public.notes (user_id, updated_at);


-- -----------------------------------------------------------------------------
-- updated_at is always assigned by the server, so every device agrees on the
-- order of changes no matter how its own clock is set. A passcode change only
-- re-encrypts rows (it is not an edit), so it keeps their timestamps.
-- -----------------------------------------------------------------------------

create or replace function public.folio_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('folio.rekeying', true), '') = 'on' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists folders_touch_updated_at on public.folders;
create trigger folders_touch_updated_at
  before insert or update on public.folders
  for each row execute function public.folio_touch_updated_at();

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before insert or update on public.notes
  for each row execute function public.folio_touch_updated_at();


-- -----------------------------------------------------------------------------
-- Row Level Security: a signed-in user can only see and change their own rows.
-- -----------------------------------------------------------------------------

alter table public.user_settings enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;

-- user_settings
drop policy if exists "user_settings: select own" on public.user_settings;
create policy "user_settings: select own" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user_settings: insert own" on public.user_settings;
create policy "user_settings: insert own" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings: update own" on public.user_settings;
create policy "user_settings: update own" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "user_settings: delete own" on public.user_settings;
create policy "user_settings: delete own" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- folders
drop policy if exists "folders: select own" on public.folders;
create policy "folders: select own" on public.folders
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "folders: insert own" on public.folders;
create policy "folders: insert own" on public.folders
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "folders: update own" on public.folders;
create policy "folders: update own" on public.folders
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "folders: delete own" on public.folders;
create policy "folders: delete own" on public.folders
  for delete to authenticated using ((select auth.uid()) = user_id);

-- notes
drop policy if exists "notes: select own" on public.notes;
create policy "notes: select own" on public.notes
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "notes: insert own" on public.notes;
create policy "notes: insert own" on public.notes
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "notes: update own" on public.notes;
create policy "notes: update own" on public.notes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "notes: delete own" on public.notes;
create policy "notes: delete own" on public.notes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-out visitors (the "anon" role) get no access at all.
revoke all on table public.user_settings, public.folders, public.notes from anon;
grant select, insert, update, delete on table public.user_settings, public.folders, public.notes to authenticated;


-- -----------------------------------------------------------------------------
-- Passcode change: swap the key settings and every row's ciphertext in ONE
-- transaction, so an interrupted change can never leave a mix of old and new
-- encryption on the server. Runs with the caller's permissions (RLS applies).
-- -----------------------------------------------------------------------------

create or replace function public.rekey_vault(
  p_expected_verifier_iv  text,
  p_kdf_salt              text,
  p_kdf_iterations        integer,
  p_verifier_ciphertext   text,
  p_verifier_iv           text,
  p_notes                 jsonb,
  p_folders               jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  update public.user_settings
     set kdf_salt            = p_kdf_salt,
         kdf_iterations      = p_kdf_iterations,
         verifier_ciphertext = p_verifier_ciphertext,
         verifier_iv         = p_verifier_iv
   where user_id = v_uid
     and verifier_iv = p_expected_verifier_iv;
  if not found then
    raise exception 'Passcode settings changed on another device. Sync and try again.' using errcode = 'P0001';
  end if;

  -- Every existing row must be included, unchanged since the device read it.
  if exists (
    select 1
      from public.notes n
      left join jsonb_to_recordset(p_notes) as r(id uuid, expected_updated_at timestamptz) on r.id = n.id
     where n.user_id = v_uid
       and (r.id is null or r.expected_updated_at is distinct from n.updated_at)
  ) then
    raise exception 'Notes changed during the passcode change. Try again.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.folders f
      left join jsonb_to_recordset(p_folders) as r(id uuid, expected_updated_at timestamptz) on r.id = f.id
     where f.user_id = v_uid
       and (r.id is null or r.expected_updated_at is distinct from f.updated_at)
  ) then
    raise exception 'Folders changed during the passcode change. Try again.' using errcode = 'P0001';
  end if;

  -- Re-encryption is not an edit: keep each row's updated_at (see folio_touch_updated_at).
  perform set_config('folio.rekeying', 'on', true);

  update public.notes n
     set ciphertext = r.ciphertext,
         iv         = r.iv
    from jsonb_to_recordset(p_notes) as r(id uuid, ciphertext text, iv text)
   where n.id = r.id
     and n.user_id = v_uid;

  update public.folders f
     set ciphertext = r.ciphertext,
         iv         = r.iv
    from jsonb_to_recordset(p_folders) as r(id uuid, ciphertext text, iv text)
   where f.id = r.id
     and f.user_id = v_uid;

  perform set_config('folio.rekeying', 'off', true);
end;
$$;

revoke all on function public.rekey_vault(text, text, integer, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.rekey_vault(text, text, integer, text, text, jsonb, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- Realtime: push changes to your other devices within seconds.
-- (Realtime also respects the RLS policies above.)
-- -----------------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.folders;
exception
  when duplicate_object then null;
end;
$$;
