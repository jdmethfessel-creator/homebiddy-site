import { getSupabaseAdmin } from "../../lib/supabase-server";
import { hasQuota } from "../../lib/plans";
import {
  analyzeWithClaude,
  generateReportId,
  formatDateLong,
} from "../../lib/auto-report";
import { renderReportPDF } from "../../lib/report-pdf";
import { sendReportEmail } from "../../lib/email";

// Vercel: allow this function to run long enough for Claude + PDF + email.
// Hobby caps at 10s; this requires Pro (max 800s).
export const config = {
  maxDuration: 120,
};

async function fulfillReport({ listing_url, email }) {
  const data = await analyzeWithClaude(listing_url);
  const reportId = generateReportId(data.address || email);
  const dateLabel = formatDateLong();
  const pdfBuffer = await renderReportPDF(data, { reportId, dateLabel });
  await sendReportEmail({ to: email, address: data.address, pdfBuffer });
  return { address: data.address, reportId };
}

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

  // === New user: free first report ===
  if (!existing) {
    let fulfilled;
    try {
      fulfilled = await fulfillReport({ listing_url, email: normalizedEmail });
    } catch (err) {
      console.error("Fulfillment error (new user):", err);
      return res.status(502).json({ error: `Could not deliver report: ${err.message}` });
    }

    const { error: insertErr } = await supabase.from("users").insert({
      email: normalizedEmail,
      plan: "free",
      report_count: 1,
    });
    if (insertErr) console.error("Supabase insert error:", insertErr);

    return res.status(200).json({
      status: "submitted",
      plan: "free",
      address: fulfilled.address,
      report_id: fulfilled.reportId,
    });
  }

  // === Existing user with remaining quota: deliver another report ===
  if (hasQuota(existing.plan, existing.report_count)) {
    let fulfilled;
    try {
      fulfilled = await fulfillReport({ listing_url, email: normalizedEmail });
    } catch (err) {
      console.error("Fulfillment error (returning user):", err);
      return res.status(502).json({ error: `Could not deliver report: ${err.message}` });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({ report_count: (existing.report_count ?? 0) + 1 })
      .eq("email", normalizedEmail);
    if (updateErr) console.error("Supabase update error:", updateErr);

    return res.status(200).json({
      status: "submitted",
      plan: existing.plan,
      address: fulfilled.address,
      report_id: fulfilled.reportId,
    });
  }

  // === Out of quota: client opens the pricing modal ===
  return res.status(200).json({
    status: "payment_required",
    plan: existing.plan,
    report_count: existing.report_count,
  });
}
