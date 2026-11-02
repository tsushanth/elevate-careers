import { useEffect, useState } from 'react';
import { fetchStats } from './feed/feedApi';

// Live inventory numbers for marketing copy. Never hard-code these: they were
// once typed in from a DB snapshot and ended up about 3x the real count.
// Callers must render non-numeric wording until (or unless) this resolves.
const DEFAULT_BASE = 'https://elevate-careers-api.fly.dev';

let cached = null;
let inflight = null;

export function loadSiteStats(base = DEFAULT_BASE) {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchStats(base)
      .then((s) => {
        const ok = s && Number.isFinite(s.jobs) && Number.isFinite(s.companies) && s.jobs > 0 && s.companies > 0;
        cached = ok ? s : null;
        return cached;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// Test hook: forget the cached answer.
export function resetSiteStats() { cached = null; inflight = null; }

// Returns { jobs, companies, remote } once /v2/stats answers, otherwise null.
export function useSiteStats(base = DEFAULT_BASE, enabled = true) {
  const [stats, setStats] = useState(cached);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    loadSiteStats(base).then((s) => { if (live && s) setStats(s); });
    return () => { live = false; };
  }, [base, enabled]);
  return stats;
}

export const fmtCount = (n) => Number(n).toLocaleString('en-US');
