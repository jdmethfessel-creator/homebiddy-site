import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  analyzeWithClaude,
  buildReportRowFromAnalysis,
  upsertReportRow,
} from "../../../lib/auto-report";
import { normalizeAddress } from "../../../lib/extract-address";

// Long-running: Claude web-search + DB writes. Pro plan required for >10s.
export const config = {
  maxDuration: 120,
};

async function grantAccess(supabase, userId, address) {
  await supabase
    .from("report_access")
    .upsert(
      { user_id: userId, address, stripe_session_id: "auto-analyze" },
      { onConflict: "user_id,address" }
    );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address, listing_url } = req.body || {};
  if (!address || !listing_url) {
    return res.status(400).json({ error: "Missing address or listing_url" });
  }

  const supabase = getSupabaseAdmin();
  const savedAddress = normalizeAddress(address) || address;

  // If a report already exists for this address, just grant access.
  const { data: existing } = await supabase
    .from("reports")
    .select("address")
    .eq("address", savedAddress)
    .maybeSingle();

  if (existing) {
    await grantAccess(supabase, auth.user.id, savedAddress);
    return res.status(200).json({ status: "cached", address: savedAddress });
  }

  // Run Claude web-search analysis. enrichReport happens inside analyzeWithClaude.
  let analysis;
  try {
    analysis = await analyzeWithClaude(listing_url);
  } catch (err) {
    console.error("analyzeWithClaude error:", err);
    return res.status(502).json({ error: `Analysis failed: ${err.message}` });
  }

  // Prefer Claude's canonical address, falling back to the saved one.
  const claudeAddress = analysis.address
    ? normalizeAddress(analysis.address)
    : null;
  const finalAddress = claudeAddress || savedAddress;

  const row = buildReportRowFromAnalysis(analysis, finalAddress);
  const upsertErr = await upsertReportRow(supabase, row);
  if (upsertErr) {
    console.error("reports upsert error:", upsertErr);
    return res.status(500).json({ error: `DB error: ${upsertErr.message}` });
  }

  // If Claude canonicalized the address differently from what the user saved,
  // realign the saved_homes row so the join with reports works.
  if (finalAddress !== savedAddress) {
    await supabase
      .from("saved_homes")
      .update({ address: finalAddress })
      .eq("user_id", auth.user.id)
      .eq("address", savedAddress);
  }

  await grantAccess(supabase, auth.user.id, finalAddress);

  return res.status(200).json({
    status: "analyzed",
    address: finalAddress,
    canonicalized: finalAddress !== savedAddress,
  });
}
