// Best-value scoring for saved homes that have generated reports.
// Returns a composite 0-100 score plus a "conservative 3-year upside" dollar amount.

export function scoreReport(report) {
  if (!report) return null;
  const {
    asking_price,
    offer_low,
    offer_high,
    negotiability_score,
    appreciation_rate_annual,
  } = report;

  if (!asking_price || !offer_high || !offer_low) return null;

  const discountPct = Math.max(0, (asking_price - offer_high) / asking_price);
  const rate = Number(appreciation_rate_annual) || 0.03;
  const projected3yrGain = offer_high * (Math.pow(1 + rate, 3) - 1);
  const instantEquity = Math.max(0, asking_price - offer_high);
  // Conservative: appreciation on the LOW end + half the instant-equity discount.
  const conservativeUpside =
    Math.round((offer_low * (Math.pow(1 + rate, 3) - 1) + instantEquity * 0.5) / 1000) * 1000;

  const negotiabilityScore = Number(negotiability_score) || 0;
  // 0-100 composite. Weights chosen so a strong listing tops out near 80-90.
  const composite =
    discountPct * 100 * 0.4 +
    negotiabilityScore * 4 +
    Math.min(40, (projected3yrGain / asking_price) * 100 * 1.5);

  return {
    score: Math.round(Math.min(100, composite) * 10) / 10,
    discount_pct: Math.round(discountPct * 1000) / 10,
    projected_3yr_gain: Math.round(projected3yrGain),
    conservative_upside: conservativeUpside,
    instant_equity: instantEquity,
  };
}

export function rankHomes(homes) {
  // homes: [{ saved_home, report (optional), access (bool) }]
  return [...homes]
    .map((h) => ({ ...h, scoring: h.report ? scoreReport(h.report) : null }))
    .sort((a, b) => {
      const sa = a.scoring?.score ?? -1;
      const sb = b.scoring?.score ?? -1;
      return sb - sa;
    });
}

export function formatMoney(n) {
  if (n == null) return "—";
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function formatMoneyFull(n) {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
