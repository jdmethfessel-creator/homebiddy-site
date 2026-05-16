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
    paddingBottom: 60,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: C.ink,
  },
  headerBand: {
    backgroundColor: C.navy,
    paddingVertical: 18,
    paddingHorizontal: PAGE_PADDING,
    marginHorizontal: -PAGE_PADDING,
    marginBottom: 16,
  },
  headerLogo: {
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
  },
  headerTitle: {
    color: C.blueMid,
    fontSize: 9,
    marginTop: 3,
    letterSpacing: 1,
  },
  headerAddress: {
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginTop: 12,
  },
  headerMeta: {
    color: C.blueMid,
    fontSize: 9,
    marginTop: 3,
  },

  offerBox: {
    backgroundColor: C.blueLight,
    borderWidth: 1,
    borderColor: C.blueMid,
    borderStyle: "solid",
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
  },
  offerLabel: {
    fontSize: 8,
    color: C.muted,
    letterSpacing: 1,
    fontFamily: "Helvetica-Bold",
  },
  offerRange: {
    fontSize: 22,
    color: C.navy,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  offerSubRow: {
    flexDirection: "row",
    marginTop: 6,
    fontSize: 10,
    color: C.navy,
  },
  offerSubItem: { marginRight: 14 },
  offerSubBold: { fontFamily: "Helvetica-Bold" },
  offerBasis: {
    fontSize: 9,
    color: C.muted,
    marginTop: 6,
    fontFamily: "Helvetica-Oblique",
  },

  statGrid: {
    flexDirection: "row",
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: C.blueLight,
    padding: 10,
    borderRadius: 6,
    marginRight: 6,
  },
  statCardLast: { marginRight: 0 },
  statLabel: {
    fontSize: 7.5,
    color: C.muted,
    letterSpacing: 0.8,
    fontFamily: "Helvetica-Bold",
  },
  statValue: {
    fontSize: 15,
    color: C.navy,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
  },
  statHint: { fontSize: 8, color: C.muted, marginTop: 2 },

  sectionH: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: C.navy,
    marginTop: 6,
    marginBottom: 8,
  },

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
    letterSpacing: 0.6,
  },
  tableCell: { fontSize: 9, color: C.ink },

  compNote: {
    fontSize: 8.5,
    color: C.muted,
    fontFamily: "Helvetica-Oblique",
    marginBottom: 14,
    marginTop: 2,
  },

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

  scriptBox: {
    backgroundColor: C.blueLight,
    borderWidth: 1,
    borderColor: C.blueMid,
    borderStyle: "solid",
    borderRadius: 6,
    padding: 12,
    marginBottom: 14,
  },
  scriptText: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 10.5,
    color: C.navy,
    lineHeight: 1.5,
  },

  question: { flexDirection: "row", marginBottom: 5 },
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
          <Text style={styles.headerTitle}>OFFER ANALYSIS REPORT</Text>
          <Text style={styles.headerAddress}>{data.address || ""}</Text>
          <Text style={styles.headerMeta}>{fmtMetaLine(data)}</Text>
        </View>

        {/* Recommended offer range hero */}
        <View style={styles.offerBox} wrap={false}>
          <Text style={styles.offerLabel}>RECOMMENDED OFFER RANGE</Text>
          <Text style={styles.offerRange}>
            {fmtMoney(data.offer_low)} – {fmtMoney(data.offer_high)}
          </Text>
          <View style={styles.offerSubRow}>
            <Text style={styles.offerSubItem}>
              Opening offer:{" "}
              <Text style={styles.offerSubBold}>{fmtMoney(data.offer_low)}</Text>
            </Text>
            {data.walk_away != null && (
              <Text style={styles.offerSubItem}>
                Walk away above:{" "}
                <Text style={styles.offerSubBold}>{fmtMoney(data.walk_away)}</Text>
              </Text>
            )}
          </View>
          {data.offer_basis && (
            <Text style={styles.offerBasis}>{data.offer_basis}</Text>
          )}
        </View>

        {/* 4 stat cards */}
        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>NEGOTIABILITY</Text>
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
            <Text style={styles.statLabel}>DAYS ON MARKET</Text>
            <Text style={styles.statValue}>{data.days_on_market ?? "—"}</Text>
            {data.avg_dom != null && (
              <Text style={styles.statHint}>vs. {data.avg_dom}-day median</Text>
            )}
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>PRICE REDUCTIONS</Text>
            <Text style={styles.statValue}>{data.price_cuts ?? 0}</Text>
            {Array.isArray(data.cut_history) && data.cut_history.length > 0 && (
              <Text style={styles.statHint} numberOfLines={2}>
                {data.cut_history.join(", ")}
              </Text>
            )}
          </View>
          <View style={[styles.statCard, styles.statCardLast]}>
            <Text style={styles.statLabel}>ZESTIMATE VS ASK</Text>
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

        {/* Comp table */}
        <Text style={styles.sectionH}>Recent Closed Comps</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHCell, { flex: 2.4 }]}>ADDRESS</Text>
            <Text style={[styles.tableHCell, { flex: 1.1 }]}>SOLD</Text>
            <Text style={[styles.tableHCell, { flex: 0.9 }]}>SQFT</Text>
            <Text style={[styles.tableHCell, { flex: 0.9 }]}>$/SQFT</Text>
            <Text style={[styles.tableHCell, { flex: 0.6 }]}>DOM</Text>
            <Text style={[styles.tableHCell, { flex: 0.8 }]}>VS LIST</Text>
            <Text style={[styles.tableHCell, { flex: 1.5 }]}>SIGNAL</Text>
          </View>
          {comps.map((c, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={[styles.tableCell, { flex: 2.4 }]}>{c.address || ""}</Text>
              <Text style={[styles.tableCell, { flex: 1.1 }]}>{c.sold_date || ""}</Text>
              <Text style={[styles.tableCell, { flex: 0.9 }]}>
                {c.sqft != null ? Number(c.sqft).toLocaleString() : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.9 }]}>
                {c.price_per_sqft != null ? `$${c.price_per_sqft}` : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.6 }]}>
                {c.dom != null ? c.dom : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 0.8 }]}>
                {c.vs_list_pct != null
                  ? `${c.vs_list_pct > 0 ? "+" : ""}${c.vs_list_pct}%`
                  : ""}
              </Text>
              <Text style={[styles.tableCell, { flex: 1.5 }]}>{c.signal || ""}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.compNote}>
          * Closed sales within ~0.5 miles in the last 12 months. The Signal column
          summarizes price-vs-list and time-to-close to gauge buyer leverage.
        </Text>

        {/* Insights */}
        {insights.length > 0 && (
          <>
            <Text style={styles.sectionH}>What the Data Tells You</Text>
            {insights.map((line, i) => (
              <View style={styles.insight} key={i} wrap={false}>
                <Text style={styles.insightNum}>{i + 1}</Text>
                <Text style={styles.insightBody}>{line}</Text>
              </View>
            ))}
          </>
        )}

        {/* Negotiation script */}
        {data.negotiation_script && (
          <>
            <Text style={styles.sectionH}>Negotiation Script</Text>
            <View style={styles.scriptBox} wrap={false}>
              <Text style={styles.scriptText}>
                &ldquo;{data.negotiation_script}&rdquo;
              </Text>
            </View>
          </>
        )}

        {/* Questions */}
        {questions.length > 0 && (
          <>
            <Text style={styles.sectionH}>3 Questions to Ask the Listing Agent</Text>
            {questions.map((q, i) => (
              <View style={styles.question} key={i} wrap={false}>
                <Text style={styles.qNum}>{i + 1}</Text>
                <Text style={styles.qText}>{q}</Text>
              </View>
            ))}
          </>
        )}

        {/* Footer (fixed) */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerDisclaimer}>
            This report is for informational purposes only and does not
            constitute legal, financial, or real-estate advice. Estimates are
            based on publicly available data; verify all figures with your agent
            before submitting any offer.
          </Text>
          <Text style={styles.footerMeta}>
            homebiddy.com  ·  Your home buying buddy.  ·  Report ID: {reportId}  ·  Generated {dateLabel}
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
