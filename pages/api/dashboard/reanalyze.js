import { waitUntil } from "@vercel/functions";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { normalizeAddress } from "../../../lib/extract-address";
import { runAnalysisForHome } from "../../../lib/dashboard-analyze";

// User-triggered re-analysis. Deletes the existing reports row for this
// address (so stale jsonb fields can't survive a fresh run) and re-kicks
// the full Claude pipeline. report_access stays intact — the user paid
// for / earned access already; this is a refresh, not a re-purchase.
export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address, listing_url } = req.body || {};
  if (!address) {
    return res.status(400).json({ error: "Missing address" });
  }

  const supabase = getSupabaseAdmin();
  const savedAddress = normalizeAddress(address) || address;

  const { data: home } = await supabase
    .from("saved_homes")
    .select("id, listing_url")
    .eq("user_id", auth.user.id)
    .eq("address", savedAddress)
    .maybeSingle();
  if (!home) {
    return res.status(404).json({ error: "Saved home not found" });
  }

  const url = listing_url || home.listing_url;
  if (!url) {
    return res
      .status(400)
      .json({ error: "Need a listing URL to re-analyze." });
  }

  // Drop the existing reports row so a fresh upsert can't inherit stale
  // jsonb fields (e.g. an old ceiling_risk_note we no longer flag).
  // report_access is intentionally NOT touched.
  const { error: delErr } = await supabase
    .from("reports")
    .delete()
    .eq("address", savedAddress);
  if (delErr) {
    console.error("reanalyze delete reports error:", delErr);
    // Non-fatal — the upsert during analysis will overwrite. Keep going.
  }

  // Reset state so the polling UI picks up the in-flight analysis.
  // Tolerate schema-v6 columns missing.
  const { error: resetErr } = await supabase
    .from("saved_homes")
    .update({ status: "pending", analysis_attempts: 0, last_error: null })
    .eq("id", home.id);
  if (resetErr && !/column .* does not exist/i.test(resetErr.message || "")) {
    console.error("reanalyze reset status error:", resetErr);
  }

  res.status(200).json({
    id: home.id,
    status: "pending",
    address: savedAddress,
  });

  waitUntil(
    runAnalysisForHome({
      supabase,
      userId: auth.user.id,
      homeId: home.id,
      address: savedAddress,
      listing_url: url,
    })
  );
}
