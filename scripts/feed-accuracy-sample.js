// Usage: node scripts/feed-accuracy-sample.js > sample.csv
// Prints ~300 rows to label by hand: stratified sampling. Takes 12 random rows from each of
// the 20 most common raw country values among active jobs, plus 60 random rows from the long tail.
// This tests per-value correctness of the normaliser, not population distribution.
import { db } from '../src/db/index.js';

const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const top = await db.query(`
  SELECT jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
  WHERE j.is_active GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`);
const topValues = top.rows.map(r => r.country);

const rows = [];
for (const country of topValues) {
  const { rows: part } = await db.query(
    `SELECT jl.city, jl.region, jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
     WHERE j.is_active AND jl.country IS NOT DISTINCT FROM $1 ORDER BY random() LIMIT 12`, [country]);
  rows.push(...part);
}
const { rows: tail } = await db.query(
  `SELECT jl.city, jl.region, jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
   WHERE j.is_active AND (jl.country IS NULL OR jl.country <> ALL($1::text[])) ORDER BY random() LIMIT 60`, [topValues.filter(Boolean)]);
rows.push(...tail);

console.log('city,region,country,label_country,label_region');
for (const r of rows) console.log([q(r.city), q(r.region), q(r.country), '', ''].join(','));
await db.close();
