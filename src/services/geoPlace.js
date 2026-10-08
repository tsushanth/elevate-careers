// src/services/geoPlace.js
// The selectable places for the typeahead, rebuilt from job_feed counts.
import { COUNTRY_NAME_BY_ISO, US_STATES, CA_PROVINCES, UNKNOWN_COUNTRY } from './places.js';

const MIN_CITY_JOBS = 3;
// A regioned city entry "absorbs" the regionless rows of the same city only when
// it is dominant: top region >= 80% of the city's regioned jobs and no other
// region above 10%. Springfield, Portland, Columbus etc. stay ambiguous.
export const ABSORB_TOP_SHARE = 0.8;
export const ABSORB_OTHER_MAX_SHARE = 0.1;
const ABSORB_TTL_MS = 60_000;

const STATE_NAMES = [...new Set([...Object.values(US_STATES), ...Object.values(CA_PROVINCES)])];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STATE_PREFIX_RE = new RegExp(`^(?:${STATE_NAMES.map(reEsc).join('|')})(?::|\\s+[-\u2013\u2014]|[-\u2013\u2014]\\s)`, 'i');

// True when a raw job_feed city value is not a real city (a scraped label such
// as "California - San Francisco Bay Area", "NY office", "Remote - U.S.").
// Hyphens without spaces (Winston-Salem), periods and apostrophes are fine.
export function isJunkCity(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (s.length > 40) return true;
  if (/\s[-\u2013\u2014]\s/.test(s)) return true;
  if (/[0-9()|;*]/.test(s)) return true;
  if (STATE_PREFIX_RE.test(s)) return true;
  if (/^[A-Z]{2,5}(\s|$)/.test(s)) return true; // NY office, NYC, SF Office, US TX Austin
  return false;
}

// Pure: is the top regioned entry dominant over the others?
export function isDominant(regionCounts) {
  const counts = [...regionCounts].sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return false;
  return counts[0] >= ABSORB_TOP_SHARE * total && (counts[1] || 0) <= ABSORB_OTHER_MAX_SHARE * total;
}

const stateName = (cc, rc) => (cc === 'US' ? US_STATES[rc] : cc === 'CA' ? CA_PROVINCES[rc] : null);

export async function rebuildGeoPlaces(db) {
  const places = [];

  const countries = await db.query(
    `SELECT country_code, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND country_code <> $1 GROUP BY 1`, [UNKNOWN_COUNTRY]);
  for (const r of countries.rows) {
    const name = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!name) continue;
    places.push({ type: 'country', label: name, name_key: name.toLowerCase(), country_code: r.country_code, region_code: '', city_key: '', job_count: r.n });
  }

  const states = await db.query(
    `SELECT country_code, region_code, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND region_code <> '' GROUP BY 1, 2`);
  for (const r of states.rows) {
    const name = stateName(r.country_code, r.region_code);
    const cname = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!name || !cname) continue;
    places.push({ type: 'state', label: `${name}, ${cname}`, name_key: name.toLowerCase(), country_code: r.country_code, region_code: r.region_code, city_key: '', job_count: r.n });
  }

  const raw = await db.query(
    `SELECT country_code, region_code, city_key, min(city) AS city, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND city_key <> '' AND country_code <> $1
     GROUP BY 1, 2, 3`, [UNKNOWN_COUNTRY]);
  // Jobs that have both a regionless and a regioned row for the same city (per region).
  const overlap = await db.query(
    `SELECT l.country_code, l.city_key, g.region_code, count(DISTINCT l.job_id)::int AS n
     FROM job_feed l JOIN job_feed g ON g.job_id = l.job_id AND g.country_code = l.country_code
       AND g.city_key = l.city_key AND g.region_code <> '' AND g.is_active
     WHERE l.is_active AND l.region_code = '' AND l.city_key <> '' AND l.country_code <> $1
     GROUP BY 1, 2, 3`, [UNKNOWN_COUNTRY]);
  const overlapBy = new Map(overlap.rows.map(r => [`${r.country_code}|${r.city_key}|${r.region_code}`, r.n]));

  const byCity = new Map();
  for (const r of raw.rows) {
    const k = `${r.country_code}|${r.city_key}`;
    if (!byCity.has(k)) byCity.set(k, { regioned: [], regionless: null });
    const g = byCity.get(k);
    if (r.region_code) g.regioned.push(r); else g.regionless = r;
  }
  const cityRows = [];
  for (const [k, g] of byCity) {
    const cc = k.split('|')[0];
    let absorbRegion = null;
    if (g.regionless && g.regioned.length && isDominant(g.regioned.map(r => r.n))) {
      const top = g.regioned.reduce((a, b) => (b.n > a.n ? b : a));
      // The regioned entry must itself be listed (junk and tiny cities are not).
      if (top.n >= MIN_CITY_JOBS && !isJunkCity(top.city)) absorbRegion = top.region_code;
    }
    for (const r of g.regioned) {
      if (r.n < MIN_CITY_JOBS || isJunkCity(r.city)) continue;
      if (r.region_code === absorbRegion) {
        const extra = g.regionless.n - (overlapBy.get(`${cc}|${r.city_key}|${r.region_code}`) || 0);
        cityRows.push({ ...r, n: r.n + extra, absorbs: true });
      } else cityRows.push({ ...r, absorbs: false });
    }
    // The regionless entry is hidden when absorbed; its jobs live under the regioned one.
    if (g.regionless && !absorbRegion && g.regionless.n >= MIN_CITY_JOBS && !isJunkCity(g.regionless.city)) {
      cityRows.push({ ...g.regionless, absorbs: false });
    }
  }
  const cities = { rows: cityRows, rowCount: cityRows.length };
  for (const r of cities.rows) {
    const cname = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!cname) continue;
    const sname = r.region_code ? stateName(r.country_code, r.region_code) : null;
    places.push({ type: 'city', label: [r.city, sname, cname].filter(Boolean).join(', '), name_key: r.city.toLowerCase(), country_code: r.country_code, region_code: r.region_code, city_key: r.city_key, job_count: r.n, absorbs_regionless: r.absorbs });
  }

  if (places.length) {
    await db.query(
      `INSERT INTO geo_place (type, label, name_key, country_code, region_code, city_key, job_count, absorbs_regionless, updated_at)
       SELECT type, label, name_key, country_code, region_code, city_key, job_count, coalesce(absorbs_regionless, false), now()
       FROM jsonb_to_recordset($1::jsonb) AS r(type text, label text, name_key text, country_code text, region_code text, city_key text, job_count int, absorbs_regionless boolean)
       ON CONFLICT (type, country_code, region_code, city_key)
       DO UPDATE SET label = EXCLUDED.label, name_key = EXCLUDED.name_key, job_count = EXCLUDED.job_count, absorbs_regionless = EXCLUDED.absorbs_regionless, updated_at = now()`,
      [JSON.stringify(places)]);
  }
  // Remove places no longer present, by key (no clock comparison). Runs after the
  // upsert so readers never see an empty table; no places at all deletes everything.
  await db.query(
    `DELETE FROM geo_place g WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS r(type text, country_code text, region_code text, city_key text)
       WHERE r.type = g.type AND r.country_code = g.country_code AND r.region_code = g.region_code AND r.city_key = g.city_key)`,
    [JSON.stringify(places.map(({ type, country_code, region_code, city_key }) => ({ type, country_code, region_code, city_key })))]);
  return { countries: countries.rowCount, states: states.rowCount, cities: cities.rowCount };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, c => '\\' + c);

