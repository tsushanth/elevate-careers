// src/services/places.js
// Turns the messy raw job_location values into a clean (country, region, city).
// The ingest parser stored "City, ST" with country repeating the state code,
// "London, UK" with country "UK", and so on, so country is not reliable on
// its own. Unresolvable input is ZZ ("unknown"), never a guess.
import { matchCountryOrRegion, tokenizeLocation } from './geo.js';

export const UNKNOWN_COUNTRY = 'ZZ';

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const CA_PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
  ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

// geo.js canonical country display value -> ISO-3166 alpha-2.
const ISO_BY_DISPLAY = {
  Canada: 'CA', Mexico: 'MX', Brazil: 'BR', Colombia: 'CO', Argentina: 'AR', Chile: 'CL', Peru: 'PE',
  Uruguay: 'UY', Guatemala: 'GT', 'Costa Rica': 'CR', Panama: 'PA', Ecuador: 'EC', Bolivia: 'BO',
  'Dominican Republic': 'DO', Honduras: 'HN', 'El Salvador': 'SV', Nicaragua: 'NI', Paraguay: 'PY',
  India: 'IN', China: 'CN', Japan: 'JP', 'South Korea': 'KR', Singapore: 'SG', Vietnam: 'VN',
  Thailand: 'TH', Philippines: 'PH', Indonesia: 'ID', Malaysia: 'MY', Taiwan: 'TW', 'Hong Kong': 'HK',
  Pakistan: 'PK', Bangladesh: 'BD', 'Sri Lanka': 'LK', UK: 'GB', Ireland: 'IE', Germany: 'DE',
  France: 'FR', Spain: 'ES', Italy: 'IT', Netherlands: 'NL', Poland: 'PL', Portugal: 'PT',
  Sweden: 'SE', Norway: 'NO', Denmark: 'DK', Finland: 'FI', Switzerland: 'CH', Austria: 'AT',
  Belgium: 'BE', 'Czech Republic': 'CZ', Romania: 'RO', Ukraine: 'UA', Greece: 'GR', Hungary: 'HU',
  Serbia: 'RS', Croatia: 'HR', Bulgaria: 'BG', Israel: 'IL', Turkey: 'TR', UAE: 'AE',
  'Saudi Arabia': 'SA', Qatar: 'QA', Egypt: 'EG', 'South Africa': 'ZA', Nigeria: 'NG', Kenya: 'KE',
  Australia: 'AU', 'New Zealand': 'NZ', Azerbaijan: 'AZ', Kazakhstan: 'KZ', Russia: 'RU',
  Cyprus: 'CY', Moldova: 'MD', Armenia: 'AM', Belarus: 'BY', Slovakia: 'SK', Slovenia: 'SI',
  Lithuania: 'LT', Latvia: 'LV', Estonia: 'EE', Luxembourg: 'LU', Malta: 'MT', Iceland: 'IS',
  'United States': 'US', Georgia: 'GE',
};

const ISO_CODES = new Set(Object.values(ISO_BY_DISPLAY));

export const COUNTRY_NAME_BY_ISO = Object.fromEntries(
  Object.entries(ISO_BY_DISPLAY).map(([name, iso]) => [iso, name])
);
COUNTRY_NAME_BY_ISO.GB = 'United Kingdom';
COUNTRY_NAME_BY_ISO.AE = 'United Arab Emirates';

const US_STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([c, n]) => [n.toLowerCase(), c]));
const CA_PROVINCE_BY_NAME = Object.fromEntries(Object.entries(CA_PROVINCES).map(([c, n]) => [n.toLowerCase(), c]));
const NO_CITY_RE = /^(remote|anywhere|worldwide|global|hybrid|home)$/i;
const TWO_LETTER_RE = /^[a-z]{2}$/i;

const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

function usState(t) {
  const u = t.toUpperCase();
  return US_STATES[u] ? u : (US_STATE_BY_NAME[t.toLowerCase()] || null);
}
function caProvince(t) {
  const u = t.toUpperCase();
  return CA_PROVINCES[u] ? u : (CA_PROVINCE_BY_NAME[t.toLowerCase()] || null);
}
function countryFromName(t) {
  const m = matchCountryOrRegion(t);
  return m && m.type === 'country' ? (ISO_BY_DISPLAY[m.value] || null) : null;
}
function countryFromCity(city) {
  const m = matchCountryOrRegion(city);
  return m && m.type === 'city' ? (ISO_BY_DISPLAY[m.country] || null) : null;
}
const firstMatch = (tokens, fn) => {
  for (const t of tokens) { const v = fn(t); if (v) return v; }
  return null;
};

