import { getSupabaseAdmin } from "../../lib/supabase-server";
import { hasQuota } from "../../lib/plans";
import { submitToFormspree } from "../../lib/formspree";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const { listing_url, email } = req.body || {};
  if (!listing_url || !email) {
    return res.status(400).json({ error: "Missing listing_url or email" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const { data: existing, error: lookupErr } = await supabase
    .from("users")
    .select("email, plan, report_count")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (lookupErr) {
    console.error("Supabase lookup error:", lookupErr);
    return res.status(500).json({ error: "Database error" });
  }

  if (!existing) {
    const ok = await submitToFormspree({ listing_url, email: normalizedEmail });
    if (!ok) {
      return res.status(502).json({ error: "Could not deliver report" });
    }

    const { error: insertErr } = await supabase.from("users").insert({
      email: normalizedEmail,
      plan: "free",
      report_count: 1,
    });
    if (insertErr) console.error("Supabase insert error:", insertErr);

    return res.status(200).json({ status: "submitted", plan: "free" });
  }

  if (hasQuota(existing.plan, existing.report_count)) {
    const ok = await submitToFormspree({ listing_url, email: normalizedEmail });
    if (!ok) {
      return res.status(502).json({ error: "Could not deliver report" });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({ report_count: (existing.report_count ?? 0) + 1 })
      .eq("email", normalizedEmail);
    if (updateErr) console.error("Supabase update error:", updateErr);

    return res.status(200).json({ status: "submitted", plan: existing.plan });
  }

  return res.status(200).json({
    status: "payment_required",
    plan: existing.plan,
    report_count: existing.report_count,
  });
}
