-- HomeBiddy Dashboard schema v3 — adds the credits/unlimited plan model.
-- Run after schema-v2.sql.

create table if not exists public.user_dashboard_plan (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits_remaining integer not null default 0,
  is_unlimited boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_dashboard_plan enable row level security;
-- Service-role only; clients read through /api/dashboard/plan.

-- Helpful: track total ever-purchased for analytics (optional).
alter table public.user_dashboard_plan
  add column if not exists total_purchased integer not null default 0;
