import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  aggregateNeighborhood,
  getMarketKey,
} from "../../../lib/market-intel";

const FIELDS =
  "address, neighborhood, asking_price, offer_low, days_on_market, price_cuts, appreciation_rate_annual";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const supabase = getSupabaseAdmin();

  const { data: homes } = await supabase
    .from("saved_homes")
    .select("address")
    .eq("user_id", auth.user.id);
  if (!homes || homes.length === 0) {
    return res.status(200).json({ markets: [] });
  }
  const addresses = homes.map((h) => h.address);
  const { data: userReports } = await supabase
    .from("reports")
    .select(FIELDS)
    .in("address", addresses);

  // Map saved address → market key so we can count user homes per submarket.
  const userMarketKeys = new Map(); // marketKey → count
  const userReportByAddress = new Map();
  (userReports || []).forEach((r) => {
    userReportByAddress.set(r.address, r);
    const key = getMarketKey(r);
    if (key) userMarketKeys.set(key, (userMarketKeys.get(key) || 0) + 1);
  });

  const targetKeys = Array.from(userMarketKeys.keys());
  if (targetKeys.length === 0) {
    return res.status(200).json({ markets: [] });
  }

  // Pull broader comp set: all reports whose computed market key matches
  // ANY of the user's submarkets. We query by neighborhood IN (...) — only
  // catches rows where neighborhood is explicitly set. For null neighborhoods
  // we'd need to scan by address, but that's a much wider query; skip it.
  const { data: allReports } = await supabase
    .from("reports")
    .select(FIELDS)
    .in("neighborhood", targetKeys);

  const groups = new Map();
  for (const r of allReports || []) {
    const key = getMarketKey(r);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // For any market key only present in user data with no aggregated set,
  // fall back to the user's own report so we still have a card.
  const out = targetKeys.map((key) => {
    const set = groups.get(key) && groups.get(key).length > 0
      ? groups.get(key)
      : (userReports || []).filter((r) => getMarketKey(r) === key);
    return {
      market: key,
      saved_count: userMarketKeys.get(key) || 0,
      summary: aggregateNeighborhood(set),
    };
  });

  return res.status(200).json({ markets: out });
}
