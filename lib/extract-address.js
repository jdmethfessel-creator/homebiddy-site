// Try to extract a normalized address from a Zillow or Realtor.com URL.
// Returns null if we can't parse it — caller should ask the user to type it.

const STATE_RE = /\b([A-Z]{2})\b/;

function decodePart(p) {
  return decodeURIComponent(p)
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAddressFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // Zillow: /homedetails/442-28th-St-West-Palm-Beach-FL-33407/12345_zpid/
  if (host.includes("zillow.com")) {
    const m = path.match(/\/homedetails\/([^/]+)\//i);
    if (m) {
      const raw = decodePart(m[1]);
      return normalizeAddress(raw);
    }
  }

  // Realtor.com: /realestateandhomes-detail/442-28th-St_West-Palm-Beach_FL_33407_M12345-67890
  if (host.includes("realtor.com")) {
    const m = path.match(/\/realestateandhomes-detail\/([^/]+)/i);
    if (m) {
      let raw = m[1];
      raw = raw.replace(/_M[\dA-Z-]+$/i, "");
      raw = decodePart(raw);
      return normalizeAddress(raw);
    }
  }

  return null;
}

export function normalizeAddress(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  const stateMatch = s.match(STATE_RE);
  if (!stateMatch) return s;
  // Build "<street>, <city> <ST> <zip>" if we can.
  const parts = s.split(" ");
  const stateIdx = parts.findIndex((p) => /^[A-Z]{2}$/.test(p));
  if (stateIdx < 0) return s;
  const zip = parts[stateIdx + 1] || "";
  const street = parts.slice(0, findCityStart(parts, stateIdx)).join(" ");
  const city = parts.slice(findCityStart(parts, stateIdx), stateIdx).join(" ");
  return `${street}, ${city} ${parts[stateIdx]} ${zip}`.trim();
}

function findCityStart(parts, stateIdx) {
  // Heuristic: city is typically 1-3 words before the state.
  // Walk back until we hit a token that looks like a street suffix.
  const suffixes = new Set([
    "st", "street", "ave", "avenue", "rd", "road", "dr", "drive",
    "blvd", "boulevard", "ln", "lane", "way", "ct", "court", "pl",
    "place", "ter", "terrace", "cir", "circle", "pkwy", "parkway",
    "hwy", "highway", "trl", "trail",
  ]);
  for (let i = stateIdx - 1; i > 0; i--) {
    const tok = parts[i].toLowerCase().replace(/\./g, "");
    if (suffixes.has(tok)) return i + 1;
  }
  // Fallback: assume city is 2 tokens.
  return Math.max(1, stateIdx - 2);
}
