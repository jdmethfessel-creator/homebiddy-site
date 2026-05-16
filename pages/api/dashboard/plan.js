import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_dashboard_plan")
    .select("credits_remaining, is_unlimited, total_purchased")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Lookup failed" });
  }
  return res.status(200).json({
    credits_remaining: data?.credits_remaining ?? 0,
    is_unlimited: !!data?.is_unlimited,
    total_purchased: data?.total_purchased ?? 0,
  });
}
