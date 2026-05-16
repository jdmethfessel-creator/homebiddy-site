import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are HomeBiddy, a real estate offer analyst. Given a Zillow or Realtor.com listing URL, use web search to find: the listing price, days on market, price reduction history, Zestimate, square footage (living), lot size, beds/baths, year built, neighborhood/submarket, last sale price + year, current tax assessed value, current annual property tax bill, HOA fees if any, FEMA flood zone if available, and at least 3-5 closed comps within 0.5 miles in the last 12 months.

Then produce a JSON object with these exact fields:

CORE
- address, neighborhood, beds, baths, sqft, year_built
- asking_price, zestimate, zestimate_gap
- days_on_market, avg_dom
- price_cuts, cut_history
- offer_low, offer_high, walk_away, offer_basis
- negotiability_score, negotiability_label

VALUATION
- lot_size_sqft: lot size in square feet
- price_per_living_sqft: asking_price ÷ sqft (rounded to 2 decimals)
- price_per_lot_sqft: asking_price ÷ lot_size_sqft (rounded to 2 decimals)

SALE HISTORY + TAXES
- last_sold_price, last_sold_year
- tax_assessed_value: current county assessed value
- annual_taxes_current: current annual property tax bill
- annual_taxes_projected: estimated post-reassessment annual taxes if the
  buyer purchases at offer_low. Compute as offer_low × the local effective
  property-tax rate. Florida is ~0.95-1.10% — pick the rate that matches the
  county and explain in offer_basis if it deviates from 1%.
- hoa_monthly: monthly HOA dues, 0 if no HOA

RISK
- flood_zone: FEMA flood-zone designation if listed (e.g. "X", "AE", "VE"); null if not known

MONTHLY COST ESTIMATES (compute these — they aren't found, they're calculated)
- estimated_monthly_mortgage: monthly P&I at offer_low purchase price with 20% down, 6.8% fixed, 30 years. Formula: principal = offer_low × 0.8; rate = 0.068/12; n = 360; payment = principal × (rate × (1+rate)^n) ÷ ((1+rate)^n − 1). Round to whole dollars.
- estimated_monthly_insurance: rough Florida estimate. 0.7%/yr of offer_low for non-flood zones (X), 1.0-1.2%/yr if flood_zone starts with A or V. Divide by 12, round to whole dollars.
- estimated_monthly_total: estimated_monthly_mortgage + (annual_taxes_projected ÷ 12) + estimated_monthly_insurance + hoa_monthly. Round to whole dollars.

COMPS + INSIGHTS
- comps (array of at least 3, max 5): each with address, sold_date, sqft, price_per_sqft, dom, vs_list_pct, signal
- insights (array of exactly 4 plain-English strings)
- negotiation_script (first-person)
- questions (array of exactly 3 questions to ask the listing agent)

Return only valid JSON, no markdown.

Format rules:
- address: canonical short-form. Single comma between street and city. No comma between directional and city. Example: "442 28th St, West Palm Beach FL 33407".
- neighborhood: submarket / sub-neighborhood name when known ("Old Northwood", "El Cid", "SoSo"). Fall back to city only when no distinct submarket exists. Do NOT prefix with the city.
- All money values as integers (USD), except price_per_living_sqft, price_per_lot_sqft, negotiability_score and tax fields which can be numeric with decimals.
- zestimate_gap = asking_price - zestimate (positive = asking over Zestimate).
- negotiability_score: 0.0-10.0. negotiability_label: "Low" | "Moderate" | "High" | "Very High".
- comps[i].sold_date: ISO YYYY-MM-DD. vs_list_pct: signed decimal percent (e.g. -3.5).
- cut_history: array of strings like ["$2,150,000 → $1,995,000 (Sep 2025)"]. Empty array if no cuts.
- If a value can't be found and isn't derivable (e.g. lot_size_sqft, HOA, flood zone), omit it from the JSON. Do NOT make up numbers.`;

export async function analyzeWithClaude(listing_url) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 8,
      },
    ],
    messages: [
      {
        role: "user",
        content: `Listing URL: ${listing_url}\n\nResearch this property and return the JSON object.`,
      },
    ],
  });

  return enrichReport(extractFinalJSON(response));
}

function extractFinalJSON(response) {
  const texts = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text);
  const full = texts.join("\n").trim();
  if (!full) throw new Error("Claude returned no text content");

  try {
    return JSON.parse(full);
  } catch {}

  const fenced = full.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const obj = full.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }

  throw new Error("Could not parse JSON from Claude response");
}

// Server-side enrichment — fill in any deterministic calculation Claude omitted
// or got wrong. Math always wins over LLM output for these fields.
export function enrichReport(data) {
  if (!data || typeof data !== "object") return data;
  const r = { ...data };

  if (r.asking_price && r.sqft && (r.price_per_living_sqft == null || isNaN(r.price_per_living_sqft))) {
    r.price_per_living_sqft = Math.round((r.asking_price / r.sqft) * 100) / 100;
  }
  if (r.asking_price && r.lot_size_sqft && (r.price_per_lot_sqft == null || isNaN(r.price_per_lot_sqft))) {
    r.price_per_lot_sqft = Math.round((r.asking_price / r.lot_size_sqft) * 100) / 100;
  }

  if (r.offer_low && (r.estimated_monthly_mortgage == null || isNaN(r.estimated_monthly_mortgage))) {
    r.estimated_monthly_mortgage = monthlyMortgage(r.offer_low * 0.8, 0.068, 30);
  }

  if (r.offer_low && (r.estimated_monthly_insurance == null || isNaN(r.estimated_monthly_insurance))) {
    const isFlood = r.flood_zone && /^(A|V)/i.test(String(r.flood_zone));
    const annualRate = isFlood ? 0.012 : 0.007;
    r.estimated_monthly_insurance = Math.round((r.offer_low * annualRate) / 12);
  }

  if (r.offer_low && (r.annual_taxes_projected == null || isNaN(r.annual_taxes_projected))) {
    r.annual_taxes_projected = Math.round(r.offer_low * 0.01);
  }

  if (r.hoa_monthly == null || isNaN(r.hoa_monthly)) {
    r.hoa_monthly = 0;
  }

  if (r.estimated_monthly_total == null || isNaN(r.estimated_monthly_total)) {
    const m = Number(r.estimated_monthly_mortgage) || 0;
    const t = (Number(r.annual_taxes_projected) || 0) / 12;
    const ins = Number(r.estimated_monthly_insurance) || 0;
    const hoa = Number(r.hoa_monthly) || 0;
    r.estimated_monthly_total = Math.round(m + t + ins + hoa);
  }

  return r;
}

function monthlyMortgage(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return Math.round(principal / n);
  const x = Math.pow(1 + r, n);
  return Math.round((principal * (r * x)) / (x - 1));
}

export function generateReportId(address) {
  const year = new Date().getFullYear();
  const stateMatch = String(address || "").match(/\b([A-Z]{2})\b/);
  const state = stateMatch ? stateMatch[1] : "XX";
  const date = new Date().toISOString().slice(0, 10);
  const hash = crypto
    .createHash("sha256")
    .update(`${address}|${date}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `HB-${year}-${state}-${hash}`;
}

