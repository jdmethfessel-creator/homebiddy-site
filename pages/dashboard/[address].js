import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { scoreReport, formatMoney, formatMoneyFull } from "../../lib/scoring";

// Reserved URL segments that should bounce back to /dashboard rather than be
// treated as a property address. /dashboard/compare used to be a real page;
// keep it bookmarkable by redirecting it onto the new inline experience.
const RESERVED_SEGMENTS = new Set(["compare", "add", "new", "index"]);

// Canonical saved addresses always have a digit (the street number) and a
// comma (between street and city). Treat anything missing both as not-an-
// address and bounce to /dashboard.
function looksLikeAddress(s) {
  return /\d/.test(s) && /,/.test(s);
}

export default function HomeReport() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [state, setState] = useState({ loading: true });

  // Redirect reserved or empty-looking segments to /dashboard before
  // anything else runs.
  useEffect(() => {
    if (!router.isReady) return;
    const seg = router.query.address;
    if (
      typeof seg === "string" &&
      (RESERVED_SEGMENTS.has(seg.toLowerCase()) || !looksLikeAddress(seg))
    ) {
      router.replace("/dashboard");
    }
  }, [router.isReady, router.query.address, router]);

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
  }, [router]);

  useEffect(() => {
    if (!token || !router.query.address) return;
    const address = router.query.address;
    fetch(`/api/dashboard/report?address=${encodeURIComponent(address)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json().then((json) => ({ status: r.status, json })))
      .then(({ status, json }) => {
        if (status === 403) {
          setState({ noAccess: true, address });
        } else if (json.pending) {
          setState({ pending: true, address });
        } else {
          setState({ report: json.report, address });
        }
      })
      .catch(() => setState({ error: true }));
  }, [token, router.query.address]);

  async function buyAccess() {
    if (!token) return;
    const r = await fetch("/api/dashboard/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ address: state.address }),
    });
    const json = await r.json();
    if (json.url) window.location.href = json.url;
    else alert(json.error || "Could not start checkout");
  }

  const report = state.report;
  const scoring = report ? scoreReport(report) : null;
  const reportData = report?.data || {};

  return (
    <>
      <Head>
        <title>{state.address || "Report"} · HomeBiddy</title>
      </Head>
      <div className="dashRoot">
        <DashboardHeader
          email={user?.email}
          subnav={<Link href="/dashboard" className="dashSubLink">← Back to saved homes</Link>}
        />
        <main className="dashMain">
          {state.loading && <div className="dashEmpty">Loading…</div>}

          {state.noAccess && (
            <div className="dashUnlock">
              <h1 className="dashTitle">{state.address}</h1>
              <p className="dashSubtitle">You haven&rsquo;t unlocked this report yet.</p>
              <button className="goButton" onClick={buyAccess} type="button">
                Unlock report · $19.99
              </button>
            </div>
          )}

          {state.pending && (
            <div className="dashUnlock">
              <h1 className="dashTitle">{state.address}</h1>
              <p className="dashSubtitle">
                Your report is being prepared. We&rsquo;ll email you when it&rsquo;s ready
                (usually within 2 minutes of payment).
              </p>
            </div>
          )}

          {report && (
            <article className="dashReport">
              <h1 className="dashTitle">{state.address}</h1>
              <p className="dashSubtitle">
                {report.beds} bd · {report.baths} ba · {report.sqft?.toLocaleString()} sqft
                {report.neighborhood ? ` · ${report.neighborhood}` : ""}
              </p>

              <div className="dashPriceCard">
                <div>
                  <div className="dashCardKicker">Asking</div>
                  <div className="dashAskingValue">{formatMoneyFull(report.asking_price)}</div>
                </div>
                <div className="dashOfferBox">
                  <div className="dashCardKicker">Recommended offer</div>
                  <div className="dashOfferValue">
                    {formatMoneyFull(report.offer_low)} – {formatMoneyFull(report.offer_high)}
                  </div>
                </div>
              </div>

              <CeilingRiskCard report={report} />


              <div className="dashStatGrid">
                <Stat label="Negotiability" value={`${report.negotiability_score} / 10`} hint="Seller flexibility" />
                <Stat label="Days on Market" value={report.days_on_market} hint="Listing age" />
                <Stat label="Price cuts" value={report.price_cuts} hint="Seller reductions" />
                <Stat label="Zestimate gap" value={formatMoney(report.zestimate_gap)} hint="Asking over estimate" />
              </div>

              {scoring && (
                <div className="dashUpsideCard">
                  <div className="dashUpsideKicker">Conservative 3-year value</div>
                  <div className="dashUpsideAmount">{formatMoneyFull(scoring.projected_value_3yr)}</div>
                  <div className="dashUpsideMeta">
                    Estimated <strong>{formatMoneyFull(scoring.estimated_equity)}</strong> in equity ·
                    {" "}value score <strong>{scoring.score}/100</strong>
                  </div>
                </div>
              )}

              {Array.isArray(reportData.insights) && (
                <>
                  <h2 className="dashH2">Why This Number</h2>
                  <ol className="dashInsights">
                    {reportData.insights.map((line, i) => (
                      <li key={i} className="dashInsight">
                        <span className="dashInsightNum">{i + 1}</span>
                        <span className="dashInsightBody">{line}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {reportData.script && (
                <>
                  <h2 className="dashH2">Negotiation Script</h2>
                  <div className="dashScript">&ldquo;{reportData.script}&rdquo;</div>
                </>
              )}

              {Array.isArray(reportData.questions) && (
                <>
                  <h2 className="dashH2">3 Questions to Ask the Listing Agent</h2>
                  <ol className="dashQuestions">
                    {reportData.questions.map((q, i) => (
                      <li key={i}>
                        <span className="dashQNum">{i + 1}</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {Array.isArray(reportData.comps) && (
                <>
                  <h2 className="dashH2">Recent Closed Comps</h2>
                  <div className="dashTableWrap">
                    <table className="dashCompTable">
                      <thead>
                        <tr>
                          <th>Address</th>
                          <th>Beds</th>
                          <th>Sqft</th>
                          <th>Sold</th>
                          <th>$/Sqft</th>
                          <th>DOM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.comps.map((c, i) => (
                          <tr key={i}>
                            <td>{c.address}</td>
                            <td className="num">{c.beds}</td>
                            <td className="num">{c.sqft?.toLocaleString()}</td>
                            <td className="num">{formatMoney(c.sold)}</td>
                            <td className="num">${c.psf}</td>
                            <td className="num">{c.dom}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {reportData.tiles && (
                <div className="dashTileGrid">
                  <Tile label="Comp avg $/sqft" value={`$${reportData.tiles.comp_avg_psf}`} />
                  <Tile label="Comp median sale" value={formatMoney(reportData.tiles.comp_median_sale)} />
                  <Tile label="Suggested under ask" value={`${reportData.tiles.suggested_under_ask_pct}%`} />
                  <Tile label="Median DOM" value={reportData.tiles.median_dom} />
                </div>
              )}

              <LifestyleSection report={report} />
              <NegotiabilityBreakdown report={report} />
              <LandBreakdown report={report} />
              <OfferLetterButton report={report} token={token} />
            </article>
          )}
        </main>
      </div>
    </>
  );
}

// ============== Score-breakdown tables shown at bottom of the page ==============

function NegotiabilityBreakdown({ report }) {
  const bd = report?.score_breakdown;
  if (!bd || typeof bd !== "object") return null;
  // Definition with both new and legacy field names so older rows still
  // render. Each entry shows a label + weight + score + 'why' explanation.
  const defs = [
    {
      name: "Days on market",
      weight: "25%",
      scoreKey: "dom_score",
      noteKey: "dom_note",
      legacyScoreKey: null,
    },
    {
      name: "Price history",
      weight: "20%",
      scoreKey: "price_history_score",
      noteKey: "price_history_note",
      legacyScoreKey: "price_cut_score",
    },
    {
      name: "$/sqft vs closed comps",
      weight: "25%",
      scoreKey: "comp_psf_score",
      noteKey: "comp_psf_note",
      legacyScoreKey: "price_per_sqft_score",
    },
    {
      name: "Zestimate gap",
      weight: "15%",
      scoreKey: "zestimate_gap_score",
      noteKey: "zestimate_gap_note",
      legacyScoreKey: null,
    },
    {
      name: "Listing language",
      weight: "15%",
      scoreKey: "listing_signals_score",
      noteKey: "listing_signals_note",
      legacyScoreKey: null,
    },
  ];
  const rows = defs
    .map((d) => {
      const score =
        bd[d.scoreKey] != null
          ? bd[d.scoreKey]
          : d.legacyScoreKey && bd[d.legacyScoreKey] != null
          ? bd[d.legacyScoreKey]
          : null;
      return {
        name: d.name,
        weight: d.weight,
        score,
        note: bd[d.noteKey] || null,
      };
    })
    .filter((r) => r.score != null);
  if (rows.length === 0) return null;
  return (
    <section className="dashBreakdownSection">
      <h2 className="dashH2">How your negotiability score was calculated</h2>
      <BreakdownTable rows={rows} total={report.negotiability_score} totalLabel="Final score" />
    </section>
  );
}

function LandBreakdown({ report }) {
  const bd = report?.data?.land_score_breakdown;
  if (!bd || typeof bd !== "object") return null;
  const defs = [
    { name: "Lot $/sqft vs neighborhood median", weight: "30%", scoreKey: "lot_psf_score", noteKey: "lot_psf_note" },
    { name: "Lot size vs median", weight: "25%", scoreKey: "lot_size_score", noteKey: "lot_size_note" },
    { name: "Structure condition", weight: "25%", scoreKey: "condition_score", noteKey: "condition_note" },
    { name: "Renovation / ADU upside", weight: "20%", scoreKey: "upside_score", noteKey: "upside_note" },
  ];
  const rows = defs
    .map((d) => ({
      name: d.name,
      weight: d.weight,
      score: bd[d.scoreKey] != null ? bd[d.scoreKey] : null,
      note: bd[d.noteKey] || null,
    }))
    .filter((r) => r.score != null);
  if (rows.length === 0) return null;
  return (
    <section className="dashBreakdownSection">
      <h2 className="dashH2">How your land arbitrage score was calculated</h2>
      <BreakdownTable rows={rows} total={report.land_arbitrage_score} totalLabel="Final score" />
    </section>
  );
}

function BreakdownTable({ rows, total, totalLabel }) {
  return (
    <div className="dashBreakdownWrap">
      <table className="dashBreakdownTable">
        <thead>
          <tr>
            <th>Signal</th>
            <th className="dashBreakdownNum">Weight</th>
            <th className="dashBreakdownNum">Score</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="dashBreakdownName">{r.name}</td>
              <td className="dashBreakdownNum">{r.weight}</td>
              <td className="dashBreakdownNum dashBreakdownScore">
                {formatBreakdownScore(r.score)}/10
              </td>
              <td className="dashBreakdownNote">
                {r.note || <span className="dashBreakdownEmpty">—</span>}
              </td>
            </tr>
          ))}
          {total != null && (
            <tr className="dashBreakdownTotal">
              <td colSpan="2">{totalLabel}</td>
              <td className="dashBreakdownNum dashBreakdownScore">
                {formatBreakdownScore(total)}/10
              </td>
              <td></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatBreakdownScore(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function Stat({ label, value, hint }) {
  return (
    <div className="dashStat">
      <div className="dashCardKicker">{label}</div>
      <div className="dashStatValue">{value}</div>
      {hint && <div className="dashStatHint">{hint}</div>}
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="dashTile">
      <div className="dashTileValue">{value}</div>
      <div className="dashTileLabel">{label}</div>
    </div>
  );
}

// Renovated-outlier insight card. Renders only when Claude has flagged the
// report's neighborhood_ceiling_risk. Amber styling because this is an
// INSIGHT, not a warning — it reframes how to read the offer range, it
// doesn't say the listing is broken.
function CeilingRiskCard({ report }) {
  if (!report?.data?.neighborhood_ceiling_risk) return null;
  const ask = Number(report.asking_price);
  const floor = Number(report.data.est_floor);
  const pct = ask && floor ? ((ask - floor) / ask) * 100 : null;
  const note =
    report.data.ceiling_risk_note ||
    "This home appears to be a renovated outlier in its neighborhood. Comps reflect an up-and-coming area where unrenovated homes sell at lower $/sqft. The seller likely has a renovation cost floor above what pure comp analysis supports.";
  return (
    <aside className="ceilingCard" aria-label="Neighborhood ceiling risk insight">
      <div className="ceilingCardHead">
        <span className="ceilingCardBadge">⚠ Renovated outlier</span>
        <span className="ceilingCardKicker">Neighborhood ceiling risk</span>
      </div>
      <p className="ceilingCardBody">{note}</p>
      {floor > 0 && (
        <div className="ceilingCardFloor">
          <span className="ceilingCardFloorLabel">Est. seller floor</span>
          <span className="ceilingCardFloorValue">
            {formatMoneyFull(floor)}
            {pct != null && (
              <span className="ceilingCardFloorPct">
                {" "}(~{pct.toFixed(0)}% below ask)
              </span>
            )}
          </span>
        </div>
      )}
      <div className="ceilingCardApproach">
        <div className="ceilingCardApproachLabel">How to negotiate this one</div>
        <p className="ceilingCardApproachBody">
          Don&apos;t lead with the $/sqft comp gap — the seller will dismiss it
          because their finishes aren&apos;t comparable. Anchor on days on
          market and the price-cut history instead. Frame the gap as
          carrying-cost math (taxes, insurance, mortgage rate trend) and ask
          what would help them move sooner.
        </p>
      </div>
    </aside>
  );
}

// Lifestyle + schools section. Renders only when at least one of the
// schema-v7 fields is present on the report.
function LifestyleSection({ report }) {
  if (!report) return null;
  const hasSchools =
    report.elementary_school || report.middle_school || report.high_school;
  const hasLifestyle =
    report.walk_score != null ||
    report.transit_score != null ||
    report.bike_score != null ||
    report.commute_to_downtown_min != null ||
    report.nearest_grocery_min != null;
  if (!hasSchools && !hasLifestyle) return null;
  return (
    <section className="lifestyleSection">
      <h2 className="dashH2">Lifestyle</h2>
      {hasSchools && (
        <p className="lifestyleRow">
          <span className="lifestyleLabel">Schools:</span>{" "}
          {report.elementary_school && (
            <span className="lifestyleChip">
              Elementary <strong>{report.elementary_school}</strong>
              {report.elementary_rating != null && (
                <> {Number(report.elementary_rating).toFixed(0)}/10</>
              )}
            </span>
          )}
          {report.middle_school && (
            <>
              {" · "}
              <span className="lifestyleChip">
                Middle <strong>{report.middle_school}</strong>
                {report.middle_rating != null && (
                  <> {Number(report.middle_rating).toFixed(0)}/10</>
                )}
              </span>
            </>
          )}
          {report.high_school && (
            <>
              {" · "}
              <span className="lifestyleChip">
                High <strong>{report.high_school}</strong>
                {report.high_rating != null && (
                  <> {Number(report.high_rating).toFixed(0)}/10</>
                )}
              </span>
            </>
          )}
        </p>
      )}
      {hasLifestyle && (
        <p className="lifestyleRow">
          <span className="lifestyleLabel">Lifestyle:</span>{" "}
          {report.walk_score != null && <span className="lifestyleChip">Walk <strong>{report.walk_score}</strong></span>}
          {report.transit_score != null && (
            <>{" · "}<span className="lifestyleChip">Transit <strong>{report.transit_score}</strong></span></>
          )}
          {report.bike_score != null && (
            <>{" · "}<span className="lifestyleChip">Bike <strong>{report.bike_score}</strong></span></>
          )}
          {report.commute_to_downtown_min != null && (
            <>{" · "}<span className="lifestyleChip">Downtown <strong>{report.commute_to_downtown_min}</strong> min</span></>
          )}
          {report.nearest_grocery_min != null && (
            <>{" · "}<span className="lifestyleChip">Grocery <strong>{report.nearest_grocery_min}</strong> min</span></>
          )}
        </p>
      )}
    </section>
  );
}

// Generate Offer Letter — opens a modal, calls /api/dashboard/offer-letter
// to render a Claude-written letter, then provides Copy + PDF download.
function OfferLetterButton({ report, token }) {
  const [open, setOpen] = useState(false);
  if (!report?.address) return null;
  return (
    <>
      <div className="offerLetterCta">
        <button
          type="button"
          className="goButton"
          onClick={() => setOpen(true)}
        >
          Generate Offer Letter
        </button>
      </div>
      {open && (
        <OfferLetterModal
          report={report}
          token={token}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function OfferLetterModal({ report, token, onClose }) {
  const [buyer, setBuyer] = useState("");
  const [contingencies, setContingencies] = useState({
    inspection: true,
    financing: true,
    appraisal: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [letter, setLetter] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!buyer.trim()) {
      setError("Enter buyer name(s) before generating.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/offer-letter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          address: report.address,
          buyer: buyer.trim(),
          contingencies,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || `Generation failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setLetter(j.letter || "");
    } catch (err) {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  async function copyLetter() {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
    } catch {
      // Fallback for older browsers — show the letter selected so user can Ctrl+C.
    }
  }

  async function downloadPdf() {
    if (!letter) return;
    const res = await fetch("/api/dashboard/offer-letter-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ letter, address: report.address, buyer }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offer-letter-${report.address.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="overlayCard offerLetterCard">
        <div className="overlayHeader">
          <h2 className="overlayTitle">Generate Offer Letter</h2>
          <p className="overlaySub">{report.address}</p>
        </div>
        {!letter ? (
          <form onSubmit={handleSubmit}>
            <label className="formLabel" htmlFor="ol-buyer">Buyer name(s)</label>
            <input
              id="ol-buyer"
              type="text"
              className="formInput"
              placeholder="e.g. Jordan & Riley Smith"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              autoFocus
            />
            <div className="formLabel" style={{ marginTop: 12 }}>Contingencies</div>
            <div className="contingencyList">
              {["inspection", "financing", "appraisal"].map((key) => (
                <label key={key} className="contingencyOpt">
                  <input
                    type="checkbox"
                    checked={!!contingencies[key]}
                    onChange={(e) =>
                      setContingencies((c) => ({ ...c, [key]: e.target.checked }))
                    }
                  />
                  <span style={{ textTransform: "capitalize" }}>{key}</span>
                </label>
              ))}
            </div>
            {error && <div className="authError" style={{ marginTop: 10 }}>{error}</div>}
            <button type="submit" className="goButton" disabled={submitting} style={{ marginTop: 14 }}>
              {submitting ? "Generating…" : "Generate letter"}
            </button>
          </form>
        ) : (
          <div>
            <pre className="offerLetterText">{letter}</pre>
            <div className="offerLetterActions">
              <button type="button" className="goButton" onClick={copyLetter}>
                Copy
              </button>
              <button type="button" className="goButton" onClick={downloadPdf}>
                Download PDF
              </button>
            </div>
          </div>
        )}
        <button type="button" className="dismissLink" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
