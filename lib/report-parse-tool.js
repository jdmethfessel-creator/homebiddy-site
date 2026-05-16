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
          "Property address normalized to canonical format: '<number> <street name> <Suffix>, <City> <ST> <ZIP>'. " +
          "RULES (apply strictly): " +
          "(1) Use the SHORT-FORM street suffix — St (not Street), Rd (not Road), Ave (not Avenue), Blvd (not Boulevard), Dr (not Drive), Ln, Ct, Pl, Ter, Cir, Pkwy, Hwy, Trl. " +
          "(2) Exactly ONE comma, placed between the street and the city. NO comma between city and state. " +
          "(3) NEVER place a comma between a directional and a city name — 'West Palm Beach' is one city; never write 'West, Palm Beach'. " +
          "Example: '442 28th St, West Palm Beach FL 33407'.",
      },
      asking_price: { type: "integer", description: "Listing asking price in USD." },
      offer_low: { type: "integer", description: "Low end of recommended offer range, USD." },
      offer_high: { type: "integer", description: "High end of recommended offer range, USD." },
      negotiability_score: {
        type: "number",
        description: "HomeBiddy negotiability score, 0-10.",
      },
      days_on_market: { type: "integer" },
      price_cuts: { type: "integer", description: "Number of prior price reductions." },
      zestimate_gap: {
        type: "integer",
        description: "Asking price minus Zestimate, USD. Positive = asking over Zestimate.",
      },
      neighborhood: {
        type: "string",
        description: "Neighborhood / city name, e.g. 'West Palm Beach'.",
      },
      appreciation_rate_annual: {
        type: "number",
        description:
          "Annual neighborhood appreciation as a decimal (e.g. 0.038 for 3.8%/yr).",
      },
      beds: { type: "integer" },
      baths: { type: "number", description: "Number of bathrooms; may be a decimal (e.g. 2.5)." },
      sqft: { type: "integer" },
      insights: {
        type: "array",
        items: { type: "string" },
        description: "Four plain-English insight bullets explaining the offer recommendation.",
      },
      script: {
        type: "string",
        description:
          "First-person negotiation script the buyer can use when delivering the offer.",
      },
      questions: {
        type: "array",
        items: { type: "string" },
        description: "Three questions to ask the listing agent.",
      },
      comps: {
        type: "array",
        description: "5 recent closed comparable sales.",
        items: {
          type: "object",
          properties: {
            address: { type: "string" },
            beds: { type: "integer" },
            sqft: { type: "integer" },
            sold: { type: "integer", description: "Sold price in USD." },
            psf: { type: "integer", description: "Sold price per square foot, USD." },
            dom: { type: "integer", description: "Days on market." },
          },
          required: ["address", "beds", "sqft", "sold", "psf", "dom"],
        },
      },
      tiles: {
        type: "object",
        description: "Summary tile values at the bottom of the report.",
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
- Read the entire pasted text before extracting. Numbers may appear with commas ($1,995,000) or with K/M suffixes ($1.99M). Always emit raw integers in USD (e.g. 1995000).
- For appreciation_rate_annual, convert any percentage you see into a decimal (3.8% → 0.038).
- For negotiability_score, accept anything from 0 to 10 as a number.
- For comps, always return exactly the 5 listed (or as many as the report contains, max 5). Each comp's "sold" and "psf" are integers in USD.
- Insights: typically 4 short paragraphs starting with a bold-style claim. Strip leading numbers/bullets/markdown. Emit clean plain-text strings.
- Script: the negotiation script, usually in quotes. Strip outer quotes; preserve the body verbatim.
- Questions: usually a numbered list of 3 short questions. Strip numbering.
- Tiles: comp_avg_psf, comp_median_sale, suggested_under_ask_pct (as a number like 7.5 for 7.5%), median_dom.
- If a non-required value is genuinely missing, omit it from the tool call (do NOT invent values).

ADDRESS FORMAT (apply strictly):
- Extract the subject property's full address (NOT a comp's address).
- Canonical format: "<number> <street name> <Suffix>, <City> <ST> <ZIP>".
- Use SHORT-FORM street suffix: St (not Street), Rd (not Road), Ave (not Avenue), Blvd (not Boulevard), Dr (not Drive), Ln, Ct, Pl, Ter, Cir, Pkwy, Hwy, Trl. Strip any trailing period (e.g. "St." → "St").
- Exactly ONE comma, between street and city. NO comma between city and state.
- NEVER insert a comma between a directional and a city name: "West Palm Beach" is one city — never write "West, Palm Beach". Same for North/South/East and the single-letter forms N/S/E/W.
- Example: "442 28th St, West Palm Beach FL 33407".

Always call the save_report tool. Do not respond in plain text.`;
