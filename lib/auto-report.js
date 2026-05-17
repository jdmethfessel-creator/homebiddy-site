import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

// Sonnet stays the default for the homepage PDF flow where output quality
// is the customer-facing artifact. The dashboard analyze path overrides
// this with Haiku via the optional { model } arg below — Haiku is much
// faster + cheaper and Tier 1 rate limits are higher (50K vs 30K
// tokens/min), and the structured-extraction quality is comparable.
const MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Full dashboard prompt — kept exported so the dashboard flow can pass
// it explicitly via { systemPrompt }. The homepage flow uses the slimmer
// HOMEPAGE_SYSTEM_PROMPT below (default).
export const SYSTEM_PROMPT = `IMPORTANT: The URL provided is a direct Zillow or Realtor.com listing page. Do NOT search for the address -- fetch the listing page directly using the URL. The active listing price, days on market, price history, and all listing data are on that page. Only use web search for closed comps and neighborhood data after reading the listing page first.

You are HomeBiddy, a real estate offer analyst. Given a Zillow or Realtor.com listing URL, use web search to find: the listing price, days on market, price reduction history, Zestimate, square footage (living), lot size, beds/baths, year built, neighborhood/submarket, last sale price + year, current tax assessed value, current annual property tax bill, HOA fees if any, FEMA flood zone if available, and at least 3-5 closed comps from the last 12 months chosen with the density-adaptive radius rules below.

COMP SEARCH — DENSITY-ADAPTIVE RADIUS (assess the subject's setting from the listing data, then pick the matching tier):

  Urban / dense city          0.25 miles, same neighborhood only
    (Manhattan, Miami Beach, downtown Chicago, SF, DC, Boston Back Bay, etc.)
  Suburban                    0.5 miles, same zip code preferred
    (West Palm Beach, Scottsdale, Naperville, typical metro suburbs)
  Small town (pop. < 50K)     1-2 miles, same town or adjacent town
  Rural / exurban             5-10 miles, same county, similar property type
  Waterfront / golf / gated   Comps MUST share the same amenity class regardless of
                              radius — a waterfront comp is NOT comparable to an
                              inland home 0.1 miles away. If the subject is waterfront,
                              every comp must also be waterfront. Same rule for direct
                              golf-course homes and gated-community homes.

Rules:
- Emit the radius you used as comp_radius_miles (number) and the count of qualifying
  comps as comp_count (integer).
- If fewer than 3 qualifying comps exist at your selected radius, EXPAND the radius
  to the next tier (e.g. urban → suburban; suburban → small-town) and note this in
  offer_basis (e.g. "Expanded from 0.25mi urban to 0.5mi to reach 3 comps").
- ALWAYS prefer recency over proximity when forced to choose: a comp from 4 months
  ago at 1 mile beats a comp from 14 months ago at 0.3 miles. Cap the window at
  12 months; never include older closings.
- Amenity-class rule overrides everything — never break it just to expand the count.

Then produce a JSON object with these exact fields:

LISTING PRICE AND PRICE HISTORY:
Step 1 - Current price: Use the large dollar amount displayed at the top of the listing page (below any 'Price cut' badge). This is always the current asking price. Do not use the original list price from the price history table.

Step 2 - Price cut history: Read the ENTIRE Price History table from top to bottom. Count ALL rows where Event = 'Price change' within the past 2 years, regardless of MLS number or listing period. The table may show cuts under different MLS numbers if the property was relisted -- count them all. Do not stop at the current MLS listing rows. Set price_cuts to the total count across all listing periods in the past 2 years.

Step 3 - Build cut_history as an array of all cuts, most recent first, format: '$2,495,000 → $2,395,000 (Feb 2024)'. Include cuts from prior listing periods if within 2 years.

Step 4 - If the property has a 'Listing removed' row followed by a new 'Listed for sale' row, set relisted: true. This signals the seller failed to sell and came back -- meaningful leverage for the buyer.

Step 5 - For last_sold_price and last_sold_year, find the most recent 'Sold' row in the price history table.

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
- last_sold_price: most recent sold price from the price history table
- last_sold_year: year of most recent sale from the price history table
- tax_assessed_value: current year assessed value from the public tax history table
- annual_taxes_current: current year property tax bill from the public tax history table
- annual_taxes_projected: estimated post-reassessment annual taxes if the
  buyer purchases at offer_low. Compute as offer_low × the local effective
  property-tax rate. Florida is ~0.95-1.10%.
- hoa_monthly: monthly HOA dues, 0 if no HOA

RISK
- flood_zone: FEMA flood zone designation if available (e.g. "X", "AE", "VE"); null if not known

MONTHLY COST ESTIMATES (compute these — they aren't found, they're calculated)
- estimated_monthly_mortgage: monthly P&I at offer_low purchase price with 20% down, 6.8% fixed, 30 years. Formula: principal = offer_low × 0.8; rate = 0.068/12; n = 360; payment = principal × (rate × (1+rate)^n) ÷ ((1+rate)^n − 1). Round to whole dollars.
- estimated_monthly_insurance: rough Florida estimate. 0.7%/yr of offer_low for non-flood zones (X), 1.0-1.2%/yr if flood_zone starts with A or V. Divide by 12, round to whole dollars.
- estimated_monthly_total: estimated_monthly_mortgage + (annual_taxes_projected ÷ 12) + estimated_monthly_insurance + hoa_monthly. Round to whole dollars.

COMPS + INSIGHTS
- comps (array of at least 3, max 5): each with address, sold_date, sqft, price_per_sqft, dom, vs_list_pct, signal
- insights (array of exactly 4 plain-English strings)
- negotiation_script (first-person)
- questions (array of exactly 3 questions to ask the listing agent)

DATA-QUALITY SANITY CHECK
- offer_range_flagged: set this to TRUE if your calculated offer_low is more than 20% below asking_price. Extreme discounts on fresh listings are almost always a sign of bad source data (wrong asking, missing context, stale comps). When true, you MUST also emit offer_range_flag_note as a one-sentence explanation of why the gap is so wide (e.g. "Asking $1.2M but closed comps trend $700-800K — verify the listing price isn't a typo or stale").
- If the discount is within normal range (≤ 20%), omit both fields.

NEIGHBORHOOD CEILING RISK (renovated-outlier detection)
Set neighborhood_ceiling_risk = TRUE when BOTH of these hold:
  1. asking $/sqft (price_per_living_sqft) is more than 25% above the comp average
     ($/sqft mean of the comps you returned), AND
  2. the listing description / public remarks include renovation / remodel / updated
     finish signals: "renovated", "fully renovated", "remodeled", "updated kitchen",
     "new kitchen", "updated baths", "new flooring", "new finishes", "fully redone",
     "turn-key", "studs-out", "down to the studs", "complete renovation",
     "all new appliances", "gut renovation", "modernized", "fully updated".
If either condition fails, omit neighborhood_ceiling_risk (do not emit false).

When neighborhood_ceiling_risk is TRUE you MUST also emit:
- ceiling_risk_note: 2-3 sentences in plain English. Explain that (a) the home appears
  to be a renovated outlier, (b) the comps reflect the surrounding (often up-and-coming)
  area where unrenovated homes sell at lower $/sqft, and (c) the seller likely has a
  renovation cost floor above what pure comp analysis supports. Close by saying the
  offer range should be treated as a market anchor, not a realistic opening bid.
- est_floor: the seller's likely floor in DOLLARS. Compute it as the LESSER of:
    (a) asking_price × (1 - dom_pct), where dom_pct is 0.08-0.10 if days_on_market ≥ 60
        with 0 price cuts, scaling up to 0.15 for ≥ 120 days. Add 0.03-0.05 PER recorded
        price cut to dom_pct. Cap dom_pct at 0.18.
    (b) the renovation-cost floor: estimate from last_sold_price + plausible renovation
        spend (use listing language to gauge scope — full gut ≈ $150-250/sqft of living
        space; cosmetic ≈ $50-80/sqft; baseline 10% margin on top of total invested).
  Round to whole dollars. IGNORE the $/sqft comp gap when computing est_floor for
  ceiling-risk homes — comps are unreliable here by definition.
  Example: 84 DOM, 0 cuts → ~8% below ask. 84 DOM, 2 cuts → ~14-18% below ask.

NEGOTIABILITY SCORE — EXPLICIT 5-COMPONENT WEIGHTED FORMULA (do the math; do not guess):
Compute five sub-scores, each clamped to [0, 10], then weight them.

1. dom_score (weight 25%): days_on_market vs neighborhood average.
   ratio = days_on_market / max(avg_dom, 1)
   dom_score = clamp(0, 10, 5 + (ratio - 1) × 10)
   At avg = 5. Every 10% over avg adds 1. A home at 2× avg = 10. Below avg drops below 5.
   Emit dom_note with one-sentence explanation, e.g. "136 days vs 41-day neighborhood avg = 3.3× average".

2. price_history_score (weight 20%): cuts + age + relisting signals combined.
   Start at 0. Add min(price_cuts × 2, 6).
   If the home was previously listed AND withdrawn before being re-listed (relisted),
     add +2 bonus. Set the top-level 'relisted' boolean accordingly.
   If price_cuts == 0 AND days_on_market > 60, floor at 3 (still some leverage from age alone).
   Final result clamped to [1, 10] — never below 1.
   Emit price_history_note explaining the math, e.g. "Two cuts totaling $155K, no relisting, 136 DOM".

3. comp_psf_score (weight 25%): asking $/sqft vs the AVERAGE of the
   closed comps in the comps array. DO NOT use Zestimate here.
   comp_avg_psf = mean of comps[].price_per_sqft (compute it yourself from the comps you return)
   ratio = price_per_living_sqft / comp_avg_psf
   comp_psf_score = clamp(0, 10, 5 + (ratio - 1) × 20)
   At parity with comps = 5. Every 5% above comps = +1. Every 5% below = -1.
   Emit comp_psf_note, e.g. "$764/sqft vs $702 comp avg = 9% above".

4. zestimate_gap_score (weight 15%): asking vs Zestimate.
   If no Zestimate is available, DEFAULT TO 5 (neutral) — never 0.
   gap_pct = (asking_price - zestimate) / zestimate × 100
   If gap_pct < 0 (asking below Zestimate): score = 3
   If 0 ≤ gap_pct < 10: score = clamp(5, 10, 5 + gap_pct × 0.3)
   If gap_pct ≥ 10: score = clamp(8, 10, 8 + (gap_pct - 10) × 0.2)
   Emit zestimate_gap_note, e.g. "Asking 5.8% over Zestimate" or
   "No Zestimate available — defaulted to neutral 5".

5. listing_signals_score (weight 15%): scan the listing description language.
   Start at 5 (neutral).
   For EACH negotiability keyword found, add +2: "motivated seller",
     "price reduced", "as-is", "must sell", "relocating", "estate sale",
     "bring offers", "priced to sell", "reduced", "owner financing".
   Cap at 10.
   For EACH competitive keyword found, drop to 2/10 and stop:
     "multiple offers", "best and final", "offers due", "highest and best",
     "deadline".
   If you can't access the description, default to 5.
   Emit listing_signals_note listing the keywords found, e.g.
   "Detected 'price reduced'; otherwise neutral language".

Final:
negotiability_score = 0.25 × dom_score + 0.20 × price_history_score
                    + 0.25 × comp_psf_score + 0.15 × zestimate_gap_score
                    + 0.15 × listing_signals_score
ROUND to one decimal AND CLAMP to [1, 10]. Never emit 0 or anything below 1.

Emit score_breakdown as a JSON object with all 5 sub-scores AND their notes,
so the math is auditable on the detail page:
score_breakdown = {
  dom_score, dom_note,
  price_history_score, price_history_note,
  comp_psf_score, comp_psf_note,
  zestimate_gap_score, zestimate_gap_note,
  listing_signals_score, listing_signals_note
}

Also emit a top-level 'relisted' boolean (true / false based on listing history).

LAND ARBITRAGE SCORE — EXPLICIT WEIGHTED FORMULA:
Compute four sub-scores then weight them.

1. lot_psf_score (weight 30%): price_per_lot_sqft vs neighborhood median.
   ratio = price_per_lot_sqft ÷ median_lot_psf
   lot_psf_score = clamp(0, 10, (1 - ratio) × 25 + 5)
   (at median = 5; 40% below median = 15→10; 40% above = -5→0)

2. lot_size_score (weight 25%): lot_size_sqft vs neighborhood median.
   ratio = lot_size_sqft ÷ median_lot_size
   lot_size_score = clamp(0, 10, ratio × 5)
   (1× = 5; 2×+ = 10)

3. condition_score (weight 25%): your judgment 0-10 based on signals — year built (older = more renovation upside), DOM, price cuts, listing language about condition ("needs work", "as-is", "fixer", "tired", "original" → higher score; "renovated", "turn-key", "move-in" → lower score). Score 7+ means there's clear value to be unlocked by improving the structure.

4. upside_score (weight 20%): your judgment 0-10 based on renovation / ADU / lot-development potential. Bigger lot, permissive zoning signals, splittable lot, ADU-friendly municipality = higher. Constrained lot, restrictive HOA, historic district = lower.

land_arbitrage_score = 0.30 × lot_psf_score + 0.25 × lot_size_score + 0.25 × condition_score + 0.20 × upside_score
ROUND to one decimal AND CLAMP to [1, 10]. Floor at 1, never below.

Emit land_score_breakdown as a JSON object with all 4 sub-scores AND their notes:
land_score_breakdown = {
  lot_psf_score, lot_psf_note,
  lot_size_score, lot_size_note,
  condition_score, condition_note,
  upside_score, upside_note
}
Each note is a short plain-English explanation of why that sub-score landed where it did
(e.g. lot_psf_note: "$266/sqft vs ~$295 neighborhood median").

land_arbitrage_notes: a SHORT comma-separated phrase, MAX 8 WORDS. No full sentences. No punctuation other than commas. Examples:
"Large lot, dated structure, renovation upside"
"Standard lot, motivated seller, ADU potential"
"Below-median $/sqft, 1962 build, redev play"

Return only valid JSON, no markdown.

Format rules:
- address: canonical short-form. Single comma between street and city. No comma between directional and city. Example: "442 28th St, West Palm Beach FL 33407".
- neighborhood: submarket / sub-neighborhood name when known ("Old Northwood", "El Cid", "SoSo"). Fall back to city only when no distinct submarket exists. Do NOT prefix with the city.
- Return the neighborhood field as the shortest commonly used local name only, no suffixes, no parentheticals, no city name. Examples: "SoSo" not "SoSo (Belair Historic District)"; "Old Northwood" not "Old Northwood Historic District"; "Lincoln Park" not "Lincoln Park Neighborhood"; "Coconut Grove" not "Coconut Grove Miami".
- All money values as integers (USD), except price_per_living_sqft, price_per_lot_sqft, negotiability_score, land_arbitrage_score and tax fields which can be numeric with decimals.
- zestimate_gap = asking_price - zestimate (positive = asking over Zestimate).
- negotiability_score and land_arbitrage_score: 0.0-10.0 (one decimal). negotiability_label: "Low" | "Moderate" | "High" | "Very High".
- comps[i].sold_date: ISO YYYY-MM-DD. vs_list_pct: signed decimal percent (e.g. -3.5).
- cut_history: array of strings like ["$2,150,000 → $1,995,000 (Sep 2025)"]. Empty array if no cuts.
- If a value can't be found and isn't derivable, omit it from the JSON. Do NOT make up numbers.

CRITICAL: Always return a valid JSON object. Never return plain English, never apologize, never ask clarifying questions. If data is missing, omit that field. If the listing cannot be accessed, return: {"error": "listing_not_found", "message": "one sentence reason"}`;

