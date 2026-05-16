// Submarket-level market intelligence + upsell tier logic.
//
// Grouping key per report: prefer the `neighborhood` field (submarket level
// when Claude returns one — "Old Northwood", "El Cid", "SoSo"). Fall back
// to the city portion parsed from the canonical address string when
// neighborhood is null/empty.

export function getMarketKey(report) {
  if (!report) return null;
  if (report.neighborhood && String(report.neighborhood).trim()) {
    return String(report.neighborhood).trim();
  }
  return extractCityFromAddress(report.address);
}

// "442 28th St, West Palm Beach FL 33407" → "West Palm Beach"
export function extractCityFromAddress(address) {
  if (!address) return null;
  const match = String(address).match(/,\s*([^,]+?)\s+[A-Z]{2}\b/);
  return match ? match[1].trim() : null;
}

// Hot / Neutral / Buyer's Market based on combined DOM + discount signal.
//   - Hot: low DOM AND small discount (sellers have leverage)
//   - Buyer's Market: high DOM OR large discount
//   - Neutral: middle ground
export function temperatureFor(summary) {
  if (!summary) return "Neutral";
  const dom = Number(summary.avg_dom) || 0;
  const discount = Number(summary.avg_discount_pct) || 0;
  if (dom > 0 && dom < 35 && discount < 3) return "Hot";
  if (dom > 80 || discount > 6) return "Buyer's Market";
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

  const summary = {
    sample_size: n,
    avg_dom: Math.round(avgDom),
    avg_discount_pct: Math.round(avgDiscount * 1000) / 10,
    typical_price_cuts: Math.round(avgCuts * 10) / 10,
    appreciation_rate: avgRate,
  };
  summary.temperature = temperatureFor(summary);
  return summary;
}

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
  const submarkets = new Set();
  let mostNeg = null;
  for (const h of homes) {
    const key = h.has_access ? getMarketKey(h.report) : null;
    if (key) submarkets.add(key);
    if (h.has_access && h.report?.negotiability_score != null) {
      if (!mostNeg || h.report.negotiability_score > mostNeg.score) {
        mostNeg = { address: h.address, score: h.report.negotiability_score };
      }
    }
  }
  return {
    days_shopping: daysShopping,
    home_count: homes.length,
    neighborhood_count: submarkets.size,
    most_negotiable: mostNeg,
  };
}
