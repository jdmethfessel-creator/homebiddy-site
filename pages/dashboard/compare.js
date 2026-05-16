import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { scoreReport, formatMoney } from "../../lib/scoring";

export default function Compare() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [homes, setHomes] = useState([]);
  const [selected, setSelected] = useState(new Set());

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

  const loadHomes = useCallback(async (tk) => {
    if (!tk) return;
    const r = await fetch("/api/dashboard/list", { headers: { Authorization: `Bearer ${tk}` } });
    const json = await r.json();
    setHomes(json.homes || []);
  }, []);

  useEffect(() => {
    if (token) loadHomes(token);
  }, [token, loadHomes]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }

  const chosen = homes.filter((h) => selected.has(h.id) && h.has_access && h.report);
  const showCompare = chosen.length >= 2;

  return (
    <>
      <Head>
        <title>Compare homes · HomeBiddy</title>
      </Head>
      <div className="dashRoot">
        <DashboardHeader
          email={user?.email}
          subnav={
            <Link href="/dashboard" className="dashSubLink">← Back to saved homes</Link>
          }
        />
        <main className="dashMain">
          <h1 className="dashTitle">Compare</h1>
          <p className="dashSubtitle">
            Pick 2–5 homes with unlocked reports to compare side-by-side.
          </p>

          <div className="dashSelectList">
            {homes.length === 0 && <div className="dashEmpty">No homes saved yet.</div>}
            {homes.map((h) => {
              const disabled = !h.has_access;
              return (
                <label key={h.id} className={`dashSelectRow${disabled ? " disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(h.id)}
                    onChange={() => toggle(h.id)}
                    disabled={disabled}
                  />
                  <span className="dashSelectAddress">{h.address}</span>
                  {disabled && <span className="dashSelectMuted">no report</span>}
                </label>
              );
            })}
          </div>

          {showCompare && (
            <div className="compareWrap">
              <table className="compareTable">
                <thead>
                  <tr>
                    <th></th>
                    {chosen.map((h) => (
                      <th key={h.id}>
                        <Link href={`/dashboard/${encodeURIComponent(h.address)}`}>
                          {h.address}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Asking" data={chosen.map((h) => formatMoney(h.report.asking_price))} />
                  <Row
                    label="Offer range"
                    data={chosen.map((h) => `${formatMoney(h.report.offer_low)}–${formatMoney(h.report.offer_high)}`)}
                  />
                  <Row
                    label="Negotiability"
                    data={chosen.map((h) => `${h.report.negotiability_score} / 10`)}
                  />
                  <Row label="Days on market" data={chosen.map((h) => h.report.days_on_market)} />
                  <Row label="Price cuts" data={chosen.map((h) => h.report.price_cuts)} />
                  <Row
                    label="Zestimate gap"
                    data={chosen.map((h) => formatMoney(h.report.zestimate_gap))}
                  />
                  <Row
                    label="Beds / Sqft"
                    data={chosen.map((h) => `${h.report.beds} bd · ${h.report.sqft?.toLocaleString()} sqft`)}
                  />
                  <Row
                    label="Neighborhood"
                    data={chosen.map((h) => h.report.neighborhood || "—")}
                  />
                  <Row
                    label="Discount %"
                    data={chosen.map((h) => {
                      const s = scoreReport(h.report);
                      return s ? `${s.discount_pct}%` : "—";
                    })}
                  />
                  <Row
                    label="3-yr upside"
                    data={chosen.map((h) => {
                      const s = scoreReport(h.report);
                      return s ? formatMoney(s.conservative_upside) : "—";
                    })}
                    highlight
                  />
                  <Row
                    label="Value score"
                    data={chosen.map((h) => {
                      const s = scoreReport(h.report);
                      return s ? `${s.score}/100` : "—";
                    })}
                    highlight
                  />
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function Row({ label, data, highlight }) {
  return (
    <tr className={highlight ? "compareHighlight" : ""}>
      <th>{label}</th>
      {data.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  );
}
