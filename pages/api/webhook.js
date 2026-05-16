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
  const type = meta.type || "plan"; // back-compat: untagged metadata = landing-page plan

  // Two strictly separate flows:
  //   - "plan": anonymous landing-page purchase → updates public.users + Formspree
  //   - "address_report": authenticated dashboard purchase → grants report_access
  // Misrouted metadata is logged and ignored — never cross over.
  if (type === "address_report") {
    return handleAddressReport(session, res);
  }
  if (type === "plan") {
    return handlePlanPurchase(session, res);
  }
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

  // Notify the team to generate (or fulfill) the report.
  if (email) {
    await submitToFormspree({ listing_url: `${listing_url}\nADDRESS: ${address}`, email });
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

  await submitToFormspree({ listing_url, email });

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
        .update({ plan, report_count: 1 })
        .eq("email", email);
      if (updateErr) console.error("Supabase update error:", updateErr);
    } else {
      const { error: insertErr } = await supabase
        .from("users")
        .insert({ email, plan, report_count: 1 });
      if (insertErr) console.error("Supabase insert error:", insertErr);
    }
  } catch (err) {
    console.error("Supabase plan webhook error:", err);
  }

  return res.status(200).json({ received: true });
}
