// src/services/geoPlace.js
// The selectable places for the typeahead, rebuilt from job_feed counts.
import { COUNTRY_NAME_BY_ISO, US_STATES, CA_PROVINCES, UNKNOWN_COUNTRY } from './places.js';

const MIN_CITY_JOBS = 3;

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

  const cities = await db.query(
    `SELECT country_code, region_code, city_key, min(city) AS city, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND city_key <> '' AND country_code <> $1
     GROUP BY 1, 2, 3 HAVING count(DISTINCT job_id) >= $2`, [UNKNOWN_COUNTRY, MIN_CITY_JOBS]);
  for (const r of cities.rows) {
    const cname = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!cname) continue;
    const sname = r.region_code ? stateName(r.country_code, r.region_code) : null;
    places.push({ type: 'city', label: [r.city, sname, cname].filter(Boolean).join(', '), name_key: r.city.toLowerCase(), country_code: r.country_code, region_code: r.region_code, city_key: r.city_key, job_count: r.n });
  }

  if (places.length) {
    await db.query(
      `INSERT INTO geo_place (type, label, name_key, country_code, region_code, city_key, job_count, updated_at)
       SELECT type, label, name_key, country_code, region_code, city_key, job_count, now()
       FROM jsonb_to_recordset($1::jsonb) AS r(type text, label text, name_key text, country_code text, region_code text, city_key text, job_count int)
       ON CONFLICT (type, country_code, region_code, city_key)
       DO UPDATE SET label = EXCLUDED.label, name_key = EXCLUDED.name_key, job_count = EXCLUDED.job_count, updated_at = now()`,
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
     ORDER BY job_count DESC, label LIMIT $2`, [escapeLike(term), limit]);
  return rows.map(r => ({ type: r.type, label: r.label, country: r.country_code, region: r.region_code, city: r.city, count: r.job_count }));
}

export async function placeCount(db, { country, region = '', city = '' }) {
  const type = city ? 'city' : region ? 'state' : 'country';
  const { rows } = await db.query(
    `SELECT job_count FROM geo_place WHERE type = $1 AND country_code = $2 AND region_code = $3 AND city_key = $4`,
    [type, country, region, city.toLowerCase()]);
  return rows[0] ? rows[0].job_count : null;
}
