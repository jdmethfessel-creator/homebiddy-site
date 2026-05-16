-- HomeBiddy Saved Homes Dashboard schema.
-- Run after schema.sql, in the Supabase SQL editor for project otekdxpccncprvsqbdzr.

-- ============================================================================
-- saved_homes: a user's watchlist. Multiple users can save the same address.
-- ============================================================================
create table if not exists public.saved_homes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  listing_url text,
  created_at timestamptz not null default now(),
  unique (user_id, address)
);

create index if not exists saved_homes_user_id_idx on public.saved_homes (user_id);

alter table public.saved_homes enable row level security;

drop policy if exists "Users manage their own saved homes" on public.saved_homes;
create policy "Users manage their own saved homes"
  on public.saved_homes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- reports: canonical analysis per address. One row per address, shared storage.
-- Access is gated per-user via report_access (below) since reports are per-user.
-- ============================================================================
create table if not exists public.reports (
  address text primary key,
  asking_price integer,
  offer_low integer,
  offer_high integer,
  negotiability_score numeric,
  days_on_market integer,
  price_cuts integer,
  zestimate_gap integer,
  neighborhood text,
  appreciation_rate_annual numeric,        -- 0.038 = 3.8%/yr
  beds integer,
  baths numeric,
  sqft integer,
  data jsonb,                              -- full structured report
  generated_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- Reports are only readable through API routes (service role bypasses RLS).
-- No public policies — clients always go through /api/dashboard/report.

-- ============================================================================
-- report_access: which users have unlocked which reports (per-user paywall).
-- ============================================================================
create table if not exists public.report_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  granted_at timestamptz not null default now(),
  stripe_session_id text,
  primary key (user_id, address)
);

create index if not exists report_access_user_id_idx on public.report_access (user_id);

alter table public.report_access enable row level security;

-- Read via service role; users see access through API responses.

-- ============================================================================
-- Seed: the sample 442 28th St report so the demo works end-to-end.
-- ============================================================================
insert into public.reports (
  address, asking_price, offer_low, offer_high, negotiability_score,
  days_on_market, price_cuts, zestimate_gap, neighborhood,
  appreciation_rate_annual, beds, baths, sqft,
  lot_size_sqft, price_per_living_sqft, price_per_lot_sqft,
  last_sold_price, last_sold_year, tax_assessed_value,
  annual_taxes_current, annual_taxes_projected, hoa_monthly,
  flood_zone, estimated_monthly_mortgage, estimated_monthly_insurance,
  estimated_monthly_total,
  land_arbitrage_score, land_arbitrage_notes, score_breakdown,
  data
) values (
  '442 28th St, West Palm Beach FL 33407',
  1995000, 1780000, 1850000, 8.2,
  136, 2, 110000, 'Old Northwood',
  0.038, 4, 3, 2610,
  7500, 764.37, 266.00,
  1450000, 2019, 1450000,
  13775, 17575, 0,
  'X', 9278, 1038,
  11781,
  7.4,
  'Solid 7,500 sqft lot at $266/sqft (~10% below Old Northwood median) with a 1989 structure showing 136 DOM and two cuts — meaningful land-value play with renovation upside.',
  jsonb_build_object(
    'dom_score', 9,
    'price_cut_score', 8,
    'zestimate_gap_score', 8,
    'price_per_sqft_score', 7
  ),
  jsonb_build_object(
    'insights', jsonb_build_array(
      'Closed comps say $1.78M-$1.85M. Five nearby 4-bed sales in the last 6 months landed at $682-$720/sqft - this listing is priced at $764/sqft, roughly 9% above the comp band.',
      'Time is on your side. 136 days on market is more than 3x the 41-day neighborhood median. After two cuts totaling $155K, the seller has already signaled clear flexibility.',
      'The Zestimate agrees. Zillow pegs fair value at $1.885M - $110K below ask. A mid-$1.8s offer lands comfortably inside the algorithm''s confidence band.',
      'Negotiability score is 8.2/10. Long DOM, two price cuts, a Zestimate gap, and softening neighborhood demand all point to a seller who will engage on a sub-ask offer rather than wait for another buyer.'
    ),
    'script', 'Our offer is $1,820,000. Comparable 4-beds on 27th and 29th closed between $1.78M and $1.85M in the last quarter, and this home has been listed 136 days with two reductions. We''re ready to move quickly with proof of funds - we''d love to find a number that works for both sides.',
    'questions', jsonb_build_array(
      'Why has the home sat for 136 days - any specific deal-killers in past offers?',
      'Is the seller willing to credit closing costs in lieu of further price reductions?',
      'What''s the seller''s timeline - do they have a contingent purchase in motion?'
    ),
    'comps', jsonb_build_array(
      jsonb_build_object('address','411 29th St','beds',4,'sqft',2540,'sold',1820000,'psf',717,'dom',42),
      jsonb_build_object('address','518 27th St','beds',4,'sqft',2610,'sold',1795000,'psf',688,'dom',58),
      jsonb_build_object('address','329 28th St','beds',4,'sqft',2720,'sold',1855000,'psf',682,'dom',71),
      jsonb_build_object('address','624 26th St','beds',5,'sqft',2820,'sold',1925000,'psf',683,'dom',39),
      jsonb_build_object('address','207 30th St','beds',4,'sqft',2480,'sold',1785000,'psf',720,'dom',33)
    ),
    'tiles', jsonb_build_object(
      'comp_avg_psf', 702,
      'comp_median_sale', 1830000,
      'suggested_under_ask_pct', 7.5,
      'median_dom', 41
    )
  )
) on conflict (address) do update set
  asking_price = excluded.asking_price,
  offer_low = excluded.offer_low,
  offer_high = excluded.offer_high,
  negotiability_score = excluded.negotiability_score,
  days_on_market = excluded.days_on_market,
  price_cuts = excluded.price_cuts,
  zestimate_gap = excluded.zestimate_gap,
  neighborhood = excluded.neighborhood,
  appreciation_rate_annual = excluded.appreciation_rate_annual,
  beds = excluded.beds,
  baths = excluded.baths,
  sqft = excluded.sqft,
  lot_size_sqft = excluded.lot_size_sqft,
  price_per_living_sqft = excluded.price_per_living_sqft,
  price_per_lot_sqft = excluded.price_per_lot_sqft,
  last_sold_price = excluded.last_sold_price,
  last_sold_year = excluded.last_sold_year,
  tax_assessed_value = excluded.tax_assessed_value,
  annual_taxes_current = excluded.annual_taxes_current,
  annual_taxes_projected = excluded.annual_taxes_projected,
  hoa_monthly = excluded.hoa_monthly,
  flood_zone = excluded.flood_zone,
  estimated_monthly_mortgage = excluded.estimated_monthly_mortgage,
  estimated_monthly_insurance = excluded.estimated_monthly_insurance,
  estimated_monthly_total = excluded.estimated_monthly_total,
  data = excluded.data;
