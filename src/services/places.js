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
  'United States': 'US',
};

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

// ---- Feed-only dictionaries (kept here so geo.js and the older feed filter are untouched) ----

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
  ].map(n => [n, 'IN'])),
  leinster: 'IE', munster: 'IE', connacht: 'IE',
};

// R5: trailing words that identify a country on their own (case-sensitive; never "US").
const TRAILING_COUNTRY_WORDS = { UK: 'GB', USA: 'US', UAE: 'AE' };
const MIN_TRAILING_NAME_LENGTH = 5;

// R7: state names too ambiguous to infer a state from when nothing else is known.
const AMBIGUOUS_STATE_NAMES = new Set(['georgia', 'washington']);
// R7: names that are also major cities; a city-field piece with this name is the city, not a stated state.
const CITY_NAMED_STATES = new Set(['washington', 'new york']);
// R6: city names too ambiguous to trust as the first word of a longer piece.
const AMBIGUOUS_LEAD_CITIES = new Set(['santiago']);

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// R1+R2: a whole token that names a country (geo.js first, then the extras).
function countryFromAnyName(t) {
  const key = fold(t);
  return countryFromName(t) || EXTRA_COUNTRY_NAMES[key] || SUBNATIONAL_COUNTRY[key] || null;
}

// R3: a field plus every piece of it (split on | - / : and by geo's tokenizer).
const PIECE_SPLIT_RE = /\s*\|\s*|\s+-\s+|\s*\/\s*|\s*:\s*/;
function fieldPieces(text) {
  if (!text) return [];
  const out = new Set([text]);
  for (const p of text.split(PIECE_SPLIT_RE)) if (p.trim()) out.add(p.trim());
  for (const p of tokenizeLocation(text)) out.add(p);
  return [...out];
}

// R5: "Zilch UK", "Munich Germany" -> { iso, rest }. Longest trailing phrase wins.
function trailingCountry(piece) {
  const words = piece.split(' ');
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  if (TRAILING_COUNTRY_WORDS[last]) return { iso: TRAILING_COUNTRY_WORDS[last], rest: words.slice(0, -1).join(' ') };
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const phrase = words.slice(-k).join(' ');
    if (fold(phrase).length < MIN_TRAILING_NAME_LENGTH) continue;
    if (fold(phrase) === 'mexico' && fold(words[words.length - 2]) === 'new') continue; // New Mexico
    const iso = countryFromName(phrase) || EXTRA_COUNTRY_NAMES[fold(phrase)];
    if (iso) return { iso, rest: words.slice(0, -k).join(' ') };
  }
  return null;
}

// R4: embedded US state codes. (b) "NC 28025", "AZ: Gilbert", "CO - US": code first, then ZIP / ':' / dash.
const LEADING_CODE_RE = /^([A-Z]{2})(?=\s+\d{5}\b|\s*:|\s+-\s|-)/;
const stripTrailingNoise = (s) => s
  .replace(/(\s*\([^)]*\))+\s*$/, '')
  .replace(/\s+metro(politan)?(\s+area)?$/i, '')
  .trim();
// R4: (a) "Joliet IL": code is the last word and something real precedes it.
function trailingCode(piece) {
  const m = /^(.*\S)\s+([A-Z]{2})$/.exec(stripTrailingNoise(piece));
  if (!m || !US_STATES[m[2]] || tokenizeLocation(m[1]).length === 0) return null;
  return { code: m[2], rest: m[1] };
}
function embeddedCodes(fields, extraCityPieces) {
  const hits = [];
  const segments = [...fields.flatMap(f => (f ? f.split(/\s*[|/]\s*/) : [])), ...extraCityPieces];
  for (const seg of segments) {
    const lead = LEADING_CODE_RE.exec(seg.trim());
    if (lead && US_STATES[lead[1]]) hits.push({ code: lead[1], rest: null });
    for (const sub of seg.split(/\s+-\s+|\s*:\s*/)) {
      const t = trailingCode(sub);
      if (t) hits.push(t);
    }
  }
  return hits;
}

// R6: the country of a dictionary city that is a whole piece, or the first one or
// two words of a longer piece whose remainder carries no state/province/ZIP info.
const remainderIsPlain = (words) => !words.some(w => /^[A-Z]{2}$/.test(w) || /\d/.test(w))
  && !usState(words.join(' ')) && !caProvince(words.join(' '))
  && !words.some(w => usState(w) || caProvince(w));
function leadingCityIso(piece) {
  const words = piece.split(' ');
  for (let k = Math.min(2, words.length - 1); k >= 1; k--) {
    const lead = words.slice(0, k).join(' ');
    const iso = AMBIGUOUS_LEAD_CITIES.has(fold(lead)) ? null : countryFromCity(lead);
    if (iso && remainderIsPlain(words.slice(k))) return iso;
  }
  return null;
}
function cityCandidateIsos(wholeFields, allPieces, cityPieces) {
  const isos = [...wholeFields, ...allPieces].map(t => (t ? countryFromCity(t) : null))
    .concat(cityPieces.map(leadingCityIso));
  return [...new Set(isos.filter(Boolean))];
}

