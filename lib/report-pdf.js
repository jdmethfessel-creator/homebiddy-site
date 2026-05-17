/* eslint-disable react/no-unescaped-entities */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

const C = {
  navy: "#0A2540",
  blue: "#2563EB",
  blueLight: "#F0F7FF",
  blueMid: "#C8DFF5",
  green: "#059669",
  white: "#ffffff",
  ink: "#0A2540",
  muted: "#5B6B82",
  line: "#E5ECF4",
};

const PAGE_PADDING = 36;

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingHorizontal: PAGE_PADDING,
    paddingBottom: 64,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: C.ink,
  },

  // --- HEADER BAND ---
  headerBand: {
    backgroundColor: C.navy,
    paddingVertical: 18,
    paddingHorizontal: PAGE_PADDING,
    marginHorizontal: -PAGE_PADDING,
    marginBottom: 16,
  },
  headerLogo: { color: C.white, fontFamily: "Helvetica-Bold", fontSize: 16 },
  headerTitle: {
    color: C.blueMid,
    fontSize: 9,
    marginTop: 3,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  headerAddress: {
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginTop: 12,
  },
  headerMeta: { color: C.blueMid, fontSize: 9, marginTop: 3 },

  // --- OFFER RANGE HERO ---
  offerBox: {
    backgroundColor: C.blueLight,
    borderWidth: 1,
    borderColor: C.blueMid,
    borderStyle: "solid",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  offerLabel: {
    fontSize: 8,
    color: C.muted,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  offerRange: {
    fontSize: 24,
    color: C.navy,
    fontFamily: "Helvetica-Bold",
    marginTop: 5,
  },
  offerSub: {
    fontSize: 10,
    color: C.navy,
    marginTop: 6,
  },
  offerSubBold: { fontFamily: "Helvetica-Bold" },
  offerBasis: {
    fontSize: 9,
    color: C.muted,
    marginTop: 6,
    fontFamily: "Helvetica-Oblique",
  },

  // --- STAT CARDS ---
  statGrid: { flexDirection: "row", marginBottom: 16 },
  statCard: {
    flex: 1,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.blueMid,
    borderStyle: "solid",
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  statCardLast: { marginRight: 0 },
  statLabel: {
    fontSize: 7,
    color: C.muted,
    letterSpacing: 1,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    color: C.navy,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  statHint: {
    fontSize: 7.5,
    color: C.muted,
    marginTop: 4,
    textAlign: "center",
  },

  // --- SECTION HEADINGS (all caps, tracked) ---
  sectionH: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: C.navy,
    marginTop: 8,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },

  // --- COMP TABLE ---
  table: {
    borderWidth: 1,
    borderColor: C.line,
    borderStyle: "solid",
    borderRadius: 6,
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.blueLight,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    borderTopStyle: "solid",
  },
  tableHCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: C.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  tableCell: { fontSize: 9, color: C.ink },

  compNote: {
    fontSize: 8.5,
    color: C.muted,
    fontFamily: "Helvetica-Oblique",
    marginBottom: 16,
    marginTop: 2,
  },

  // --- INSIGHTS (left bordered, numbered) ---
  insight: {
    backgroundColor: C.blueLight,
    borderLeftWidth: 2.5,
    borderLeftColor: C.blue,
    borderLeftStyle: "solid",
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    flexDirection: "row",
    borderRadius: 3,
  },
  insightNum: {
    width: 16,
    height: 16,
    backgroundColor: C.blue,
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textAlign: "center",
    paddingTop: 2,
    borderRadius: 3,
    marginRight: 8,
  },
  insightBody: { flex: 1, fontSize: 9.5, lineHeight: 1.45, color: C.navy },

  // --- NEGOTIATION SCRIPT (left-bordered quote, italic, no surrounding box) ---
  scriptQuote: {
    borderLeftWidth: 3,
    borderLeftColor: C.blue,
    borderLeftStyle: "solid",
    paddingVertical: 4,
    paddingLeft: 14,
    paddingRight: 8,
    marginBottom: 26,
  },
  scriptText: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 10.5,
    color: C.navy,
    lineHeight: 1.55,
  },

  // --- QUESTIONS ---
  question: { flexDirection: "row", marginBottom: 12 },
  qNum: {
    width: 16,
    height: 16,
    backgroundColor: C.blue,
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textAlign: "center",
    paddingTop: 2,
    borderRadius: 3,
    marginRight: 8,
  },
  qText: { flex: 1, fontSize: 9.5, color: C.navy, lineHeight: 1.45 },

  // --- FOOTER ---
  footer: {
    position: "absolute",
    bottom: 20,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    borderTopStyle: "solid",
  },
  footerDisclaimer: {
    fontSize: 6.5,
    color: C.muted,
    textAlign: "center",
    lineHeight: 1.4,
  },
  footerMeta: {
    fontSize: 7.5,
    color: C.muted,
    textAlign: "center",
    marginTop: 4,
  },
});

// --- formatters ---
function fmtMoney(n) {
  if (n == null || isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString()}`;
}
function fmtShort(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}
function fmtMetaLine(data) {
  const parts = [];
  if (data.beds != null) parts.push(`${data.beds} bd`);
  if (data.baths != null) parts.push(`${data.baths} ba`);
  if (data.sqft != null) parts.push(`${Number(data.sqft).toLocaleString()} sqft`);
  if (data.year_built != null) parts.push(`built ${data.year_built}`);
  if (data.neighborhood) parts.push(data.neighborhood);
  return parts.join(" · ");
}

// "411 29th St, West Palm Beach FL 33407" → "411 29th St, WPB"
function shortenCompAddress(addr) {
  if (!addr) return "";
  const parts = String(addr).split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts[0];
  if (parts.length < 2) return street;
  const tail = parts.slice(1).join(" ");
  const tokens = tail.split(/\s+/);
  const stateIdx = tokens.findIndex((t) => /^[A-Z]{2}$/.test(t));
  const cityWords = stateIdx > 0 ? tokens.slice(0, stateIdx) : tokens.slice(0, 2);
  const initials = cityWords
    .map((w) => w[0]?.toUpperCase())
    .filter(Boolean)
    .join("");
  return initials ? `${street}, ${initials}` : street;
}

function truncate(s, n) {
  if (!s) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function ReportPDF({ data, reportId, dateLabel }) {
  const comps = Array.isArray(data.comps) ? data.comps.slice(0, 6) : [];
  const insights = Array.isArray(data.insights) ? data.insights.slice(0, 4) : [];
  const questions = Array.isArray(data.questions) ? data.questions.slice(0, 3) : [];

  return (
    <Document
      title={`HomeBiddy Report — ${data.address || ""}`}
      author="HomeBiddy"
      subject="Offer Analysis Report"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header band */}
        <View style={styles.headerBand}>
          <Text style={styles.headerLogo}>HomeBiddy</Text>
          <Text style={styles.headerTitle}>Offer Analysis Report</Text>
          <Text style={styles.headerAddress}>{data.address || ""}</Text>
          <Text style={styles.headerMeta}>{fmtMetaLine(data)}</Text>
        </View>

        {/* Recommended Offer Range hero */}
        <View style={styles.offerBox} wrap={false}>
          <Text style={styles.offerLabel}>Recommended Offer Range</Text>
          <Text style={styles.offerRange}>
            {fmtMoney(data.offer_low)} – {fmtMoney(data.offer_high)}
          </Text>
          <Text style={styles.offerSub}>
            Opening offer:{" "}
            <Text style={styles.offerSubBold}>{fmtMoney(data.offer_low)}</Text>
            {data.walk_away != null && (
              <>
                {"  |  "}
                Walk away above:{" "}
                <Text style={styles.offerSubBold}>{fmtMoney(data.walk_away)}</Text>
              </>
            )}
          </Text>
          {data.offer_basis && (
            <Text style={styles.offerBasis}>{data.offer_basis}</Text>
          )}
        </View>

        {/* 4 stat cards — 1x4 grid, centered values, bordered */}
        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Negotiability</Text>
            <Text style={styles.statValue}>
              {data.negotiability_score != null
                ? `${data.negotiability_score} / 10`
                : "—"}
            </Text>
            {data.negotiability_label && (
              <Text style={styles.statHint}>{data.negotiability_label}</Text>
            )}
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Days on Market</Text>
            <Text style={styles.statValue}>{data.days_on_market ?? "—"}</Text>
            {data.avg_dom != null && (
              <Text style={styles.statHint}>vs. {data.avg_dom}-day median</Text>
            )}
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Price Reductions</Text>
            <Text style={styles.statValue}>{data.price_cuts ?? 0}</Text>
            {Array.isArray(data.cut_history) && data.cut_history.length > 0 && (
              <Text style={styles.statHint} numberOfLines={2}>
                {data.cut_history.join(", ")}
              </Text>
            )}
          </View>
          <View style={[styles.statCard, styles.statCardLast]}>
            <Text style={styles.statLabel}>Zestimate vs Ask</Text>
            <Text style={styles.statValue}>
              {data.zestimate_gap != null
                ? `${data.zestimate_gap > 0 ? "+" : ""}${fmtShort(data.zestimate_gap)}`
                : "—"}
            </Text>
            <Text style={styles.statHint}>
              {data.zestimate_gap != null
                ? data.zestimate_gap > 0
                  ? "Asking over estimate"
                  : "Asking under estimate"
                : ""}
            </Text>
          </View>
        </View>

        {/* Comp table — all-caps section header, short addresses, capped signal */}
        <Text style={styles.sectionH}>Recent Closed Comps</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHCell, { flex: 2.0 }]}>Address</Text>
            <Text style={[styles.tableHCell, { flex: 1.1 }]}>Sold</Text>
            <Text style={[styles.tableHCell, { flex: 0.9 }]}>Sqft</Text>
            <Text style={[styles.tableHCell, { flex: 0.9 }]}>$/Sqft</Text>
            <Text style={[styles.tableHCell, { flex: 0.6 }]}>DOM</Text>
            <Text style={[styles.tableHCell, { flex: 0.8 }]}>vs List</Text>
            <Text style={[styles.tableHCell, { flex: 1.7 }]}>Signal</Text>
          </View>
          {comps.map((c, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={[styles.tableCell, { flex: 2.0 }]} numberOfLines={1}>
                {shortenCompAddress(c.address)}
              </Text>
              <Text style={[styles.tableCell, { flex: 1.1 }]} numberOfLines={1}>
                {c.sold_date || ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.9 }]} numberOfLines={1}>
                {c.sqft != null ? Number(c.sqft).toLocaleString() : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.9 }]} numberOfLines={1}>
                {c.price_per_sqft != null ? `$${c.price_per_sqft}` : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.6 }]} numberOfLines={1}>
                {c.dom != null ? c.dom : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.8 }]} numberOfLines={1}>
                {c.vs_list_pct != null
                  ? `${c.vs_list_pct > 0 ? "+" : ""}${c.vs_list_pct}%`
                  : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 1.7 }]} numberOfLines={1}>
                {truncate(c.signal, 20)}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.compNote}>
          * Closed sales within ~0.5 miles in the last 12 months. The Signal
          column summarizes price-vs-list and time-to-close to gauge buyer
          leverage.
        </Text>

        {/* Insights — only items 1 and 2 render on page 1. Items 3 and
            4 move into the page-2 wrapper below. */}
        {insights.length > 0 && (
          <>
            <Text style={styles.sectionH}>What the Data Tells You</Text>
            {insights.slice(0, 2).map((line, i) => (
              <View style={styles.insight} key={i} wrap={false}>
                <Text style={styles.insightNum}>{i + 1}</Text>
                <Text style={styles.insightBody}>{line}</Text>
              </View>
            ))}
          </>
        )}

        {/* Page 2 — single forced break with 40pt of blank space at the
            top. Holds insights 3-4, the Negotiation Script, and the
            3 Questions. The fixed footer renders on every page. */}
        {(insights.length > 2 || data.negotiation_script || questions.length > 0) && (
          <View break style={{ paddingTop: 40 }}>
            {insights.slice(2, 4).map((line, i) => (
              <View style={styles.insight} key={i + 2} wrap={false}>
                <Text style={styles.insightNum}>{i + 3}</Text>
                <Text style={styles.insightBody}>{line}</Text>
              </View>
            ))}

            {data.negotiation_script && (
              <>
                <Text style={[styles.sectionH, { marginTop: 16, marginBottom: 14 }]}>
                  Negotiation Script
                </Text>
                <View style={styles.scriptQuote} wrap={false}>
                  <Text style={styles.scriptText}>
                    &ldquo;{data.negotiation_script}&rdquo;
                  </Text>
                </View>
              </>
            )}

            {questions.length > 0 && (
              <>
                <Text style={[styles.sectionH, { marginTop: 18, marginBottom: 12 }]}>
                  3 Questions to Ask the Listing Agent
                </Text>
                {questions.map((q, i) => (
                  <View style={styles.question} key={i} wrap={false}>
                    <Text style={styles.qNum}>{i + 1}</Text>
                    <Text style={styles.qText}>{q}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* Footer — pipe separators */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerDisclaimer}>
            This report is for informational purposes only and does not
            constitute legal, financial, or real-estate advice. Estimates are
            based on publicly available data; verify all figures with your agent
            before submitting any offer.
          </Text>
          <Text style={styles.footerMeta}>
            homebiddy.com | Your home buying buddy. | Report ID: {reportId} | Generated {dateLabel}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPDF(data, { reportId, dateLabel }) {
  return await renderToBuffer(
    <ReportPDF data={data} reportId={reportId} dateLabel={dateLabel} />
  );
}
