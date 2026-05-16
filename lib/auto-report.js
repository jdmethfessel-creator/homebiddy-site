import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are HomeBiddy, a real estate offer analyst. Given a Zillow or Realtor.com listing URL, use web search to find: the listing price, days on market, price reduction history, Zestimate, square footage, beds/baths, year built, neighborhood, and at least 3-5 closed comps within 0.5 miles in the last 12 months. Then produce a JSON object with these exact fields: address, neighborhood, beds, baths, sqft, year_built, asking_price, zestimate, zestimate_gap, days_on_market, avg_dom, price_cuts, cut_history, offer_low, offer_high, walk_away, offer_basis, negotiability_score, negotiability_label, comps (array: address, sold_date, sqft, price_per_sqft, dom, vs_list_pct, signal), insights (array of 4 strings), negotiation_script, questions (array of 3 strings). Return only valid JSON, no markdown.

Format rules for the JSON values:
- address: canonical short-form, single comma between street and city, no comma between directional and city — "<number> <street name> <St|Rd|Ave|Blvd|Dr|Ln|Ct|Pl|Ter|Cir|Pkwy|Hwy|Trl>, <City> <ST> <ZIP>". Example: "442 28th St, West Palm Beach FL 33407".
- All money values as integers (USD).
- zestimate_gap = asking_price - zestimate (positive = asking over Zestimate).
- negotiability_score: 0.0-10.0.
- negotiability_label: one of "Low", "Moderate", "High", "Very High".
- comps[i].sold_date: ISO YYYY-MM-DD.
- comps[i].vs_list_pct: signed decimal percent (negative = sold below list, e.g. -3.5).
- comps[i].signal: one short phrase, e.g. "below list, slow", "at list, fast".
- cut_history: array of strings like ["$2,150,000 → $1,995,000 (Sep 2025)"]. If no cuts, [].`;

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

  return extractFinalJSON(response);
}

function extractFinalJSON(response) {
  const texts = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text);
  const full = texts.join("\n").trim();
  if (!full) throw new Error("Claude returned no text content");

  // Try direct parse
  try {
    return JSON.parse(full);
  } catch {}

  // Try fenced ```json ... ```
  const fenced = full.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  // Last resort: greedy object match
  const obj = full.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {}
  }

  throw new Error("Could not parse JSON from Claude response");
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
