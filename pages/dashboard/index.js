import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback, useMemo } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { formatMoney, formatMoneyFull } from "../../lib/scoring";
import {
  pickUpsell,
  getMarketKey,
  aggregateMarketConditions,
  extractCityFromAddress,
} from "../../lib/market-intel";

const MAX_COMPARE = 4;
const MAX_BARS_PER_CARD = 4;
const TAX_RISK_THRESHOLD = 1.25;

function encodeAddress(addr) {
  return encodeURIComponent(addr);
}

function shortAddress(addr) {
  if (!addr) return "";
  return String(addr).split(",")[0].trim();
}

function LockIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function dotColorForScore(score) {
  if (score == null) return "muted";
  if (score >= 7) return "green";
  if (score >= 5) return "amber";
  return "red";
}

function temperatureClass(temp) {
  if (temp === "Competitive") return "competitive";
  if (temp === "Buyer's Market") return "buyers";
  return "neutral";
}

function savingsFor(home) {
  if (!home?.has_access || !home?.report) return null;
  const { asking_price, offer_low } = home.report;
  if (!asking_price || !offer_low) return null;
  return asking_price - offer_low;
}

function rankByArbitrage(homes) {
  return [...homes]
    .map((h) => ({ ...h, savings: savingsFor(h) }))
    .sort((a, b) => {
      if (a.savings == null && b.savings == null) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      if (a.savings == null) return 1;
      if (b.savings == null) return -1;
      return b.savings - a.savings;
    });
}

function pickBestNegotiabilityHome(unlockedHomes) {
  return unlockedHomes.reduce((best, h) => {
    if (!h.report || h.report.negotiability_score == null) return best;
    if (!best || h.report.negotiability_score > best.report.negotiability_score) return h;
    return best;
  }, null);
}

function pickLowest(homes, field) {
  return homes.reduce((best, h) => {
    const v = h.report?.[field];
    if (v == null || isNaN(Number(v))) return best;
    if (!best || Number(v) < Number(best.report[field])) return h;
    return best;
  }, null);
}

function pickConditionAdjustedHome(unlockedHomes) {
  // Lower psf is better; longer DOM signals seller fatigue; more cuts even more.
  // Subtract a small per-DOM-day and per-cut bonus.
  return unlockedHomes.reduce((best, h) => {
    const psf = Number(h.report?.price_per_living_sqft);
    if (!psf) return best;
    const dom = Number(h.report?.days_on_market) || 0;
    const cuts = Number(h.report?.price_cuts) || 0;
    const adj = psf - dom * 0.5 - cuts * 20;
    if (!best || adj < best.adj) return { home: h, adj };
    return best;
  }, null)?.home;
}

function hasTaxRisk(report) {
  const current = Number(report?.annual_taxes_current);
  const projected = Number(report?.annual_taxes_projected);
  if (!current || !projected) return false;
  return projected > current * TAX_RISK_THRESHOLD;
}

function computeTotalSavings(unlockedHomes) {
  let low = 0;
  let high = 0;
  let count = 0;
  for (const h of unlockedHomes) {
    if (!h.report || !h.report.asking_price) continue;
    if (h.report.offer_high != null) low += h.report.asking_price - h.report.offer_high;
    if (h.report.offer_low != null) high += h.report.asking_price - h.report.offer_low;
    if (h.report.offer_low != null || h.report.offer_high != null) count++;
  }
  return { low, high, count };
}