// ---------------------------------------------------------------------------
// Feed-only dictionaries (kept here so geo.js and the older feed filter are untouched)
// ---------------------------------------------------------------------------

// R1: native-language / alternate country names, keyed accent-folded and lower-case.
const EXTRA_COUNTRY_NAMES = {
  nederland: 'NL', 'the netherlands': 'NL', belgie: 'BE', deutschland: 'DE', osterreich: 'AT',
  schweiz: 'CH', suisse: 'CH', svizzera: 'CH', espana: 'ES', italia: 'IT', mexico: 'MX',
  polska: 'PL', sverige: 'SE', norge: 'NO', danmark: 'DK', suomi: 'FI', turkiye: 'TR', eire: 'IE',
  england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
};

// R2: subnational names that identify exactly one country. Ambiguous ones
// (Punjab, Georgia, Victoria, Mizoram...) are deliberately left out.
const SUBNATIONAL_COUNTRY = {
  ...Object.fromEntries([
    'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana',
    'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
    'meghalaya', 'odisha', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
    'uttarakhand', 'west bengal', 'delhi',
  ].map(name => [name, 'IN'])),
  leinster: 'IE', munster: 'IE', connacht: 'IE',
  yorkshire: 'GB', staffordshire: 'GB', 'richmond upon thames': 'GB',
};

// Feed-only dictionary cities (geo.js is untouched), keyed accent-folded and lower-case.
const EXTRA_CITY_COUNTRY = { 'ceske budejovice': 'CZ' };

// "Remote PL": a bare ISO code is only trusted from this list. Codes that are also a US state or
// CA province (DE, IN, CA, NL...) or an everyday abbreviation (IT, HR, SE, AM...) are left out.
const REMOTE_ISO_CODES = new Set(['PL', 'GB', 'FR', 'ES', 'PT', 'SG', 'JP', 'KR', 'AU', 'NZ', 'IE', 'ZA',
  'RO', 'TR', 'UA', 'CZ', 'HU', 'GR', 'MX', 'BR', 'PH', 'DK', 'FI', 'PK', 'BD', 'LK', 'VN', 'TH', 'TW', 'HK']);

// R5: trailing words that identify a country on their own (case-sensitive; never "US").
const TRAILING_COUNTRY_WORDS = { UK: 'GB', USA: 'US', UAE: 'AE' };
const MIN_TRAILING_NAME_LENGTH = 5;
const LIST_CONNECTORS = new Set(['or', 'and', '&', '+', 'and/or']);

// R7: state names too ambiguous to infer a state from when nothing else is known.
const AMBIGUOUS_STATE_NAMES = new Set(['georgia', 'washington']);
// R7: names that are also major cities; a city-field piece with this name is the city, not a stated state.
const CITY_NAMED_STATES = new Set(['washington', 'new york']);
// R6: city names too ambiguous to trust as the first word of a longer piece.
const AMBIGUOUS_LEAD_CITIES = new Set(['santiago']);
// Words that carry no place information in front of a bare state code ("Remote - CA").
const NOISE_PREFIXES = new Set(['remote', 'hybrid', 'onsite', 'on-site']);

// Longer raw values are paragraphs, not places.
const MAX_FIELD_LENGTH = 200;
const NONE = Object.freeze({ iso: null, region: null });