// Slimmer prompt used by the homepage PDF flow. Strips land arbitrage,
// score_breakdown, monthly costs, taxes, flood zone, and ceiling-risk
// detection — none of those render in the customer-facing PDF. Keeps
// the same negotiability score formula and density-adaptive comp rules
// so the score itself stays apples-to-apples with the dashboard.
const HOMEPAGE_SYSTEM_PROMPT = `IMPORTANT: The URL provided is a direct Zillow or Realtor.com listing page. Do NOT search for the address -- fetch the listing page directly using the URL. The active listing price, days on market, price history, and all listing data are on that page. Only use web search for closed comps and neighborhood data after reading the listing page first.

You are HomeBiddy, a real estate offer analyst. Given a Zillow or Realtor.com listing URL, use web search to research the listing and return a JSON object with the fields listed below.

COMP SEARCH — DENSITY-ADAPTIVE RADIUS (assess the subject's setting from the listing data, then pick the matching tier):

  Urban / dense city          0.25 miles, same neighborhood only
    (Manhattan, Miami Beach, downtown Chicago, SF, DC, Boston Back Bay, etc.)
  Suburban                    0.5 miles, same zip code preferred
    (West Palm Beach, Scottsdale, Naperville, typical metro suburbs)
  Small town (pop. < 50K)     1-2 miles, same town or adjacent town
  Rural / exurban             5-10 miles, same county, similar property type
  Waterfront / golf / gated   Comps MUST share the same amenity class regardless
                              of radius — waterfront, direct-golf, or gated only
                              comp against the same class.

Rules:
- Emit comp_radius_miles (number) and comp_count (integer).
- If fewer than 3 qualifying comps at the chosen radius, expand to the next
  tier and note this in offer_basis.
- Prefer recency over proximity within the 12-month window. Never include
  closings older than 12 months. Amenity-class rule overrides everything.

FIELDS TO RETURN:

LISTING PRICE AND PRICE HISTORY:
Step 1 - Current price: Use the large dollar amount displayed at the top of the listing page (below any 'Price cut' badge). This is always the current asking price. Do not use the original list price from the price history table.

Step 2 - Price cut history: Scroll down to the full Price History table. Count ALL rows where Event = 'Price change' from the past 2 years, even across multiple listing periods (the property may have been removed and relisted). Each 'Price change' row is one cut. Set price_cuts to the total count. Do NOT count 'Listed for sale' or 'Listing removed' rows as cuts.

Step 3 - Build cut_history as an array of all cuts, most recent first, format: '$2,495,000 → $2,395,000 (Feb 2024)'. Include cuts from prior listing periods if within 2 years.

CORE
- address, neighborhood, beds, baths, sqft, year_built
- asking_price, zestimate, zestimate_gap
- days_on_market, avg_dom
- price_cuts, cut_history
- offer_low, offer_high, walk_away, offer_basis
- negotiability_score, negotiability_label
- comp_radius_miles, comp_count

COMPS (3-5 entries, each with):
- address, sold_date (ISO YYYY-MM-DD), sqft, price_per_sqft, dom, vs_list_pct, signal

INSIGHTS + SCRIPT
- insights: exactly 4 plain-English strings
- negotiation_script: first-person script the buyer would use
- questions: exactly 3 questions to ask the listing agent

NEGOTIABILITY SCORE — EXPLICIT 5-COMPONENT WEIGHTED FORMULA (do the math; do not guess):
Compute five sub-scores, each clamped to [0, 10], then weight them.

1. dom_score (weight 25%): days_on_market vs neighborhood average.
   ratio = days_on_market / max(avg_dom, 1)
   dom_score = clamp(0, 10, 5 + (ratio - 1) × 10)

2. price_history_score (weight 20%): cuts + age + relisting signals.
   Start at 0. Add min(price_cuts × 2, 6). If previously listed AND withdrawn
   before re-listing, add +2. If price_cuts == 0 AND days_on_market > 60,
   floor at 3. Final result clamped to [1, 10].

3. comp_psf_score (weight 25%): asking $/sqft vs the AVERAGE of the closed
   comps in the comps array (NOT Zestimate).
   ratio = (asking_price / sqft) / mean(comps[].price_per_sqft)
   comp_psf_score = clamp(0, 10, 5 + (ratio - 1) × 20)

4. zestimate_gap_score (weight 15%): asking vs Zestimate.
   If no Zestimate, default to 5 (neutral).
   gap_pct = (asking_price - zestimate) / zestimate × 100
   If gap_pct < 0: score = 3
   If 0 ≤ gap_pct < 10: score = clamp(5, 10, 5 + gap_pct × 0.3)
   If gap_pct ≥ 10: score = clamp(8, 10, 8 + (gap_pct - 10) × 0.2)

5. listing_signals_score (weight 15%): scan listing description.
   Start at 5. For each negotiability keyword ("motivated seller",
   "price reduced", "as-is", "must sell", "relocating", "estate sale",
   "bring offers", "priced to sell", "reduced", "owner financing"), add +2.
   Cap at 10. If any competitive keyword present ("multiple offers",
   "best and final", "offers due", "highest and best", "deadline"),
   drop to 2. If description inaccessible, default to 5.

Final:
negotiability_score = 0.25 × dom_score + 0.20 × price_history_score
                    + 0.25 × comp_psf_score + 0.15 × zestimate_gap_score
                    + 0.15 × listing_signals_score
ROUND to one decimal AND CLAMP to [1, 10]. Never emit 0 or below 1.
negotiability_label: "Low" | "Moderate" | "High" | "Very High".

FORMAT RULES:
- address: canonical short-form. Single comma between street and city,
  no comma between directional and city. Example: "442 28th St, West
  Palm Beach FL 33407".
- neighborhood: shortest commonly used local name only ("SoSo" not
  "SoSo (Belair Historic District)"). Fall back to city if no submarket.
- All money values as integers (USD).
- zestimate_gap = asking_price - zestimate.
- comps[i].vs_list_pct: signed decimal (e.g. -3.5).
- cut_history: array of strings like ["$2,150,000 → $1,995,000 (Sep 2025)"]. Empty array if no cuts.
- If a value can't be found and isn't derivable, omit it. Do NOT make up numbers.

Return only valid JSON, no markdown.

CRITICAL: Always return a valid JSON object. Never return plain English, never apologize, never ask clarifying questions. If data is missing, omit that field. If the listing cannot be accessed, return: {"error": "listing_not_found", "message": "one sentence reason"}`;