function pickPrimaryCity(homes) {
  const counts = new Map();
  for (const h of homes) {
    const city = extractCityFromAddress(h.address);
    if (city) counts.set(city, (counts.get(city) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [city, c] of counts.entries()) {
    if (c > bestCount) { best = city; bestCount = c; }
  }
  return best;
}

// Submarket avg $/sqft lookup keyed by market key.
function submarketPsfMap(markets) {
  const m = new Map();
  for (const x of markets || []) {
    const key = x.market || x.neighborhood;
    const psf = x.summary?.avg_psf;
    if (key && psf) m.set(key, psf);
  }
  return m;
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [homes, setHomes] = useState([]);
  const [plan, setPlan] = useState({ credits_remaining: 0, is_unlimited: false });
  const [markets, setMarkets] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingAddress, setPendingAddress] = useState(null);
  const [selectedCompare, setSelectedCompare] = useState(() => new Set());
  const [compareLimitMessage, setCompareLimitMessage] = useState(false);

  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) {
      router.replace("/login");
      return;
    }
    sb.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setUser(data.session.user);
      setToken(data.session.access_token);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
      else { setUser(session.user); setToken(session.access_token); }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const loadAll = useCallback(async (tk) => {
    if (!tk) return;
    setLoading(true);
    try {
      const [listRes, marketRes] = await Promise.all([
        fetch("/api/dashboard/list", { headers: { Authorization: `Bearer ${tk}` } }),
        fetch("/api/dashboard/market", { headers: { Authorization: `Bearer ${tk}` } }),
      ]);
      const listJson = await listRes.json();
      const marketJson = await marketRes.json();
      setHomes(listJson.homes || []);
      setPlan(listJson.plan || { credits_remaining: 0, is_unlimited: false });
      setMarkets(marketJson.markets || marketJson.neighborhoods || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) loadAll(token); }, [token, loadAll]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.paid === "1") {
      setNotice({
        kind: "paid",
        address: router.query.address,
        purchasedPlan: router.query.plan,
      });
      router.replace(router.pathname, undefined, { shallow: true });
      const t = setTimeout(() => setNotice(null), 7000);
      return () => clearTimeout(t);
    }
    if (router.query.canceled === "1") {
      setNotice({ kind: "canceled" });
      router.replace(router.pathname, undefined, { shallow: true });
      const t = setTimeout(() => setNotice(null), 4500);
      return () => clearTimeout(t);
    }
  }, [router]);

  useEffect(() => {
    setSelectedCompare((prev) => {
      const next = new Set();
      for (const h of homes) {
        if (prev.has(h.id) && h.has_access && h.report) next.add(h.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [homes]);

  async function handleRemove(id) {
    if (!token) return;
    if (!confirm("Remove this home from your saved list?")) return;
    await fetch("/api/dashboard/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    loadAll(token);
  }

  async function handleUnlock(home) {
    if (!token) return;
    setPendingAddress(home.address);
    try {
      const r = await fetch("/api/dashboard/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ address: home.address }),
      });
      const json = await r.json();
      if (r.ok && json.status && json.status !== "payment_required") {
        await loadAll(token);
        setPendingAddress(null);
        return;
      }
      const r2 = await fetch("/api/dashboard/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: "single", address: home.address, listing_url: home.listing_url }),
      });
      const j2 = await r2.json();
      if (j2.url) window.location.href = j2.url;
      else alert(j2.error || "Could not start checkout");
    } catch (err) {
      console.error(err);
    } finally {
      setPendingAddress(null);
    }
  }

  async function startPlanCheckout(planKey) {
    if (!token) return;
    const r = await fetch("/api/dashboard/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: planKey }),
    });
    const j = await r.json();
    if (j.url) window.location.href = j.url;
    else alert(j.error || "Could not start checkout");
  }

  function toggleCompare(homeId) {
    setSelectedCompare((prev) => {
      const next = new Set(prev);
      if (next.has(homeId)) { next.delete(homeId); return next; }
      if (next.size >= MAX_COMPARE) {
        setCompareLimitMessage(true);
        setTimeout(() => setCompareLimitMessage(false), 4000);
        return prev;
      }
      next.add(homeId);
      return next;
    });
  }

  function clearCompare() { setSelectedCompare(new Set()); }

  const unlockedHomes = useMemo(() => homes.filter((h) => h.has_access && h.report), [homes]);
  const bestNeg = useMemo(() => pickBestNegotiabilityHome(unlockedHomes), [unlockedHomes]);
  const bestLivingPsf = useMemo(() => pickLowest(unlockedHomes, "price_per_living_sqft"), [unlockedHomes]);
  const bestLotPsf = useMemo(() => pickLowest(unlockedHomes, "price_per_lot_sqft"), [unlockedHomes]);
  const condAdjusted = useMemo(() => pickConditionAdjustedHome(unlockedHomes), [unlockedHomes]);
  const totalSavings = useMemo(() => computeTotalSavings(unlockedHomes), [unlockedHomes]);
  const marketCondition = useMemo(() => aggregateMarketConditions(markets), [markets]);
  const primaryCity = useMemo(() => pickPrimaryCity(homes), [homes]);
  const ranked = useMemo(() => rankByArbitrage(homes), [homes]);
  const maxSavings = useMemo(
    () => ranked.reduce((m, h) => (h.savings && h.savings > m ? h.savings : m), 0),
    [ranked]
  );
  const psfByMarket = useMemo(() => submarketPsfMap(markets), [markets]);

  const upsell = !plan.is_unlimited ? pickUpsell(homes.length) : null;
  const comparing = useMemo(
    () => ranked.filter((h) => selectedCompare.has(h.id) && h.has_access && h.report),
    [ranked, selectedCompare]
  );

  const planLabel = plan.is_unlimited
    ? "unlimited plan"
    : plan.credits_remaining > 0
    ? `${plan.credits_remaining} credit${plan.credits_remaining === 1 ? "" : "s"}`
    : null;

  return (
    <>
      <Head>
        <title>Saved Homes · HomeBiddy</title>
      </Head>
      <div className="dashRoot">
        <DashboardHeader email={user?.email} />
        <main className="dashMain">
          <div className="dashTopBar">
            <div className="dashTopBarText">
              {homes.length === 0 ? (
                "Start by adding a Zillow or Realtor.com listing."
              ) : (
                <>
                  <strong>{homes.length}</strong> home{homes.length === 1 ? "" : "s"} saved
                  {planLabel ? <> · <strong>{planLabel}</strong></> : null}
                  {primaryCity ? <> · <strong>{primaryCity}</strong></> : null}
                </>
              )}
            </div>
            <button className="dashAddBtn" onClick={() => setShowAdd(true)} type="button">
              + Add home
            </button>
          </div>

          {notice?.kind === "paid" && (
            <div className="dashNotice dashNoticeSuccess">
              {notice.purchasedPlan === "unlimited"
                ? "Unlimited access activated — all your saved homes are unlocked."
                : notice.purchasedPlan === "pack5"
                ? "5 report credits added. Tap Unlock on any saved home to spend one."
                : `Payment received. Your report${notice.address ? ` for ${notice.address}` : ""} is being prepared — we'll email you when it's ready.`}
            </div>
          )}
          {notice?.kind === "canceled" && (
            <div className="dashNotice dashNoticeWarn">
              Payment canceled. Your saved homes are unchanged.
            </div>
          )}

          {homes.length === 0 ? (
            <div className="answerHero">
              <div className="answerHeroKicker">Get started</div>
              <h2 className="answerHeroTitle">
                Add a listing URL to unlock full analysis.
              </h2>
              <p className="answerHeroSub">
                Paste any Zillow or Realtor.com link. We&rsquo;ll surface your
                best deal, value breakdown, and true monthly cost across every
                home you save.
              </p>
              <button
                type="button"
                className="dashAddBtn"
                onClick={() => setShowAdd(true)}
              >
                + Add home
              </button>
            </div>
          ) : (
            <div className="answerGrid">
              <BestDealCard home={bestNeg} />
              <ValueBreakdownCard
                unlockedHomes={unlockedHomes}
                bestLiving={bestLivingPsf}
                bestLot={bestLotPsf}
                conditionAdjusted={condAdjusted}
                psfByMarket={psfByMarket}
              />
              <TrueMonthlyCostCard unlockedHomes={unlockedHomes} />
            </div>
          )}

          {upsell && (
            <UpsellBanner upsell={upsell} onClick={() => startPlanCheckout(upsell.plan)} />
          )}

          {loading && <div className="dashEmpty" style={{ marginBottom: 18 }}>Loading…</div>}
          {!loading && ranked.length === 0 && (
            <div className="dashEmpty" style={{ marginBottom: 18 }}>
              No homes yet.{" "}
              <button className="dashLink" onClick={() => setShowAdd(true)}>
                Add your first home
              </button>{" "}
              to see analysis here.
            </div>
          )}
          {ranked.length > 0 && (
            <RankedTable
              ranked={ranked}
              maxSavings={maxSavings}
              psfByMarket={psfByMarket}
              selectedSet={selectedCompare}
              onToggleCompare={toggleCompare}
              onUnlock={handleUnlock}
              onRemove={handleRemove}
              pendingAddress={pendingAddress}
              credits={plan.credits_remaining}
              unlimited={plan.is_unlimited}
            />
          )}

          {compareLimitMessage && (
            <div className="compareLimitNote" role="status">
              Compare up to {MAX_COMPARE} homes at a time.
            </div>
          )}

          {comparing.length >= 2 && (
            <InlineCompare
              comparing={comparing}
              onRemove={(id) => toggleCompare(id)}
              onClear={clearCompare}
            />
          )}

          {markets.length > 0 && <MarketIntelligenceSection markets={markets} />}
        </main>
      </div>

      {showAdd && (
        <AddHomeModal
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadAll(token); }}
        />
      )}
    </>
  );
}

