import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { formatMoney, formatMoneyFull } from "../../lib/scoring";

// Public, read-only view of someone else's saved homes via a share token.
// No auth, no actions — viewers can browse the table and click through to
// /signup if they want their own. Mirrors the visible-data parts of the
// owner's dashboard without exposing any account or write capability.
export default function SharedDashboard() {
  const router = useRouter();
  const { token } = router.query;
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!token || typeof token !== "string") return;
    fetch(`/api/shared/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setState({
            loading: false,
            error: j.error || `Could not load shared dashboard (${r.status})`,
          });
          return;
        }
        setState({ loading: false, homes: j.homes || [], expires_at: j.expires_at });
      })
      .catch(() => setState({ loading: false, error: "Network error." }));
  }, [token]);

  const homes = state.homes || [];

  return (
    <>
      <Head>
        <title>Shared dashboard · HomeBiddy</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div className="sharedShell">
        <header className="sharedBanner">
          <div>
            <strong>Shared dashboard</strong> · View only · Powered by{" "}
            <Link href="/" className="sharedBannerBrand">HomeBiddy</Link>
          </div>
          <Link href="/signup" className="sharedBannerCta">
            Get your own →
          </Link>
        </header>
        <main className="sharedMain">
          {state.loading && <p className="dashEmpty">Loading shared dashboard…</p>}
          {state.error && (
            <div className="dashNotice dashNoticeWarn">{state.error}</div>
          )}
          {!state.loading && !state.error && (
            <>
              <h1 className="sharedTitle">Saved homes</h1>
              <p className="sharedSub">
                {homes.length === 0
                  ? "No homes saved yet."
                  : `${homes.length} home${homes.length === 1 ? "" : "s"} on this list.`}
              </p>

              {homes.length > 0 && (
                <div className="rankedWrap">
                  <div className="rankedTableScroll">
                    <table className="rankedTable">
                      <thead>
                        <tr>
                          <th className="rankedColRank">#</th>
                          <th className="rankedColProp">Property</th>
                          <th className="rankedColNeighborhood">Neighborhood</th>
                          <th>Asking</th>
                          <th className="rankedColOfferRange">Offer range</th>
                          <th className="rankedColGapPct">Gap %</th>
                          <th>$/sqft</th>
                          <th>$/lot</th>
                          <th>Score</th>
                          <th>DOM</th>
                          <th>Monthly</th>
                        </tr>
                      </thead>
                      <tbody>
                        {homes.map((h, i) => {
                          const r = h.report || {};
                          const unlocked = h.has_access && h.report;
                          const gapPct =
                            unlocked && r.asking_price && r.offer_low
                              ? ((r.asking_price - r.offer_low) / r.asking_price) * 100
                              : null;
                          return (
                            <tr key={h.id}>
                              <td className="rankedColRank">
                                <span className="rankBadgeNum">#{i + 1}</span>
                              </td>
                              <td className="rankedColProp">
                                <div className="rankPropTop">
                                  <span className="rankAddress">{h.address}</span>
                                  {h.listing_url && (
                                    <a
                                      href={h.listing_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rankListingLink"
                                      title="Open original listing"
                                    >
                                      ↗
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="rankedColNeighborhood">
                                {r.neighborhood ? (
                                  <span className="rankNeighborhood">{r.neighborhood}</span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                <span className="rankAsk">
                                  {r.asking_price ? formatMoneyFull(r.asking_price) : "—"}
                                </span>
                              </td>
                              <td className="rankedColOfferRange">
                                {unlocked ? (
                                  <span className="rankOffer">
                                    {formatMoney(r.offer_low)}–{formatMoney(r.offer_high)}
                                  </span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td className="rankedColGapPct">
                                {gapPct != null ? (
                                  <span className="rankGapPctSolo">{gapPct.toFixed(1)}%</span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                {unlocked && r.price_per_living_sqft ? (
                                  <span className="rankPsf">
                                    ${Math.round(Number(r.price_per_living_sqft)).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                {unlocked && r.price_per_lot_sqft ? (
                                  <span className="rankPsf">
                                    ${Math.round(Number(r.price_per_lot_sqft)).toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                {unlocked && r.negotiability_score != null ? (
                                  <span className="rankScore">{Number(r.negotiability_score).toFixed(1)}</span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                {unlocked && r.days_on_market != null ? (
                                  <span className="rankDom">{r.days_on_market}</span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                              <td>
                                {unlocked && r.estimated_monthly_total != null ? (
                                  <span className="rankMonthly">
                                    {formatMoney(r.estimated_monthly_total)}
                                  </span>
                                ) : (
                                  <span className="dashMuted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <footer className="sharedFooter">
                <p>Want to track your own home search?</p>
                <Link href="/signup" className="goButton">Create a free account</Link>
              </footer>
            </>
          )}
        </main>
      </div>
    </>
  );
}
