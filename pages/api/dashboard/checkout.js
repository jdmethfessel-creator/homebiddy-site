import Stripe from "stripe";
import { getUserFromRequest } from "../../../lib/auth-server";
import { PLANS } from "../../../lib/plans";

// Dashboard checkout supports three plan kinds:
//   - single: pay for one specific address ($19.99). Requires address.
//   - pack5: 5 credits ($49.99). No address required.
//   - unlimited: lifetime access ($69.99). No address required.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { plan = "single", address, listing_url } = req.body || {};
  if (!PLANS[plan]) return res.status(400).json({ error: "Unknown plan" });
  if (plan === "single" && !address) {
    return res.status(400).json({ error: "Missing address for single plan" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  const type = plan === "single" ? "address_report" : `dashboard_${plan}`;
  const successPath = address
    ? `/dashboard?paid=1&address=${encodeURIComponent(address)}`
    : `/dashboard?paid=1&plan=${plan}`;

  const metadata = {
    type,
    user_id: auth.user.id,
    email: auth.user.email || "",
    plan,
    address: address || "",
    listing_url: listing_url || "",
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
      customer_email: auth.user.email,
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}/dashboard?canceled=1`,
      metadata,
      payment_intent_data: { metadata },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Dashboard checkout error:", err);
    return res.status(500).json({ error: "Could not start checkout" });
  }
}