/* ===================== SHARED ===================== */

function AnswerCardShell({ kicker, children, variant }) {
  const cls = ["answerCard", variant ? `answerCard_${variant}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className="answerKicker">{kicker}</div>
      {children}
    </div>
  );
}

function EmptyAnswerCard({ kicker, message, variant }) {
  return (
    <AnswerCardShell kicker={kicker} variant={variant}>
      <div className="answerEmpty">{message}</div>
    </AnswerCardShell>
  );
}

/* ===================== CARD 1 — BEST DEAL with circular gauge ===================== */

function ScoreGauge({ score }) {
  const size = 76;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(10, Number(score) || 0));
  const offset = c * (1 - v / 10);
  const color = v >= 7 ? "#15803D" : v >= 5 ? "#F59E0B" : "#DC2626";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5ECF4" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x={size / 2}
        y={size / 2 + 6}
        textAnchor="middle"
        fontFamily='"Fraunces", Georgia, serif'
        fontSize="20"
        fontWeight="700"
        fill="#0A2540"
      >
        {v.toFixed(1)}
      </text>
    </svg>
  );
}

function BestDealCard({ home }) {
  if (!home || !home.report) {
    return (
      <EmptyAnswerCard
        kicker="Your Best Deal"
        message="Once a saved home has an unlocked report, your strongest opportunity surfaces here."
      />
    );
  }
  const r = home.report;
  const savings = (r.asking_price || 0) - (r.offer_low || 0);
  const score = r.negotiability_score;
  const buy = score != null && score >= 7;
  return (
    <AnswerCardShell kicker="Your Best Deal">
      <div className="answerHeaderRow">
        <Link href={`/dashboard/${encodeAddress(home.address)}`} className="answerAddress">
          {home.address}
        </Link>
        {score != null && (
          <span className={`answerPill answerPill_${buy ? "buy" : "monitor"}`}>
            {buy ? "BUY SIGNAL" : "MONITOR"}
          </span>
        )}
      </div>
      <div className="bestDealRow">
        <div className="bestDealStat">
          <div className="answerBigStat answerStatGreen">Save up to {formatMoney(savings)}</div>
          <div className="answerSubline">
            <strong>Most negotiable</strong> home in your list
          </div>
        </div>
        <ScoreGauge score={score} />
      </div>
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="answerLink">
        View report →
      </Link>
    </AnswerCardShell>
  );
}

/* ===================== CARD 2 — VALUE BREAKDOWN with race bars ===================== */

function ValueBreakdownCard({ unlockedHomes, bestLiving, bestLot, conditionAdjusted, psfByMarket }) {
  if (unlockedHomes.length === 0) {
    return (
      <EmptyAnswerCard
        kicker="Value Breakdown"
        message="Unlock reports to compare price per square foot across your list."
      />
    );
  }

  // If no home has any PSF data (older reports pre-schema-v4), show a
  // graceful fallback that surfaces what we DO have instead of an empty
  // card.
  const hasLivingPsf = unlockedHomes.some(
    (h) => h.report?.price_per_living_sqft != null
  );
  const hasLotPsf = unlockedHomes.some(
    (h) => h.report?.price_per_lot_sqft != null
  );

  if (!hasLivingPsf && !hasLotPsf) {
    // Show offer-vs-asking gap fallback so the card still informs.
    const sorted = [...unlockedHomes]
      .filter(
        (h) => h.report?.asking_price && h.report?.offer_low
      )
      .map((h) => ({
        ...h,
        _gap:
          ((h.report.asking_price - h.report.offer_low) /
            h.report.asking_price) *
          100,
      }))
      .sort((a, b) => b._gap - a._gap)
      .slice(0, MAX_BARS_PER_CARD);
    const max = sorted[0]?._gap || 1;
    return (
      <AnswerCardShell kicker="Value Breakdown">
        <div className="valueRow">
          <div className="valueRowHeader">
            <div className="valueRowLabel">Biggest gap under asking</div>
            <div className="valueRowSub">$/sqft data pending</div>
          </div>
          <div className="valueBars">
            {sorted.map((h, i) => {
              const pct = Math.max(8, Math.round((h._gap / max) * 100));
              return (
                <div key={h.id} className="valueBarRow">
                  <div className="valueBarLabel">
                    <span className="valueBarPsf">{h._gap.toFixed(1)}%</span>
                    <span className="valueBarAddr">{shortAddress(h.address)}</span>
                  </div>
                  <div className="valueRaceBar">
                    <div
                      className={`valueRaceFill${i === 0 ? " valueRaceFillWin" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="valueMarketRef">
            Refresh reports to add $/sqft living + lot comparisons.
          </div>
        </div>
      </AnswerCardShell>
    );
  }

  return (
    <AnswerCardShell kicker="Value Breakdown">
      {hasLivingPsf && (
        <ValueMetricRow
          label="Best $/sqft living"
          sublabel="Most space for your money"
          winner={bestLiving}
          field="price_per_living_sqft"
          unlockedHomes={unlockedHomes}
          psfByMarket={psfByMarket}
        />
      )}
      {hasLotPsf && (
        <ValueMetricRow
          label="Best $/sqft lot"
          sublabel="Best land value"
          winner={bestLot}
          field="price_per_lot_sqft"
          unlockedHomes={unlockedHomes}
          psfByMarket={null}
        />
      )}
      {conditionAdjusted && (
        <div className="answerSubline valueAdjusted">
          <strong>Condition-adjusted:</strong> {shortAddress(conditionAdjusted.address)} may offer
          the best effective value after factoring in DOM and price cuts.
        </div>
      )}
    </AnswerCardShell>
  );
}