export async function suggestPlaces(db, q, limit = 8) {
  const term = String(q || '').trim().toLowerCase().slice(0, 60);
  if (!term) return [];
  const { rows } = await db.query(
    `SELECT type, label, country_code, region_code, city_key, job_count,
            CASE WHEN type = 'city' THEN split_part(label, ',', 1) ELSE '' END AS city
     FROM geo_place WHERE name_key LIKE $1 || '%' ESCAPE '\\'
     ORDER BY CASE type WHEN 'country' THEN 0 WHEN 'state' THEN 1 ELSE 2 END, job_count DESC, label
     LIMIT $2`, [escapeLike(term), limit]);
  return rows.map(r => ({ type: r.type, label: r.label, country: r.country_code, region: r.region_code, city: r.city, count: r.job_count }));
}

export async function placeCount(db, { country, region = '', city = '' }) {
  const type = city ? 'city' : region ? 'state' : 'country';
  const { rows } = await db.query(
    `SELECT job_count FROM geo_place WHERE type = $1 AND country_code = $2 AND region_code = $3 AND city_key = $4`,
    [type, country, region, city.toLowerCase()]);
  return rows[0] ? rows[0].job_count : null;
}

// Does this country+region+city pick also cover the city's regionless rows?
// Cached in-process ~60 s per db; any failure fails open to "no" (the strict
// region match), never to an error.
const absorbCache = new WeakMap();
export async function isAbsorbing(db, { country, region = '', city = '' }, now = Date.now()) {
  if (!country || !region || !city) return false;
  const key = `${country}|${region}|${city.toLowerCase()}`;
  let m = absorbCache.get(db);
  if (!m) { m = new Map(); absorbCache.set(db, m); }
  const hit = m.get(key);
  if (hit && now - hit.at < ABSORB_TTL_MS) return hit.v;
  try {
    const { rows } = await db.query(
      `SELECT absorbs_regionless FROM geo_place WHERE type = 'city' AND country_code = $1 AND region_code = $2 AND city_key = $3`,
      [country, region, city.toLowerCase()]);
    const v = !!rows[0]?.absorbs_regionless;
    m.set(key, { v, at: now });
    return v;
  } catch {
    return false;
  }
}
export function clearAbsorbCache(db) { absorbCache.delete(db); }
