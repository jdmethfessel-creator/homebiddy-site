import { waitUntil } from "@vercel/functions";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { normalizeAddress } from "../../../lib/extract-address";
import { runAnalysisForHome } from "../../../lib/dashboard-analyze";

// Same lifetime ceiling as /api/dashboard/save — waitUntil keeps the
// function alive for the background analysis up to maxDuration.
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

  // The home must already exist for this user.
  const { data: home } = await supabase
    .from("saved_homes")
    .select("id, listing_url")
    .eq("user_id", auth.user.id)
    .eq("address", savedAddress)
    .maybeSingle();
  if (!home) {
    return res.status(404).json({ error: "Saved home not found" });
  }

  // Reset state for a fresh attempt. Tolerate schema-v6 columns missing.
  const { error: resetErr } = await supabase
    .from("saved_homes")
    .update({ status: "pending", analysis_attempts: 0, last_error: null })
    .eq("id", home.id);
  if (resetErr && !/column .* does not exist/i.test(resetErr.message || "")) {
    console.error("retry reset error:", resetErr);
  }

  const url = listing_url || home.listing_url;

  // Respond immediately; client picks up status via list-polling.
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
