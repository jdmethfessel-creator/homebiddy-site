import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { aggregateNeighborhood } from "../../../lib/market-intel";

const FIELDS =
  "neighborhood, asking_price, offer_low, days_on_market, price_cuts, appreciation_rate_annual";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const supabase = getSupabaseAdmin();

  // Find neighborhoods represented in this user's saved homes.
  const { data: homes } = await supabase
    .from("saved_homes")
    .select("address")
    .eq("user_id", auth.user.id);
  if (!homes || homes.length === 0) {
    return res.status(200).json({ neighborhoods: [] });
  }
  const addresses = homes.map((h) => h.address);
  const { data: reports } = await supabase
    .from("reports")
    .select(FIELDS)
    .in("address", addresses);
  const targetNeighborhoods = Array.from(
    new Set((reports || []).map((r) => r.neighborhood).filter(Boolean))
  );
  if (targetNeighborhoods.length === 0) {
    return res.status(200).json({ neighborhoods: [] });
  }

  // Aggregate across ALL reports in those neighborhoods (broader sample).
  const { data: allReports } = await supabase
    .from("reports")
    .select(FIELDS)
    .in("neighborhood", targetNeighborhoods);

  const groups = new Map();
  for (const r of allReports || []) {
    if (!r.neighborhood) continue;
    if (!groups.has(r.neighborhood)) groups.set(r.neighborhood, []);
    groups.get(r.neighborhood).push(r);
  }

  const out = targetNeighborhoods.map((n) => ({
    neighborhood: n,
    summary: aggregateNeighborhood(groups.get(n) || []),
  }));

  return res.status(200).json({ neighborhoods: out });
}
