import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { SAVE_REPORT_TOOL, SYSTEM_PROMPT } from "../../../lib/report-parse-tool";
import { normalizeAddress } from "../../../lib/extract-address";
import {
  enrichReport,
  buildReportRowFromAnalysis,
  upsertReportRow,
} from "../../../lib/auto-report";

function checkAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, error: "ADMIN_PASSWORD not configured" };
  const provided = req.headers["x-admin-password"];
  if (!provided || provided !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const check = checkAdmin(req);
  if (!check.ok) return res.status(401).json({ error: check.error });

  const { address: rawAddress, raw_report } = req.body || {};
  if (!rawAddress || !raw_report) {
    return res.status(400).json({ error: "Missing address or raw_report" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }
  // Fallback if Claude can't extract — always run through the canonicalizer.
  const typedAddress = normalizeAddress(rawAddress) || rawAddress.trim();

  // Parse the pasted report via Claude with structured tool output.
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let extracted;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [SAVE_REPORT_TOOL],
      tool_choice: { type: "tool", name: "save_report" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Address hint (from admin form, may be in any format — re-normalize per the rules): ${typedAddress}\n\nReport text:\n\n${raw_report}`,
        },
      ],
    });
    const block = (response.content || []).find((b) => b.type === "tool_use");
    if (!block) {
      return res.status(502).json({ error: "Claude did not return structured data" });
    }
    extracted = block.input;
  } catch (err) {
    console.error("Anthropic parse error:", err);
    return res.status(502).json({ error: `Claude error: ${err.message}` });
  }

  // Address: prefer Claude's extracted value (extracted from the report itself);
  // always pass through normalizeAddress as a server-side safety net so the
  // stored key exactly matches what URL-derived saves produce.
  const claudeAddress = extracted.address ? normalizeAddress(extracted.address) : null;
  const address = claudeAddress || typedAddress;

  // Run through the same enrichment as the auto-report pipeline so derived
  // financial fields are deterministic and consistent across both entry points.
  const enriched = enrichReport(extracted);
  const row = buildReportRowFromAnalysis(enriched, address);
  const supabase = getSupabaseAdmin();
  const upsertErr = await upsertReportRow(supabase, row);
  if (upsertErr) {
    console.error("reports upsert:", upsertErr);
    return res.status(500).json({ error: `DB error: ${upsertErr.message}` });
  }

  // Count users who already have access (they paid; webhook granted at payment time).
  const { count: accessCount } = await supabase
    .from("report_access")
    .select("user_id", { count: "exact", head: true })
    .eq("address", address);

  // Also count any unlimited users with this address saved — backfill their access.
  const { data: savedHomes } = await supabase
    .from("saved_homes")
    .select("user_id")
    .eq("address", address);
  const savedUserIds = (savedHomes || []).map((h) => h.user_id);
  let unlimitedGranted = 0;
  if (savedUserIds.length > 0) {
    const { data: unlimitedPlans } = await supabase
      .from("user_dashboard_plan")
      .select("user_id")
      .in("user_id", savedUserIds)
      .eq("is_unlimited", true);
    const toGrant = (unlimitedPlans || []).map((p) => ({
      user_id: p.user_id,
      address,
      stripe_session_id: "unlimited",
    }));
    if (toGrant.length > 0) {
      const { error: grantErr } = await supabase
        .from("report_access")
        .upsert(toGrant, { onConflict: "user_id,address" });
      if (!grantErr) unlimitedGranted = toGrant.length;
    }
  }

  return res.status(200).json({
    success: true,
    address,
    typed_address: typedAddress !== address ? typedAddress : undefined,
    unlocked_count: (accessCount || 0) + unlimitedGranted,
    extracted_summary: {
      asking: row.asking_price,
      offer: `${row.offer_low}-${row.offer_high}`,
      neighborhood: row.neighborhood,
    },
  });
}
