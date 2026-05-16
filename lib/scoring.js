// Best Value scoring engine.
//
// Composite 0-100 score with 5 weighted signals:
//   - Upside capture (30 pts): (asking - offer_low) / asking
//   - Negotiability score (25 pts): the report's negotiability_score / 10
//   - Appreciation rate (20 pts): annual neighborhood appreciation
//   - Days on market (15 pts): higher DOM = more motivated seller
//   - Price cuts (10 pts): more cuts = more motivated seller
//
// Conservative 3-year value = offer_low * (1 + rate)^3
// Estimated equity = (asking - offer_low) + (offer_low * ((1+rate)^3 - 1))

const WEIGHTS = {
  upside: 30,
  negotiability: 25,
  appreciation: 20,
  dom: 15,
  cuts: 10,
};

export function scoreReport(report) {
  if (!report) return null;
  const {
    asking_price,
    offer_low,
    offer_high,
    negotiability_score,
    appreciation_rate_annual,
    days_on_market,
    price_cuts,
  } = report;

  if (!asking_price || !offer_low) return null;

  const rate = Number(appreciation_rate_annual) || 0.03;
  const upsidePct = Math.max(0, (asking_price - offer_low) / asking_price);
  const projectedValue = offer_low * Math.pow(1 + rate, 3);
  const appreciationGain = projectedValue - offer_low;
  const instantDiscount = Math.max(0, asking_price - offer_low);
  const estimatedEquity = appreciationGain + instantDiscount;

  // Sub-scores (each 0..max-weight)
  const upsideSub = Math.min(WEIGHTS.upside, upsidePct * 200);
  const negSub = Math.min(WEIGHTS.negotiability, (Number(negotiability_score) || 0) * 2.5);
  const apprSub = Math.min(WEIGHTS.appreciation, rate * 500);
  const domSub = Math.min(WEIGHTS.dom, (Number(days_on_market) || 0) / 10);
  const cutsSub = Math.min(WEIGHTS.cuts, (Number(price_cuts) || 0) * 3);

  const total = upsideSub + negSub + apprSub + domSub + cutsSub;

  return {
    score: Math.round(total * 10) / 10,
    upside_pct: Math.round(upsidePct * 1000) / 10,
    projected_value_3yr: Math.round(projectedValue),
    appreciation_gain: Math.round(appreciationGain),
    instant_discount: Math.round(instantDiscount),
    estimated_equity: Math.round(estimatedEquity),
    upside_pct_value: Math.round((estimatedEquity / (offer_low || 1)) * 1000) / 10,
    components: {
      upside: { value: upsideSub, weight: WEIGHTS.upside, label: "upside capture" },
      negotiability: { value: negSub, weight: WEIGHTS.negotiability, label: "negotiability" },
      appreciation: { value: apprSub, weight: WEIGHTS.appreciation, label: "neighborhood appreciation" },
      dom: { value: domSub, weight: WEIGHTS.dom, label: "days on market" },
      cuts: { value: cutsSub, weight: WEIGHTS.cuts, label: "price cuts" },
    },
    // Legacy fields used by existing UI:
    discount_pct: Math.round(upsidePct * 1000) / 10,
    projected_3yr_gain: Math.round(appreciationGain),
    conservative_upside: Math.round(estimatedEquity / 1000) * 1000,
  };
}

export function rankHomes(homes) {
  return [...homes]
    .map((h) => ({ ...h, scoring: h.report ? scoreReport(h.report) : null }))
    .sort((a, b) => {
      const sa = a.scoring?.score ?? -1;
      const sb = b.scoring?.score ?? -1;
      return sb - sa;
    });
}

// Pick the top 2 contributing components and craft a 2-sentence explanation.
export function explainBestValue(home, scoring) {
  if (!scoring || !home?.report) return "";
  const r = home.report;
  const sorted = Object.entries(scoring.components).sort(
    (a, b) => b[1].value - a[1].value
  );
  const top = sorted.slice(0, 2).map(([k, v]) => ({ key: k, ...v }));

  function phrase(c) {
    switch (c.key) {
      case "negotiability":
        return `a ${r.negotiability_score}/10 negotiability score`;
      case "upside":
        return `${scoring.upside_pct}% room under asking`;
      case "appreciation":
        return `${(Number(r.appreciation_rate_annual) * 100).toFixed(1)}%/yr neighborhood appreciation`;
      case "dom":
        return `${r.days_on_market} days on market signaling a motivated seller`;
      case "cuts":
        return `${r.price_cuts} prior price cut${r.price_cuts === 1 ? "" : "s"}`;
      default:
        return null;
    }
  }

  const a = phrase(top[0]);
  const b = phrase(top[1]);
  const drivers = [a, b].filter(Boolean).join(" and ");

  return `Ranked #1 driven by ${drivers}. Conservative 3-year value lands around ${formatMoney(
    scoring.projected_value_3yr
  )} — about ${formatMoney(scoring.estimated_equity)} in projected equity.`;
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

export function formatPercent(n, digits = 1) {
  if (n == null) return "—";
  return `${Number(n).toFixed(digits)}%`;
}
