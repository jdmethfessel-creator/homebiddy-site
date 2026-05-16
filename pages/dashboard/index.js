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
} from "../../lib/market-intel";

const MAX_COMPARE = 4;

function encodeAddress(addr) {
  return encodeURIComponent(addr);
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

  useEffect(() => {
    if (token) loadAll(token);
  }, [token, loadAll]);

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
      if (next.has(homeId)) {
        next.delete(homeId);
        return next;
      }
      if (next.size >= MAX_COMPARE) {
        setCompareLimitMessage(true);
        setTimeout(() => setCompareLimitMessage(false), 4000);
        return prev;
      }
      next.add(homeId);
      return next;
    });
  }

  function clearCompare() {
    setSelectedCompare(new Set());
  }

  const unlockedHomes = useMemo(
    () => homes.filter((h) => h.has_access && h.report),
    [homes]
  );
  const bestNeg = useMemo(() => pickBestNegotiabilityHome(unlockedHomes), [unlockedHomes]);
  const totalSavings = useMemo(() => computeTotalSavings(unlockedHomes), [unlockedHomes]);
  const marketCondition = useMemo(() => aggregateMarketConditions(markets), [markets]);
  const ranked = useMemo(() => rankByArbitrage(homes), [homes]);
  const maxSavings = useMemo(
    () => ranked.reduce((m, h) => (h.savings && h.savings > m ? h.savings : m), 0),
    [ranked]
  );

  const upsell = !plan.is_unlimited ? pickUpsell(homes.length) : null;

  const comparing = useMemo(
    () => ranked.filter((h) => selectedCompare.has(h.id) && h.has_access && h.report),
    [ranked, selectedCompare]
  );

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
                  {plan.is_unlimited
                    ? " · unlimited plan"
                    : plan.credits_remaining > 0
                    ? ` · ${plan.credits_remaining} credit${plan.credits_remaining === 1 ? "" : "s"}`
                    : ""}
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

          {/* SECTION 1 — Top 3 answer cards */}
          <div className="answerGrid">
            <BestDealCard home={bestNeg} />
            <TotalSavingsCard totals={totalSavings} />
            <MarketConditionsCard condition={marketCondition} />
          </div>

          {upsell && (
            <UpsellBanner upsell={upsell} onClick={() => startPlanCheckout(upsell.plan)} />
          )}

          {/* SECTION 2 — Ranked table */}
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

          {/* SECTION 3 — Market intelligence by submarket */}
          {markets.length > 0 && <MarketIntelligenceSection markets={markets} />}
        </main>
      </div>

      {showAdd && (
        <AddHomeModal
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            loadAll(token);
          }}
        />
      )}
    </>
  );
}

/* ===================== TOP 3 ANSWER CARDS ===================== */

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

function BestDealCard({ home }) {
  if (!home || !home.report) {
    return (
      <EmptyAnswerCard
        kicker="Your Best Deal Right Now"
        message="Unlock a report to see your strongest negotiation opportunity."
      />
    );
  }
  const r = home.report;
  const savings = (r.asking_price || 0) - (r.offer_low || 0);
  const score = r.negotiability_score;
  const buy = score != null && score >= 7;
  return (
    <AnswerCardShell kicker="Your Best Deal Right Now">
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
      <div className="answerBigStat answerStatGreen">
        Save up to {formatMoney(savings)}
      </div>
      <div className="answerSubline">
        <strong>{score}</strong> / 10 negotiability · most negotiable home in your list
      </div>
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="answerLink">
        View report →
      </Link>
    </AnswerCardShell>
  );
}

function TotalSavingsCard({ totals }) {
  if (!totals.count) {
    return (
      <EmptyAnswerCard
        kicker="Total Savings on the Table"
        message="Unlock reports to see aggregated savings across your list."
        variant="dark"
      />
    );
  }
  const low = Math.max(0, totals.low);
  const high = Math.max(0, totals.high);
  return (
    <AnswerCardShell kicker="Total Savings on the Table" variant="dark">
      <div className="answerBigStat">
        You could save {formatMoney(low)} – {formatMoney(high)}
      </div>
      <div className="answerSubline answerSublineDark">
        across <strong>{totals.count}</strong> home{totals.count === 1 ? "" : "s"} vs. current asking prices
      </div>
    </AnswerCardShell>
  );
}

function MarketConditionsCard({ condition }) {
  if (!condition) {
    return (
      <EmptyAnswerCard
        kicker="Market Conditions"
        message="Save a home to see local market conditions."
      />
    );
  }
  const variant = temperatureClass(condition.temperature);
  return (
    <AnswerCardShell kicker="Market Conditions" variant={variant}>
      <div className="answerBigTemp">{condition.temperature}</div>
      <div className="answerSubline">
        Avg DOM <strong>{condition.avg_dom}</strong> · typical{" "}
        <strong>{condition.avg_discount_pct}%</strong> off list
      </div>
    </AnswerCardShell>
  );
}

