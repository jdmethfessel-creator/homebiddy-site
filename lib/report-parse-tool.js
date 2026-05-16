// Tool schema used to extract structured report data via Claude API.
export const SAVE_REPORT_TOOL = {
  name: "save_report",
  description: "Save the extracted HomeBiddy report fields to the database.",
  input_schema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description:
          "Property address normalized to canonical format: '<number> <street name> <Suffix>, <City> <ST> <ZIP>'. RULES: (1) SHORT-FORM street suffix — St (not Street), Rd (not Road), Ave (not Avenue), Blvd (not Boulevard), Dr (not Drive), Ln, Ct, Pl, Ter, Cir, Pkwy, Hwy, Trl. (2) Exactly ONE comma, between street and city. NO comma between city and state. (3) NEVER place a comma between a directional and city name — 'West Palm Beach' is one city; never 'West, Palm Beach'. Example: '442 28th St, West Palm Beach FL 33407'.",
      },
      asking_price: { type: "integer" },
      offer_low: { type: "integer" },
      offer_high: { type: "integer" },
      walk_away: { type: "integer" },
      offer_basis: { type: "string" },
      negotiability_score: { type: "number" },
      negotiability_label: { type: "string" },
      days_on_market: { type: "integer" },
      avg_dom: { type: "integer" },
      price_cuts: { type: "integer" },
      cut_history: { type: "array", items: { type: "string" } },
      zestimate: { type: "integer" },
      zestimate_gap: { type: "integer" },
      neighborhood: {
        type: "string",
        description:
          "Submarket / sub-neighborhood name when recognizable (e.g. 'Old Northwood', 'El Cid', 'SoSo', 'Flamingo Park'). Only fall back to the city name when no distinct submarket exists. Do NOT prefix with the city. Return the SHORTEST commonly used local name only — no suffixes, no parentheticals, no 'Historic District' / 'Neighborhood', no city appended. Example: 'SoSo' not 'SoSo (Belair Historic District)'.",
      },
      appreciation_rate_annual: {
        type: "number",
        description: "Annual neighborhood appreciation as a decimal (0.038 = 3.8%).",
      },
      beds: { type: "integer" },
      baths: { type: "number" },
      sqft: { type: "integer" },
      year_built: { type: "integer" },

      // Valuation
      lot_size_sqft: { type: "integer", description: "Lot size in square feet." },
      price_per_living_sqft: {
        type: "number",
        description: "asking_price ÷ sqft, two decimals.",
      },
      price_per_lot_sqft: {
        type: "number",
        description: "asking_price ÷ lot_size_sqft, two decimals.",
      },

      // Sale history + taxes
      last_sold_price: { type: "integer" },
      last_sold_year: { type: "integer" },
      tax_assessed_value: { type: "integer" },
      annual_taxes_current: { type: "integer" },
      annual_taxes_projected: {
        type: "integer",
        description:
          "Post-sale projected annual taxes = offer_low × local effective property tax rate. Florida is ~0.95-1.10% — pick the rate matching the county.",
      },
      hoa_monthly: { type: "integer" },

      // Risk
      flood_zone: { type: "string", description: "FEMA zone like 'X', 'AE', 'VE'." },

      // Monthly cost estimates
      estimated_monthly_mortgage: {
        type: "integer",
        description: "Monthly P&I at 20% down, 6.8% 30yr fixed, on offer_low.",
      },
      estimated_monthly_insurance: {
        type: "integer",
        description:
          "Monthly homeowners insurance estimate. ~0.7%/yr of offer_low for non-flood zones; 1.0-1.2% if flood_zone starts with A or V.",
      },
      estimated_monthly_total: {
        type: "integer",
        description: "mortgage + taxes/12 + insurance + hoa_monthly.",
      },

      // Lifestyle + schools (schema-v7).
      walk_score: { type: "integer", description: "Walk Score 0-100." },
      transit_score: { type: "integer", description: "Transit Score 0-100. Omit if not available." },
      bike_score: { type: "integer", description: "Bike Score 0-100. Omit if not available." },
      elementary_school: { type: "string" },
      elementary_rating: { type: "number", description: "Rating out of 10." },
      middle_school: { type: "string" },
      middle_rating: { type: "number" },
      high_school: { type: "string" },
      high_rating: { type: "number" },
      school_rating_avg: {
        type: "number",
        description: "Mean of the three school ratings. Compute it yourself.",
      },
      commute_to_downtown_min: {
        type: "integer",
        description: "Estimated drive time in minutes to the city's main downtown / CBD.",
      },
      nearest_grocery_min: {
        type: "integer",
        description: "Estimated drive time in minutes to the nearest grocery store.",
      },

      // Land arbitrage + transparent negotiability breakdown (schema-v5).
      land_arbitrage_score: {
        type: "number",
        description:
          "0-10 weighted: 30% $/sqft lot vs neighborhood median, 25% lot size vs median, 25% structure condition signals (age + DOM + cuts + listing language), 20% renovation/ADU upside.",
      },
      land_arbitrage_notes: {
        type: "string",
        description:
          "Short comma-separated phrase explaining the land_arbitrage_score, MAX 8 WORDS, no full sentences. Examples: 'Large lot, dated structure, renovation upside' or 'Standard lot, motivated seller, ADU potential'.",
      },
      offer_range_flagged: {
        type: "boolean",
        description:
          "Set TRUE if offer_low is more than 25% below asking_price (data-quality flag). Omit otherwise.",
      },
      offer_range_flag_note: {
        type: "string",
        description:
          "If offer_range_flagged is true, a short explanation of why the discount looks suspect.",
      },
      neighborhood_ceiling_risk: {
        type: "boolean",
        description:
          "Set TRUE when the home is a renovated outlier in its neighborhood: asking $/sqft is more than 25% above the comp average AND the listing mentions renovation, remodel, or updated finishes ('renovated', 'remodeled', 'updated kitchen', 'new finishes', 'fully redone', etc.). Omit otherwise.",
      },
      ceiling_risk_note: {
        type: "string",
        description:
          "If neighborhood_ceiling_risk is true, a plain-English explanation (2-3 sentences) of why the comps are unreliable here and how the buyer should think about the seller's cost floor.",
      },
      est_floor: {
        type: "integer",
        description:
          "If neighborhood_ceiling_risk is true, the seller's likely floor in dollars — the lesser of (a) 10-15% below asking based on DOM and price cuts, or (b) the renovation-cost floor implied by listing signals and history. Use DOM and price-cut history as primary inputs; IGNORE the $/sqft comp gap when computing this for ceiling-risk homes. A home with 84 DOM and no cuts ≈ 8-10% below ask. Add 3-5% per recorded price cut.",
      },
      score_breakdown: {
        type: "object",
        description:
          "Transparent breakdown of the 5-component negotiability_score. Each *_score is 0-10. Each *_note is a short plain-English explanation displayed on the detail page.",
        properties: {
          dom_score: { type: "number" },
          dom_note: { type: "string" },
          price_history_score: { type: "number" },
          price_history_note: { type: "string" },
          comp_psf_score: { type: "number" },
          comp_psf_note: { type: "string" },
          zestimate_gap_score: { type: "number" },
          zestimate_gap_note: { type: "string" },
          listing_signals_score: { type: "number" },
          listing_signals_note: { type: "string" },
        },
      },
      land_score_breakdown: {
        type: "object",
        description:
          "Transparent breakdown of the 4-component land_arbitrage_score. Each *_score is 0-10; each *_note is the rationale.",
        properties: {
          lot_psf_score: { type: "number" },
          lot_psf_note: { type: "string" },
          lot_size_score: { type: "number" },
          lot_size_note: { type: "string" },
          condition_score: { type: "number" },
          condition_note: { type: "string" },
          upside_score: { type: "number" },
          upside_note: { type: "string" },
        },
      },
      relisted: {
        type: "boolean",
        description:
          "True if the home was previously listed and withdrawn before this listing — feeds the price_history sub-score (+2 bonus).",
      },
      comp_radius_miles: {
        type: "number",
        description:
          "Radius (in miles) used for the comp search. Density-adaptive: 0.25 urban, 0.5 suburban, 1-2 small town, 5-10 rural. Waterfront / golf / gated overrides the tier — same amenity class required.",
      },
      comp_count: {
        type: "integer",
        description: "Number of qualifying closed comps within comp_radius_miles in the last 12 months.",
      },

      // Long-form content
      insights: { type: "array", items: { type: "string" } },
      script: { type: "string", description: "Negotiation script for the buyer." },
      questions: { type: "array", items: { type: "string" } },
      comps: {
        type: "array",
        description: "5 recent closed comparable sales.",
        items: {
          type: "object",
          properties: {
            address: { type: "string" },
            beds: { type: "integer" },
            sqft: { type: "integer" },
            sold: { type: "integer" },
            psf: { type: "integer" },
            dom: { type: "integer" },
          },
          required: ["address", "beds", "sqft", "sold", "psf", "dom"],
        },
      },
      tiles: {
        type: "object",
        properties: {
          comp_avg_psf: { type: "integer" },
          comp_median_sale: { type: "integer" },
          suggested_under_ask_pct: { type: "number" },
          median_dom: { type: "integer" },
        },
      },
    },
    required: [
      "address",
      "asking_price",
      "offer_low",
      "offer_high",
      "negotiability_score",
      "days_on_market",
      "price_cuts",
      "neighborhood",
      "appreciation_rate_annual",
      "beds",
      "sqft",
      "insights",
      "script",
      "questions",
      "comps",
    ],
  },
};