// ---------------------------------------------------------------------------
// Module-scope regexes
// ---------------------------------------------------------------------------
const COMMA_RE = /\s*,\s*/;
const SEGMENT_SPLIT_RE = /\s*[|;>/()]\s*/; // hard separators
const SOFT_SPLIT_RE = /\s+-\s+|\s*:\s*/; // " - " and ":"
// "NC 28025", "AZ: Gilbert", "CO - US": a state code first, then a ZIP / ':' / ' - '.
const LEADING_CODE_RE = /^([A-Z]{2})(?=\s+\d{5}\b|\s*:|\s+-\s)/;
const ZIP_AFTER_CODE_RE = /^[A-Z]{2}\s+\d{5}\b/;
const TRAILING_PARENS_RE = /(\s*\([^)]*\))+\s*$/;
const TRAILING_METRO_RE = /\s+metro(politan)?(\s+area)?$/i;
const TRAILING_CODE_RE = /^(.*\S)\s+([A-Z]{2})$/;
const NOISE_DASH_CODE_RE = /^(\S+)\s+-\s+([A-Z]{2})$/;
// "Anywhere in the US", "Remote within the USA": only when the phrase ends the segment (so "...US or Canada" is no match).
const IN_THE_US_RE = /\b(?:in|within|across)\s+the\s+(?:US|USA|U\.S\.A?\.?|United States)\s*$/i;
// "Austin | TX (Central)": a state code opening a segment, directly followed by a parenthetical.
const PAREN_CODE_RE = /(?:^|[|;]\s*)([A-Z]{2})\s*\(([^)]*)\)/g;
const US_WORD_RE = /\b(?:US|USA|U\.S\.A?|United States)\b/i;
const OFFICE_CODE_RE = /^([A-Z]{2})\s+(?:[Oo]ffice|HQ|hq|[Hh]eadquarters)$/;
const REMOTE_CODE_RE = /^(?:[Rr]emote|[Hh]ybrid|[Oo]n-?[Ss]ite)\s+([A-Z]{2})$/;
const DC_DOTTED_RE = /^D\.C\.$/;
const CAPS_WORD_RE = /^[A-Z]{2}$/;
const HAS_DIGIT_RE = /\d/;
const DIACRITICS_RE = /\p{M}/gu;

// Memoised: fold() is called many times per row on the same few strings.
const foldCache = new Map();
function fold(s) {
  let v = foldCache.get(s);
  if (v === undefined) {
    v = s.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim();
    if (foldCache.size > 5000) foldCache.clear();
    foldCache.set(s, v);
  }
  return v;
}

// R1+R2: a whole token that names a country. Weak names (R1/R2 extras) are skipped for vetoed pieces.
function countryFromAnyName(t, { weak = true } = {}) {
  const iso = countryFromName(t);
  if (iso || !weak) return iso;
  const key = fold(t);
  return EXTRA_COUNTRY_NAMES[key] || SUBNATIONAL_COUNTRY[key] || null;
}

// A dictionary city: { iso } (iso null when its country has no ISO entry), or null if not a city.
function cityLookup(text) {
  const m = matchCountryOrRegion(text);
  if (m) return m.type === 'city' ? { iso: ISO_BY_DISPLAY[m.country] || null } : null;
  const extra = EXTRA_CITY_COUNTRY[fold(text)];
  return extra ? { iso: extra } : null;
}

// R6: the first one or two words of a longer piece, when the remainder carries no state/province/ZIP info.
const remainderIsPlain = (words) => !words.some(w => CAPS_WORD_RE.test(w) || HAS_DIGIT_RE.test(w)
  || usState(w) || caProvince(w)) && !usState(words.join(' ')) && !caProvince(words.join(' '));
function leadingCity(piece) {
  const words = piece.split(' ');
  for (let k = Math.min(2, words.length - 1); k >= 1; k--) {
    const lead = words.slice(0, k).join(' ');
    const found = AMBIGUOUS_LEAD_CITIES.has(fold(lead)) ? null : cityLookup(lead);
    if (found && remainderIsPlain(words.slice(k))) return found;
  }
  return null;
}
const cityOf = (text) => cityLookup(text) || leadingCity(text);

// R5: "Zilch UK", "Munich Germany" -> { iso, rest }; a list like "USA or Canada" -> { conflict }.
function trailingCountry(piece) {
  const words = piece.split(' ');
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  let found = null;
  if (TRAILING_COUNTRY_WORDS[last]) {
    found = { iso: TRAILING_COUNTRY_WORDS[last], k: 1 };
  } else {
    for (let k = Math.min(3, words.length - 1); k >= 1 && !found; k--) {
      const phrase = words.slice(-k).join(' ');
      if (fold(phrase).length < MIN_TRAILING_NAME_LENGTH) continue;
      if (['mexico', 'england'].includes(fold(phrase)) && fold(words[words.length - k - 1]) === 'new') continue; // New Mexico, New England
      const iso = countryFromName(phrase) || EXTRA_COUNTRY_NAMES[fold(phrase)];
      if (iso) found = { iso, k };
    }
  }
  if (!found) return null;
  const restWords = words.slice(0, -found.k);
  if (LIST_CONNECTORS.has(fold(restWords[restWords.length - 1]))) return { conflict: true };
  return { iso: found.iso, rest: restWords.join(' ') };
}

