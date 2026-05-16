import Stripe from "stripe";
import { getUserFromRequest } from "../../../lib/auth-server";
import { PLANS } from "../../../lib/plans";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const auth = await getUserFromRequest(req);
  if (!auth) return res.status(401).json({ error: "Not authenticated" });

  const { address, listing_url } = req.body || {};
  if (!address) return res.status(400).json({ error: "Missing address" });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe not configured" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: PLANS.single.priceId, quantity: 1 }],
      customer_email: auth.user.email,
      success_url: `${origin}/dashboard?paid=1&address=${encodeURIComponent(address)}`,
      cancel_url: `${origin}/dashboard?canceled=1`,
      metadata: {
        type: "address_report",
        address,
        listing_url: listing_url || "",
        user_id: auth.user.id,
        email: auth.user.email || "",
      },
      payment_intent_data: {
        metadata: {
          type: "address_report",
          address,
          user_id: auth.user.id,
        },
      },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Dashboard checkout error:", err);
    return res.status(500).json({ error: "Could not start checkout" });
  }
}
