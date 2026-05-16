import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
  Font,
} from "@react-pdf/renderer";

export const config = {
  maxDuration: 30,
};

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Times-Roman", color: "#0A2540" },
  body: { lineHeight: 1.6, whiteSpace: "pre-wrap" },
});

function OfferLetterDoc({ letter }) {
  // Split the letter on blank lines to preserve paragraph spacing in the PDF.
  const paragraphs = String(letter || "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.body}>
          {paragraphs.map((p, i) => (
            <Text key={i} style={{ marginBottom: 10 }}>
              {p}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const { letter } = req.body || {};
  if (!letter) {
    return res.status(400).json({ error: "Missing letter" });
  }
  try {
    const buf = await renderToBuffer(<OfferLetterDoc letter={letter} />);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=offer-letter.pdf");
    res.status(200).send(buf);
  } catch (err) {
    console.error("offer-letter-pdf render error:", err);
    res.status(500).json({ error: err.message || "PDF render failed" });
  }
}
