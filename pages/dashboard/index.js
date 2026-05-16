import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback, useMemo } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import {
  rankHomes,
  scoreReport,
  explainBestValue,
  formatMoney,
  formatMoneyFull,
  formatPercent,
} from "../../lib/scoring";
import {
  pickUpsell,
  timelineFor,
  getMarketKey,
  temperatureFor,
} from "../../lib/market-intel";

const MAX_COMPARE = 4;

function encodeAddress(addr) {
  return encodeURIComponent(addr);
}

function LockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function signalColorForScore(score) {
  if (score == null) return "muted";
  if (score >= 7) return "green";
  if (score >= 5) return "amber";
  return "red";
}

function buySignalForScore(score) {
  if (score == null) return null;
  return score >= 7 ? "buy" : "monitor";
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

  // Drop any compare selections for homes that disappear or get locked.
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

  const homesForRanking = useMemo(
    () => homes.map((h) => ({ ...h, report: h.has_access ? h.report : null })),
    [homes]
  );
  const ranked = useMemo(() => rankHomes(homesForRanking), [homesForRanking]);
  const topRanked = ranked.find((h) => h.scoring);
  const topExplanation = topRanked ? explainBestValue(topRanked, topRanked.scoring) : null;
  const timeline = timelineFor(homesForRanking);
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
          <div className="dashTitleRow">
            <div>
              <h1 className="dashTitle">Your saved homes</h1>
              <p className="dashSubtitle">
                {homes.length === 0
                  ? "Start by adding a Zillow or Realtor.com listing."
                  : `${homes.length} home${homes.length === 1 ? "" : "s"} saved.`}
              </p>
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

          {timeline && (
            <TimelineStrip
              timeline={timeline}
              credits={plan.credits_remaining}
              unlimited={plan.is_unlimited}
            />
          )}

          {topRanked?.scoring && (
            <BestValueHero
              home={topRanked}
              scoring={topRanked.scoring}
              explanation={topExplanation}
            />
          )}

          {markets.length > 0 && (
            <MarketIntelligenceSection markets={markets} />
          )}

          {upsell && (
            <UpsellBanner upsell={upsell} onClick={() => startPlanCheckout(upsell.plan)} />
          )}

          <div className="dashGrid">
            {loading && <div className="dashEmpty">Loading…</div>}
            {!loading && ranked.length === 0 && (
              <div className="dashEmpty">
                No homes yet. <button className="dashLink" onClick={() => setShowAdd(true)}>Add your first home</button> to see analysis here.
              </div>
            )}
            {ranked.map((h) => (
              <HomeCard
                key={h.id}
                home={h}
                pending={pendingAddress === h.address}
                credits={plan.credits_remaining}
                unlimited={plan.is_unlimited}
                selected={selectedCompare.has(h.id)}
                onToggleCompare={() => toggleCompare(h.id)}
                onRemove={() => handleRemove(h.id)}
                onUnlock={() => handleUnlock(h)}
              />
            ))}
          </div>

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

function TimelineStrip({ timeline, credits, unlimited }) {
  const planLabel = unlimited
    ? "Unlimited access"
    : credits > 0
    ? `${credits} report credit${credits === 1 ? "" : "s"} remaining`
    : null;
  return (
    <div className="dashTimeline">
      <div className="dashTimelineCell">
        <div className="dashTimelineKicker">Shopping for</div>
        <div className="dashTimelineValue">
          {timeline.days_shopping} day{timeline.days_shopping === 1 ? "" : "s"}
        </div>
      </div>
      <div className="dashTimelineCell">
        <div className="dashTimelineKicker">Saved</div>
        <div className="dashTimelineValue">
          {timeline.home_count} home{timeline.home_count === 1 ? "" : "s"}
        </div>
        <div className="dashTimelineSub">
          across {timeline.neighborhood_count || 0} submarket
          {timeline.neighborhood_count === 1 ? "" : "s"}
        </div>
      </div>
      <div className="dashTimelineCell">
        <div className="dashTimelineKicker">Most negotiable</div>
        {timeline.most_negotiable ? (
          <>
            <div className="dashTimelineValue dashTimelineAddr">
              {timeline.most_negotiable.address}
            </div>
            <div className="dashTimelineSub">{timeline.most_negotiable.score}/10</div>
          </>
        ) : (
          <div className="dashTimelineSub">Unlock a report to see</div>
        )}
      </div>
      {planLabel && (
        <div className="dashTimelineCell dashTimelinePlan">
          <div className="dashTimelineKicker">Plan</div>
          <div className="dashTimelineValue">{planLabel}</div>
        </div>
      )}
    </div>
  );
}

function BestValueHero({ home, scoring, explanation }) {
  const r = home.report;
  const signal = buySignalForScore(r.negotiability_score);
  return (
    <div className="dashBest">
      <div className="dashBestTopRow">
        <span className="dashBestTag">⭐ Best value</span>
        {signal && (
          <span className={`dashBestPill dashBestPill_${signal}`}>
            {signal === "buy" ? "BUY SIGNAL" : "MONITOR"}
          </span>
        )}
      </div>
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashBestAddress">
        {home.address}
      </Link>
      <div className="dashBestPriceBlock">
        <div className="dashBestListLine">
          LIST PRICE · <span>{formatMoneyFull(r.asking_price)}</span>
        </div>
        <div className="dashBestOfferLabel">YOUR LIKELY PURCHASE</div>
        <div className="dashBestOfferRange">
          {formatMoneyFull(r.offer_low)} – {formatMoneyFull(r.offer_high)}
        </div>
      </div>
      <div className="dashBestUpsideRow">
        <div className="dashBestUpsideAmt">{formatMoneyFull(scoring.estimated_equity)}</div>
        <div className="dashBestUpsideLabel">
          Conservative 3-year upside · <strong>{formatPercent(scoring.upside_pct_value, 1)}</strong>
        </div>
      </div>
      {explanation && <div className="dashBestExplain">{explanation}</div>}
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashBestCta">
        View full report →
      </Link>
    </div>
  );
}

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
  const temp = s.temperature || temperatureFor(s);
  const tempClass =
    temp === "Hot"
      ? "hot"
      : temp === "Buyer's Market"
      ? "buyers"
      : "neutral";
  return (
    <div className="dashMarketCard">
      <div className="dashMarketHeaderRow">
        <div className="dashMarketName">{name}</div>
        <span className={`dashMarketBadge dashMarketBadge_${tempClass}`}>
          {temp}
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

function HomeCard({ home, pending, credits, unlimited, selected, onToggleCompare, onRemove, onUnlock }) {
  const r = home.report || {};
  const unlocked = home.has_access && home.report;
  const scoring = unlocked ? scoreReport(r) : null;
  const submarket = getMarketKey(r);
  const signal = unlocked ? signalColorForScore(r.negotiability_score) : "muted";

  return (
    <div className={`dashCard dashCard_${signal}${unlocked ? "" : " dashCardLocked"}`}>
      <div className="dashCardHeaderRow">
        {submarket ? (
          <span className="dashSubmarketBadge">{submarket}</span>
        ) : (
          <span className="dashSubmarketBadge dashSubmarketBadgeMuted">—</span>
        )}
        {unlocked ? (
          <label className="dashCompareCheck">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleCompare}
            />
            <span>Compare</span>
          </label>
        ) : (
          <button className="dashCardRemove" onClick={onRemove} aria-label="Remove">×</button>
        )}
      </div>

      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardAddress">
        {home.address}
      </Link>

      <div className="dashCardAsking">
        {r.asking_price ? formatMoneyFull(r.asking_price) : "—"}
      </div>

      <div className="dashCardOfferRow">
        <span className="dashCardKicker">Your offer</span>
        {unlocked ? (
          <span className="dashCardOfferVal">
            {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
          </span>
        ) : (
          <span className="dashCardOfferVal dashBlur">$1,XXX,000–$1,XXX,000</span>
        )}
      </div>

      <div className="dashCardStats">
        <div>
          <span className="dashCardKicker">Score</span>
          {unlocked ? <strong>{r.negotiability_score}</strong> : <strong className="dashBlur">X.X</strong>}
        </div>
        <div>
          <span className="dashCardKicker">DOM</span>
          {unlocked ? <strong>{r.days_on_market}</strong> : <strong className="dashBlur">XXX</strong>}
        </div>
        <div>
          <span className="dashCardKicker">Value</span>
          {scoring ? <strong>{scoring.score}</strong> : <strong className="dashBlur">XX</strong>}
        </div>
      </div>

      <div className="dashCardFooter">
        {unlocked ? (
          <>
            <button
              type="button"
              className="dashCardSecondary"
              onClick={onRemove}
              aria-label="Remove home"
            >
              Remove
            </button>
            <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardLink">
              View report →
            </Link>
          </>
        ) : (
          <>
            <span className="dashCardLockHint">
              <LockIcon size={11} /> unlock to compare
            </span>
            <button
              type="button"
              className="dashCardCta dashCardCtaSm"
              onClick={onUnlock}
              disabled={pending}
            >
              <LockIcon /> {pending ? "Unlocking…" : unlockLabel(home, credits, unlimited)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function unlockLabel(home, credits, unlimited) {
  if (unlimited) return "Unlock free";
  if (credits > 0) return `Use credit (${credits} left)`;
  if (!home.report_exists) return "Generate · $19.99";
  return "Unlock · $19.99";
}

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
