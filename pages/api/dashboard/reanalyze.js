import { waitUntil } from "@vercel/functions";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { normalizeAddress } from "../../../lib/extract-address";
import { runAnalysisForHome } from "../../../lib/dashboard-analyze";

// User-triggered re-analysis. Wipes the reports row AND this user's
// report_access row for this address, flips saved_homes.status back to
// 'pending', then re-kicks the full Claude pipeline via waitUntil. The
// access row is re-created by runAnalysisForHome's grantAccess() once the
// fresh report is in place.
export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  console.log("[reanalyze] handler start", { method: req.method });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) {
    console.warn("[reanalyze] unauthenticated request");
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { address, listing_url } = req.body || {};
  console.log("[reanalyze] body", { userId: auth.user.id, address, listing_url });
  if (!address) {
    return res.status(400).json({ error: "Missing address" });
  }

  const supabase = getSupabaseAdmin();
  const savedAddress = normalizeAddress(address) || address;
  console.log("[reanalyze] savedAddress (normalized)", savedAddress);

  const { data: home, error: lookupErr } = await supabase
    .from("saved_homes")
    .select("id, listing_url")
    .eq("user_id", auth.user.id)
    .eq("address", savedAddress)
    .maybeSingle();
  if (lookupErr) {
    console.error("[reanalyze] saved_homes lookup error:", lookupErr);
    return res.status(500).json({ error: "Lookup failed", detail: lookupErr.message });
  }
  if (!home) {
    console.warn("[reanalyze] no matching saved_home", { userId: auth.user.id, savedAddress });
    return res.status(404).json({ error: "Saved home not found" });
  }
  console.log("[reanalyze] home found", { homeId: home.id, listing_url: home.listing_url });

  const url = listing_url || home.listing_url;
  if (!url) {
    return res
      .status(400)
      .json({ error: "Need a listing URL to re-analyze." });
  }

  // 1) Drop this user's report_access row so the UI loses unlock state
  //    immediately. runAnalysisForHome's grantAccess() will re-create it
  //    after the new report lands. (We also let the dashboard surface the
  //    Analyzing... spinner during the gap because has_access goes false.)
  const { error: delAccessErr } = await supabase
    .from("report_access")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("address", savedAddress);
  if (delAccessErr) {
    console.error("reanalyze: delete report_access failed:", delAccessErr);
  }

  // 2) Drop the existing reports row so a fresh upsert can't inherit stale
  //    jsonb fields (e.g. an old ceiling_risk_note we no longer flag).
  //    This is shared across users — deleting it briefly hides the report
  //    from anyone who'd unlocked it. Acceptable: the report regenerates
  //    in seconds and grantAccess restores anyone who had access.
  const { error: delReportErr } = await supabase
    .from("reports")
    .delete()
    .eq("address", savedAddress);
  if (delReportErr) {
    console.error("reanalyze: delete reports failed:", delReportErr);
  }

  // 3) Reset saved_homes state so the polling UI picks up the in-flight
  //    analysis. Tolerate schema-v6 columns missing.
  const { error: resetErr } = await supabase
    .from("saved_homes")
    .update({ status: "pending", analysis_attempts: 0, last_error: null })
    .eq("id", home.id);
  if (resetErr && !/column .* does not exist/i.test(resetErr.message || "")) {
    console.error("reanalyze: reset status failed:", resetErr);
  }

  console.log("[reanalyze] delete results", {
    report_deleted: !delReportErr,
    access_deleted: !delAccessErr,
    status_reset: !resetErr,
  });

  // Surface deletion outcomes in the response so the client can debug
  // without needing Vercel log access.
  res.status(200).json({
    id: home.id,
    status: "pending",
    address: savedAddress,
    deleted: {
      report: !delReportErr,
      access: !delAccessErr,
    },
  });

  console.log("[reanalyze] kicking off background analysis via waitUntil");

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
