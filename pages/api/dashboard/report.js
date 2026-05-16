import { getUserFromRequest } from "../../../lib/auth-server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address" });

  const supabase = getSupabaseAdmin();

  const { data: access } = await supabase
    .from("report_access")
    .select("address")
    .eq("user_id", auth.user.id)
    .eq("address", address)
    .maybeSingle();

  if (!access) {
    return res.status(403).json({ error: "No access", access: false });
  }

  const { data: report, error } = await supabase
    .from("reports")
    .select("*")
    .eq("address", address)
    .maybeSingle();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Lookup error" });
  }
  if (!report) {
    return res.status(200).json({
      access: true,
      report: null,
      pending: true,
      message: "Your report is being prepared. We'll email you when it's ready.",
    });
  }
  return res.status(200).json({ access: true, report });
}