// ---------------------------------------------------------------------------
// Field analysis: pieces, state-code hits, comma-form
// ---------------------------------------------------------------------------

// R4: "Joliet IL", "Boston MA (Back Bay)", "Washington DC Metro Area" -> { code, rest }.
function trailingCode(piece) {
  const m = TRAILING_CODE_RE.exec(piece.replace(TRAILING_PARENS_RE, '').replace(TRAILING_METRO_RE, '').trim());
  if (!m || !US_STATES[m[2]] || tokenizeLocation(m[1]).length === 0) return null;
  return { code: m[2], rest: m[1] };
}

// Comma-form "City, ST" / "City, Province": the tail is the state/province and vetoes city readings of the head.
function commaTail(parts) {
  const tail = parts[parts.length - 1];
  const code = usState(tail);
  const prov = caProvince(tail);
  if (!code && !prov) return null;
  return { tail, code, prov, rest: parts.slice(0, -1).join(', ') };
}

// Splits one raw field into pieces (each flagged vetoed or not), segments and state-code hits.
function analyzeField(text, extraSubPieces = []) {
  const out = { pieces: [], hits: [], comma: null };
  if (!text) return out;
  const seen = new Set();
  const add = (t, vetoed) => {
    const key = `${vetoed ? 1 : 0}|${t}`;
    if (t && !seen.has(key)) { seen.add(key); out.pieces.push({ text: t, vetoed }); }
  };
  const parts = text.split(COMMA_RE).filter(Boolean);
  out.comma = parts.length > 1 ? commaTail(parts) : null;
  add(text, false);
  parts.forEach((part, i) => {
    const vetoed = !!out.comma && i < parts.length - 1;
    if (!vetoed) collectParenHits(part, out.hits);
    for (const seg of part.split(SEGMENT_SPLIT_RE)) {
      if (!seg) continue;
      if (!vetoed) collectHits(seg, out.hits);
      if (!vetoed && IN_THE_US_RE.test(seg)) add('United States', false);
      for (const sub of seg.split(SOFT_SPLIT_RE)) add(sub, vetoed);
    }
    for (const t of tokenizeLocation(part)) add(t, vetoed);
  });
  for (const sub of extraSubPieces) { add(sub, false); collectHits(sub, out.hits); }
  if (out.comma) {
    out.hits.push({ kind: 'comma', code: out.comma.code, prov: out.comma.prov, rest: out.comma.rest, tail: out.comma.tail });
  }
  return out;
}

// "TX (Central)", "CA (Open to US-based Remote)" -> a state-code hit. Plain CA is Canada-or-California,
// so it needs a US marker inside the parenthetical.
function collectParenHits(part, hits) {
  for (const m of part.matchAll(PAREN_CODE_RE)) {
    if (!US_STATES[m[1]] || (m[1] === 'CA' && !US_WORD_RE.test(m[2]))) continue;
    hits.push({ kind: 'paren', code: m[1] });
  }
}

// R4 hits within one segment: leading code, trailing code, "Remote - CA".
function collectHits(seg, hits) {
  const lead = LEADING_CODE_RE.exec(seg);
  if (lead && US_STATES[lead[1]]) hits.push({ kind: 'lead', code: lead[1], zip: ZIP_AFTER_CODE_RE.test(seg) });
  const noisy = NOISE_DASH_CODE_RE.exec(seg);
  if (noisy && NOISE_PREFIXES.has(fold(noisy[1])) && noisy[2] === 'CA') hits.push({ kind: 'noise', code: 'CA' });
  for (const sub of seg.split(SOFT_SPLIT_RE)) {
    const t = trailingCode(sub);
    if (t) hits.push({ kind: 'trail', code: t.code, rest: t.rest });
  }
}

// Whole-token / bare-piece state evidence: "Florida", "MD", "D.C.".
function bareStateCode(text) {
  if (DC_DOTTED_RE.test(text)) return 'DC';
  return CAPS_WORD_RE.test(text) && US_STATES[text] ? text : null;
}
function stateFromName(text, { inCity, bare }) {
  const key = text.toLowerCase();
  const code = US_STATE_BY_NAME[key];
  if (!code) return null;
  if (bare && AMBIGUOUS_STATE_NAMES.has(key)) return null;
  if (inCity && CITY_NAMED_STATES.has(key) && (!bare || key === 'washington')) return null;
  return code;
}

