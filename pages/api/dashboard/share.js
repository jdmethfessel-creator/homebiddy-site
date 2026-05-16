import crypto from "crypto";
import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const supabase = getSupabaseAdmin();
  const token = crypto.randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("dashboard_shares")
    .insert({
      user_id: auth.user.id,
      token,
      expires_at: expiresAt,
    })
    .select("id, token, expires_at")
    .single();

  if (error) {
    console.error("dashboard_shares insert error:", error);
    return res
      .status(500)
      .json({ error: "Could not create share link", detail: error.message });
  }

  return res.status(200).json({
    id: data.id,
    token: data.token,
    expires_at: data.expires_at,
  });
}
