export const EMPTY_PLACE = { country: '', region: '', city: '', label: '' };

const NAMES = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', IN: 'India', AU: 'Australia',
  NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain', NL: 'Netherlands', SG: 'Singapore',
  JP: 'Japan', AE: 'United Arab Emirates', BR: 'Brazil', MX: 'Mexico',
};

const CANADA_ZONES = ['Toronto', 'Vancouver', 'Edmonton', 'Winnipeg', 'Halifax', 'St_Johns', 'Regina', 'Montreal'];
const TZ_EXACT = {
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Dubai': 'AE', 'Pacific/Auckland': 'NZ',
  'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX',
};

function countryFromTimeZone(tz) {
  if (!tz) return null;
  if (TZ_EXACT[tz]) return TZ_EXACT[tz];
  if (tz.startsWith('Australia/')) return 'AU';
  if (tz.startsWith('America/')) return CANADA_ZONES.some(z => tz.endsWith('/' + z)) ? 'CA' : 'US';
  return null;
}

function countryFromLanguages(languages) {
  for (const l of languages || []) {
    const m = /^[a-z]{2,3}-([A-Za-z]{2})$/.exec(l);
    if (m && NAMES[m[1].toUpperCase()]) return m[1].toUpperCase();
  }
  return null;
}

export function guessPlace({ timeZone, languages } = {}) {
  const country = countryFromTimeZone(timeZone) || countryFromLanguages(languages) || 'US';
  return { country, region: '', city: '', label: NAMES[country] || country };
}

export function placeFromSuggestion(s) {
  if (!s) return EMPTY_PLACE;
  return { country: s.country || '', region: s.region || '', city: s.city || '', label: s.label || '' };
}

const KEY = 'sa_place';

export function loadSavedPlace() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    return p && typeof p.country === 'string' ? { ...EMPTY_PLACE, ...p } : null;
  } catch { return null; }
}

export function savePlace(place) {
  try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* private mode */ }
}
