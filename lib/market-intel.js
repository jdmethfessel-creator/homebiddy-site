// Neighborhood market intelligence — aggregations over the reports table.

export function momentumFor(appreciationRate) {
  if (appreciationRate == null) return "Neutral";
  if (appreciationRate >= 0.04) return "Heating Up";
  if (appreciationRate < 0.02) return "Cooling Down";
  return "Neutral";
}

export function aggregateNeighborhood(reports) {
  if (!reports || reports.length === 0) return null;
  const valid = reports.filter((r) => r.asking_price && r.offer_low);
  const n = valid.length;
  if (n === 0) return null;

  const avgDom =
    valid.reduce((s, r) => s + (Number(r.days_on_market) || 0), 0) / n;
  const avgDiscount =
    valid.reduce(
      (s, r) => s + (r.asking_price - r.offer_low) / r.asking_price,
      0
    ) / n;
  const avgCuts =
    valid.reduce((s, r) => s + (Number(r.price_cuts) || 0), 0) / n;
  const avgRate =
    valid.reduce(
      (s, r) => s + (Number(r.appreciation_rate_annual) || 0),
      0
    ) / n;

  return {
    sample_size: n,
    avg_dom: Math.round(avgDom),
    avg_discount_pct: Math.round(avgDiscount * 1000) / 10,
    typical_price_cuts: Math.round(avgCuts * 10) / 10,
    momentum: momentumFor(avgRate),
    appreciation_rate: avgRate,
  };
}

// Pick the upsell tier based on saved-home count.
export function pickUpsell(homeCount) {
  if (homeCount <= 0) return null;
  if (homeCount === 1) {
    return {
      tier: "single",
      headline: "Unlock your report",
      sub: "Get the full HomeBiddy analysis for this listing.",
      price: "$19.99",
      per: "one-time",
      plan: "single",
    };
  }
  if (homeCount <= 3) {
    return {
      tier: "pack5",
      headline: "5 reports for $49.99 — just $10 each",
      sub: `You have ${homeCount} home${homeCount === 1 ? "" : "s"} saved. Unlock 5 with one purchase.`,
      price: "$49.99",
      per: "$10/report",
      plan: "pack5",
      badge: "Best value",
    };
  }
  const perReport = Math.round((69.99 / homeCount) * 100) / 100;
  return {
    tier: "unlimited",
    headline: `Unlimited reports for $69.99`,
    sub: `You have ${homeCount} homes saved. Unlimited access works out to about $${perReport.toFixed(
      2
    )} per report.`,
    price: "$69.99",
    per: "unlimited · one-time",
    plan: "unlimited",
    badge: "Best value",
  };
}

export function timelineFor(homes) {
  if (!homes || homes.length === 0) return null;
  const oldest = homes.reduce((acc, h) => {
    const t = new Date(h.created_at).getTime();
    if (!acc || t < acc) return t;
    return acc;
  }, null);
  const daysShopping = oldest
    ? Math.max(0, Math.round((Date.now() - oldest) / (1000 * 60 * 60 * 24)))
    : 0;
  const neighborhoods = new Set();
  let mostNeg = null;
  for (const h of homes) {
    if (h.has_access && h.report?.neighborhood) {
      neighborhoods.add(h.report.neighborhood);
    }
    if (h.has_access && h.report?.negotiability_score != null) {
      if (!mostNeg || h.report.negotiability_score > mostNeg.score) {
        mostNeg = { address: h.address, score: h.report.negotiability_score };
      }
    }
  }
  return {
    days_shopping: daysShopping,
    home_count: homes.length,
    neighborhood_count: neighborhoods.size,
    most_negotiable: mostNeg,
  };
}
