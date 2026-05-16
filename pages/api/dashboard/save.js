import { waitUntil } from "@vercel/functions";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  extractAddressFromUrl,
  normalizeAddress,
} from "../../../lib/extract-address";
import { runAnalysisForHome } from "../../../lib/dashboard-analyze";

// 5-minute ceiling on the function's total lifetime — waitUntil keeps the
// runtime alive after the response is sent, up to maxDuration.
export const config = {
  maxDuration: 300,
};

// Insert saved_home tolerating schema-v6 columns being absent.
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
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { listing_url, address: providedAddress } = req.body || {};
  if (!listing_url && !providedAddress) {
    return res.status(400).json({ error: "Missing listing_url or address" });
  }

  let address = providedAddress
    ? normalizeAddress(providedAddress)
    : extractAddressFromUrl(listing_url);

  if (!address) {
    return res.status(400).json({
      error: "Could not parse the address. Please type it in.",
      needs_address: true,
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: existingHome } = await supabase
    .from("saved_homes")
    .select("id, status")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();

  const { data: report } = await supabase
    .from("reports")
    .select("address")
    .eq("address", address)
    .maybeSingle();
  const reportExists = !!report;

  let homeId = existingHome?.id;
  const initialStatus = reportExists ? "complete" : "pending";

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
      console.error("save_home insert error:", insertErr);
      return res.status(500).json({ error: "Could not save home" });
    }
    homeId = inserted.id;
  } else if (!reportExists) {
    // Re-saving an address that still has no report — flip it back to pending
    // so the polling UI shows analysis is running.
    const { error: statusErr } = await supabase
      .from("saved_homes")
      .update({ status: "pending", analysis_attempts: 0, last_error: null })
      .eq("id", homeId);
    if (statusErr && !/column .* does not exist/i.test(statusErr.message || "")) {
      console.error("status reset error:", statusErr);
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

  // Respond immediately. The Claude pipeline below runs in the background
  // via waitUntil — the user sees status='pending' on the dashboard and
  // the client polls /api/dashboard/list every 10s for completion.
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