export function formatDateLong(d = new Date()) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Columns that exist on public.reports in the schema-v2 baseline. The v4
// migration adds the rest. If the v4 migration hasn't been run yet,
// upsertReportRow falls back to writing only these.
const LEGACY_REPORT_COLUMNS = [
  "address", "asking_price", "offer_low", "offer_high",
  "negotiability_score", "days_on_market", "price_cuts",
  "zestimate_gap", "neighborhood", "appreciation_rate_annual",
  "beds", "baths", "sqft", "data",
];

// Translate a Claude-extracted analysis JSON into a public.reports row.
// Anything that doesn't get its own column (year_built, avg_dom, walk_away,
// offer_basis, cut_history, zestimate) is stashed in the data jsonb blob
// alongside insights / script / questions / comps / tiles.
export function buildReportRowFromAnalysis(a, address) {
  const data = {
    insights: a.insights || [],
    script: a.script || a.negotiation_script || "",
    questions: a.questions || [],
    comps: a.comps || [],
    tiles: a.tiles || null,
    year_built: a.year_built,
    avg_dom: a.avg_dom,
    walk_away: a.walk_away,
    offer_basis: a.offer_basis,
    cut_history: a.cut_history,
    zestimate: a.zestimate,
  };
  return {
    address,
    asking_price: a.asking_price,
    offer_low: a.offer_low,
    offer_high: a.offer_high,
    negotiability_score: a.negotiability_score,
    days_on_market: a.days_on_market,
    price_cuts: a.price_cuts,
    zestimate_gap: a.zestimate_gap,
    neighborhood: a.neighborhood,
    appreciation_rate_annual: a.appreciation_rate_annual,
    beds: a.beds,
    baths: a.baths,
    sqft: a.sqft,
    lot_size_sqft: a.lot_size_sqft,
    price_per_living_sqft: a.price_per_living_sqft,
    price_per_lot_sqft: a.price_per_lot_sqft,
    last_sold_price: a.last_sold_price,
    last_sold_year: a.last_sold_year,
    tax_assessed_value: a.tax_assessed_value,
    annual_taxes_current: a.annual_taxes_current,
    annual_taxes_projected: a.annual_taxes_projected,
    hoa_monthly: a.hoa_monthly,
    flood_zone: a.flood_zone,
    estimated_monthly_mortgage: a.estimated_monthly_mortgage,
    estimated_monthly_insurance: a.estimated_monthly_insurance,
    estimated_monthly_total: a.estimated_monthly_total,
    data,
  };
}

// Upsert a reports row, retrying with only legacy columns if the v4 fields
// don't exist yet. Returns the error object or null on success.
export async function upsertReportRow(supabase, row) {
  let { error } = await supabase
    .from("reports")
    .upsert(row, { onConflict: "address" });
  if (error && /column .* does not exist/i.test(error.message || "")) {
    console.warn(
      "schema-v4 columns missing — retrying upsert with legacy fields only:",
      error.message
    );
    const legacy = {};
    for (const k of LEGACY_REPORT_COLUMNS) {
      if (row[k] !== undefined) legacy[k] = row[k];
    }
    const retry = await supabase
      .from("reports")
      .upsert(legacy, { onConflict: "address" });
    error = retry.error;
  }
  return error;
}
