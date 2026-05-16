-- HomeBiddy schema v4 — cost + valuation fields on public.reports.
-- Run after schema-v3.sql.

alter table public.reports
  add column if not exists lot_size_sqft integer,
  add column if not exists price_per_living_sqft numeric,
  add column if not exists price_per_lot_sqft numeric,
  add column if not exists last_sold_price numeric,
  add column if not exists last_sold_year integer,
  add column if not exists tax_assessed_value numeric,
  add column if not exists annual_taxes_current numeric,
  add column if not exists annual_taxes_projected numeric,
  add column if not exists hoa_monthly numeric default 0,
  add column if not exists flood_zone text,
  add column if not exists estimated_monthly_mortgage numeric,
  add column if not exists estimated_monthly_insurance numeric,
  add column if not exists estimated_monthly_total numeric;
