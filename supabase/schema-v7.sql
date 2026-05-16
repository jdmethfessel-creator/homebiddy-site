-- HomeBiddy schema v7
-- 1) Lifestyle / school columns on reports
-- 2) dashboard_shares table for the read-only share-link feature
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1) Lifestyle + school columns on reports
-- ============================================================================
alter table public.reports
  add column if not exists walk_score integer,
  add column if not exists transit_score integer,
  add column if not exists bike_score integer,
  add column if not exists elementary_school text,
  add column if not exists elementary_rating numeric,
  add column if not exists middle_school text,
  add column if not exists middle_rating numeric,
  add column if not exists high_school text,
  add column if not exists high_rating numeric,
  add column if not exists school_rating_avg numeric,
  add column if not exists commute_to_downtown_min integer,
  add column if not exists nearest_grocery_min integer;

-- ============================================================================
-- 2) dashboard_shares — public read-only tokens for sharing a watchlist
-- ============================================================================
create table if not exists public.dashboard_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists dashboard_shares_user_idx on public.dashboard_shares (user_id);
create index if not exists dashboard_shares_token_idx on public.dashboard_shares (token);

alter table public.dashboard_shares enable row level security;

-- Service-role only access — clients always go through /api/dashboard/share
-- and /api/shared/[token], which both use the admin client.
drop policy if exists "Users see their own shares" on public.dashboard_shares;
create policy "Users see their own shares"
  on public.dashboard_shares
  for select
  to authenticated
  using (auth.uid() = user_id);