export async function analyzeWithClaude(listing_url, { model, systemPrompt } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: model || MODEL,
    // Dashboard callers (passing SYSTEM_PROMPT) need headroom for the
    // expanded field set; homepage stays tight at 4096.
    max_tokens: systemPrompt ? 8192 : 4096,
    system: systemPrompt || HOMEPAGE_SYSTEM_PROMPT,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        // Same cap for both flows. The prompt instructs Claude to fetch
        // the listing page first and only use web_search for closed
        // comps + neighborhood data, so 3 is enough on either path.
        max_uses: 3,
      },
    ],
    messages: [
      {
        role: "user",
        content: `Listing URL: ${listing_url}\n\nResearch this property and return the JSON object.`,
      },
    ],
  });

  const parsed = extractFinalJSON(response);
  // Both prompts instruct Claude to return {"error": "listing_not_found",
  // "message": "..."} when the listing page can't be reached. Surface it
  // as a typed Error so callers can distinguish "model failure" (worth
  // retrying) from "URL is dead" (retrying won't help).
  if (parsed && parsed.error === "listing_not_found") {
    const msg = parsed.message || "Listing could not be accessed.";
    const err = new Error(`listing_not_found: ${msg}`);
    err.code = "listing_not_found";
    throw err;
  }
  return enrichReport(parsed);
}

