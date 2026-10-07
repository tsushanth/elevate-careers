// Idempotent and resumable. Run while ingestion is idle or accept some contention.
//   node scripts/backfill-job-feed.js [--from=0] [--batch=500] [--sleep=100]
import { db } from '../src/db/index.js';
import { syncJobFeedBatch } from '../src/services/jobFeed.js';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
let from = arg('from', 0);
const batch = arg('batch', 500);
const sleepMs = arg('sleep', 100);

let written = 0;
for (;;) {
  const { rows } = await db.query(
    'SELECT id::int AS id FROM job WHERE id > $1 ORDER BY id LIMIT $2', [from, batch]);
  if (!rows.length) break;
  written += await syncJobFeedBatch(db, rows.map(r => r.id));
  from = rows[rows.length - 1].id;
  console.log(`last id ${from}, rows written so far ${written}`);
  await new Promise(r => setTimeout(r, sleepMs));
}
console.log(`done. rows written: ${written}`);
await db.close();
