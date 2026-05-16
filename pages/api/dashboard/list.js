import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

// Use `*` so the SELECT tolerates schema migrations being half-applied —
// we return whatever columns currently exist and the dashboard handles
// missing fields gracefully.
const REPORT_FIELDS = "*";

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
    return res.status(200).json({ homes: [], plan: { credits_remaining: 0, is_unlimited: false } });
  }

  const addresses = homes.map((h) => h.address);

  const [
    { data: reports },
    { data: access },
    { data: plan },
  ] = await Promise.all([
    supabase.from("reports").select(REPORT_FIELDS).in("address", addresses),
    supabase
      .from("report_access")
      .select("address")
      .eq("user_id", auth.user.id)
      .in("address", addresses),
    supabase
      .from("user_dashboard_plan")
      .select("credits_remaining, is_unlimited, total_purchased")
      .eq("user_id", auth.user.id)
      .maybeSingle(),
  ]);

  const isUnlimited = !!plan?.is_unlimited;
  const reportsByAddress = new Map((reports || []).map((r) => [r.address, r]));
  const accessSet = new Set((access || []).map((a) => a.address));

  const result = homes.map((h) => {
    const report = reportsByAddress.get(h.address) || null;
    // Unlimited users implicitly have access to any report for their saved homes.
    const hasAccess = accessSet.has(h.address) || (isUnlimited && !!report);
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

  return res.status(200).json({
    homes: result,
    plan: {
      credits_remaining: plan?.credits_remaining ?? 0,
      is_unlimited: isUnlimited,
      total_purchased: plan?.total_purchased ?? 0,
    },
  });
}

// For a saved-home report the user hasn't paid for: show the address +
// asking price + neighborhood as a tease; blur the rest in the UI.
function maskedSummary(report) {
  return {
    address: report.address,
    asking_price: report.asking_price,
    neighborhood: report.neighborhood,
    beds: report.beds,
    baths: report.baths,
    sqft: report.sqft,
  };
}
