import Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabase-server";
import { submitToFormspree } from "../../lib/formspree";
import { PLANS } from "../../lib/plans";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe webhook env vars missing");
    return res.status(500).send("Webhook not configured");
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error("Failed to read raw body:", err);
    return res.status(400).send("Bad Request");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const meta = session.metadata || {};
  const type = meta.type || "plan";

  // Dispatch:
  //   - "plan": landing anonymous purchase  → public.users + Formspree
  //   - "address_report": dashboard per-address → report_access
  //   - "dashboard_pack5": dashboard credits → user_dashboard_plan +5 credits
  //   - "dashboard_unlimited": dashboard lifetime → user_dashboard_plan.is_unlimited
  if (type === "plan") return handlePlanPurchase(session, res);
  if (type === "address_report") return handleAddressReport(session, res);
  if (type === "dashboard_pack5") return handleDashboardCredits(session, res, 5);
  if (type === "dashboard_unlimited") return handleDashboardUnlimited(session, res);

  console.warn("Webhook: unknown metadata.type", { type, meta });
  return res.status(200).json({ received: true, ignored: type });
}

async function handleAddressReport(session, res) {
  const meta = session.metadata || {};
  const address = meta.address;
  const userId = meta.user_id;
  const email = (meta.email || "").trim().toLowerCase();
  const listing_url = meta.listing_url || "";

  if (!address || !userId) {
    console.error("address_report missing metadata", { meta });
    return res.status(200).json({ received: true, error: "missing metadata" });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error: insertErr } = await supabase
      .from("report_access")
      .upsert({
        user_id: userId,
        address,
        stripe_session_id: session.id,
      });
    if (insertErr) console.error("report_access upsert:", insertErr);
  } catch (err) {
    console.error("Supabase report_access error:", err);
  }

  if (email) {
    await submitToFormspree({
      listing_url: `${listing_url}\nADDRESS: ${address}\nUSER: ${email}`,
      email,
    });
  }

  return res.status(200).json({ received: true });
}

async function handleDashboardCredits(session, res, credits) {
  const meta = session.metadata || {};
  const userId = meta.user_id;
  const email = (meta.email || "").trim().toLowerCase();
  if (!userId) {
    console.error("dashboard_credits missing user_id", { meta });
    return res.status(200).json({ received: true, error: "missing user_id" });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from("user_dashboard_plan")
      .select("credits_remaining, total_purchased")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("user_dashboard_plan")
        .update({
          credits_remaining: (existing.credits_remaining ?? 0) + credits,
          total_purchased: (existing.total_purchased ?? 0) + credits,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("user_dashboard_plan").insert({
        user_id: userId,
        credits_remaining: credits,
        total_purchased: credits,
        is_unlimited: false,
      });
    }
  } catch (err) {
    console.error("Supabase credits error:", err);
  }

  if (email) {
    await submitToFormspree({
      listing_url: `DASHBOARD_5PACK\nUSER: ${email}`,
      email,
    });
  }

  return res.status(200).json({ received: true });
}

async function handleDashboardUnlimited(session, res) {
  const meta = session.metadata || {};
  const userId = meta.user_id;
  const email = (meta.email || "").trim().toLowerCase();
  if (!userId) {
    console.error("dashboard_unlimited missing user_id", { meta });
    return res.status(200).json({ received: true, error: "missing user_id" });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from("user_dashboard_plan")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("user_dashboard_plan")
        .update({
          is_unlimited: true,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("user_dashboard_plan").insert({
        user_id: userId,
        credits_remaining: 0,
        is_unlimited: true,
      });
    }

    // Backfill access for all saved homes that have reports
    const { data: homes } = await supabase
      .from("saved_homes")
      .select("address")
      .eq("user_id", userId);
    if (homes && homes.length > 0) {
      const addresses = homes.map((h) => h.address);
      const { data: reports } = await supabase
        .from("reports")
        .select("address")
        .in("address", addresses);
      if (reports && reports.length > 0) {
        const rows = reports.map((r) => ({
          user_id: userId,
          address: r.address,
          stripe_session_id: "unlimited",
        }));
        await supabase.from("report_access").upsert(rows, { onConflict: "user_id,address" });
      }
    }
  } catch (err) {
    console.error("Supabase unlimited error:", err);
  }

  if (email) {
    await submitToFormspree({
      listing_url: `DASHBOARD_UNLIMITED\nUSER: ${email}`,
      email,
    });
  }

  return res.status(200).json({ received: true });
}

async function handlePlanPurchase(session, res) {
  const meta = session.metadata || {};
  const listing_url = meta.listing_url;
  const email = (meta.email || "").trim().toLowerCase();
  const plan = meta.plan;

  if (!listing_url || !email || !PLANS[plan]) {
    console.error("plan purchase missing metadata", { meta });
    return res.status(200).json({ received: true, error: "missing metadata" });
  }

  // Note: we no longer call Formspree here — the homepage flow auto-fulfills
  // on the next /api/submit. The webhook only grants entitlement.
  // Reset report_count to 0 so the auto-submit (or any subsequent submit)
  // has the full plan quota available. The auto-submit increments back to 1
  // when the report is actually delivered.
  try {
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      const { error: updateErr } = await supabase
        .from("users")
        .update({ plan, report_count: 0 })
        .eq("email", email);
      if (updateErr) console.error("Supabase update error:", updateErr);
    } else {
      const { error: insertErr } = await supabase
        .from("users")
        .insert({ email, plan, report_count: 0 });
      if (insertErr) console.error("Supabase insert error:", insertErr);
    }
  } catch (err) {
    console.error("Supabase plan webhook error:", err);
  }

  return res.status(200).json({ received: true });
}