// Build a partial reports-row update from the Phase 2 analysis result.
// Used by runAnalysisForHome to merge enrichment data into the row that
// Phase 1 already created. Only columns with non-null values are
// included so this update is safe to apply additively.
export function buildEnrichmentRowFromAnalysis(a) {
  const fields = {};
  const copy = (k) => {
    if (a[k] != null && a[k] !== "") fields[k] = a[k];
  };
  [
    "last_sold_price",
    "last_sold_year",
    "tax_assessed_value",
    "annual_taxes_current",
    "flood_zone",
  ].forEach(copy);
  return fields;
}

function extractFinalJSON(response) {
  const texts = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text);
  const full = texts.join("\n").trim();
  if (!full) {
    console.error("[extractFinalJSON] empty Claude response content:", JSON.stringify(response.content, null, 2));
    throw new Error("Claude returned no text content");
  }

  console.log("[extractFinalJSON] raw response (first 400 chars):", full.slice(0, 400));

  // Strategy 1: whole-string parse (Claude returned just JSON).
  const direct = tryParse(full);
  if (direct) return direct;

  // Strategy 2: strip any markdown fences and try the fenced content.
  const fenced = full.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const fencedTry = tryParse(fenced[1].trim());
    if (fencedTry) return fencedTry;
  }

  // Strategy 3: substring from first { to last } across the WHOLE text.
  // Greedy across both braces handles "preamble text { ... } trailing text".
  const first = full.indexOf("{");
  const last = full.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const slice = full.slice(first, last + 1);
    const sliced = tryParse(slice);
    if (sliced) return sliced;

    // Strategy 4: trailing-comma tolerant cleanup. Remove trailing commas
    // before } or ] which JSON.parse rejects but Claude occasionally emits.
    const cleaned = slice
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    const cleanedTry = tryParse(cleaned);
    if (cleanedTry) return cleanedTry;
  }

  // All strategies failed — dump the full response so we can diagnose
  // exactly what Claude emitted. Vercel runtime logs will capture this.
  console.error("[extractFinalJSON] all parse strategies failed. FULL RAW RESPONSE:\n" + full);
  throw new Error("Could not parse JSON from Claude response");
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch (err) {
    console.warn(
      "[extractFinalJSON] parse attempt failed:",
      err.message,
      "len=", s.length,
      "head=", s.slice(0, 120)
    );
    return null;
  }
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

  // SCORE AUDIT — if Claude returned a valid score_breakdown, recompute
  // negotiability_score from it using the authoritative weighted formula
  // so a bad LLM emission can't ship a sub-component value as the final
  // score. Then clamp to [1, 10] regardless of source.
  const recomputed = recomputeNegotiabilityScore(r.score_breakdown);
  if (recomputed != null) {
    r.negotiability_score = recomputed;
  } else if (r.negotiability_score != null) {
    const n = Number(r.negotiability_score);
    if (!isNaN(n)) {
      r.negotiability_score = clampScore(n);
    }
  }

  // Same safety clamp for land_arbitrage_score.
  if (r.land_arbitrage_score != null) {
    const n = Number(r.land_arbitrage_score);
    if (!isNaN(n)) {
      r.land_arbitrage_score = clampScore(n);
    }
  }

  return r;
}

