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

// Saved-home limit (separate from report-unlock credits). Free users cap
// at 3 homes on their watchlist; any paid purchase (single, pack5,
// unlimited) lifts the cap entirely.
export const FREE_SAVED_HOME_LIMIT = 3;

// A user is "paid" if they've ever bought any tier or hold an unlimited
// flag. Read from a user_dashboard_plan row shape:
//   { credits_remaining, is_unlimited, total_purchased }
export function isPaidUser(planRow) {
  if (!planRow) return false;
  if (planRow.is_unlimited) return true;
  return (planRow.total_purchased ?? 0) > 0;
}

export function canSaveAnotherHome(planRow, currentSavedCount) {
  if (isPaidUser(planRow)) return true;
  return (currentSavedCount ?? 0) < FREE_SAVED_HOME_LIMIT;
}
