export const PLANS = {
  single: {
    id: "single",
    priceId: "price_1TXeiLEPb8kQvEZkB9T90KWh",
    label: "Single Report",
    price: "$19.99",
    headline: "$19.99",
    description: "One full offer report",
    credits: 1,
  },
  pack5: {
    id: "pack5",
    priceId: "price_1TXejFEPb8kQvEZky3vYdc8O",
    label: "5 Reports",
    price: "$49.99",
    headline: "$49.99",
    description: "Five reports — $10 each",
    credits: 5,
    badge: "Best value",
  },
  unlimited: {
    id: "unlimited",
    priceId: "price_1TXejfEPb8kQvEZktW8ht7TL",
    label: "Unlimited",
    price: "$69.99",
    headline: "$69.99",
    description: "Unlimited reports for life",
    credits: Infinity,
  },
};

export const FREE_QUOTA = 1;

export function quotaFor(plan) {
  if (plan === "unlimited") return Infinity;
  if (plan === "pack5") return 5;
  if (plan === "single") return 1;
  return FREE_QUOTA;
}

export function hasQuota(plan, reportCount) {
  if (plan === "unlimited") return true;
  return (reportCount ?? 0) < quotaFor(plan);
}