// ---------------------------------------------------------------------------
// Context: everything the steps need, computed once per row
// ---------------------------------------------------------------------------
function buildContext(city, regionRaw, countryRaw) {
  const tokens = [countryRaw, regionRaw].filter(Boolean);
  const cityTrailing = analyzeField(city).pieces.map(p => (p.vetoed ? null : trailingCountry(p.text)));
  const trailingConflict = cityTrailing.some(t => t && t.conflict);
  const trailing = cityTrailing.filter(t => t && !t.conflict);
  const fields = {
    country: analyzeField(countryRaw),
    region: analyzeField(regionRaw),
    city: analyzeField(city, trailing.map(t => t.rest)),
  };
  const live = (f) => f.pieces.filter(p => !p.vetoed);
  const spell = (pieces) => pieces.map(p => countryFromAnyName(p.text, { weak: !p.vetoed })).filter(Boolean);
  const hits = [...fields.country.hits, ...fields.region.hits, ...fields.city.hits];

  const cityIsos = new Set();
  let unmapped = false;
  const noteCity = (found) => { if (found) { if (found.iso) cityIsos.add(found.iso); else unmapped = true; } };
  for (const t of [city, regionRaw, countryRaw]) if (t) noteCity(cityLookup(t));
  for (const f of Object.values(fields)) for (const p of live(f)) noteCity(cityLookup(p.text));
  for (const p of live(fields.city)) noteCity(leadingCity(p.text));

  return {
    tokens, city, countryRaw, fields, hits, trailingConflict, cityIsos, unmapped,
    cityWholeIso: city ? (cityLookup(city) || {}).iso || null : null,
    spelledStrong: [...new Set(spell([...live(fields.country), ...live(fields.region)]))],
    spelledCity: [...new Set([...spell(live(fields.city)), ...trailing.map(t => t.iso)])],
    // City-field country names that are not weak extras (those yield to the country/region fields).
    spelledCityHard: [...new Set([...spell(live(fields.city).filter(p => countryFromName(p.text))), ...trailing.map(t => t.iso)])],
    bareCounts: bareCodeCounts([city, regionRaw, countryRaw]),
    tokenStates: new Set(tokens.map(usState).filter(Boolean)),
    tokenProvs: new Set(tokens.map(caProvince).filter(Boolean)),
  };
}

// How many separate segments name each bare state code ("Birmingham | AL; Montgomery | AL" -> AL: 2).
function bareCodeCounts(texts) {
  const counts = {};
  for (const text of texts) {
    if (!text) continue;
    for (const seg of text.split(SEGMENT_SPLIT_RE)) {
      const code = bareStateCode(seg.trim());
      if (code) counts[code] = (counts[code] || 0) + 1;
    }
  }
  return counts;
}

const onlyOne = (set) => (set.size === 1 ? [...set][0] : null);

// States named by hits and pieces once the country is already US: one state -> it, several/none -> null.
function usRegion(ctx) {
  const states = new Set(ctx.tokenStates);
  for (const h of ctx.hits) if (h.code) states.add(h.code);
  for (const [name, f] of Object.entries(ctx.fields)) {
    for (const p of f.pieces) {
      const code = p.vetoed ? null : stateFromName(p.text, { inCity: name === 'city', bare: false });
      if (code) states.add(code);
      if (!p.vetoed && bareStateCode(p.text)) states.add(bareStateCode(p.text)); // country is already US
    }
  }
  return onlyOne(states);
}
function caRegion(ctx) {
  const provs = new Set(ctx.tokenProvs);
  for (const h of ctx.hits) if (h.prov) provs.add(h.prov);
  return onlyOne(provs);
}
const regionFor = (iso, ctx) => (iso === 'US' ? usRegion(ctx) : iso === 'CA' ? caRegion(ctx) : null);

// ---------------------------------------------------------------------------
// Steps. Each returns a result, NONE (conflict -> ZZ), or null (no opinion, try next step).
// ---------------------------------------------------------------------------