export const SYSTEM_PROMPT = `You are a strict data-extraction service. The user will paste a HomeBiddy offer report in free-form text. Your only job is to call the save_report tool with the report's fields filled in.

Rules:
- Read the entire pasted text before extracting. Numbers may appear with commas ($1,995,000) or K/M suffixes ($1.99M). Emit raw integers in USD (e.g. 1995000) for money fields.
- appreciation_rate_annual: convert percentages to decimal (3.8% → 0.038).
- For comps, always return as many as the report contains, max 5. Each comp's sold and psf are integers in USD.
- Insights: 4 short plain-text strings, no bullets/numbers/markdown.
- Script: the negotiation script, usually in quotes. Strip outer quotes; preserve body verbatim.
- Questions: 3 short questions, no numbering.
- Tiles: comp_avg_psf, comp_median_sale, suggested_under_ask_pct (number like 7.5), median_dom.
- Cost + valuation fields (lot_size_sqft, price_per_living_sqft, price_per_lot_sqft, last_sold_price, last_sold_year, tax_assessed_value, annual_taxes_current, annual_taxes_projected, hoa_monthly, flood_zone, estimated_monthly_mortgage, estimated_monthly_insurance, estimated_monthly_total): extract whatever the report includes. If a field isn't present, OMIT it — do NOT invent values.
- If a non-required value is genuinely missing, omit it from the tool call (do NOT invent values).

ADDRESS FORMAT (apply strictly):
- Extract the subject property's full address (NOT a comp's address).
- Canonical: '<number> <street name> <Suffix>, <City> <ST> <ZIP>'.
- Use SHORT-FORM street suffix: St, Rd, Ave, Blvd, Dr, Ln, Ct, Pl, Ter, Cir, Pkwy, Hwy, Trl. Strip any trailing period.
- Exactly ONE comma between street and city. NO comma between city and state.
- NEVER place a comma between a directional and city name: 'West Palm Beach' is one city.

Always call the save_report tool. Do not respond in plain text.`;
