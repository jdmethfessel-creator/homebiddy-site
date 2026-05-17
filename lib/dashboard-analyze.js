// Shared background-analysis flow used by /api/dashboard/save (kick-off on
// fresh save) and /api/dashboard/analyze (manual retry). Performs up to
// MAX_ATTEMPTS Claude calls with a short backoff between attempts, then
// flips saved_homes.status to 'complete' or 'failed' depending on the
// outcome. Tolerates schema-v6 columns being absent (just skips status
// updates in that case).

import {
  analyzeWithClaude,
  buildReportRowFromAnalysis,
  upsertReportRow,
  SYSTEM_PROMPT,
} from "./auto-report";
import { normalizeAddress } from "./extract-address";

// Dashboard path runs on Sonnet for quality on the structured
// extraction + comp-set reasoning. Matches the homepage PDF flow.
const DASHBOARD_MODEL = "claude-sonnet-4-6";

// initial + 1 retry. A third attempt routinely pushed the function past
// maxDuration when Claude's web_search calls were slow. The runtime
// would kill the analysis mid-flight, leaving rows stuck on 'pending'.
const MAX_ATTEMPTS = 2;
const BACKOFF_MS = 2500;

async function grantAccess(supabase, userId, address) {
  await supabase
    .from("report_access")
    .upsert(
      { user_id: userId, address, stripe_session_id: "auto-analyze" },
      { onConflict: "user_id,address" }
    );
}

// Update saved_homes; if the v6 columns aren't there, silently drop them and
// only update the legacy fields. Returns the final error or null.
async function updateSavedHome(supabase, homeId, fields) {
  let { error } = await supabase
    .from("saved_homes")
    .update(fields)
    .eq("id", homeId);
  if (error && /column .* does not exist/i.test(error.message || "")) {
    const { status, analysis_attempts, last_error, ...legacy } = fields;
    if (Object.keys(legacy).length === 0) return null;
    const retry = await supabase
      .from("saved_homes")
      .update(legacy)
      .eq("id", homeId);
    error = retry.error;
  }
  return error;
}

export async function runAnalysisForHome({
  supabase,
  userId,
  homeId,
  address,
  listing_url,
}) {
  console.log("[runAnalysisForHome] start", {
    userId,
    homeId,
    address,
    has_listing_url: !!listing_url,
    started_at: new Date().toISOString(),
  });
  if (!supabase || !userId || !homeId || !address) {
    console.warn("[runAnalysisForHome] missing inputs, aborting");
    return;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await updateSavedHome(supabase, homeId, { analysis_attempts: attempt });

      // Race-safe: a parallel save or admin fulfillment may have written the
      // report between attempts. If so just grant access and we're done.
      const { data: existing } = await supabase
        .from("reports")
        .select("address")
        .eq("address", address)
        .maybeSingle();
      if (existing) {
        await grantAccess(supabase, userId, address);
        await updateSavedHome(supabase, homeId, {
          status: "complete",
          last_error: null,
        });
        return { status: "complete", source: "cached" };
      }

      if (!listing_url) {
        throw new Error("No listing_url available for analysis");
      }

      const analysis = await analyzeWithClaude(listing_url, {
        model: DASHBOARD_MODEL,
        systemPrompt: SYSTEM_PROMPT,
      });
      const claudeAddress = analysis.address
        ? normalizeAddress(analysis.address)
        : null;
      const finalAddress = claudeAddress || address;

      const row = buildReportRowFromAnalysis(analysis, finalAddress);
      const upsertErr = await upsertReportRow(supabase, row);
      if (upsertErr) {
        throw new Error(`reports upsert: ${upsertErr.message}`);
      }

      // Realign saved_homes.address if Claude canonicalized differently —
      // keeps the join with reports correct.
      if (finalAddress !== address) {
        await supabase
          .from("saved_homes")
          .update({ address: finalAddress })
          .eq("id", homeId);
      }

      await grantAccess(supabase, userId, finalAddress);
      await updateSavedHome(supabase, homeId, {
        status: "complete",
        last_error: null,
      });
      console.log("[runAnalysisForHome] success", {
        homeId,
        address: finalAddress,
        attempt,
        finished_at: new Date().toISOString(),
      });
      return { status: "complete", source: "analyzed", address: finalAddress };
    } catch (err) {
      lastError = err?.message || String(err);
      console.error(
        `runAnalysisForHome attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err
      );
      // listing_not_found is deterministic — retrying the same dead URL
      // just burns tokens. Bail out of the retry loop and let the
      // trailing block mark status='failed' with the model's reason.
      if (err?.code === "listing_not_found") break;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
      }
    }
  }

  console.warn("[runAnalysisForHome] all attempts failed", { homeId, address, lastError });
  await updateSavedHome(supabase, homeId, {
    status: "failed",
    last_error: lastError,
  });
  return { status: "failed", error: lastError };
}
