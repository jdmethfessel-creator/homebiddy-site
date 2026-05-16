import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useCallback, useMemo } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import { getSupabaseClient } from "../../lib/supabase-client";
import { scoreReport, formatMoney, formatPercent } from "../../lib/scoring";

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

  const chosen = useMemo(
    () => homes.filter((h) => selected.has(h.id)),
    [homes, selected]
  );
  const showCompare = chosen.length >= 2;

  // Compute per-home scoring once
  const scored = useMemo(
    () =>
      chosen.map((h) => ({
        ...h,
        scoring: h.has_access && h.report ? scoreReport(h.report) : null,
      })),
    [chosen]
  );

  // Compute winners per row (highest or lowest depending on metric direction).
  const winners = useMemo(() => computeWinners(scored), [scored]);

  return (
    <>
      <Head>
        <title>Compare homes · HomeBiddy</title>
      </Head>
      <div className="dashRoot">
        <DashboardHeader
          email={user?.email}
          subnav={<Link href="/dashboard" className="dashSubLink">← Back to saved homes</Link>}
        />
        <main className="dashMain">
          <h1 className="dashTitle">Compare</h1>
          <p className="dashSubtitle">
            Pick 2–5 homes to compare side-by-side. Green = winner in that category.
          </p>

          <div className="dashSelectList">
            {homes.length === 0 && <div className="dashEmpty">No homes saved yet.</div>}
            {homes.map((h) => (
              <label key={h.id} className="dashSelectRow">
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggle(h.id)}
                />
                <span className="dashSelectAddress">{h.address}</span>
                {!h.has_access && <span className="dashSelectMuted">locked</span>}
              </label>
            ))}
          </div>

          {showCompare && (
            <div className="compareWrap">
              <table className="compareTable">
                <thead>
                  <tr>
                    <th></th>
                    {scored.map((h) => (
                      <th key={h.id}>
                        <Link href={`/dashboard/${encodeURIComponent(h.address)}`}>
                          {h.address}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    label="Asking"
                    cells={scored.map((h) => formatCell(h.report?.asking_price, formatMoney, h.has_access))}
                    winners={winners.asking}
                  />
                  <CompareRow
                    label="Offer range"
                    cells={scored.map((h) => {
                      if (!h.has_access || !h.report) return { value: "Locked", locked: true };
                      return {
                        value: `${formatMoney(h.report.offer_low)}–${formatMoney(h.report.offer_high)}`,
                      };
                    })}
                  />
                  <CompareRow
                    label="Negotiability"
                    cells={scored.map((h) => {
                      if (!h.has_access || !h.report) return { value: "Locked", locked: true };
                      return { value: `${h.report.negotiability_score} / 10` };
                    })}
                    winners={winners.negotiability}
                  />
                  <CompareRow
                    label="Days on market"
                    cells={scored.map((h) => formatCell(h.report?.days_on_market, (n) => n, h.has_access))}
                    winners={winners.dom}
                  />
                  <CompareRow
                    label="3-yr projected value"
                    cells={scored.map((h) =>
                      h.scoring ? { value: formatMoney(h.scoring.projected_value_3yr) } : { value: "Locked", locked: true }
                    )}
                    winners={winners.projected}
                    highlight
                  />
                  <CompareRow
                    label="Best Value score"
                    cells={scored.map((h) => (h.scoring ? { value: `${h.scoring.score}/100` } : { value: "Locked", locked: true }))}
                    winners={winners.score}
                    highlight
                  />
                  <CompareRow
                    label="Appreciation / yr"
                    cells={scored.map((h) => {
                      if (!h.has_access || !h.report || h.report.appreciation_rate_annual == null) {
                        return { value: "Locked", locked: true };
                      }
                      return { value: formatPercent(h.report.appreciation_rate_annual * 100, 1) };
                    })}
                    winners={winners.appreciation}
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

function formatCell(value, formatter, hasAccess) {
  if (value == null) return { value: hasAccess ? "—" : "Locked", locked: !hasAccess };
  return { value: formatter(value) };
}

function CompareRow({ label, cells, winners = [], highlight }) {
  return (
    <tr className={highlight ? "compareHighlight" : ""}>
      <th>{label}</th>
      {cells.map((c, i) => {
        const isWinner = winners[i];
        const cls = [
          c.locked ? "compareLocked" : "",
          isWinner ? "compareWinner" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <td key={i} className={cls || undefined}>
            {isWinner && <span className="compareWinnerDot" aria-hidden="true">●</span>}
            {c.value}
          </td>
        );
      })}
    </tr>
  );
}

// Decide which cell wins each row.
//  - asking:        lower wins (cheaper home)
//  - dom:           higher wins (more motivated seller)
//  - projected:     higher wins
//  - score:         higher wins
//  - appreciation:  higher wins
//  - negotiability: higher wins
function computeWinners(scored) {
  function maxIdx(values) {
    let best = -Infinity, idx = -1;
    values.forEach((v, i) => { if (v != null && v > best) { best = v; idx = i; } });
    return values.map((v, i) => i === idx && v != null);
  }
  function minIdx(values) {
    let best = Infinity, idx = -1;
    values.forEach((v, i) => { if (v != null && v < best) { best = v; idx = i; } });
    return values.map((v, i) => i === idx && v != null);
  }
  const access = scored.map((h) => h.has_access && h.report);
  const reports = scored.map((h, i) => (access[i] ? h.report : null));
  const scoring = scored.map((h) => h.scoring);

  return {
    asking: minIdx(reports.map((r) => r?.asking_price ?? null)),
    negotiability: maxIdx(reports.map((r) => r?.negotiability_score ?? null)),
    dom: maxIdx(reports.map((r) => r?.days_on_market ?? null)),
    projected: maxIdx(scoring.map((s) => s?.projected_value_3yr ?? null)),
    score: maxIdx(scoring.map((s) => s?.score ?? null)),
    appreciation: maxIdx(reports.map((r) => r?.appreciation_rate_annual ?? null)),
  };
}
