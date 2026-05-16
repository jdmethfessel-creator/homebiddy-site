import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { extractAddressFromUrl, normalizeAddress } from "../../../lib/extract-address";

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

  const { data: existing } = await supabase
    .from("saved_homes")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();

  let homeId = existing?.id;

  if (!homeId) {
    const { data: inserted, error: insertErr } = await supabase
      .from("saved_homes")
      .insert({
        user_id: auth.user.id,
        address,
        listing_url: listing_url || null,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error("save_home insert error:", insertErr);
      return res.status(500).json({ error: "Could not save home" });
    }
    homeId = inserted.id;
  }

  const { data: report } = await supabase
    .from("reports")
    .select("address")
    .eq("address", address)
    .maybeSingle();

  // Saving a URL is now the trigger for free, automatic analysis. Auto-grant
  // access in every case so the saving user can view their report immediately
  // once the analyze step (or the existing cached report) is ready.
  let hasAccess = false;
  if (report) {
    const { error: grantErr } = await supabase
      .from("report_access")
      .upsert(
        { user_id: auth.user.id, address, stripe_session_id: "auto-save" },
        { onConflict: "user_id,address" }
      );
    if (!grantErr) hasAccess = true;
    else console.error("report_access auto-grant error:", grantErr);
  }

  return res.status(200).json({
    id: homeId,
    address,
    listing_url: listing_url || null,
    report_exists: !!report,
    has_access: hasAccess,
    // The client kicks off /api/dashboard/analyze when this is true so we
    // can show an "Analyzing..." state on the home card.
    analyzing: !report,
  });
}
