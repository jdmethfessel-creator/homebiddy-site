import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback } from "react";
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
import { pickUpsell, timelineFor } from "../../lib/market-intel";

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

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [homes, setHomes] = useState([]);
  const [plan, setPlan] = useState({ credits_remaining: 0, is_unlimited: false });
  const [market, setMarket] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pendingAddress, setPendingAddress] = useState(null);

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
      setMarket(marketJson.neighborhoods || []);
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

  // Try to unlock without payment (credits or unlimited).
  // If no credits available, fall back to single-report checkout.
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
      // No credits — go to Stripe single-report checkout.
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

  // Sort and rank
  const homesForRanking = homes.map((h) => ({
    ...h,
    report: h.has_access ? h.report : null,
  }));
  const ranked = rankHomes(homesForRanking);
  const topRanked = ranked.find((h) => h.scoring);
  const topExplanation = topRanked ? explainBestValue(topRanked, topRanked.scoring) : null;

  const timeline = timelineFor(homesForRanking);
  const upsell = !plan.is_unlimited ? pickUpsell(homes.length) : null;

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
                : `Payment received. Your report${notice.address ? ` for ${notice.address}` : ""} is being prepared — we’ll email you when it’s ready.`}
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

          {upsell && (
            <UpsellBanner upsell={upsell} onClick={() => startPlanCheckout(upsell.plan)} />
          )}

          {ranked.length >= 2 && (
            <div className="dashCompareRow">
              <Link href="/dashboard/compare" className="dashCompareBtn">
                Compare homes side-by-side →
              </Link>
            </div>
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
                onRemove={() => handleRemove(h.id)}
                onUnlock={() => handleUnlock(h)}
              />
            ))}
          </div>

          {market.length > 0 && (
            <>
              <h2 className="dashMarketHeading">Market intelligence</h2>
              <div className="dashMarketGrid">
                {market.map((m) => (
                  <MarketCard key={m.neighborhood} item={m} />
                ))}
              </div>
            </>
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
          onPurchase={async (address, listing_url) => {
            setShowAdd(false);
            const r = await fetch("/api/dashboard/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ plan: "single", address, listing_url }),
            });
            const json = await r.json();
            if (json.url) window.location.href = json.url;
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
          across {timeline.neighborhood_count || 0} neighborhood
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
  return (
    <div className="dashBest">
      <div className="dashBestTag">⭐ Best value</div>
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashBestAddress">
        {home.address}
      </Link>
      <div className="dashBestPrices">
        <div>
          <div className="dashBestKicker">Asking</div>
          <div>{formatMoneyFull(home.report.asking_price)}</div>
        </div>
        <div className="dashBestArrow">→</div>
        <div>
          <div className="dashBestKicker">Likely purchase</div>
          <div className="dashBestPurchase">
            {formatMoney(home.report.offer_low)}–{formatMoney(home.report.offer_high)}
          </div>
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

function HomeCard({ home, pending, credits, unlimited, onRemove, onUnlock }) {
  const scoring = home.has_access && home.report ? scoreReport(home.report) : null;
  const r = home.report || {};
  const unlocked = home.has_access && home.report;

  return (
    <div className={`dashCard${unlocked ? "" : " dashCardLocked"}`}>
      <div className="dashCardTop">
        <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardAddress">
          {home.address}
        </Link>
        <button className="dashCardRemove" onClick={onRemove} aria-label="Remove">×</button>
      </div>

      {/* Address + asking price are always visible; rest is freemium-blurred when locked */}
      <div className="dashCardPriceRow">
        <div>
          <div className="dashCardKicker">Asking</div>
          <div className="dashCardPrice">{r.asking_price ? formatMoney(r.asking_price) : "—"}</div>
        </div>
        <div className="dashCardOffer">
          <div className="dashCardKicker">Your offer</div>
          {unlocked ? (
            <div className="dashCardOfferVal">
              {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
            </div>
          ) : (
            <div className="dashCardOfferVal dashBlur">$1,XXX,000–$1,XXX,000</div>
          )}
        </div>
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
        {r.neighborhood ? (
          <span className="dashCardNeigh">{r.neighborhood}</span>
        ) : (
          <span className="dashCardNeigh">&nbsp;</span>
        )}
        {unlocked ? (
          <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardLink">
            View report →
          </Link>
        ) : (
          <button
            type="button"
            className="dashCardCta dashCardCtaSm"
            onClick={onUnlock}
            disabled={pending}
          >
            <LockIcon /> {pending ? "Unlocking…" : unlockLabel(home, credits, unlimited)}
          </button>
        )}
      </div>

      {!unlocked && (
        <div className="dashCardLockHint">
          <LockIcon size={11} /> unlock to see full analysis
        </div>
      )}
    </div>
  );
}

function unlockLabel(home, credits, unlimited) {
  if (unlimited) return "Unlock free";
  if (credits > 0) return `Use credit (${credits} left)`;
  if (!home.report_exists) return "Generate · $19.99";
  return "Unlock · $19.99";
}

function MarketCard({ item }) {
  const s = item.summary;
  if (!s) {
    return (
      <div className="dashMarketCard">
        <div className="dashMarketName">{item.neighborhood}</div>
        <div className="dashMarketEmpty">Not enough comp data yet.</div>
      </div>
    );
  }
  const momentumClass =
    s.momentum === "Heating Up" ? "hot" : s.momentum === "Cooling Down" ? "cool" : "neutral";
  return (
    <div className="dashMarketCard">
      <div className="dashMarketName">{item.neighborhood}</div>
      <div className={`dashMarketBadge dashMarketBadge_${momentumClass}`}>{s.momentum}</div>
      <div className="dashMarketRow">
        <div>
          <div className="dashCardKicker">Avg DOM</div>
          <strong>{s.avg_dom}</strong>
        </div>
        <div>
          <div className="dashCardKicker">Typical discount</div>
          <strong>{s.avg_discount_pct}%</strong>
        </div>
        <div>
          <div className="dashCardKicker">Price cuts</div>
          <strong>{s.typical_price_cuts}</strong>
        </div>
      </div>
      <div className="dashMarketSample">Based on {s.sample_size} report{s.sample_size === 1 ? "" : "s"}</div>
    </div>
  );
}

function AddHomeModal({ token, onClose, onSaved, onPurchase }) {
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
