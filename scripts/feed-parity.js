// scripts/feed-parity.js
// Compares the old /jobs response with the new /v2/jobs/feed for the same
// filters. Differences are expected only for unlocated jobs and inactive jobs;
// this prints the overlap so a human can judge. Read only.
//   node scripts/feed-parity.js [apiBase]
const base = process.argv[2] || 'https://elevate-careers-api.fly.dev';

const cases = [
  { name: 'US', old: 'location=United%20States', neu: 'country=US' },
  { name: 'US remote', old: 'location=United%20States&remote=true', neu: 'country=US&remote=true' },
  { name: 'UK', old: 'location=UK', neu: 'country=GB' },
  { name: 'engineer in US', old: 'location=United%20States&keyword=engineer', neu: 'country=US&q=engineer' },
];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  let body;
  try { body = await res.json(); } catch { throw new Error(`non-JSON response from ${url}`); }
  if (!body || !Array.isArray(body.jobs)) throw new Error(`no jobs array in response from ${url}`);
  return body;
}

let failed = 0;
for (const c of cases) {
  try {
    const t0 = Date.now();
    const o = await getJson(`${base}/jobs?limit=50&${c.old}`);
    const tOld = Date.now() - t0;
    const t1 = Date.now();
    const n = await getJson(`${base}/v2/jobs/feed?limit=25&${c.neu}`);
    const tNew = Date.now() - t1;
    const oldIds = new Set(o.jobs.slice(0, 25).map(j => String(j.id)));
    const overlap = n.jobs.filter(j => oldIds.has(String(j.id))).length;
    console.log(`${c.name.padEnd(16)} old ${String(tOld).padStart(5)} ms  new ${String(tNew).padStart(5)} ms  top-25 overlap ${overlap}/${n.jobs.length}`);
  } catch (e) {
    failed++;
    console.log(`case ${c.name}: FAILED (${e && e.message ? e.message : e})`);
  }
}
if (failed) process.exitCode = 1;
