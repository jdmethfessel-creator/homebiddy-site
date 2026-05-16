-- HomeBiddy schema v5 — Land Arbitrage score + transparent score breakdown.
-- Run after schema-v4.sql.

alter table public.reports
  add column if not exists land_arbitrage_score numeric,
  add column if not exists land_arbitrage_notes text,
  add column if not exists score_breakdown jsonb;
