// Address extraction and canonicalization.
//
// Canonical format: "<number> <street name> <Suffix>, <City> <ST> <ZIP>"
//   - Single comma between street and city
//   - Short-form street suffix (St, Rd, Ave, Blvd, Dr, Ln, Ct, Pl, Ter, Cir, Pkwy, Hwy, Trl)
//   - No comma between directional ("West"/"East"/"North"/"South") and city name
//
// Used in two places that must stay consistent:
//   1. /api/dashboard/save — parsing a Zillow/Realtor URL the user pastes
//   2. /api/admin/save-report — normalizing the address Claude extracts (or admin types)

const STREET_TYPE_REPLACEMENTS = [
  [/\bStreet\b\.?/gi, "St"],
  [/\bRoad\b\.?/gi, "Rd"],
  [/\bAvenue\b\.?/gi, "Ave"],
  [/\bBoulevard\b\.?/gi, "Blvd"],
  [/\bDrive\b\.?/gi, "Dr"],
  [/\bLane\b\.?/gi, "Ln"],
  [/\bCourt\b\.?/gi, "Ct"],
  [/\bPlace\b\.?/gi, "Pl"],
  [/\bTerrace\b\.?/gi, "Ter"],
  [/\bCircle\b\.?/gi, "Cir"],
  [/\bParkway\b\.?/gi, "Pkwy"],
  [/\bHighway\b\.?/gi, "Hwy"],
  [/\bTrail\b\.?/gi, "Trl"],
];

const STATE_RE = /\b([A-Z]{2})\b/;

const STREET_SUFFIX_SET = new Set([
  "st", "rd", "ave", "blvd", "dr", "ln", "ct", "pl", "ter",
  "cir", "way", "pkwy", "hwy", "trl",
]);

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

function applyStreetTypeAbbreviations(s) {
  for (const [from, to] of STREET_TYPE_REPLACEMENTS) {
    s = s.replace(from, to);
  }
  // Strip trailing period from already-abbreviated suffixes ("Ave." → "Ave").
  s = s.replace(
    /\b(St|Rd|Ave|Blvd|Dr|Ln|Ct|Pl|Ter|Cir|Pkwy|Hwy|Trl)\.(?=\s|,|$)/g,
    "$1"
  );
  return s;
}

// "West, Palm Beach" → "West Palm Beach"  (also matches "N,", "S,", "E,", "W,")
function removeDirectionalCommas(s) {
  return s.replace(/\b(North|South|East|West|N|S|E|W),\s+/gi, "$1 ");
}

export function normalizeAddress(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, " ").trim();

  // Strip any wrapping quotes the model might emit.
  s = s.replace(/^["'“‘]+|["'”’]+$/g, "").trim();

  s = applyStreetTypeAbbreviations(s);
  s = removeDirectionalCommas(s);

  // Collapse to single comma between street and city portion.
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const street = parts[0];
    const rest = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();
    s = `${street}, ${rest}`;
  } else {
    s = inferStructureFromTokens(s);
  }

  return s.replace(/\s+/g, " ").trim() || null;
}

// Used when input has no commas (e.g. URL-slug-derived). Walks back from the
// state token to find the street suffix, then inserts the canonical comma.
function inferStructureFromTokens(s) {
  const stateMatch = s.match(STATE_RE);
  if (!stateMatch) return s;
  const parts = s.split(" ");
  const stateIdx = parts.findIndex((p) => /^[A-Z]{2}$/.test(p));
  if (stateIdx < 0) return s;
  const cityStart = findCityStart(parts, stateIdx);
  if (cityStart <= 0) return s;
  const street = parts.slice(0, cityStart).join(" ");
  const city = parts.slice(cityStart, stateIdx).join(" ");
  const tail = parts.slice(stateIdx).join(" ");
  return `${street}, ${city} ${tail}`;
}

function findCityStart(parts, stateIdx) {
  for (let i = stateIdx - 1; i > 0; i--) {
    const tok = parts[i].toLowerCase().replace(/\./g, "");
    if (STREET_SUFFIX_SET.has(tok)) return i + 1;
  }
  return Math.max(1, stateIdx - 2);
}