// 1. A spelled country. Distinct spelled countries conflict -> ZZ. A city-field name that
// contradicts an explicit state/province token ("Wales | WI | WI") is a conflict as well.
function stepSpelled(ctx) {
  // A weak city-field name ("Munster", "Yorkshire") never outvotes a country/region field.
  const all = new Set([...ctx.spelledStrong, ...(ctx.spelledStrong.length ? ctx.spelledCityHard : ctx.spelledCity)]);
  if (ctx.trailingConflict || all.size > 1) return NONE;
  if (all.size === 0) return null;
  if (!ctx.spelledStrong.length && (ctx.tokenStates.size || ctx.tokenProvs.size)) {
    // A city-field "United States" next to state tokens, or "Canada" next to provinces, agrees with them.
    const agrees = (ctx.spelledCity.length === 1 && ctx.spelledCity[0] === 'US' && !ctx.tokenProvs.size)
      || (ctx.spelledCity.length === 1 && ctx.spelledCity[0] === 'CA' && !ctx.tokenStates.size);
    if (agrees) return { iso: onlyOne(all), region: regionFor(onlyOne(all), ctx) };
    // Explicit state tokens repeated in country AND region ("Delhi | NY | NY") outrank a city-field name.
    const repeated = tokensCorroborate(ctx, usState) || tokensCorroborate(ctx, caProvince);
    return repeated ? null : NONE;
  }
  const iso = onlyOne(all);
  return { iso, region: regionFor(iso, ctx) };
}

// 2. A dictionary city whose country has no ISO entry cannot be resolved.
const stepUnmapped = (ctx) => (ctx.unmapped ? NONE : null);

// A token that repeats the same state/province (country AND region), or spells it out, is
// corroboration for it sitting next to a foreign dictionary city ("Paris | TX | TX", "London | Ontario | Ontario").
function tokensCorroborate(ctx, lookup) {
  const [a, b] = [lookup(ctx.countryRaw || ''), lookup(ctx.tokens[ctx.tokens.length - 1] || '')];
  return (a && a === b && ctx.tokens.length > 1) || ctx.tokens.some(t => !CAPS_WORD_RE.test(t) && lookup(t));
}

// 3. Explicit US state / CA province tokens in the country/region fields.
//
// Foreign dictionary city + state/province code: the code decides only when it IS that city's
// own country code (Pune IN, Berlin DE, Toronto CA) or when it is corroborated (repeated in
// country and region, or spelled out). A single stray code next to a foreign city is ZZ.
function stepExplicit(ctx) {
  const { tokens, tokenStates, tokenProvs } = ctx;
  if (!tokens.length) return null;
  const cityIso = ctx.cityWholeIso;
  const countryName = cityIso && COUNTRY_NAME_BY_ISO[cityIso] ? fold(COUNTRY_NAME_BY_ISO[cityIso]) : null;
  if (cityIso && tokens.some(t => (TWO_LETTER_RE.test(t) && t.toUpperCase() === cityIso) || fold(t) === countryName)) {
    return { iso: cityIso, region: cityIso === 'CA' ? caRegion(ctx) : null };
  }
  if (!ctx.city && tokens.every(t => t.toUpperCase() === 'CA')) return NONE; // bare CA: California or Canada
  const foreign = ctx.cityIsos.size > 0;
  if (tokenProvs.size && (ctx.countryRaw.toUpperCase() === 'CA' || !tokenStates.size)) {
    if (foreign && !ctx.cityIsos.has('CA') && ctx.countryRaw.toUpperCase() !== 'CA' && !tokensCorroborate(ctx, caProvince)) return NONE;
    return { iso: 'CA', region: caRegion(ctx) };
  }
  if (tokenStates.size) {
    if (foreign && !tokensCorroborate(ctx, usState)) return NONE;
    return { iso: 'US', region: usRegion(ctx) };
  }
  return null;
}

