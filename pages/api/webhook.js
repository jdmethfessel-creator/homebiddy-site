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
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const meta = session.metadata || {};
  const listing_url = meta.listing_url;
  const email = (meta.email || "").trim().toLowerCase();
  const plan = meta.plan;

  if (!listing_url || !email || !PLANS[plan]) {
    console.error("Webhook missing metadata", { meta });
    return res.status(200).json({ received: true, error: "missing metadata" });
  }

  // 1. Deliver the report
  const delivered = await submitToFormspree({ listing_url, email });
  if (!delivered) {
    console.error("Formspree delivery failed for paid order", { email });
    // Still continue — record the purchase so the user can re-submit.
  }

  // 2. Update Supabase: set plan to the purchased plan, reset report_count to 1
  //    (this delivered report). Future reports within their plan increment the count.
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
      const { error: insertErr } = await supabase.from("users").insert({
        email,
        plan,
        report_count: 1,
      });
      if (insertErr) console.error("Supabase insert error:", insertErr);
    }
  } catch (err) {
    console.error("Supabase webhook error:", err);
  }

  return res.status(200).json({ received: true });
}
