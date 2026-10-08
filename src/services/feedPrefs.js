// Saved job preferences (apply_preferences) applied to the v2 feed. Pure: no I/O.
//
// Two tiers, reproducing the old /jobs/personalized filters on the job_feed read model:
//   HARD  excluded_titles, excluded_locations: always applied to a signed-in user, also while
//         they search or pick pills.
//   SOFT  remote, salary_min: applied only on the default list (no keyword, no pills) and
//         skipped when the request carries prefs=off.
// Not implemented here: keywords (ranking, step 2), location (the feed has its own place
// picker), require_visa_sponsor (job_feed has no visa column; the old filter joined
// company_h1b_sponsorship, which is outside the read model).
import { US_STATES, CA_PROVINCES, COUNTRY_NAME_BY_ISO } from './places.js';

// Same normalisation the old list used for stored excluded titles (normalizer.normalizeTitle).
// Kept in step with the SQL expression in TITLE_EXPR.
const normTitle = (t) => String(t || '').toLowerCase().trim().replace(/\s+/g, ' ');
const TITLE_EXPR = `lower(trim(regexp_replace(f.title, '\\s+', ' ', 'g')))`;

const COUNTRY_BY_NAME = Object.fromEntries(
  Object.entries(COUNTRY_NAME_BY_ISO).map(([iso, name]) => [name.toLowerCase(), iso]));
Object.assign(COUNTRY_BY_NAME, { usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US', uk: 'GB', 'great britain': 'GB' });
const ISO_CODES = new Set(Object.keys(COUNTRY_NAME_BY_ISO));
const REGION_BY_NAME = [
  ...Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), 'US', code]),
  ...Object.entries(CA_PROVINCES).map(([code, name]) => [name.toLowerCase(), 'CA', code]),
];

// The old filter compared raw job_location city/region/country text with the stored
// strings. job_feed keeps a display city, a region code and an ISO country code, so each
// stored string is resolved to whichever of those it can denote (case-insensitive).
export function resolveLocations(list) {
  const cities = new Set(), countries = new Set(), pairs = new Map();
  for (const raw of list || []) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) continue;
    cities.add(t);
    if (ISO_CODES.has(t.toUpperCase()) && t.length === 2) countries.add(t.toUpperCase());
    if (COUNTRY_BY_NAME[t]) countries.add(COUNTRY_BY_NAME[t]);
    for (const [name, cc, code] of REGION_BY_NAME) {
      if (name === t) pairs.set(`${cc}|${code}`, [cc, code]);
    }
    const u = t.toUpperCase();
    if (US_STATES[u]) pairs.set(`US|${u}`, ['US', u]);
    if (CA_PROVINCES[u]) pairs.set(`CA|${u}`, ['CA', u]);
  }
  return {
    cities: [...cities], countries: [...countries],
    regionCountries: [...pairs.values()].map(p => p[0]), regionCodes: [...pairs.values()].map(p => p[1]),
  };
}

// Raw apply_preferences row -> the compact shape the rest of the code passes around.
export function normalizePrefs(row) {
  if (!row) return null;
  const titles = [...new Set((Array.isArray(row.excluded_titles) ? row.excluded_titles : []).map(normTitle).filter(Boolean))];
  const locations = resolveLocations(Array.isArray(row.excluded_locations) ? row.excluded_locations : []);
  const salary = Number(row.salary_min);
  return {
    titles,
    locations: locations.cities.length ? locations : null,
    remote: row.remote === true,
    salaryMin: Number.isFinite(salary) && salary > 0 ? salary : null,
  };
}

export const hasSoft = (p) => !!p && (p.remote || p.salaryMin !== null);
export const hasHard = (p) => !!p && (p.titles.length > 0 || !!p.locations);

// Soft preferences only shape the default list: no keyword, no pill.
export const isDefaultList = (params) => !params.q && !params.remote && !params.type && params.days === null;

// What actually applies to this request. `off` is prefs=off. Returns null when nothing applies.
export function activePrefs(prefs, params, { off = false } = {}) {
  if (!prefs) return null;
  const soft = !off && isDefaultList(params) && hasSoft(prefs);
  const out = {
    titles: prefs.titles,
    locations: prefs.locations,
    remote: soft && prefs.remote,
    salaryMin: soft ? prefs.salaryMin : null,
  };
  return hasHard(out) || hasSoft(out) ? out : null;
}

// WHERE fragments (ANDed by the caller). `add(v)` binds a value and returns its $n placeholder.
export function prefClauses(active, add) {
  if (!active) return [];
  const out = [];
  if (active.remote) out.push('f.remote');
  if (active.salaryMin !== null) out.push(`(f.salary_min IS NULL OR f.salary_min >= ${add(active.salaryMin)})`);
  if (active.titles.length) out.push(`${TITLE_EXPR} <> ALL(${add(active.titles)}::text[])`);
  if (active.locations) {
    const l = active.locations;
    const cities = add(l.cities);
    const countries = l.countries.length ? add(l.countries) : null;
    const own = [`lower(f.city) = ANY(${cities}::text[])`];
    const any = [`lower(g.city) = ANY(${cities}::text[])`];
    if (countries) { own.push(`f.country_code = ANY(${countries}::text[])`); any.push(`g.country_code = ANY(${countries}::text[])`); }
    if (l.regionCodes.length) {
      any.push(`EXISTS (SELECT 1 FROM unnest(${add(l.regionCountries)}::text[], ${add(l.regionCodes)}::text[]) r(cc, rc) WHERE r.cc = g.country_code AND r.rc = g.region_code)`);
    }
    // Cheap test on the row itself first (most exclusions are decided here), then the per-job
    // probe on the job_feed primary key: any location of the job matches, the whole job goes
    // (the old list excluded per job, not per location row).
    out.push(`NOT (${own.join(' OR ')})`);
    out.push(`NOT EXISTS (SELECT 1 FROM job_feed g WHERE g.job_id = f.job_id AND (${any.join(' OR ')}))`);
  }
  return out;
}
