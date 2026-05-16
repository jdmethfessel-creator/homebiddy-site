import { getSupabaseAdmin } from "../../../lib/supabase-server";

// Public, no-auth endpoint that returns a read-only snapshot of a user's
// saved homes by share token. The token's user_id is looked up in
// dashboard_shares; the response mirrors /api/dashboard/list so the
// /shared/[token] page can render with the existing components.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: "Missing token" });

  const supabase = getSupabaseAdmin();

  const { data: share, error: shareErr } = await supabase
    .from("dashboard_shares")
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (shareErr) {
    console.error("share lookup error:", shareErr);
    return res.status(500).json({ error: "Lookup failed" });
  }
  if (!share) return res.status(404).json({ error: "Share not found" });
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.status(410).json({ error: "Share link has expired" });
  }

  const userId = share.user_id;

  const { data: homes, error: homesErr } = await supabase
    .from("saved_homes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (homesErr) {
    console.error(homesErr);
    return res.status(500).json({ error: "List error" });
  }
  if (!homes || homes.length === 0) {
    return res.status(200).json({ homes: [] });
  }
  const addresses = homes.map((h) => h.address);

  const [
    { data: reports },
    { data: access },
    { data: plan },
  ] = await Promise.all([
    supabase.from("reports").select("*").in("address", addresses),
    supabase
      .from("report_access")
      .select("address")
      .eq("user_id", userId)
      .in("address", addresses),
    supabase
      .from("user_dashboard_plan")
      .select("is_unlimited")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const reportsByAddress = new Map((reports || []).map((r) => [r.address, r]));
  const accessSet = new Set((access || []).map((a) => a.address));
  const isUnlimited = !!plan?.is_unlimited;

  const result = homes.map((h) => {
    const report = reportsByAddress.get(h.address) || null;
    const hasAccess = accessSet.has(h.address) || (isUnlimited && !!report);
    return {
      id: h.id,
      address: h.address,
      listing_url: h.listing_url,
      created_at: h.created_at,
      status: h.status || "complete",
      report_exists: !!report,
      has_access: hasAccess,
      report: hasAccess ? report : report ? maskedSummary(report) : null,
    };
  });

  return res.status(200).json({ homes: result, expires_at: share.expires_at });
}

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
