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

  // Auto-grant access for unlimited users
  const { data: plan } = await supabase
    .from("user_dashboard_plan")
    .select("is_unlimited")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  let hasAccess = false;
  if (report) {
    const { data: access } = await supabase
      .from("report_access")
      .select("address")
      .eq("user_id", auth.user.id)
      .eq("address", address)
      .maybeSingle();
    hasAccess = !!access;
    if (!hasAccess && plan?.is_unlimited) {
      const { error: grantErr } = await supabase.from("report_access").insert({
        user_id: auth.user.id,
        address,
        stripe_session_id: "unlimited",
      });
      if (!grantErr) hasAccess = true;
    }
  }

  return res.status(200).json({
    id: homeId,
    address,
    report_exists: !!report,
    has_access: hasAccess,
  });
}
