import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing id" });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("saved_homes")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.user.id);
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Remove failed" });
  }

  return res.status(200).json({ ok: true });
}