// R7: US state named by a whole piece. Washington is never taken from a city piece; New York only when nothing else is known.
function stateFromNamePieces({ country, region, city }, { bare }) {
  const named = (p, inCity) => {
    const key = p.toLowerCase();
    if (!US_STATE_BY_NAME[key]) return null;
    if (bare && AMBIGUOUS_STATE_NAMES.has(key)) return null;
    if (inCity && CITY_NAMED_STATES.has(key) && (!bare || key === 'washington')) return null;
    return US_STATE_BY_NAME[key];
  };
  return firstMatch([...country, ...region], p => named(p, false)) || firstMatch(city, p => named(p, true));
}

// Region once the country is known to be US (spelled or inferred), CA otherwise.
function regionFor(iso, ctx) {
  if (iso === 'CA') return firstMatch(ctx.tokens, caProvince);
  if (iso !== 'US') return null;
  return firstMatch(ctx.tokens, usState)
    || (ctx.codes[0] && ctx.codes[0].code)
    || stateFromNamePieces(ctx.pieces, { bare: false });
}

// The original token-level inference (US/CA codes in country/region, "Pune, IN" guard).
function explicitInference(ctx, cityIso) {
  const { tokens, city } = ctx;
  const prov = firstMatch(tokens, caProvince);
  const state = firstMatch(tokens, usState);
  const twoLetterIsCityCountry = tokens.some(t => TWO_LETTER_RE.test(t) && t.toUpperCase() === cityIso);
  const bareCA = !city && tokens.length > 0 && tokens.every(t => t.toUpperCase() === 'CA');
  if (twoLetterIsCityCountry) return { iso: cityIso, region: cityIso === 'CA' ? prov : cityIso === 'US' ? state : null };
  if (bareCA) return { iso: null, region: null, stop: true };
  if (prov && (ctx.countryRaw.toUpperCase() === 'CA' || !state)) return { iso: 'CA', region: prov };
  if (state) return { iso: 'US', region: state };
  return null;
}

function resolveLocation(city, regionRaw, countryRaw) {
  const tokens = [countryRaw, regionRaw].filter(Boolean);
  const pieces = { country: fieldPieces(countryRaw), region: fieldPieces(regionRaw), city: fieldPieces(city) };
  const trailing = pieces.city.map(trailingCountry).filter(Boolean);
  const cityPieces = [...pieces.city, ...trailing.map(t => t.rest)];
  const codes = embeddedCodes([countryRaw, regionRaw, city], trailing.map(t => t.rest));
  const ctx = { tokens, city, countryRaw, pieces: { ...pieces, city: cityPieces }, codes };
  const done = (iso) => ({ iso, region: regionFor(iso, ctx) });

  // 1. a spelled country (or R1/R2 name) in the country/region fields wins.
  const spelled = firstMatch([...pieces.country, ...pieces.region], countryFromAnyName);
  if (spelled) return done(spelled);

  // 2. explicit US/CA state or province in country/region, as before.
  const cityIso = city ? countryFromCity(city) : null;
  const explicit = explicitInference(ctx, cityIso);
  if (explicit) return explicit.stop ? { iso: null, region: null } : explicit;

  // 3. a spelled country inside the city field ("Zilch UK", "Remote - Poland").
  const cityCountry = firstMatch(pieces.city, countryFromAnyName) || (trailing[0] && trailing[0].iso);
  if (cityCountry) return done(cityCountry);

  // 4. embedded US state code, unless a foreign city's own country code says otherwise.
  const candidateIsos = cityCandidateIsos([city, regionRaw, countryRaw], cityPieces.concat(pieces.country, pieces.region), cityPieces);
  const rests = codes.map(c => c.rest).filter(Boolean);
  const hit = codes[0];
  if (hit) {
    const restIsos = rests.map(leadingOrWholeCityIso).filter(Boolean);
    const foreign = [...new Set([...candidateIsos, ...restIsos])];
    if (foreign.includes(hit.code)) return { iso: hit.code, region: null };
    if (!(hit.code === 'CA' && foreign.length)) return { iso: 'US', region: hit.code };
    return { iso: null, region: null };
  }

  // 5. a state named in a piece ("Minnesota - Minneapolis", bare "New York").
  const named = stateFromNamePieces(ctx.pieces, { bare: true });
  if (named) return { iso: 'US', region: named };

  // 6. a dictionary city among the tokens; conflicting cities do not guess.
  if (candidateIsos.length === 1) return { iso: candidateIsos[0], region: null };
  return { iso: null, region: null };
}
function leadingOrWholeCityIso(text) { return countryFromCity(text) || leadingCityIso(text); }

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