function ValueMetricRow({ label, sublabel, winner, field, unlockedHomes, psfByMarket }) {
  const homes = unlockedHomes
    .filter((h) => h.report?.[field] != null && !isNaN(Number(h.report[field])))
    .map((h) => ({ ...h, _v: Number(h.report[field]) }))
    .sort((a, b) => a._v - b._v)
    .slice(0, MAX_BARS_PER_CARD);
  if (homes.length === 0) {
    return (
      <div className="valueRow">
        <div className="valueRowHeader">
          <div className="valueRowLabel">{label}</div>
          <div className="valueRowSub">{sublabel}</div>
        </div>
        <div className="answerEmpty" style={{ fontSize: 12 }}>
          Not enough data yet.
        </div>
      </div>
    );
  }
  const min = homes[0]._v;
  const winnerSubmarket = winner ? getMarketKey(winner.report) : null;
  const marketAvg = winnerSubmarket && psfByMarket ? psfByMarket.get(winnerSubmarket) : null;
  return (
    <div className="valueRow">
      <div className="valueRowHeader">
        <div className="valueRowLabel">{label}</div>
        <div className="valueRowSub">{sublabel}</div>
      </div>
      <div className="valueBars">
        {homes.map((h) => {
          const pct = Math.max(8, Math.round((min / h._v) * 100));
          const isWinner = winner && h.id === winner.id;
          return (
            <div key={h.id} className="valueBarRow">
              <div className="valueBarLabel">
                <span className="valueBarPsf">${Math.round(h._v).toLocaleString()}</span>
                <span className="valueBarAddr">{shortAddress(h.address)}</span>
              </div>
              <div className="valueRaceBar">
                <div
                  className={`valueRaceFill${isWinner ? " valueRaceFillWin" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {marketAvg && winner && (
        <div className="valueMarketRef">
          {winnerSubmarket} avg <strong>${marketAvg.toLocaleString()}/sqft</strong>
        </div>
      )}
    </div>
  );
}

/* ===================== CARD 3 — TRUE MONTHLY COST ===================== */

function TrueMonthlyCostCard({ unlockedHomes }) {
  const homesWithTotal = unlockedHomes
    .filter((h) => h.report?.estimated_monthly_total != null)
    .map((h) => ({ ...h, _m: Number(h.report.estimated_monthly_total) }))
    .sort((a, b) => a._m - b._m);

  // Fallback for pre-schema-v4 reports: show offer range across the list
  // so the card still answers a useful question.
  if (homesWithTotal.length === 0) {
    if (unlockedHomes.length === 0) {
      return (
        <EmptyAnswerCard
          kicker="True Monthly Cost"
          message="Unlock reports to see fully-loaded monthly carry estimates."
        />
      );
    }
    const homesWithOffer = unlockedHomes
      .filter((h) => h.report?.offer_low && h.report?.offer_high)
      .map((h) => ({
        ...h,
        _lo: Number(h.report.offer_low),
        _hi: Number(h.report.offer_high),
      }))
      .sort((a, b) => a._lo - b._lo);
    if (homesWithOffer.length === 0) {
      return (
        <EmptyAnswerCard
          kicker="True Monthly Cost"
          message="Monthly cost estimates appear after fresh reports include tax + insurance data."
        />
      );
    }
    const min = homesWithOffer[0]._lo;
    const max = homesWithOffer[homesWithOffer.length - 1]._hi;
    return (
      <AnswerCardShell kicker="True Monthly Cost">
        <div className="answerSubline" style={{ marginBottom: 4 }}>
          Offer range across your list
        </div>
        <div className="answerBigStat">
          {formatMoney(min)} – {formatMoney(max)}
        </div>
        <div className="monthlyBars">
          {homesWithOffer.slice(0, MAX_BARS_PER_CARD).map((h) => {
            const range = Math.max(1, max - min);
            const t = (h._lo - min) / range;
            const pct = Math.max(8, Math.round(t * 90 + 10));
            const fillClass =
              t < 0.34
                ? "monthlyFillLow"
                : t < 0.67
                ? "monthlyFillMid"
                : "monthlyFillHigh";
            return (
              <div key={h.id} className="monthlyRow">
                <div className="monthlyMeta">
                  <span className="monthlyAddr">{shortAddress(h.address)}</span>
                  <span className="monthlyVal">{formatMoney(h._lo)}</span>
                </div>
                <div className="monthlyBar">
                  <div
                    className={`monthlyBarFill ${fillClass}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="answerSubline">
          Mortgage + tax + insurance estimates will appear once reports
          include those fields. Re-generate to populate.
        </div>
      </AnswerCardShell>
    );
  }
  const min = homesWithTotal[0]._m;
  const max = homesWithTotal[homesWithTotal.length - 1]._m;
  return (
    <AnswerCardShell kicker="True Monthly Cost">
      <div className="answerBigStat">
        {formatMoney(min)} – {formatMoney(max)}<span className="monthlyPerMo">/mo</span>
      </div>
      <div className="monthlyBars">
        {homesWithTotal.slice(0, MAX_BARS_PER_CARD).map((h) => {
          const range = Math.max(1, max - min);
          const t = (h._m - min) / range;
          const pct = Math.max(8, Math.round(t * 90 + 10));
          const fillClass =
            t < 0.34 ? "monthlyFillLow" : t < 0.67 ? "monthlyFillMid" : "monthlyFillHigh";
          const taxRisk = hasTaxRisk(h.report);
          return (
            <div key={h.id} className="monthlyRow">
              <div className="monthlyMeta">
                <span className="monthlyAddr">{shortAddress(h.address)}</span>
                <span className="monthlyVal">{formatMoney(h._m)}</span>
              </div>
              <div className="monthlyBar">
                <div className={`monthlyBarFill ${fillClass}`} style={{ width: `${pct}%` }} />
              </div>
              {taxRisk && (
                <div className="taxFlag" title="Projected post-sale taxes are more than 25% above current bill">
                  ⚠ Tax reassessment risk
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="answerSubline">
        Estimates: 20% down, 6.8% 30yr fixed + projected post-sale tax reassessment.
      </div>
    </AnswerCardShell>
  );
}

/* ===================== RANKED TABLE ===================== */

function RankedTable({
  ranked,
  maxSavings,
  psfByMarket,
  selectedSet,
  onToggleCompare,
  onUnlock,
  onRemove,
  pendingAddress,
  credits,
  unlimited,
}) {
  let unlockedRank = 0;
  return (
    <div className="rankedWrap">
      <div className="rankedTableScroll">
        <table className="rankedTable">
          <thead>
            <tr>
              <th className="rankedColRank">#</th>
              <th className="rankedColProp">Property</th>
              <th>Asking</th>
              <th>Offer range</th>
              <th>Savings</th>
              <th>$/sqft</th>
              <th>$/lot</th>
              <th>Score</th>
              <th>DOM</th>
              <th>Monthly</th>
              <th>Tax</th>
              <th className="rankedColDeal">Deal</th>
              <th className="rankedColActions"></th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((h) => {
              const unlocked = h.has_access && h.report;
              if (unlocked && h.savings != null) unlockedRank += 1;
              return (
                <RankedRow
                  key={h.id}
                  home={h}
                  rank={unlocked && h.savings != null ? unlockedRank : null}
                  maxSavings={maxSavings}
                  psfByMarket={psfByMarket}
                  selected={selectedSet.has(h.id)}
                  onToggleCompare={() => onToggleCompare(h.id)}
                  onUnlock={() => onUnlock(h)}
                  onRemove={() => onRemove(h.id)}
                  pending={pendingAddress === h.address}
                  credits={credits}
                  unlimited={unlimited}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankedRow({
  home, rank, maxSavings, psfByMarket,
  selected, onToggleCompare, onUnlock, onRemove,
  pending, credits, unlimited,
}) {
  const r = home.report || {};
  const unlocked = home.has_access && home.report;
  const submarket = getMarketKey(r);
  const dot = unlocked ? dotColorForScore(r.negotiability_score) : "muted";
  const dealPct =
    unlocked && home.savings && maxSavings
      ? Math.max(2, Math.round((home.savings / maxSavings) * 100))
      : 0;
  const marketPsf = unlocked && submarket ? psfByMarket.get(submarket) : null;
  const psf = unlocked ? Number(r.price_per_living_sqft) : null;
  let psfDir = null;
  if (psf && marketPsf) psfDir = psf > marketPsf * 1.02 ? "up" : psf < marketPsf * 0.98 ? "down" : "even";

  return (
    <tr className={unlocked ? "" : "rankedLockedRow"}>
      <td className="rankedColRank">
        {rank != null ? <span className="rankBadgeNum">#{rank}</span> : <span className="rankBadgeMuted">—</span>}
      </td>
      <td className="rankedColProp">
        <Link href={`/dashboard/${encodeAddress(home.address)}`} className="rankAddress">
          {home.address}
        </Link>
        {submarket && <span className="rankBadge">{submarket}</span>}
      </td>
      <td>
        <span className="rankAsk">{r.asking_price ? formatMoneyFull(r.asking_price) : "—"}</span>
      </td>
      <td>
        {unlocked ? (
          <span className="rankOffer">
            {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
          </span>
        ) : (
          <span className="dashBlur">$X,XXX,XXX</span>
        )}
      </td>
      <td>
        {unlocked && home.savings != null ? (
          <span className="rankSavings">{formatMoney(home.savings)}</span>
        ) : (
          <span className="dashBlur">$XXX,XXX</span>
        )}
      </td>
      <td>
        {unlocked && psf ? (
          <span className="rankPsf">
            ${Math.round(psf).toLocaleString()}
            {psfDir === "up" && <span className="psfArrow psfArrowUp" title="above submarket avg">▲</span>}
            {psfDir === "down" && <span className="psfArrow psfArrowDown" title="below submarket avg">▼</span>}
          </span>
        ) : (
          <span className="dashBlur">$XXX</span>
        )}
      </td>
      <td>
        {unlocked && r.price_per_lot_sqft != null ? (
          <span className="rankPsf">${Math.round(Number(r.price_per_lot_sqft)).toLocaleString()}</span>
        ) : (
          <span className="dashMuted">—</span>
        )}
      </td>
      <td>
        {unlocked ? (
          <span className="rankScore">
            <span className={`scoreDot scoreDot_${dot}`} />
            {r.negotiability_score ?? "—"}
          </span>
        ) : (
          <span className="dashBlur">X.X</span>
        )}
      </td>
      <td>
        {unlocked ? <span className="rankDom">{r.days_on_market ?? "—"}</span> : <span className="dashBlur">XXX</span>}
      </td>
      <td>
        {unlocked && r.estimated_monthly_total != null ? (
          <span className="rankMonthly">{formatMoney(r.estimated_monthly_total)}</span>
        ) : (
          <span className="dashMuted">—</span>
        )}
      </td>
      <td>
        {unlocked && hasTaxRisk(r) ? (
          <span className="taxFlagSmall" title="Projected post-sale taxes are more than 25% above current bill">⚠</span>
        ) : null}
      </td>
      <td className="rankedColDeal">
        {unlocked && home.savings ? (
          <div className="dealBar" title={`${dealPct}% of top deal`} aria-label={`Deal strength ${dealPct} percent of top deal`}>
            <div className="dealBarFill" style={{ width: `${dealPct}%` }} />
          </div>
        ) : (
          <span className="dashBlur">▬▬▬</span>
        )}
      </td>
      <td className="rankedColActions">
        {unlocked ? (
          <div className="rankActionsBox">
            <label className="rankCheckLabel" title="Add to comparison">
              <input type="checkbox" checked={selected} onChange={onToggleCompare} className="rankCheck" />
              <span className="rankCheckText">Compare</span>
            </label>
            <Link href={`/dashboard/${encodeAddress(home.address)}`} className="rankViewBtn">View →</Link>
            <button type="button" className="rankRemoveBtn" onClick={onRemove} aria-label="Remove" title="Remove">×</button>
          </div>
        ) : (
          <div className="rankActionsBox">
            <button type="button" className="rankUnlockBtn" onClick={onUnlock} disabled={pending}>
              <LockIcon size={11} />
              {pending ? "..." : unlockLabel(home, credits, unlimited)}
            </button>
            <button type="button" className="rankRemoveBtn" onClick={onRemove} aria-label="Remove" title="Remove">×</button>
          </div>
        )}
      </td>
    </tr>
  );
}

function unlockLabel(home, credits, unlimited) {
  if (unlimited) return "Unlock free";
  if (credits > 0) return `Use credit (${credits})`;
  if (!home.report_exists) return "Generate · $19.99";
  return "Unlock · $19.99";
}

/* ===================== MARKET INTELLIGENCE ===================== */

function MarketIntelligenceSection({ markets }) {
  return (
    <section className="dashMarketSection">
      <h2 className="dashMarketHeading">Market intelligence</h2>
      <div className="dashMarketGrid">
        {markets.map((m) => (
          <MarketCard key={m.market || m.neighborhood} item={m} />
        ))}
      </div>
    </section>
  );
}

function MarketCard({ item }) {
  const name = item.market || item.neighborhood;
  const s = item.summary;
  const saved = item.saved_count ?? 0;
  if (!s) {
    return (
      <div className="dashMarketCard">
        <div className="dashMarketName">{name}</div>
        <div className="dashMarketEmpty">Not enough comp data yet.</div>
      </div>
    );
  }
  const tempClass = temperatureClass(s.temperature);
  return (
    <div className="dashMarketCard">
      <div className="dashMarketHeaderRow">
        <div className="dashMarketName">{name}</div>
        <span className={`dashMarketBadge dashMarketBadge_${tempClass}`}>{s.temperature}</span>
      </div>
      <div className="dashMarketRow">
        <div>
          <div className="dashCardKicker">Avg DOM</div>
          <strong>{s.avg_dom}</strong>
        </div>
        <div>
          <div className="dashCardKicker">Off-list</div>
          <strong>{s.avg_discount_pct}%</strong>
        </div>
        <div>
          <div className="dashCardKicker">Avg $/sqft</div>
          <strong>{s.avg_psf ? `$${s.avg_psf.toLocaleString()}` : "—"}</strong>
        </div>
        <div>
          <div className="dashCardKicker">Saved</div>
          <strong>{saved}</strong>
        </div>
      </div>
      <div className="dashMarketSample">
        Based on {s.sample_size} report{s.sample_size === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/* ===================== UPSELL ===================== */

function UpsellBanner({ upsell, onClick }) {
  return (
    <button type="button" className="dashUpsell" onClick={onClick}>
      <div className="dashUpsellLeft">
        {upsell.badge && <span className="dashUpsellBadge">{upsell.badge}</span>}
        <div className="dashUpsellHeadline">{upsell.headline}</div>
        <div className="dashUpsellSub">{upsell.sub}</div>
      </div>
      <div className="dashUpsellRight">
        <div className="dashUpsellPrice">{upsell.price}</div>
        <div className="dashUpsellArrow">→</div>
      </div>
    </button>
  );
}

/* ===================== INLINE COMPARE ===================== */

function InlineCompare({ comparing, onRemove, onClear }) {
  return (
    <section className="compareInline" aria-label="Comparison">
      <div className="compareInlineHeader">
        <h2 className="compareInlineTitle">
          Comparing {comparing.length} home{comparing.length === 1 ? "" : "s"}
        </h2>
        <button type="button" className="compareInlineClear" onClick={onClear}>
          Clear all
        </button>
      </div>
      <div className="compareInlineTableWrap">
        <table className="compareInlineTable">
          <thead>
            <tr>
              <th></th>
              {comparing.map((h) => (
                <th key={h.id}>
                  <div className="compareColHead">
                    <Link href={`/dashboard/${encodeAddress(h.address)}`} className="compareColAddr">
                      {h.address}
                    </Link>
                    <button
                      type="button"
                      className="compareColRemove"
                      onClick={() => onRemove(h.id)}
                      aria-label="Remove from comparison"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompareRow label="Asking" cells={comparing.map((h) => formatMoneyFull(h.report.asking_price))} />
            <CompareRow
              label="Offer Range"
              cells={comparing.map((h) => `${formatMoney(h.report.offer_low)}–${formatMoney(h.report.offer_high)}`)}
              accent
            />
            <CompareRow label="Negotiability" cells={comparing.map((h) => `${h.report.negotiability_score} / 10`)} />
            <CompareRow label="Days on Market" cells={comparing.map((h) => h.report.days_on_market ?? "—")} />
            <CompareRow label="Price Cuts" cells={comparing.map((h) => h.report.price_cuts ?? 0)} />
            <CompareRow
              label="$/sqft Living"
              cells={comparing.map((h) =>
                h.report.price_per_living_sqft != null
                  ? `$${Math.round(Number(h.report.price_per_living_sqft)).toLocaleString()}`
                  : "—"
              )}
            />
            <CompareRow
              label="$/sqft Lot"
              cells={comparing.map((h) =>
                h.report.price_per_lot_sqft != null
                  ? `$${Math.round(Number(h.report.price_per_lot_sqft)).toLocaleString()}`
                  : "—"
              )}
            />
            <CompareRow
              label="Est. Monthly"
              cells={comparing.map((h) =>
                h.report.estimated_monthly_total != null
                  ? formatMoney(h.report.estimated_monthly_total)
                  : "—"
              )}
              accent
            />
            <CompareRow
              label="Tax Risk"
              cells={comparing.map((h) =>
                hasTaxRisk(h.report) ? <span className="taxFlagSmall" key="t">⚠ Reassessment</span> : "—"
              )}
            />
            <CompareRow
              label="Last Sold"
              cells={comparing.map((h) => {
                const p = h.report.last_sold_price;
                const y = h.report.last_sold_year;
                if (!p && !y) return "—";
                return `${p ? formatMoney(p) : "—"}${y ? ` (${y})` : ""}`;
              })}
            />
            <CompareRow
              label="Flood Zone"
              cells={comparing.map((h) => h.report.flood_zone || "—")}
            />
            <CompareRow label="Zestimate Gap" cells={comparing.map((h) =>
              h.report.zestimate_gap != null ? formatMoney(h.report.zestimate_gap) : "—"
            )} />
            <CompareRow label="Submarket" cells={comparing.map((h) => getMarketKey(h.report) || "—")} />
            <tr>
              <th></th>
              {comparing.map((h) => (
                <td key={h.id}>
                  <Link href={`/dashboard/${encodeAddress(h.address)}`} className="compareViewBtn">
                    View full report
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompareRow({ label, cells, accent }) {
  return (
    <tr className={accent ? "compareRowAccent" : ""}>
      <th>{label}</th>
      {cells.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  );
}

/* ===================== ADD HOME MODAL ===================== */

function AddHomeModal({ token, onClose, onSaved }) {
  const [url, setUrl] = useState("");
  const [address, setAddress] = useState("");
  const [needsAddress, setNeedsAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) return;
    setError("");
    setSubmitting(true);
    try {
      const r = await fetch("/api/dashboard/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_url: url, address: address || undefined }),
      });
      const json = await r.json();
      if (!r.ok) {
        if (json.needs_address) {
          setNeedsAddress(true);
          setError("Please enter the address manually.");
        } else {
          setError(json.error || "Could not save home");
        }
        setSubmitting(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlayCard">
        <div className="overlayHeader">
          <h2 className="overlayTitle">Add a home</h2>
          <p className="overlaySub">Paste a Zillow or Realtor.com link.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label className="formLabel" htmlFor="add-url">Listing URL</label>
          <input
            id="add-url"
            type="url"
            className="formInput"
            placeholder="https://www.zillow.com/homedetails/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          {needsAddress && (
            <>
              <label className="formLabel" htmlFor="add-address" style={{ marginTop: 12 }}>Address</label>
              <input
                id="add-address"
                type="text"
                className="formInput"
                placeholder="442 28th St, West Palm Beach FL 33407"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </>
          )}
          {error && <div className="authError" style={{ marginTop: 10 }}>{error}</div>}
          <button type="submit" className="goButton" disabled={submitting} style={{ marginTop: 14 }}>
            {submitting ? "Saving…" : "Save home"}
          </button>
        </form>
        <button type="button" className="dismissLink" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