// 4. Embedded state codes ("Joliet IL", "NC 28025", "Remote - CA", "City, ST") and 2+ bare codes ("D.C./ MD / VA").
// A foreign dictionary city next to a code: the code's own country wins (Berlin DE); a different
// code needs corroboration (comma-form, or the same code twice), else ZZ. Plain "CA" never
// corroborates itself; a leading CA needs a ZIP.
function stepEmbedded(ctx) {
  const usable = ctx.hits.filter(h => h.code && !(h.kind === 'lead' && h.code === 'CA' && !h.zip));
  // The same bare code in two segments corroborates itself ("Birmingham | AL; Montgomery | AL"), except plain CA.
  for (const [code, count] of Object.entries(ctx.bareCounts)) {
    if (count > 1 && code !== 'CA') usable.push({ kind: 'bare', code }, { kind: 'bare', code });
  }
  const bare = new Set();
  for (const f of Object.values(ctx.fields)) {
    for (const p of f.pieces) if (!p.vetoed && bareStateCode(p.text)) bare.add(bareStateCode(p.text));
  }
  const provHit = ctx.hits.find(h => h.prov);
  if (!usable.length && bare.size < 2 && !provHit) return null;

  const foreign = new Set(ctx.cityIsos);
  for (const h of ctx.hits) {
    const found = h.rest ? cityOf(h.rest) : null;
    if (found) { if (found.iso) foreign.add(found.iso); else return NONE; }
  }
  const tailNames = ctx.hits.filter(h => h.tail).map(h => fold(h.tail));
  for (const iso of foreign) {
    const own = COUNTRY_NAME_BY_ISO[iso] && fold(COUNTRY_NAME_BY_ISO[iso]);
    if (usable.some(h => h.code === iso) || (provHit && provHit.prov === iso) || tailNames.includes(own)) {
      return { iso, region: null };
    }
  }
  if (provHit) return { iso: 'CA', region: provHit.prov }; // comma-form is its own corroboration
  const codeCounts = {};
  for (const h of usable) codeCounts[h.code] = (codeCounts[h.code] || 0) + 1;
  const corroborated = (h) => h.kind === 'comma' ? h.code !== 'CA' : (codeCounts[h.code] > 1);
  if (foreign.size && usable.some(h => !corroborated(h))) return NONE;
  const states = new Set([...usable.map(h => h.code), ...(usable.length || bare.size >= 2 ? bare : [])]);
  if (foreign.size && !states.size) return NONE;
  return states.size ? { iso: 'US', region: onlyOne(states) } : null;
}

// 5. A state named by a whole piece ("Minnesota - Minneapolis", bare "New York"); several -> US, region null.
function stepStateNames(ctx) {
  const states = new Set();
  for (const [name, f] of Object.entries(ctx.fields)) {
    for (const p of f.pieces) {
      const code = p.vetoed ? null : stateFromName(p.text, { inCity: name === 'city', bare: true });
      if (code) states.add(code);
    }
  }
  return states.size ? { iso: 'US', region: onlyOne(states) } : null;
}

// 5b. A whole city field that is only "NY office" or "Remote PL". Codes that are also ISO countries
// or Canadian provinces are not guessed.
function stepCodeOnly(ctx) {
  if (!ctx.city || ctx.tokens.length) return null;
  const office = OFFICE_CODE_RE.exec(ctx.city);
  if (office && US_STATES[office[1]] && !ISO_CODES.has(office[1]) && !CA_PROVINCES[office[1]]) {
    return { iso: 'US', region: office[1] };
  }
  const remote = REMOTE_CODE_RE.exec(ctx.city);
  if (remote && REMOTE_ISO_CODES.has(remote[1]) && !US_STATES[remote[1]] && !CA_PROVINCES[remote[1]]) {
    return { iso: remote[1], region: null };
  }
  return null;
}

// 6. Dictionary cities among the tokens; cities in different countries do not guess.
function stepCities(ctx) {
  return ctx.cityIsos.size === 1 ? { iso: onlyOne(ctx.cityIsos), region: null } : null;
}

const STEPS = [stepSpelled, stepUnmapped, stepExplicit, stepEmbedded, stepCodeOnly, stepStateNames, stepCities];

function resolveLocation(city, regionRaw, countryRaw) {
  if ([city, regionRaw, countryRaw].some(f => f && f.length > MAX_FIELD_LENGTH)) return NONE;
  const ctx = buildContext(city, regionRaw, countryRaw);
  for (const step of STEPS) {
    const r = step(ctx);
    if (r) return r;
  }
  return NONE;
}

export function normalizeLocationRow(row) {
  const rawCity = clean(row.city);
  const city = rawCity && !NO_CITY_RE.test(rawCity) ? rawCity : null;
  const { iso, region } = resolveLocation(city, clean(row.region), clean(row.country));
  return {
    country_code: iso || UNKNOWN_COUNTRY,
    region_code: iso ? region : null,
    city,
    city_key: city ? city.toLowerCase() : '',
  };
}

export function normalizeJobLocations(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const n = normalizeLocationRow(r);
    const key = `${n.country_code}|${n.region_code || ''}|${n.city_key}`;
    if (!seen.has(key)) seen.set(key, n);
  }
  const known = [...seen.values()].filter(n => n.country_code !== UNKNOWN_COUNTRY);
  if (known.length) return known;
  return [{ country_code: UNKNOWN_COUNTRY, region_code: null, city: null, city_key: '' }];
}
