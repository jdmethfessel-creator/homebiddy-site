import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: "Missing address" });

  const supabase = getSupabaseAdmin();

  // Already unlocked?
  const { data: existing } = await supabase
    .from("report_access")
    .select("address")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();
  if (existing) return res.status(200).json({ status: "already_unlocked" });

  // Get user's plan
  const { data: plan } = await supabase
    .from("user_dashboard_plan")
    .select("credits_remaining, is_unlimited")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // Unlimited: grant immediately
  if (plan?.is_unlimited) {
    await supabase.from("report_access").insert({
      user_id: auth.user.id,
      address,
      stripe_session_id: "unlimited",
    });
    return res.status(200).json({ status: "unlocked", source: "unlimited" });
  }

  // Credits: spend one
  if (plan && (plan.credits_remaining ?? 0) > 0) {
    const { error: insertErr } = await supabase.from("report_access").insert({
      user_id: auth.user.id,
      address,
      stripe_session_id: "credit",
    });
    if (insertErr) {
      console.error("report_access insert:", insertErr);
      return res.status(500).json({ error: "Could not unlock" });
    }
    const { error: updateErr } = await supabase
      .from("user_dashboard_plan")
      .update({
        credits_remaining: plan.credits_remaining - 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.user.id);
    if (updateErr) console.error("plan update:", updateErr);
    return res.status(200).json({
      status: "unlocked",
      source: "credit",
      credits_remaining: plan.credits_remaining - 1,
    });
  }

  return res.status(402).json({ status: "payment_required" });
}
