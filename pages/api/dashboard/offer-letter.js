import Anthropic from "@anthropic-ai/sdk";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export const config = {
  maxDuration: 60,
};

const MODEL = "claude-sonnet-4-6";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address, buyer, contingencies } = req.body || {};
  if (!address || !buyer) {
    return res.status(400).json({ error: "Missing address or buyer" });
  }

  const supabase = getSupabaseAdmin();

  // Confirm the user has access to this address before generating.
  const { data: access } = await supabase
    .from("report_access")
    .select("address")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();
  const { data: plan } = await supabase
    .from("user_dashboard_plan")
    .select("is_unlimited")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const hasAccess = !!access || plan?.is_unlimited === true;
  if (!hasAccess) {
    return res.status(403).json({ error: "No access to this report" });
  }

  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("address", address)
    .maybeSingle();
  if (!report) return res.status(404).json({ error: "Report not found" });

  const selected = Object.entries(contingencies || {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const closingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const offerLow = Number(report.offer_low) || 0;
  const earnest = Math.round(offerLow * 0.02);

  const comps = Array.isArray(report?.data?.comps) ? report.data.comps : [];
  const compSummary = comps
    .slice(0, 5)
    .map(
      (c) =>
        `${c.address || "comp"}: ${c.sqft || "?"} sqft sold ${c.sold ? "$" + Number(c.sold).toLocaleString() : "?"} ($${c.psf || "?"}/sqft, ${c.dom ?? "?"} DOM)`
    )
    .join("\n");

  const prompt = `Generate a professional offer letter from a buyer to a listing agent for a residential real-estate transaction. Use a formal but warm tone. Format as a complete letter with date, salutation, body, and signature line. Use plain text only — no markdown, no headers, no bullet points except numbered/lettered terms where appropriate.

BUYER: ${buyer}
PROPERTY ADDRESS: ${address}
ASKING PRICE: $${(Number(report.asking_price) || 0).toLocaleString()}
OFFER AMOUNT: $${offerLow.toLocaleString()}
EARNEST MONEY DEPOSIT: $${earnest.toLocaleString()} (2% of offer)
PROPOSED CLOSING DATE: ${closingDate}
CONTINGENCIES: ${selected.length > 0 ? selected.join(", ") : "none"}
DAYS ON MARKET: ${report.days_on_market ?? "?"}
PRICE CUTS: ${report.price_cuts ?? 0}

COMP DATA (use 1-2 of these to justify the offer in one short paragraph):
${compSummary || "(none available)"}

Letter sections to include:
1. Date and salutation ("Dear Listing Agent," or similar)
2. Statement of intent to purchase, listing the address and offer amount
3. Key terms: earnest money, contingencies, closing date
4. One paragraph referencing comp data + days on market to justify the offer
5. Polite close + signature line for the buyer

Length: 250-400 words. Output ONLY the letter text — no preamble, no explanation.`;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (response.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return res.status(200).json({ letter: text });
  } catch (err) {
    console.error("offer-letter generation error:", err);
    return res.status(500).json({ error: err.message || "Generation failed" });
  }
}
