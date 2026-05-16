import Stripe from "stripe";
import { PLANS } from "../../lib/plans";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const { listing_url, email, plan } = req.body || {};
  if (!listing_url || !email || !plan || !PLANS[plan]) {
    return res.status(400).json({ error: "Invalid params" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const normalizedEmail = String(email).trim().toLowerCase();
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      line_items: [
        {
          price: PLANS[plan].priceId,
          quantity: 1,
        },
      ],
      customer_email: normalizedEmail,
      success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: {
        type: "plan",
        listing_url,
        email: normalizedEmail,
        plan,
      },
      payment_intent_data: {
        metadata: {
          type: "plan",
          listing_url,
          email: normalizedEmail,
          plan,
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return res.status(500).json({ error: "Could not create checkout session" });
  }
}
