// Usage: node scripts/feed-accuracy-check.js sample.csv
// sample.csv columns: city,region,country,label_country,label_region
// label_* are filled in by hand. Exits 1 when agreement is below 95%.
import fs from 'node:fs';
import { normalizeLocationRow } from '../src/services/places.js';

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rest] = lines;
  const cols = split(head).map(c => c.trim());
  return rest.map(l => Object.fromEntries(split(l).map((v, i) => [cols[i], v.trim()])));
}

export function agreement(rows) {
  let matched = 0;
  for (const r of rows) {
    const n = normalizeLocationRow({ city: r.city, region: r.region, country: r.country });
    const okCountry = n.country_code === r.label_country;
    const okRegion = (n.region_code || '') === (r.label_region || '');
    if (okCountry && okRegion) matched++;
  }
  const total = rows.length;
  return { total, matched, pct: total ? Math.round((matched / total) * 1000) / 10 : 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = parseCsv(fs.readFileSync(process.argv[2], 'utf8')).filter(r => r.label_country);
  const r = agreement(rows);
  console.log(`${r.matched}/${r.total} agree (${r.pct}%)`);
  process.exit(r.pct >= 95 ? 0 : 1);
}