// Clamp a 0-10 raw score to the [1, 10] presentation range and round to
// one decimal. Used for both negotiability and land_arbitrage final scores.
function clampScore(n) {
  return Math.max(1, Math.min(10, Math.round(Number(n) * 10) / 10));
}

// Compute negotiability_score from score_breakdown components. Each
// sub-score is independently clamped to [0, 10] before weighting so a
// hallucinated 12 can't blow up the final number, and the result is
// floored at 1 so we never emit a "0.5" that reads as missing data.
//
// Supports BOTH the new 5-component shape (preferred) and the legacy
// 4-component shape (so older rows in the DB still recompute correctly).
function recomputeNegotiabilityScore(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return null;
  const subClamp = (v) => Math.max(0, Math.min(10, Number(v)));

  // Preferred: new 5-component formula (DOM / price history / comp psf /
  // Zestimate / listing signals).
  const dom = numOrNull(breakdown.dom_score);
  const ph = numOrNull(breakdown.price_history_score);
  const psf = numOrNull(breakdown.comp_psf_score);
  const zest = numOrNull(breakdown.zestimate_gap_score);
  const sig = numOrNull(breakdown.listing_signals_score);
  if (
    dom != null && ph != null && psf != null && zest != null && sig != null
  ) {
    const w =
      0.25 * subClamp(dom) +
      0.20 * subClamp(ph) +
      0.25 * subClamp(psf) +
      0.15 * subClamp(zest) +
      0.15 * subClamp(sig);
    return clampScore(w);
  }

  // Legacy fallback: 4-component formula (no listing-signals; old weights).
  const oldCuts = numOrNull(breakdown.price_cut_score);
  const oldPsf = numOrNull(breakdown.price_per_sqft_score);
  if (dom != null && oldCuts != null && zest != null && oldPsf != null) {
    const w =
      0.30 * subClamp(dom) +
      0.25 * subClamp(oldCuts) +
      0.25 * subClamp(zest) +
      0.20 * subClamp(oldPsf);
    return clampScore(w);
  }

  return null;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function shouldFlagOfferRange(asking, offerLow) {
  const a = Number(asking);
  const o = Number(offerLow);
  if (!a || !o) return false;
  return (a - o) / a > 0.20;
}

function defaultOfferRangeNote(asking, offerLow) {
  const a = Number(asking);
  const o = Number(offerLow);
  if (!a || !o) return null;
  const pct = ((a - o) / a) * 100;
  return `Offer range is ${pct.toFixed(1)}% below asking — extreme discounts on fresh listings usually indicate stale or mis-keyed data. Verify the listing price and comp set before relying on this range.`;
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
// migration adds the cost columns and v5 adds the land arbitrage fields.
// If those migrations haven't run yet, upsertReportRow falls back to
// writing only these legacy columns.
const LEGACY_REPORT_COLUMNS = [
  "address", "asking_price", "offer_low", "offer_high",
  "negotiability_score", "days_on_market", "price_cuts",
  "zestimate_gap", "neighborhood", "appreciation_rate_annual",
  "beds", "baths", "sqft", "data",
];

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
    // Relisted flag fed into the price_history sub-score; preserved here so
    // the detail page can show it in the breakdown context.
    relisted: a.relisted === true,
    // Density-adaptive comp search metadata.
    comp_radius_miles: a.comp_radius_miles ?? null,
    comp_count: a.comp_count ?? (Array.isArray(a.comps) ? a.comps.length : null),
    // Land arbitrage breakdown lives in jsonb so we don't need a schema
    // migration to ship it alongside the existing land_arbitrage_score /
    // _notes columns.
    land_score_breakdown: a.land_score_breakdown || null,
    // Data-quality flag: extreme discounts (>20%) get flagged with a note.
    // We always emit a note when the flag is set so the dashboard's
    // ⚠ Verify tooltip is informative.
    offer_range_flagged: false, // overwritten below
    offer_range_flag_note: null, // overwritten below
    // Renovated-outlier flag — comps unreliable here, so the dashboard
    // swaps the gap columns for an est_floor display.
    neighborhood_ceiling_risk: a.neighborhood_ceiling_risk === true,
    ceiling_risk_note:
      a.neighborhood_ceiling_risk === true ? a.ceiling_risk_note || null : null,
    est_floor:
      a.neighborhood_ceiling_risk === true && Number(a.est_floor) > 0
        ? Math.round(Number(a.est_floor))
        : null,
  };
  // Decide the offer-range flag using BOTH Claude's signal and a hard
  // server-side sanity check on (asking - offer_low) / asking.
  const flagged =
    a.offer_range_flagged === true ||
    shouldFlagOfferRange(a.asking_price, a.offer_low);
  data.offer_range_flagged = flagged;
  data.offer_range_flag_note = flagged
    ? a.offer_range_flag_note ||
      defaultOfferRangeNote(a.asking_price, a.offer_low)
    : null;
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
    land_arbitrage_score: a.land_arbitrage_score,
    land_arbitrage_notes: a.land_arbitrage_notes,
    score_breakdown: a.score_breakdown,
    data,
  };
}

// Upsert a reports row, retrying with only legacy columns if the v4/v5
// fields don't exist yet. Returns the error object or null on success.
export async function upsertReportRow(supabase, row) {
  let { error } = await supabase
    .from("reports")
    .upsert(row, { onConflict: "address" });
  if (error && /column .* does not exist/i.test(error.message || "")) {
    console.warn(
      "post-v3 columns missing — retrying upsert with legacy fields only:",
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
