// src/services/places.js
// Turns the messy raw job_location values into a clean (country, region, city).
// The ingest parser stored "City, ST" with country repeating the state code,
// "London, UK" with country "UK", and so on, so country is not reliable on
// its own. Unresolvable input is ZZ ("unknown"), never a guess.
import { matchCountryOrRegion } from './geo.js';

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

export function normalizeLocationRow(row) {
  const rawCity = clean(row.city);
  const city = rawCity && !NO_CITY_RE.test(rawCity) ? rawCity : null;
  const regionRaw = clean(row.region);
  const countryRaw = clean(row.country);
  const tokens = [countryRaw, regionRaw].filter(Boolean);
  const cityIso = city ? countryFromCity(city) : null;

  let iso = null;
  let region = null;

  for (const t of tokens) { iso = countryFromName(t); if (iso) break; }

  if (iso === 'US') {
    region = firstMatch(tokens, usState);
  } else if (iso === 'CA') {
    region = firstMatch(tokens, caProvince);
  } else if (!iso) {
    const prov = firstMatch(tokens, caProvince);
    const state = firstMatch(tokens, usState);
    // "Pune, IN": IN is also Indiana, but Pune is a known Indian city.
    const twoLetterIsCityCountry = tokens.some(t => TWO_LETTER_RE.test(t) && t.toUpperCase() === cityIso);
    const bareCA = !city && tokens.length === 1 && tokens[0].toUpperCase() === 'CA';
    if (twoLetterIsCityCountry) {
      iso = cityIso;
      region = iso === 'CA' ? prov : iso === 'US' ? state : null;
    } else if (bareCA) {
      iso = null; // California or Canada: cannot tell.
    } else if (prov && (countryRaw.toUpperCase() === 'CA' || !state)) {
      iso = 'CA';
      region = prov;
    } else if (state) {
      iso = 'US';
      region = state;
    } else if (cityIso) {
      iso = cityIso;
    }
  }

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
