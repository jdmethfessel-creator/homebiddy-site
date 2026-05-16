-- HomeBiddy schema v6 — async analysis status on saved_homes.
-- Run after schema-v5.sql.
--
-- status:           'pending' while Claude analysis is in flight, 'complete'
--                    once a report is associated, 'failed' after retries exhausted
-- analysis_attempts: counter incremented on each Claude attempt
-- last_error:        most recent error message (null on success)

alter table public.saved_homes
  add column if not exists status text not null default 'complete',
  add column if not exists analysis_attempts integer not null default 0,
  add column if not exists last_error text;
