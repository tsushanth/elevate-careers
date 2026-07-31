// Shared country/recruiting-region name list, used both to parse a bare
// (no-comma) location string into a real country/region — instead of it
// silently landing in `city` with country left null — and as a second,
// title-text-based non-US signal in the personalized feed filter. Single
// source of truth so the two checks can't drift apart.
//
// Deliberately NOT exhaustive: this only needs to catch the common
// single-token forms ATS listings actually use ("Canada", "India (Remote)",
// "LATAM"), not be a full country database. False negatives (a real
// non-US location this list doesn't recognize) just fall back to today's
// permissive "no clear signal" behavior — no worse than before. False
// positives (misclassifying something as a country/region) are the risk to
// watch for, so keep this list to unambiguous names only.

// Real countries — map to `country`.
export const COUNTRY_NAMES = [
  'canada', 'mexico', 'brazil', 'colombia', 'argentina', 'chile', 'peru',
  'india', 'china', 'japan', 'south korea', 'korea', 'singapore', 'vietnam',
  'thailand', 'philippines', 'indonesia', 'malaysia', 'taiwan', 'hong kong',
  'united kingdom', 'uk', 'ireland', 'germany', 'france', 'spain', 'italy',
  'netherlands', 'poland', 'portugal', 'sweden', 'norway', 'denmark',
  'finland', 'switzerland', 'austria', 'belgium', 'czech republic', 'romania',
  'ukraine', 'greece', 'hungary', 'serbia', 'croatia', 'bulgaria',
  'israel', 'turkey', 'uae', 'united arab emirates', 'saudi arabia',
  'egypt', 'south africa', 'nigeria', 'kenya',
  'australia', 'new zealand',
  // NOTE: "Georgia" deliberately excluded — collides with the US state
  // (e.g. "Atlanta, Georgia"), which is exactly the false-positive risk to
  // avoid here. Add a country-vs-state disambiguation before re-adding it.
  'azerbaijan', 'kazakhstan', 'russia', 'cyprus',
];

// Recruiting-region shorthand — not real countries, map to `region` instead.
export const REGION_NAMES = [
  'latam', 'emea', 'apac', 'dach', 'nordics', 'benelux', 'anz', 'cee',
];

// Matches "India (Remote)", "India - Remote", "India, Remote" etc. — strips
// the remote-work qualifier so the country lookup underneath still hits.
export function stripRemoteQualifier(s) {
  return s.replace(/[\s,(-]*remote\)?\s*$/i, '').trim();
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

export function matchCountryOrRegion(rawToken) {
  const cleaned = stripRemoteQualifier(rawToken).trim().toLowerCase();
  if (!cleaned) return null;
  if (REGION_NAMES.includes(cleaned)) return { type: 'region', value: cleaned.toUpperCase() };
  if (COUNTRY_NAMES.includes(cleaned)) return { type: 'country', value: titleCase(cleaned) };
  return null;
}

// For the title-text signal — a regex alternation of all names, \y-bounded
// (Postgres word-boundary; NOT \b, which is a backspace escape in Postgres's
// POSIX ARE regex dialect, unlike JS — verified directly, see server.js).
export function nonUsTitleRegex() {
  const names = [...COUNTRY_NAMES, ...REGION_NAMES]
    .filter(n => n !== 'uk' && n !== 'korea') // too short/ambiguous as a bare title token
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `\\y(${names.join('|')})\\y`;
}
