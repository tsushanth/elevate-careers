// Recurring audit (run weekly, e.g. via cron): surfaces the highest-volume
// RAW location strings that still don't resolve to a known country/region/
// city — i.e. new formatting patterns geo.js hasn't seen yet, the same class
// of bug behind the "Delhi NCR" / "CIS Region" / "Full-time" leaks found by
// hand this session. The point is to catch these proactively, before a user
// has to spot one in production.
//
// This does NOT fix anything — it's a report. Add new entries to geo.js's
// dictionaries/noise lists based on what shows up here, then run
// backfill-job-locations.js --apply to fix existing rows.
//
// Usage:
//   node scripts/audit-unmatched-locations.js              # top 30, all-time
//   node scripts/audit-unmatched-locations.js --days=90     # only recent postings
//   node scripts/audit-unmatched-locations.js --top=50

import { db } from '../src/db/index.js';
import { resolveLocationToken } from '../src/services/geo.js';

const daysArg = process.argv.find(a => a.startsWith('--days='));
const topArg = process.argv.find(a => a.startsWith('--top='));
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : null;
const topN = topArg ? parseInt(topArg.split('=')[1], 10) : 30;

async function main() {
  const { rows } = await db.query(
    `SELECT jl.city, count(*) AS n
     FROM job_location jl
     JOIN job j ON j.id = jl.job_id
     WHERE jl.region IS NULL AND jl.country IS NULL AND jl.city IS NOT NULL
       ${days ? `AND j.posted_at > now() - interval '${days} days'` : ''}
     GROUP BY jl.city
     ORDER BY n DESC
     LIMIT 500`
  );

  // Re-check each against the CURRENT dictionary — this script is meant to
  // run after geo.js has already picked up recent fixes, so only genuinely
  // still-unresolved strings should surface here.
  const unmatched = rows.filter(r => !resolveLocationToken(r.city));

  if (unmatched.length === 0) {
    console.log(`Checked ${rows.length} distinct unresolved city strings — all now match the current dictionary. Run backfill-job-locations.js --apply to write them.`);
    return;
  }

  console.log(`Top ${Math.min(topN, unmatched.length)} highest-volume unresolved location strings${days ? ` (last ${days} days)` : ' (all time)'}:\n`);
  for (const r of unmatched.slice(0, topN)) {
    console.log(`  ${String(r.n).padStart(5)}  ${r.city}`);
  }
  console.log(`\n${unmatched.length} distinct unresolved strings total. Review the top ones above for a new pattern worth adding to geo.js (a new city/country/qualifier, or a noise word).`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
