-- Public Tagesranking support for Plose storefront
-- Additive, rollback-safe migration.

begin;

-- 1) Store public profile snapshot directly on leaderboard rows
alter table if exists public.leaderboard_entries
  add column if not exists display_name text,
  add column if not exists avatar_url text;

-- 2) Performance index for daily park/user lookups
create index if not exists leaderboard_entries_park_day_user_idx
  on public.leaderboard_entries (park_id, ride_date, user_id);

-- 3) Ensure RLS is enabled
alter table if exists public.leaderboard_entries enable row level security;

-- 4) Policies: public can read ranking, authenticated users can write only own row
-- Public read (needed so logged-out visitors can see Tagesranking)
drop policy if exists leaderboard_entries_public_read on public.leaderboard_entries;
create policy leaderboard_entries_public_read
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (true);

-- Authenticated users can insert own ranking row only
drop policy if exists leaderboard_entries_insert_own on public.leaderboard_entries;
create policy leaderboard_entries_insert_own
  on public.leaderboard_entries
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.park_id = leaderboard_entries.park_id
    )
  );

-- Authenticated users can update only own ranking row
drop policy if exists leaderboard_entries_update_own on public.leaderboard_entries;
create policy leaderboard_entries_update_own
  on public.leaderboard_entries
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.park_id = leaderboard_entries.park_id
    )
  );

commit;
