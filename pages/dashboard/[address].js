import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { scoreReport, formatMoney, formatMoneyFull } from "../../lib/scoring";

export default function HomeReport() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [state, setState] = useState({ loading: true });

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
            </article>
          )}
        </main>
      </div>
    </>
  );
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
