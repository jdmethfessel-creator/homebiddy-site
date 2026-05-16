import { waitUntil } from "@vercel/functions";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  extractAddressFromUrl,
  normalizeAddress,
} from "../../../lib/extract-address";
import { runAnalysisForHome } from "../../../lib/dashboard-analyze";
import {
  FREE_SAVED_HOME_LIMIT,
  isPaidUser,
} from "../../../lib/plans";

// Function lifetime ceiling. waitUntil keeps the runtime alive after the
// response is sent, up to maxDuration. 800s requires Vercel Pro + Fluid
// Compute (default for new projects; toggle under Project Settings →
// Functions if it isn't already on).
export const config = {
  maxDuration: 800,
};

// Wraps a Supabase error into a structured JSON response. The actual message
// gets surfaced to the client so the user (and we, via the console) can see
// exactly what failed — no more generic "Could not save home".
function fail(res, status, code, message, detail) {
  return res.status(status).json({
    error: message,
    code,
    ...(detail ? { detail } : {}),
  });
}

// Insert saved_home, retrying with only legacy fields if any v6 column is
// missing. Returns { data, error } in the standard Supabase shape.
async function insertSavedHome(supabase, fields) {
  let { data, error } = await supabase
    .from("saved_homes")
    .insert(fields)
    .select("id")
    .single();
  if (error && /column .* does not exist/i.test(error.message || "")) {
    const { status, analysis_attempts, last_error, ...legacy } = fields;
    const retry = await supabase
      .from("saved_homes")
      .insert(legacy)
      .select("id")
      .single();
    data = retry.data;
    error = retry.error;
  }
  return { data, error };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return fail(res, 401, "unauthenticated", "Sign in to save homes.");

  const { listing_url, address: providedAddress } = req.body || {};
  if (!listing_url && !providedAddress) {
    return fail(
      res,
      400,
      "missing_input",
      "Paste a Zillow or Realtor.com listing URL."
    );
  }

  // Surface URL-shape problems early instead of silently failing address
  // extraction further down.
  if (listing_url && !providedAddress) {
    try {
      const u = new URL(listing_url);
      const host = u.hostname.toLowerCase();
      if (!/(zillow\.com|realtor\.com)$/i.test(host)) {
        return res.status(400).json({
          error:
            "We can only auto-parse Zillow or Realtor.com URLs. Paste the address manually below.",
          code: "unsupported_host",
          needs_address: true,
        });
      }
    } catch {
      return res.status(400).json({
        error:
          "That doesn't look like a valid URL. Paste a Zillow/Realtor.com link or type the address.",
        code: "invalid_url",
        needs_address: true,
      });
    }
  }

  let address = providedAddress
    ? normalizeAddress(providedAddress)
    : extractAddressFromUrl(listing_url);

  if (!address) {
    return res.status(400).json({
      error:
        "Couldn't extract the address from that URL — please type it in below.",
      code: "needs_address",
      needs_address: true,
    });
  }

  const supabase = getSupabaseAdmin();

  // Schema-tolerant: select only id so this works regardless of v6 migration
  // state. (Selecting v6 columns here would 400 the request on stale schemas
  // and skip our existing-row check, forcing a duplicate insert later.)
  const { data: existingHome, error: lookupErr } = await supabase
    .from("saved_homes")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();
  if (lookupErr) {
    console.error("saved_homes lookup error:", lookupErr);
    return fail(
      res,
      500,
      "db_lookup",
      `Database lookup failed: ${lookupErr.message}`,
      lookupErr.code
    );
  }

  // Check report cache (non-fatal if this query errors — we just won't
  // auto-grant access).
  const { data: report } = await supabase
    .from("reports")
    .select("address")
    .eq("address", address)
    .maybeSingle();
  const reportExists = !!report;

  let homeId = existingHome?.id;
  const initialStatus = reportExists ? "complete" : "pending";

  // Plan-based saved-home limit. Only applies to NEW saves — re-saving an
  // address that already exists for this user is a no-op and shouldn't
  // count against the cap. Free users are limited to FREE_SAVED_HOME_LIMIT;
  // anyone who has purchased (single / pack5 / unlimited) has no cap.
  if (!homeId) {
    const { data: planRow } = await supabase
      .from("user_dashboard_plan")
      .select("credits_remaining, is_unlimited, total_purchased")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!isPaidUser(planRow)) {
      const { count, error: countErr } = await supabase
        .from("saved_homes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id);
      if (countErr) {
        console.error("saved_homes count error:", countErr);
      } else if ((count ?? 0) >= FREE_SAVED_HOME_LIMIT) {
        return res.status(402).json({
          error: `Free accounts can save up to ${FREE_SAVED_HOME_LIMIT} homes. Upgrade any tier (Single, 5-pack, or Unlimited) to save unlimited homes.`,
          code: "free_limit",
          saved_count: count,
          limit: FREE_SAVED_HOME_LIMIT,
        });
      }
    }
  }

  if (!homeId) {
    const { data: inserted, error: insertErr } = await insertSavedHome(
      supabase,
      {
        user_id: auth.user.id,
        address,
        listing_url: listing_url || null,
        status: initialStatus,
        analysis_attempts: 0,
        last_error: null,
      }
    );
    if (insertErr) {
      // 23505 = unique violation. The most common cause: a concurrent
      // duplicate save by the same user. Re-fetch the existing row and
      // proceed gracefully instead of returning an error.
      const isDup =
        insertErr.code === "23505" ||
        /duplicate key|already exists/i.test(insertErr.message || "");
      if (isDup) {
        const { data: refetch, error: refetchErr } = await supabase
          .from("saved_homes")
          .select("id")
          .eq("user_id", auth.user.id)
          .eq("address", address)
          .maybeSingle();
        if (refetch?.id) {
          homeId = refetch.id;
        } else {
          console.error("dup insert + refetch failed:", insertErr, refetchErr);
          return fail(
            res,
            409,
            "duplicate",
            "This home is already saved but we couldn't find it. Refresh the page and try again."
          );
        }
      } else {
        console.error("save_home insert error:", insertErr);
        return fail(
          res,
          500,
          "db_insert",
          `Couldn't save home: ${insertErr.message}`,
          insertErr.code || null
        );
      }
    } else {
      homeId = inserted.id;
    }
  } else if (!reportExists) {
    // Re-saving an address that still has no report — flip it back to pending
    // so the polling UI lights up again. Tolerate v6 columns missing.
    const { error: statusErr } = await supabase
      .from("saved_homes")
      .update({ status: "pending", analysis_attempts: 0, last_error: null })
      .eq("id", homeId);
    if (
      statusErr &&
      !/column .* does not exist/i.test(statusErr.message || "")
    ) {
      console.error("status reset error:", statusErr);
      // Non-fatal — the home is saved and analysis will retry on next attempt.
    }
  }

  // Auto-grant access whenever a report already exists for this address.
  let hasAccess = false;
  if (reportExists) {
    const { error: grantErr } = await supabase
      .from("report_access")
      .upsert(
        {
          user_id: auth.user.id,
          address,
          stripe_session_id: "auto-save",
        },
        { onConflict: "user_id,address" }
      );
    if (!grantErr) hasAccess = true;
    else console.error("auto-grant access error:", grantErr);
  }

  res.status(200).json({
    id: homeId,
    address,
    listing_url: listing_url || null,
    report_exists: reportExists,
    has_access: hasAccess,
    status: initialStatus,
  });

  if (!reportExists && listing_url) {
    waitUntil(
      runAnalysisForHome({
        supabase,
        userId: auth.user.id,
        homeId,
        address,
        listing_url,
      })
    );
  }
}
