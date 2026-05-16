import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { rankHomes, scoreReport, formatMoney, formatMoneyFull } from "../../lib/scoring";

function encodeAddress(addr) {
  return encodeURIComponent(addr);
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [homes, setHomes] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState(null);

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
      if (!session) {
        router.replace("/login");
      } else {
        setUser(session.user);
        setToken(session.access_token);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const loadHomes = useCallback(async (tk) => {
    if (!tk) return;
    setLoading(true);
    try {
      const r = await fetch("/api/dashboard/list", {
        headers: { Authorization: `Bearer ${tk}` },
      });
      const json = await r.json();
      setHomes(json.homes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) loadHomes(token);
  }, [token, loadHomes]);

  // Handle Stripe return params
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.paid === "1") {
      setNotice({ kind: "paid", address: router.query.address });
      const url = router.pathname;
      router.replace(url, undefined, { shallow: true });
      const t = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(t);
    }
    if (router.query.canceled === "1") {
      setNotice({ kind: "canceled" });
      const url = router.pathname;
      router.replace(url, undefined, { shallow: true });
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
    loadHomes(token);
  }

  async function handlePurchase(home) {
    if (!token) return;
    const r = await fetch("/api/dashboard/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ address: home.address, listing_url: home.listing_url }),
    });
    const json = await r.json();
    if (json.url) {
      window.location.href = json.url;
    } else {
      alert(json.error || "Could not start checkout");
    }
  }

  const ranked = rankHomes(homes.map((h) => ({ ...h, report: h.has_access ? h.report : null })));
  const topRanked = ranked.find((h) => h.scoring);

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
              Payment received. Your report{notice.address ? ` for ${notice.address}` : ""} is being prepared — we&rsquo;ll email you when it&rsquo;s ready (usually under 2 minutes).
            </div>
          )}
          {notice?.kind === "canceled" && (
            <div className="dashNotice dashNoticeWarn">
              Payment canceled. The home is still saved — purchase anytime.
            </div>
          )}

          {topRanked?.scoring && (
            <div className="dashBest">
              <div className="dashBestTag">⭐ Best value</div>
              <Link href={`/dashboard/${encodeAddress(topRanked.address)}`} className="dashBestAddress">
                {topRanked.address}
              </Link>
              <div className="dashBestUpside">
                Conservative 3-year upside:{" "}
                <strong>{formatMoneyFull(topRanked.scoring.conservative_upside)}</strong>{" "}
                based on market comparables.
              </div>
              <div className="dashBestStats">
                <span>Value score <strong>{topRanked.scoring.score}/100</strong></span>
                <span>·</span>
                <span><strong>{topRanked.scoring.discount_pct}%</strong> below ask</span>
                <span>·</span>
                <span>Negotiability <strong>{topRanked.report?.negotiability_score}</strong></span>
              </div>
              <Link href={`/dashboard/${encodeAddress(topRanked.address)}`} className="dashBestCta">
                View full report →
              </Link>
            </div>
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
                onRemove={() => handleRemove(h.id)}
                onPurchase={() => handlePurchase(h)}
              />
            ))}
          </div>
        </main>
      </div>

      {showAdd && (
        <AddHomeModal
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            loadHomes(token);
          }}
          onPurchase={async (address, listing_url) => {
            setShowAdd(false);
            const r = await fetch("/api/dashboard/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ address, listing_url }),
            });
            const json = await r.json();
            if (json.url) window.location.href = json.url;
          }}
        />
      )}
    </>
  );
}

function HomeCard({ home, onRemove, onPurchase }) {
  const scoring = home.has_access && home.report ? scoreReport(home.report) : null;
  return (
    <div className="dashCard">
      <div className="dashCardTop">
        <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardAddress">
          {home.address}
        </Link>
        <button className="dashCardRemove" onClick={onRemove} aria-label="Remove">×</button>
      </div>
      {home.has_access && home.report ? (
        <>
          <div className="dashCardPriceRow">
            <div>
              <div className="dashCardKicker">Asking</div>
              <div className="dashCardPrice">{formatMoney(home.report.asking_price)}</div>
            </div>
            <div className="dashCardOffer">
              <div className="dashCardKicker">Your offer</div>
              <div className="dashCardOfferVal">
                {formatMoney(home.report.offer_low)}–{formatMoney(home.report.offer_high)}
              </div>
            </div>
          </div>
          <div className="dashCardStats">
            <div><span className="dashCardKicker">Score</span><strong>{home.report.negotiability_score}</strong></div>
            <div><span className="dashCardKicker">DOM</span><strong>{home.report.days_on_market}</strong></div>
            {scoring && (
              <div><span className="dashCardKicker">Value</span><strong>{scoring.score}</strong></div>
            )}
          </div>
          <div className="dashCardFooter">
            {home.report.neighborhood && <span className="dashCardNeigh">{home.report.neighborhood}</span>}
            <Link href={`/dashboard/${encodeAddress(home.address)}`} className="dashCardLink">View report →</Link>
          </div>
        </>
      ) : (
        <>
          <div className="dashCardPending">
            <div className="dashCardKicker">Report</div>
            <div className="dashCardPendingText">
              {home.report_exists ? "Available — unlock to view" : "Not yet generated"}
            </div>
          </div>
          <button className="dashCardCta" onClick={onPurchase} type="button">
            Generate report · $19.99
          </button>
        </>
      )}
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
      if (json.has_access || !json.report_exists) {
        onSaved();
      } else {
        // Report exists but user doesn't have access — offer to purchase
        const wantsBuy = confirm(
          `A HomeBiddy report exists for ${json.address}. Unlock it for $19.99?`
        );
        if (wantsBuy) {
          onPurchase(json.address, url);
        } else {
          onSaved();
        }
      }
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