/* ===================== RANKED TABLE ===================== */

function RankedTable({
  ranked,
  maxSavings,
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
              <th>Your offer range</th>
              <th>Potential savings</th>
              <th>Score</th>
              <th>DOM</th>
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
  home,
  rank,
  maxSavings,
  selected,
  onToggleCompare,
  onUnlock,
  onRemove,
  pending,
  credits,
  unlimited,
}) {
  const r = home.report || {};
  const unlocked = home.has_access && home.report;
  const submarket = getMarketKey(r);
  const dot = unlocked ? dotColorForScore(r.negotiability_score) : "muted";
  const dealPct =
    unlocked && home.savings && maxSavings
      ? Math.max(2, Math.round((home.savings / maxSavings) * 100))
      : 0;

  return (
    <tr className={unlocked ? "" : "rankedLockedRow"}>
      <td className="rankedColRank">
        {rank != null ? <span className="rankBadgeNum">#{rank}</span> : <span className="rankBadgeMuted">—</span>}
      </td>
      <td className="rankedColProp">
        <Link
          href={`/dashboard/${encodeAddress(home.address)}`}
          className="rankAddress"
        >
          {home.address}
        </Link>
        {submarket && <span className="rankBadge">{submarket}</span>}
      </td>
      <td>
        <span className="rankAsk">
          {r.asking_price ? formatMoneyFull(r.asking_price) : "—"}
        </span>
      </td>
      <td>
        {unlocked ? (
          <span className="rankOffer">
            {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
          </span>
        ) : (
          <span className="dashBlur">$X,XXX,XXX–$X,XXX,XXX</span>
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
        {unlocked ? (
          <span className="rankDom">{r.days_on_market ?? "—"}</span>
        ) : (
          <span className="dashBlur">XXX</span>
        )}
      </td>
      <td className="rankedColDeal">
        {unlocked && home.savings ? (
          <div
            className="dealBar"
            title={`${dealPct}% of top deal`}
            aria-label={`Deal strength ${dealPct} percent of top deal`}
          >
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
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleCompare}
                className="rankCheck"
              />
              <span className="rankCheckText">Compare</span>
            </label>
            <Link
              href={`/dashboard/${encodeAddress(home.address)}`}
              className="rankViewBtn"
            >
              View →
            </Link>
            <button
              type="button"
              className="rankRemoveBtn"
              onClick={onRemove}
              aria-label="Remove"
              title="Remove"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="rankActionsBox">
            <button
              type="button"
              className="rankUnlockBtn"
              onClick={onUnlock}
              disabled={pending}
            >
              <LockIcon size={11} />
              {pending ? "..." : unlockLabel(home, credits, unlimited)}
            </button>
            <button
              type="button"
              className="rankRemoveBtn"
              onClick={onRemove}
              aria-label="Remove"
              title="Remove"
            >
              ×
            </button>
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
        <span className={`dashMarketBadge dashMarketBadge_${tempClass}`}>
          {s.temperature}
        </span>
      </div>
      <div className="dashMarketRow">
        <div>
          <div className="dashCardKicker">Avg DOM</div>
          <strong>{s.avg_dom}</strong>
        </div>
        <div>
          <div className="dashCardKicker">Typical off-list</div>
          <strong>{s.avg_discount_pct}%</strong>
        </div>
        <div>
          <div className="dashCardKicker">Saved here</div>
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

/* ===================== INLINE COMPARE PANEL ===================== */

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
                    <Link
                      href={`/dashboard/${encodeAddress(h.address)}`}
                      className="compareColAddr"
                    >
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
            <CompareRow
              label="Asking Price"
              cells={comparing.map((h) => formatMoneyFull(h.report.asking_price))}
            />
            <CompareRow
              label="Your Offer Range"
              cells={comparing.map(
                (h) => `${formatMoney(h.report.offer_low)}–${formatMoney(h.report.offer_high)}`
              )}
              accent
            />
            <CompareRow
              label="Negotiability Score"
              cells={comparing.map((h) => `${h.report.negotiability_score} / 10`)}
            />
            <CompareRow
              label="Days on Market"
              cells={comparing.map((h) => h.report.days_on_market ?? "—")}
            />
            <CompareRow
              label="Price Cuts"
              cells={comparing.map((h) => h.report.price_cuts ?? 0)}
            />
            <CompareRow
              label="Zestimate Gap"
              cells={comparing.map((h) =>
                h.report.zestimate_gap != null ? formatMoney(h.report.zestimate_gap) : "—"
              )}
            />
            <CompareRow
              label="Submarket"
              cells={comparing.map((h) => getMarketKey(h.report) || "—")}
            />
            <tr>
              <th></th>
              {comparing.map((h) => (
                <td key={h.id}>
                  <Link
                    href={`/dashboard/${encodeAddress(h.address)}`}
                    className="compareViewBtn"
                  >
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
