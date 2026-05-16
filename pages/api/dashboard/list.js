import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

const REPORT_FIELDS = [
  "address",
  "asking_price",
  "offer_low",
  "offer_high",
  "negotiability_score",
  "days_on_market",
  "price_cuts",
  "zestimate_gap",
  "neighborhood",
  "appreciation_rate_annual",
  "beds",
  "baths",
  "sqft",
].join(",");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const supabase = getSupabaseAdmin();

  const { data: homes, error: homesErr } = await supabase
    .from("saved_homes")
    .select("id, address, listing_url, created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (homesErr) {
    console.error(homesErr);
    return res.status(500).json({ error: "List error" });
  }
  if (!homes || homes.length === 0) {
    return res.status(200).json({ homes: [] });
  }

  const addresses = homes.map((h) => h.address);

  const [{ data: reports }, { data: access }] = await Promise.all([
    supabase.from("reports").select(REPORT_FIELDS).in("address", addresses),
    supabase
      .from("report_access")
      .select("address")
      .eq("user_id", auth.user.id)
      .in("address", addresses),
  ]);

  const reportsByAddress = new Map((reports || []).map((r) => [r.address, r]));
  const accessSet = new Set((access || []).map((a) => a.address));

  const result = homes.map((h) => {
    const report = reportsByAddress.get(h.address) || null;
    const hasAccess = accessSet.has(h.address);
    return {
      id: h.id,
      address: h.address,
      listing_url: h.listing_url,
      created_at: h.created_at,
      report_exists: !!report,
      has_access: hasAccess,
      report: hasAccess ? report : report ? maskedSummary(report) : null,
    };
  });

  return res.status(200).json({ homes: result });
}

// For a report the user hasn't paid for, expose only the address and neighborhood
// so the card can show "Generate report" without revealing analysis.
function maskedSummary(report) {
  return {
    address: report.address,
    neighborhood: report.neighborhood,
  };
}
