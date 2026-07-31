// One-off, run by hand: corrects existing job_location rows where the
// bare-country/region parseLocation fix (normalizer.js) wasn't applied yet
// — rows where the whole raw location string landed in `city` with
// `region`/`country` both null (e.g. city="Canada", city="Colombia",
// city="India (Remote)"). Re-parses `city` against the same country/region
// list the live ingestion path now uses, so the two stay consistent.
// Prints what it's about to do first — review before it writes anything.
//
// Usage:
//   node scripts/backfill-job-locations.js            # dry run, prints only
//   node scripts/backfill-job-locations.js --apply     # actually updates

import { db } from '../src/db/index.js';
import { matchCountryOrRegion } from '../src/services/geo.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows } = await db.query(`
    SELECT id, city FROM job_location
    WHERE region IS NULL AND country IS NULL AND city IS NOT NULL
  `);

  const toFix = rows
    .map(r => ({ ...r, match: matchCountryOrRegion(r.city) }))
    .filter(r => r.match);

  if (toFix.length === 0) {
    console.log(`Checked ${rows.length} rows with no region/country — none matched a known country/region name.`);
    return;
  }

  console.log(`${toFix.length} of ${rows.length} rows match a known bare country/region name:\n`);
  const counts = {};
  for (const r of toFix) {
    const key = `${r.city} -> ${r.match.type}:${r.match.value}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${key}`);
  }

  if (!apply) {
    console.log('\nDry run only — pass --apply to actually update.');
    return;
  }

  console.log('\nApplying fixes...');
  let updated = 0;
  for (const r of toFix) {
    if (r.match.type === 'country') {
      await db.query(`UPDATE job_location SET country = $1, city = NULL WHERE id = $2`, [r.match.value, r.id]);
    } else {
      await db.query(`UPDATE job_location SET region = $1, city = NULL WHERE id = $2`, [r.match.value, r.id]);
    }
    updated++;
  }
  console.log(`\nDone. Updated ${updated} rows.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
