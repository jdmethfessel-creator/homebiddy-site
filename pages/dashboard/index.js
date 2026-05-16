import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
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

// Trim a free-form notes string to at most `maxWords` words. Used as a
// safety net for older land_arbitrage_notes rows that pre-date the new
// 'short phrase' prompt rules.
function truncateWords(s, maxWords = 8) {
  if (!s) return "";
  const cleaned = String(s).replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(" ") + "…";
}

// Display formatter for 0-10 scores. Integer scores render without a
// decimal (8 not 8.0); decimals only when meaningful (8.5 stays 8.5).
function formatScore(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Same formatter, but clamped to [1, 10] before display. Used for the
// final negotiability_score and land_arbitrage_score so any legacy row
// in the DB with a sub-1 value (pre-clamp era) still renders sensibly.
// Sub-component scores in the tooltip keep using formatScore directly
// since 0 is a legitimate value for an individual component.
function formatFinalScore(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Math.max(1, Math.min(10, Number(n)));
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Map a 0-10 land_arbitrage_score to a word label for Card 2.
function landLabel(score) {
  if (score == null || isNaN(Number(score))) return "—";
  const v = Number(score);
  if (v >= 7) return "Strong";
  if (v >= 5) return "Moderate";
  return "Weak";
}

// Plain-English message that replaces the BUY SIGNAL / MONITOR pill on
// the Best Deal card. Tied to the negotiability score bands.
function scoreMessage(score) {
  if (score == null || isNaN(Number(score))) return "";
  const v = Number(score);
  if (v >= 8) return "Seller is motivated. Strong time to offer.";
  if (v >= 6) return "Some room to negotiate. Worth pursuing.";
  if (v >= 4) return "Limited leverage. Seller holding firm.";
  return "Fresh listing. Wait for motivation signals.";
}

// Actionable "next step" prompt for the Best Deal hero card. Decision
// matrix is driven by negotiability_score + days_on_market so users get
// a concrete cue tied to the data they're looking at.
function nextStepFor(score, dom) {
  const v = Number(score);
  const d = Number(dom);
  if (isNaN(v)) return null;
  if (v >= 7) {
    return { label: "Ready to make an offer", linkLabel: "see negotiation script" };
  }
  if (v >= 5 && d >= 60) {
    return { label: "Schedule a showing and monitor for price cuts", linkLabel: null };
  }
  if (v < 5 && d > 0 && d < 30) {
    return { label: "Too early — add to watchlist and revisit in 30 days", linkLabel: null };
  }
  return null;
}

function LockIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function RefreshIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

function ExternalLinkIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// Hover tooltip rendered via a React portal so the bubble can escape the
// table's overflow-clipped scroll container. Positioned above the trigger
// with a fixed-position bubble anchored to the trigger's bounding rect.
function HoverTooltip({ children, title, body }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef(null);

  function showAt() {
    if (typeof window === "undefined" || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
    setShow(true);
  }
  function hide() { setShow(false); }

  const hasContent = title || body;

  return (
    <>
      <span
        ref={triggerRef}
        className={hasContent ? "hoverTrigger" : ""}
        onMouseEnter={hasContent ? showAt : undefined}
        onMouseLeave={hasContent ? hide : undefined}
        onFocus={hasContent ? showAt : undefined}
        onBlur={hasContent ? hide : undefined}
      >
        {children}
      </span>
      {show && hasContent && typeof document !== "undefined"
        ? createPortal(
            <div
              className="hoverTooltipBubble"
              style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
            >
              {title && <div className="hoverTooltipTitle">{title}</div>}
              {body}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

// Tooltips show methodology only — the full breakdown lives on the
// /dashboard/[address] detail page so users get the "what" on hover and
// the "how" when they click in.
function ScoreTooltipBody() {
  return (
    <div className="hoverTooltipLead">
      Negotiability Score (1–10). Weighted across 5 signals: days on market,
      price history, $/sqft vs closed comps, Zestimate gap, and listing
      language. Higher = more room to negotiate.
    </div>
  );
}

function LandTooltipBody() {
  return (
    <div className="hoverTooltipLead">
      Land Arbitrage (1–10). Weighted across 4 signals: lot $/sqft vs
      neighborhood median, lot size vs median, structure condition, and
      renovation / ADU upside. Higher = better land play.
    </div>
  );
}

function dotColorForScore(score) {
  if (score == null) return "muted";
  if (score >= 6) return "green";
  if (score >= 4) return "amber";
  return "red";
}

// Parse the most recent cut from cut_history. Strings are formatted as
// "$X → $Y (Month YYYY)" or similar — see SYSTEM_PROMPT. Returns null
// if nothing parseable. Handles upward moves too (rare but possible).
function parseLatestPriceChange(report) {
  const history = report?.data?.cut_history || report?.cut_history || [];
  if (!Array.isArray(history) || history.length === 0) return null;
  const latest = String(history[history.length - 1] || "");
  const m = latest.match(/\$?([\d,]+)\s*[→\-]+\s*\$?([\d,]+).*\(([^)]+)\)/);
  if (!m) return null;
  const oldPrice = parseInt(m[1].replace(/,/g, ""), 10);
  const newPrice = parseInt(m[2].replace(/,/g, ""), 10);
  const when = m[3].trim();
  if (!oldPrice || !newPrice) return null;
  return {
    oldPrice,
    newPrice,
    delta: newPrice - oldPrice,
    when,
  };
}

function formatShortDollars(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

// "May 16" / "May 2025" — short date for "Analysis updated" line.
function formatShortDate(timestamp) {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Returns relative-time string for the Property cell ("3 days ago", etc.).
function savedAgo(timestamp) {
  if (!timestamp) return null;
  const ms = Date.now() - new Date(timestamp).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

// Approximate fully-loaded monthly carry for any price point — used by
// the True Monthly Cost hover tooltip to show "At $X offer / At $Y offer"
// without storing each scenario separately on the report.
function approxMonthly(price, opts = {}) {
  if (!price || price <= 0) return null;
  const hoa = Number(opts.hoa) || 0;
  const principal = price * 0.8;
  const rate = 0.068 / 12;
  const n = 360;
  const x = Math.pow(1 + rate, n);
  const mort = Math.round((principal * rate * x) / (x - 1));
  const tax = Math.round((price * 0.01) / 12);
  const insRate = opts.isFlood ? 0.012 : 0.007;
  const ins = Math.round((price * insRate) / 12);
  return mort + tax + ins + hoa;
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

// Get the numeric value of a home by sort key. Returns null for missing
// values so the sort routine can park them at the bottom regardless of
// direction.
function getSortValue(home, key) {
  const r = home.report || {};
  switch (key) {
    case "asking": return numOrNull(r.asking_price);
    case "offer_range": return numOrNull(r.offer_low);
    case "offer_gap": return home.savings;
    case "offer_gap_pct": {
      const asking = numOrNull(r.asking_price);
      const gap = home.savings;
      if (asking == null || gap == null || asking === 0) return null;
      return (gap / asking) * 100;
    }
    case "home_sqft": return numOrNull(r.sqft);
    case "lot_sqft": return numOrNull(r.lot_size_sqft);
    case "psf": return numOrNull(r.price_per_living_sqft);
    case "lot_psf": return numOrNull(r.price_per_lot_sqft);
    case "score": return numOrNull(r.negotiability_score);
    case "land": return numOrNull(r.land_arbitrage_score);
    case "dom": return numOrNull(r.days_on_market);
    case "monthly": return numOrNull(r.estimated_monthly_total);
    default: return null;
  }
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function sortHomes(homes, key, dir) {
  const dirMul = dir === "asc" ? 1 : -1;
  return [...homes]
    .map((h) => ({ ...h, savings: savingsFor(h) }))
    .sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);
      // Stable tie-break by most-recently-saved.
      if (av == null && bv == null) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      if (av == null) return 1; // null always at the bottom
      if (bv == null) return -1;
      if (av === bv) return new Date(b.created_at) - new Date(a.created_at);
      return (av - bv) * dirMul;
    });
}

// Data-quality flag for the offer range. Claude can mark a report with
// data.offer_range_flagged when it suspects bad listing data; we also
// apply a client-side sanity check so any home whose offer_low is more
// than 20% below asking gets the ⚠ Verify tag regardless of what was
// stored at parse time.
function offerRangeFlagged(report) {
  if (!report) return false;
  if (report?.data?.offer_range_flagged) return true;
  const asking = Number(report.asking_price);
  const offerLow = Number(report.offer_low);
  if (!asking || !offerLow) return false;
  return (asking - offerLow) / asking > 0.20;
}

function offerRangeFlagNote(report) {
  return (
    report?.data?.offer_range_flag_note ||
    "Offer range is more than 20% below asking — verify listing data before relying on it."
  );
}

// Renovated-outlier flag: the home's $/sqft is far above neighborhood comps
// AND the listing language signals a renovation, so comp-based analysis
// understates what the seller will accept. Replaces the comp-gap display
// with an est_floor anchored to DOM + price-cut history.
function hasCeilingRisk(report) {
  return report?.data?.neighborhood_ceiling_risk === true;
}

function ceilingRiskNote(report) {
  return (
    report?.data?.ceiling_risk_note ||
    "This home appears to be a renovated outlier in its neighborhood. Comps reflect an up-and-coming area where unrenovated homes sell at lower $/sqft. The seller likely has a renovation cost floor above what pure comp analysis supports. Treat the offer range as a market anchor, not a realistic opening bid."
  );
}

function ceilingEstFloor(report) {
  const v = Number(report?.data?.est_floor);
  return v > 0 ? v : null;
}

function ceilingEstFloorPct(report) {
  const ask = Number(report?.asking_price);
  const floor = ceilingEstFloor(report);
  if (!ask || !floor) return null;
  return ((ask - floor) / ask) * 100;
}

const CEILING_TOOLTIP_TITLE = "Renovated outlier";
const CEILING_TOOLTIP_BODY =
  "This home appears to be a renovated outlier in its neighborhood. Comps reflect the surrounding area, not this home's finish level. The offer gap shown is an estimated floor based on seller motivation signals, not pure comp analysis.";

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

function hasTaxRisk(report) {
  const current = Number(report?.annual_taxes_current);
  const projected = Number(report?.annual_taxes_projected);
  if (!current || !projected) return false;
  const diff = projected - current;
  // Flag only if the jump is BOTH proportionally large (>25%) AND
  // dollar-material (>$2,000/yr). Cheap homes won't false-flag on small
  // proportional jumps.
  return projected > current * TAX_RISK_THRESHOLD && diff > 2000;
}

function pickBestLandPlay(unlockedHomes) {
  return unlockedHomes.reduce((best, h) => {
    const s = Number(h.report?.land_arbitrage_score);
    if (!s || isNaN(s)) return best;
    if (!best || s > Number(best.report.land_arbitrage_score)) return h;
    return best;
  }, null);
}

function landDotColor(score) {
  if (score == null) return "muted";
  const v = Number(score);
  if (isNaN(v)) return "muted";
  if (v >= 7) return "green";
  if (v >= 5) return "amber";
  return "red";
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

// Submarket avg $/sqft lookup — still used by the ranked-table $/sqft column
// to drive the up/down vs-market arrow indicator. Each entry exposes both
// living and lot averages.
function submarketPsfMap(markets) {
  const m = new Map();
  for (const x of markets || []) {
    const key = x.market || x.neighborhood;
    if (!key || !x.summary) continue;
    m.set(key, {
      living: x.summary.avg_psf || null,
      lot: x.summary.avg_lot_psf || null,
    });
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
  // Optimistic-delete state. We hide the home immediately, commit to the
  // server after a delay, and let the user undo within the window. Native
  // confirm() was unreliable: browsers suppress repeated dialogs and the
  // suppressed call returns false, silently blocking every subsequent
  // delete.
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [hiddenHomeIds, setHiddenHomeIds] = useState(() => new Set());
  // Table sort state. Default is negotiability score descending so the
  // strongest deal is at the top on first render. Clicking a sortable
  // header toggles direction; clicking a different column resets to a
  // sensible default direction for that metric.
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // For metrics where lower is better, default to ascending; for
    // everything else (score/land/DOM/offer-gap/sqft) default to desc.
    const ascByDefault = new Set(["asking", "offer_range", "psf", "lot_psf", "monthly"]);
    setSortDir(ascByDefault.has(key) ? "asc" : "desc");
  }

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

  // Background polls pass { silent: true } so they don't flip the loading
  // state. Without this, every 10s poll re-renders the dashboard with a
  // "Loading…" line above the already-populated table.
  const loadAll = useCallback(async (tk, { silent = false } = {}) => {
    if (!tk) return;
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) loadAll(token); }, [token, loadAll]);

  // Poll /api/dashboard/list every 10s ONLY while at least one home is
  // mid-analysis. The instant every home reaches a terminal status
  // ('complete' or 'failed'), the effect's cleanup clears the interval
  // and no further polls fire. Polls pass silent=true so they don't
  // toggle the loading state on a fully-populated dashboard.
  useEffect(() => {
    if (!token) return;
    const inFlight = homes.some(
      (h) => h.status === "pending" || h.status === "analyzing"
    );
    if (!inFlight) return;
    const interval = setInterval(() => {
      loadAll(token, { silent: true });
    }, 10000);
    return () => clearInterval(interval);
  }, [homes, token, loadAll]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.paid === "1") {
      setNotice({
        kind: "paid",
        address: router.query.address,
        purchasedPlan: router.query.plan,
      });
      router.replace(router.pathname, undefined, { shallow: true });
      // Longer timeout for "report being prepared" because the report
      // can take 30-60s to arrive. The effect below also dismisses early
      // the moment the report shows up in the homes list.
      const t = setTimeout(() => setNotice(null), 60000);
      return () => clearTimeout(t);
    }
    if (router.query.canceled === "1") {
      setNotice({ kind: "canceled" });
      router.replace(router.pathname, undefined, { shallow: true });
      const t = setTimeout(() => setNotice(null), 4500);
      return () => clearTimeout(t);
    }
  }, [router]);

  // Auto-dismiss the "report being prepared" banner the moment the
  // report for that address actually arrives. Saves the user from
  // staring at a stale "your report is being prepared" message after
  // the row has already filled in.
  useEffect(() => {
    if (notice?.kind !== "paid" || !notice.address) return;
    const norm = (s) => String(s || "").trim().toLowerCase();
    const target = norm(notice.address);
    const arrived = homes.some(
      (h) => norm(h.address) === target && h.has_access && h.report
    );
    if (arrived) setNotice(null);
  }, [homes, notice]);

  useEffect(() => {
    setSelectedCompare((prev) => {
      const next = new Set();
      for (const h of homes) {
        if (prev.has(h.id) && h.has_access && h.report) next.add(h.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [homes]);

  async function commitRemove(id) {
    if (!token || !id) return;
    try {
      await fetch("/api/dashboard/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      console.error("remove failed:", err);
    }
    loadAll(token);
  }

  function handleRemove(id) {
    if (!token || !id) return;
    const home = homes.find((h) => h.id === id);
    if (!home) return;

    // If there's already a pending removal, commit it now — the user has
    // moved on, so the previous undo window closes.
    if (pendingRemoval) {
      clearTimeout(pendingRemoval.timer);
      // Fire-and-forget — the response just refreshes state which we'll
      // also do after the new removal commits.
      commitRemove(pendingRemoval.id);
    }

    // Hide the row immediately for a snappy click; drop any compare slot
    // it was occupying.
    setHiddenHomeIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedCompare((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    const timer = setTimeout(() => {
      setPendingRemoval(null);
      setHiddenHomeIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      commitRemove(id);
    }, 5000);

    setPendingRemoval({ id, address: home.address, timer });
  }

  function undoRemove() {
    if (!pendingRemoval) return;
    clearTimeout(pendingRemoval.timer);
    setHiddenHomeIds((prev) => {
      const next = new Set(prev);
      next.delete(pendingRemoval.id);
      return next;
    });
    setPendingRemoval(null);
  }

  // Clear any pending removal timer if the component unmounts so we don't
  // try to setState on an unmounted tree.
  useEffect(() => {
    return () => {
      if (pendingRemoval?.timer) clearTimeout(pendingRemoval.timer);
    };
  }, [pendingRemoval]);

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

  // Trigger /api/dashboard/analyze (used by the Retry button on failed
  // rows). The endpoint flips status='pending' and kicks off analysis via
  // waitUntil; the polling effect above picks up completion.
  async function triggerAnalyze(homeId, address, listing_url) {
    if (!token || !homeId || !address) return;
    try {
      await fetch("/api/dashboard/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ address, listing_url }),
      });
    } catch (err) {
      console.error("analyze trigger failed:", err);
    }
    loadAll(token);
  }

  // User-triggered refresh on an already-unlocked row. No confirm dialog —
  // the prior version's window.confirm was being dismissed in some cases
  // and silently swallowing the click. The optimistic UI update flips the
  // row to pending immediately so the Analyzing... spinner shows on click.
  async function triggerReanalyze(homeId, address, listing_url) {
    console.log("[reanalyze] click", { homeId, address, listing_url, hasToken: !!token });
    if (!token || !homeId || !address) {
      console.warn("[reanalyze] missing inputs, aborting");
      return;
    }

    // Optimistic update — row visibly flips into Analyzing state on click.
    setHomes((prev) =>
      prev.map((h) =>
        h.id === homeId
          ? {
              ...h,
              status: "pending",
              report: null,
              report_exists: false,
              has_access: false,
              last_error: null,
            }
          : h
      )
    );

    let serverError = null;
    try {
      console.log("[reanalyze] POST /api/dashboard/reanalyze", { address, listing_url });
      const r = await fetch("/api/dashboard/reanalyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ address, listing_url }),
      });
      const j = await r.json().catch(() => ({}));
      console.log("[reanalyze] response", r.status, j);
      if (!r.ok) {
        serverError = j.error || `Re-analysis request failed (${r.status})`;
      }
    } catch (err) {
      console.error("[reanalyze] network error:", err);
      serverError = "Network error. Please try again.";
    }

    if (serverError && typeof window !== "undefined") {
      window.alert(serverError);
    }
    loadAll(token);
  }

  // Visible-to-the-user view of homes — strips anything optimistically
  // hidden by a pending undo.
  const visibleHomes = useMemo(
    () => homes.filter((h) => !hiddenHomeIds.has(h.id)),
    [homes, hiddenHomeIds]
  );
  const unlockedHomes = useMemo(() => visibleHomes.filter((h) => h.has_access && h.report), [visibleHomes]);
  const bestNeg = useMemo(() => pickBestNegotiabilityHome(unlockedHomes), [unlockedHomes]);
  const bestLivingPsf = useMemo(() => pickLowest(unlockedHomes, "price_per_living_sqft"), [unlockedHomes]);
  const bestLotPsf = useMemo(() => pickLowest(unlockedHomes, "price_per_lot_sqft"), [unlockedHomes]);
  const bestLandPlay = useMemo(() => pickBestLandPlay(unlockedHomes), [unlockedHomes]);
  const totalSavings = useMemo(() => computeTotalSavings(unlockedHomes), [unlockedHomes]);
  const marketCondition = useMemo(() => aggregateMarketConditions(markets), [markets]);
  const primaryCity = useMemo(() => pickPrimaryCity(visibleHomes), [visibleHomes]);
  const ranked = useMemo(
    () => sortHomes(visibleHomes, sortKey, sortDir),
    [visibleHomes, sortKey, sortDir]
  );
  const maxSavings = useMemo(
    () => ranked.reduce((m, h) => (h.savings && h.savings > m ? h.savings : m), 0),
    [ranked]
  );
  const psfByMarket = useMemo(() => submarketPsfMap(markets), [markets]);

  const upsell = !plan.is_unlimited ? pickUpsell(visibleHomes.length) : null;
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
              {visibleHomes.length === 0 ? (
                "Start by adding a Zillow or Realtor.com listing."
              ) : (
                <>
                  <strong>{visibleHomes.length}</strong> home{visibleHomes.length === 1 ? "" : "s"} saved
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

          {visibleHomes.length === 0 ? (
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
                psfByMarket={psfByMarket}
              />
              <TrueMonthlyCostCard unlockedHomes={unlockedHomes} />
            </div>
          )}

          {upsell && (
            <UpsellBanner upsell={upsell} onClick={() => startPlanCheckout(upsell.plan)} />
          )}

          {markets.length > 0 && <MarketIntelligenceSection markets={markets} />}

          {/* Loading line only renders on the FIRST load (before any homes
              have arrived). Once content is on screen, subsequent fetches
              update silently — no flash above the table. */}
          {loading && ranked.length === 0 && (
            <div className="dashEmpty" style={{ marginBottom: 18 }}>
              Loading…
            </div>
          )}
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
            <div id="ranked-homes">
              <RankedTable
                ranked={ranked}
                maxSavings={maxSavings}
                psfByMarket={psfByMarket}
                selectedSet={selectedCompare}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                onToggleCompare={toggleCompare}
                onUnlock={handleUnlock}
                onRemove={handleRemove}
                onRetryAnalyze={triggerAnalyze}
                onReanalyze={triggerReanalyze}
                pendingAddress={pendingAddress}
                credits={plan.credits_remaining}
                unlimited={plan.is_unlimited}
              />
            </div>
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

        </main>

        {pendingRemoval && (
          <div className="undoToast" role="status" aria-live="polite">
            <span className="undoToastText">
              Removed <strong>{shortAddress(pendingRemoval.address)}</strong>
            </span>
            <button
              type="button"
              className="undoToastBtn"
              onClick={undoRemove}
            >
              Undo
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddHomeModal
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            // save.js already kicks off background analysis via waitUntil
            // and sets status='pending'. The polling effect above will
            // refresh the list every 10s until status flips to 'complete'.
            setShowAdd(false);
            loadAll(token);
          }}
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
        {formatFinalScore(v)}
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
  const gapDollars = (r.asking_price || 0) - (r.offer_low || 0);
  const gapPct = r.asking_price && gapDollars > 0
    ? (gapDollars / r.asking_price) * 100
    : 0;
  const score = r.negotiability_score;
  const message = scoreMessage(score);
  const ceilingRisk = hasCeilingRisk(r);
  const ceilingPct = ceilingRisk ? ceilingEstFloorPct(r) : null;
  return (
    <AnswerCardShell kicker="Your Best Deal">
      <div className="answerHeaderRow">
        <Link href={`/dashboard/${encodeAddress(home.address)}`} className="answerAddress">
          {home.address}
        </Link>
      </div>
      <div className="bestDealRow">
        <div className="bestDealStat">
          {ceilingRisk ? (
            <HoverTooltip title={CEILING_TOOLTIP_TITLE} body={CEILING_TOOLTIP_BODY}>
              <span className="answerBigStat answerStatAmber">
                {ceilingPct != null
                  ? `~${ceilingPct.toFixed(0)}% below ask`
                  : "Est. floor"}
              </span>
            </HoverTooltip>
          ) : (
            <>
              <div className="answerBigStat answerStatGreen">
                {gapPct.toFixed(1)}% below ask
              </div>
              <div className="offerGapSubMoney">{formatMoney(gapDollars)} gap</div>
            </>
          )}
        </div>
        <ScoreGauge score={score} />
      </div>
      {message && <div className="bestDealMessage">{message}</div>}
      {(() => {
        const ns = nextStepFor(score, r.days_on_market);
        if (!ns) return null;
        return (
          <p className="bestDealNextStep">
            <em>
              Next step: {ns.label}
              {ns.linkLabel && (
                <>
                  {" — "}
                  <Link
                    href={`/dashboard/${encodeAddress(home.address)}`}
                    className="bestDealNextStepLink"
                  >
                    {ns.linkLabel} →
                  </Link>
                </>
              )}
            </em>
          </p>
        );
      })()}
      <div className="bestDealSignals">
        {r.days_on_market != null && (
          <span className="bestDealSignal">
            {r.days_on_market} days on market
          </span>
        )}
        {r.price_cuts != null && r.price_cuts > 0 && (
          <span className="bestDealSignal">
            {r.price_cuts} price cut{r.price_cuts === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <Link href={`/dashboard/${encodeAddress(home.address)}`} className="answerLink">
        View report →
      </Link>
    </AnswerCardShell>
  );
}

/* ===================== CARD 2 — VALUE BREAKDOWN with race bars ===================== */

function ValueBreakdownCard({ unlockedHomes }) {
  if (unlockedHomes.length === 0) {
    return (
      <EmptyAnswerCard
        kicker="Value Breakdown"
        message="Unlock reports to compare price per square foot across your list."
      />
    );
  }

  // For each category, pick the SINGLE winner across the user's list:
  //   - cheapest $/sqft living
  //   - cheapest $/sqft lot
  //   - highest land arbitrage score (land play)
  const livingWinner = unlockedHomes
    .filter((h) => Number(h.report?.price_per_living_sqft) > 0)
    .reduce((best, h) => {
      const v = Number(h.report.price_per_living_sqft);
      if (!best || v < best.v) return { home: h, v };
      return best;
    }, null);

  const lotWinner = unlockedHomes
    .filter((h) => Number(h.report?.price_per_lot_sqft) > 0)
    .reduce((best, h) => {
      const v = Number(h.report.price_per_lot_sqft);
      if (!best || v < best.v) return { home: h, v };
      return best;
    }, null);

  const landWinner = unlockedHomes
    .filter((h) => Number(h.report?.land_arbitrage_score) > 0)
    .reduce((best, h) => {
      const v = Number(h.report.land_arbitrage_score);
      if (!best || v > best.v) return { home: h, v };
      return best;
    }, null);

  if (!livingWinner && !lotWinner && !landWinner) {
    return (
      <AnswerCardShell kicker="Value Breakdown">
        <div className="answerEmpty">
          $/sqft data appears once fresh reports include the new fields.
        </div>
        <a href="#ranked-homes" className="answerLink valueFullLink">
          Full breakdown →
        </a>
      </AnswerCardShell>
    );
  }

  return (
    <AnswerCardShell kicker="Value Breakdown">
      {livingWinner && (
        <ValueWinnerRow
          label="$/sqft living"
          home={livingWinner.home}
          value={`$${Math.round(livingWinner.v).toLocaleString()}`}
        />
      )}
      {lotWinner && (
        <ValueWinnerRow
          label="$/sqft lot"
          home={lotWinner.home}
          value={`$${Math.round(lotWinner.v).toLocaleString()}`}
        />
      )}
      {landWinner && (
        <ValueWinnerRow
          label="Land play"
          home={landWinner.home}
          value={`${formatFinalScore(landWinner.v)}/10`}
        />
      )}
      <a href="#ranked-homes" className="answerLink valueFullLink">
        Full breakdown →
      </a>
    </AnswerCardShell>
  );
}

// One stat row per category: label, the winning address, the value as
// a green full bar. Mirrors the layout of the True Monthly Cost rows
// so all three cards read consistently.
function ValueWinnerRow({ label, home, value }) {
  return (
    <div className="valueWinnerRow">
      <div className="valueWinnerMeta">
        <span className="valueWinnerLabel">{label}</span>
        <span className="valueWinnerValue">{value}</span>
      </div>
      <div className="valueWinnerAddr">{shortAddress(home.address)}</div>
      <div className="monthlyBar">
        <div className="monthlyBarSeg valueSegBelow" style={{ width: "100%" }} />
      </div>
    </div>
  );
}

/* ===================== CARD 3 — TRUE MONTHLY COST ===================== */

function TrueMonthlyCostCard({ unlockedHomes }) {
  const homesWithTotal = unlockedHomes
    .filter((h) => h.report?.estimated_monthly_total != null)
    .map((h) => ({ ...h, _m: Number(h.report.estimated_monthly_total) }))
    .sort((a, b) => a._m - b._m);

  // Count all unlocked homes with tax reassessment risk so we can show a
  // single summary line at the bottom of the card instead of an inline
  // warning under every affected row.
  const taxRiskCount = unlockedHomes.filter((h) => hasTaxRisk(h.report)).length;

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
  // Scale every bar against the same axis: max monthly = 100%. Within each
  // bar, three segments stack proportionally for mortgage / taxes /
  // insurance (and HOA if present).
  const axis = Math.max(1, max);

  // Show ALL homes with reports — those without monthly totals render
  // a "Data pending" stub row instead of being filtered out, so the
  // card represents the user's entire list.
  const pendingHomes = unlockedHomes.filter(
    (h) => h.report?.estimated_monthly_total == null
  );
  const visibleHomes = [...homesWithTotal, ...pendingHomes];
  const anyHasHoa = homesWithTotal.some(
    (h) => Number(h.report?.hoa_monthly) > 0
  );

  return (
    <AnswerCardShell kicker="True Monthly Cost">
      <div className="answerBigStat">
        {formatMoney(min)} – {formatMoney(max)}
        <span className="monthlyPerMo">/mo</span>
      </div>
      <div className="monthlyBars">
        {visibleHomes.map((h) => {
          const r = h.report || {};
          // Pending stub: home has report metadata but no monthly total.
          if (r.estimated_monthly_total == null) {
            return (
              <div key={h.id} className="monthlyRow monthlyRowPending">
                <div className="monthlyMeta">
                  <span className="monthlyAddr">{shortAddress(h.address)}</span>
                  <span className="monthlyVal monthlyValMuted">—</span>
                </div>
                <div className="monthlyPendingNote">Data pending</div>
              </div>
            );
          }
          const mort = Number(r.estimated_monthly_mortgage) || 0;
          const tax = (Number(r.annual_taxes_projected) || 0) / 12;
          const ins = Number(r.estimated_monthly_insurance) || 0;
          const hoa = Number(r.hoa_monthly) || 0;
          const mortPct = (mort / axis) * 100;
          const taxPct = (tax / axis) * 100;
          const insPct = (ins / axis) * 100;
          const hoaPct = (hoa / axis) * 100;
          const taxRisk = hasTaxRisk(r);
          // Offer-to-monthly breakdown for the hover tooltip — recompute
          // at offer_low and offer_high using the same assumptions so the
          // user can see how the carry scales across the recommended range.
          const isFlood = r.flood_zone && /^[AV]/i.test(String(r.flood_zone));
          const lowMonthly =
            r.offer_low != null
              ? approxMonthly(Number(r.offer_low), { hoa, isFlood })
              : null;
          const highMonthly =
            r.offer_high != null
              ? approxMonthly(Number(r.offer_high), { hoa, isFlood })
              : null;
          const diff =
            lowMonthly != null && highMonthly != null
              ? Math.abs(highMonthly - lowMonthly)
              : null;
          const tooltipBody =
            lowMonthly != null && highMonthly != null
              ? `At ${formatMoney(Number(r.offer_low))} offer: ${formatMoney(lowMonthly)}/mo · At ${formatMoney(Number(r.offer_high))} offer: ${formatMoney(highMonthly)}/mo · Difference: ${formatMoney(diff)}/mo`
              : `Mortgage ${formatMoney(mort)}/mo · Taxes ${formatMoney(Math.round(tax))}/mo · Insurance ${formatMoney(ins)}/mo${hoa > 0 ? ` · HOA ${formatMoney(hoa)}/mo` : ""}`;
          return (
            <div key={h.id} className="monthlyRow">
              <div className="monthlyMeta">
                <span className="monthlyAddr">
                  {shortAddress(h.address)}
                  {taxRisk && (
                    <span
                      className="monthlyAddrFlag"
                      title={`Projected taxes (${formatMoney(Number(r.annual_taxes_projected))}/yr) are >25% AND >$2,000/yr above current (${formatMoney(Number(r.annual_taxes_current))}/yr).`}
                    >
                      {" "}⚠
                    </span>
                  )}
                </span>
                <span className="monthlyVal">{formatMoney(h._m)}</span>
              </div>
              <div className="monthlyBar" title={tooltipBody}>
                {mortPct > 0 && (
                  <div
                    className="monthlyBarSeg monthlySegMortgage"
                    style={{ width: `${mortPct}%` }}
                  />
                )}
                {taxPct > 0 && (
                  <div
                    className="monthlyBarSeg monthlySegTax"
                    style={{ width: `${taxPct}%` }}
                  />
                )}
                {insPct > 0 && (
                  <div
                    className="monthlyBarSeg monthlySegIns"
                    style={{ width: `${insPct}%` }}
                  />
                )}
                {hoaPct > 0 && (
                  <div
                    className="monthlyBarSeg monthlySegHoa"
                    style={{ width: `${hoaPct}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="monthlyLegend">
        <span className="monthlyLegendItem">
          <span className="monthlyLegendSwatch swatchMortgage" /> Mortgage
        </span>
        <span className="monthlyLegendItem">
          <span className="monthlyLegendSwatch swatchTax" /> Taxes
        </span>
        <span className="monthlyLegendItem">
          <span className="monthlyLegendSwatch swatchIns" /> Insurance
        </span>
        {anyHasHoa && (
          <span className="monthlyLegendItem">
            <span className="monthlyLegendSwatch swatchHoa" /> HOA
          </span>
        )}
      </div>
      {taxRiskCount > 0 && (
        <div className="taxFlagSummary">
          ⚠ {taxRiskCount} {taxRiskCount === 1 ? "home has" : "homes have"} tax reassessment risk
        </div>
      )}
      <div className="answerSubline">
        Estimates: 20% down, 6.8% 30yr fixed + projected post-sale tax reassessment.
      </div>
    </AnswerCardShell>
  );
}

/* ===================== RANKED TABLE ===================== */

function SortHeader({ label, sortKey, activeKey, dir, onSort, className }) {
  if (!sortKey) {
    return <th className={className}>{label}</th>;
  }
  const active = sortKey === activeKey;
  return (
    <th
      className={`sortableTh ${active ? "sortableThActive" : ""} ${className || ""}`}
      onClick={() => onSort(sortKey)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
    >
      <span className="sortableLabel">{label}</span>
      <span className="sortArrow" aria-hidden="true">
        {active ? (dir === "asc" ? "▲" : "▼") : ""}
      </span>
    </th>
  );
}

function RankedTable({
  ranked,
  maxSavings,
  psfByMarket,
  selectedSet,
  sortKey,
  sortDir,
  onSort,
  onToggleCompare,
  onUnlock,
  onRemove,
  onRetryAnalyze,
  onReanalyze,
  pendingAddress,
  credits,
  unlimited,
}) {
  // Rank is position in the CURRENT sort order — only assigned to rows
  // whose active sort value is non-null (locked / missing-data rows get
  // a — instead of a number).
  let rankCounter = 0;
  return (
    <div className="rankedWrap">
      <div className="rankedTableScroll">
        <table className="rankedTable">
          <thead>
            <tr>
              <th className="rankedColRank">#</th>
              <th className="rankedColProp">Property</th>
              <th className="rankedColNeighborhood">Neighborhood</th>
              <th className="rankedColPriceHistory">Price history</th>
              <SortHeader label="Asking"      sortKey="asking"        activeKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Offer range" sortKey="offer_range"   activeKey={sortKey} dir={sortDir} onSort={onSort} className="rankedColOfferRange" />
              <SortHeader label="Gap %"       sortKey="offer_gap_pct" activeKey={sortKey} dir={sortDir} onSort={onSort} className="rankedColGapPct" />
              <SortHeader label="$/sqft"      sortKey="psf"           activeKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="$/lot"       sortKey="lot_psf"       activeKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader
                label={
                  <>
                    Score{" "}
                    <HoverTooltip
                      title="Negotiability Score (1–10)"
                      body="Weighted combination of days on market, price-cut history, comp $/sqft gap, Zestimate gap, and listing-language signals. 7+ = strong leverage. 4–6 = moderate. Below 4 = limited room."
                    >
                      <span className="colInfoIcon" onClick={(e) => e.stopPropagation()}>ⓘ</span>
                    </HoverTooltip>
                  </>
                }
                sortKey="score"
                activeKey={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <SortHeader label="DOM"         sortKey="dom"           activeKey={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Monthly"     sortKey="monthly"       activeKey={sortKey} dir={sortDir} onSort={onSort} />
              <th className="rankedColDeal">Deal</th>
              <th className="rankedColView"></th>
              <th className="rankedColRefresh"></th>
              <th className="rankedColRemove"></th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((h) => {
              const sortVal = getSortValue(h, sortKey);
              const hasRank = sortVal != null;
              if (hasRank) rankCounter += 1;
              return (
                <RankedRow
                  key={h.id}
                  home={h}
                  rank={hasRank ? rankCounter : null}
                  maxSavings={maxSavings}
                  psfByMarket={psfByMarket}
                  selected={selectedSet.has(h.id)}
                  onToggleCompare={() => onToggleCompare(h.id)}
                  onUnlock={() => onUnlock(h)}
                  onRemove={() => onRemove(h.id)}
                  onRetryAnalyze={() =>
                    onRetryAnalyze && onRetryAnalyze(h.id, h.address, h.listing_url)
                  }
                  onReanalyze={() =>
                    onReanalyze && onReanalyze(h.id, h.address, h.listing_url)
                  }
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
  selected, onToggleCompare, onUnlock, onRemove, onRetryAnalyze, onReanalyze,
  pending, credits, unlimited,
}) {
  const analyzing = home.status === "pending";
  const failedAnalysis = home.status === "failed";
  const r = home.report || {};
  const unlocked = home.has_access && home.report;
  const submarket = getMarketKey(r);
  const dot = unlocked ? dotColorForScore(r.negotiability_score) : "muted";

  // Diagnostic: log score components per home so we can verify the
  // weighted formula is producing the expected 1-10 range. Only logs
  // for unlocked homes with a score_breakdown.
  if (typeof window !== "undefined" && unlocked && r.score_breakdown) {
    console.log(`[score:${home.address}]`, {
      final: r.negotiability_score,
      breakdown: r.score_breakdown,
    });
  }
  const ceilingRisk = unlocked && hasCeilingRisk(r);
  const ceilingFloorPct = ceilingRisk ? ceilingEstFloorPct(r) : null;
  const priceChange = unlocked ? parseLatestPriceChange(r) : null;
  // Deal bar tracks negotiability score directly: 9.0 → 90% width, 4.6 → 46%.
  const negScore = unlocked ? Number(r.negotiability_score) : null;
  const dealPct =
    negScore != null && !isNaN(negScore)
      ? Math.max(2, Math.min(100, Math.round(negScore * 10)))
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
        <div className="rankPropTop">
          <Link href={`/dashboard/${encodeAddress(home.address)}`} className="rankAddress">
            {home.address}
          </Link>
          {home.listing_url && (
            <a
              href={home.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rankListingLink"
              title={
                unlocked && r.generated_at
                  ? `Open original listing · analysis updated ${formatShortDate(r.generated_at)}`
                  : "Open original listing in a new tab"
              }
              aria-label="Open original listing"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      </td>
      <td className="rankedColNeighborhood">
        {submarket ? (
          <span className="rankNeighborhood">{submarket}</span>
        ) : (
          <span className="dashMuted">—</span>
        )}
      </td>
      <td className="rankedColPriceHistory">
        {priceChange && priceChange.delta !== 0 ? (
          <span
            className={`rankPriceChange ${priceChange.delta < 0 ? "priceChangeCut" : "priceChangeUp"}`}
            title={`${formatMoney(priceChange.oldPrice)} → ${formatMoney(priceChange.newPrice)}`}
          >
            {priceChange.delta < 0 ? "↓" : "↑"} {priceChange.delta < 0 ? "cut" : "raised"} {formatShortDollars(priceChange.delta)} {priceChange.when}
          </span>
        ) : (
          <span className="dashMuted">—</span>
        )}
      </td>
      <td>
        <span className="rankAsk">{r.asking_price ? formatMoneyFull(r.asking_price) : "—"}</span>
      </td>
      <td className="rankedColOfferRange">
        {unlocked ? (
          <span className="rankOffer">
            {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
          </span>
        ) : (
          <span className="dashBlur">$X,XXX,XXX</span>
        )}
      </td>
      <td className="rankedColGapPct">
        {unlocked && ceilingRisk ? (
          <HoverTooltip title={CEILING_TOOLTIP_TITLE} body={CEILING_TOOLTIP_BODY}>
            <span className="rankCeilingFloor">
              {ceilingFloorPct != null
                ? `~${ceilingFloorPct.toFixed(0)}% below ask`
                : "Est. floor"}
            </span>
          </HoverTooltip>
        ) : unlocked && home.savings != null && r.asking_price ? (
          <span className="rankGapPctSolo">
            {((home.savings / r.asking_price) * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="dashBlur">XX%</span>
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
          <HoverTooltip
            title="Negotiability score"
            body={<ScoreTooltipBody />}
          >
            <span className="rankScore">
              <span className={`scoreDot scoreDot_${dot}`} />
              {formatFinalScore(r.negotiability_score)}
            </span>
          </HoverTooltip>
        ) : (
          <span className="dashBlur">X</span>
        )}
      </td>
      <td>
        {unlocked ? <span className="rankDom">{r.days_on_market ?? "—"}</span> : <span className="dashBlur">XXX</span>}
      </td>
      <td>
        {unlocked && r.estimated_monthly_total != null ? (
          <span className="rankMonthly">
            {formatMoney(r.estimated_monthly_total)}
            {hasTaxRisk(r) && (
              <span
                className="taxFlagSmall rankMonthlyTaxFlag"
                title="Projected post-sale taxes are more than 25% above current bill"
              >
                ⚠
              </span>
            )}
          </span>
        ) : (
          <span className="dashMuted">—</span>
        )}
      </td>
      <td className="rankedColDeal">
        {unlocked && negScore != null && !isNaN(negScore) ? (
          <div className="dealBar" title={`Negotiability ${negScore.toFixed(1)}/10`} aria-label={`Negotiability score ${negScore} out of 10`}>
            <div className="dealBarFill" style={{ width: `${dealPct}%` }} />
          </div>
        ) : (
          <span className="dashBlur">▬▬▬</span>
        )}
      </td>
      <td className="rankedColView">
        {unlocked ? (
          <Link href={`/dashboard/${encodeAddress(home.address)}`} className="rankViewBtn">
            View →
          </Link>
        ) : analyzing ? (
          <span className="rankAnalyzingBadge" aria-live="polite" title="Claude is analyzing this listing — should complete within ~60s">
            <span className="rankAnalyzingSpinner" />
            Analyzing…
          </span>
        ) : failedAnalysis ? (
          <button
            type="button"
            className="rankUnlockBtn rankUnlockBtnFailed"
            onClick={onRetryAnalyze}
            disabled={pending || !home.listing_url}
            title={home.last_error ? `Analysis failed: ${home.last_error}` : "Retry analysis"}
          >
            ⚠ Retry
          </button>
        ) : !home.report_exists ? (
          <button
            type="button"
            className="rankUnlockBtn"
            onClick={onRetryAnalyze}
            disabled={pending || !home.listing_url}
            title={!home.listing_url ? "Need a listing URL to re-run analysis" : "Re-run Claude analysis"}
          >
            Retry
          </button>
        ) : (
          <button type="button" className="rankUnlockBtn" onClick={onUnlock} disabled={pending}>
            <LockIcon size={11} />
            {pending ? "..." : unlockLabel(home, credits, unlimited)}
          </button>
        )}
      </td>
      <td className="rankedColRefresh">
        {unlocked && (
          <button
            type="button"
            className="rankRefreshBtn"
            onClick={onReanalyze}
            disabled={pending || !home.listing_url}
            title={
              !home.listing_url
                ? "Need a listing URL to re-analyze"
                : "Re-run Claude analysis with fresh data"
            }
            aria-label="Re-analyze this home"
          >
            <RefreshIcon />
          </button>
        )}
      </td>
      <td className="rankedColRemove">
        <button
          type="button"
          className="rankRemoveBtn"
          onClick={onRemove}
          aria-label="Remove"
          title="Remove"
        >
          ×
        </button>
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

function breakdownTooltip(breakdown, score) {
  if (!breakdown || typeof breakdown !== "object") {
    return score != null ? `Negotiability score ${formatScore(score)}/10` : "";
  }
  const parts = [];
  if (breakdown.dom_score != null) parts.push(`DOM ${formatScore(breakdown.dom_score)}/10`);
  if (breakdown.price_cut_score != null) parts.push(`Cuts ${formatScore(breakdown.price_cut_score)}/10`);
  if (breakdown.zestimate_gap_score != null) parts.push(`Zestimate ${formatScore(breakdown.zestimate_gap_score)}/10`);
  if (breakdown.price_per_sqft_score != null) parts.push(`$/sqft ${formatScore(breakdown.price_per_sqft_score)}/10`);
  return parts.join(" · ");
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
            <CompareRow label="Negotiability" cells={comparing.map((h) => `${formatFinalScore(h.report.negotiability_score)} / 10`)} />
            <CompareRow
              label="Land Arbitrage"
              cells={comparing.map((h) => {
                const s = h.report.land_arbitrage_score;
                if (s == null) return "—";
                return (
                  <div key={h.id}>
                    <div>{formatFinalScore(s)} / 10</div>
                    {h.report.land_arbitrage_notes && (
                      <div className="compareLandNotes">
                        {h.report.land_arbitrage_notes}
                      </div>
                    )}
                  </div>
                );
              })}
            />
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
      // Pass the listing_url back so the parent can kick off /api/dashboard/analyze.
      onSaved({ ...json, listing_url: json.listing_url || url });
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
