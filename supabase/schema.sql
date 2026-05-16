-- HomeBiddy users table.
-- Run this in the Supabase SQL editor for project otekdxpccncprvsqbdzr.

create table if not exists public.users (
  email text primary key,
  plan text not null default 'free',
  report_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Server-only access: writes/reads go through the service-role key from API routes.
alter table public.users enable row level security;

-- No public policies — anon key cannot read or write. Service key bypasses RLS.
