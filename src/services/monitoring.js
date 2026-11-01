/**
 * Signals that do not depend on any one failure path:
 *
 *  - INGEST_STALE: no company has been ingested for 30 h. The daily ingest runs on a separate Fly cron machine; if that
 *    schedule stops firing (or every sync fails) the feed silently ages. One alert per 12 h per process.
 *  - EXTENSION_FILL_FAILURES_HIGH: >= 25 extension fill failures (repair_queue rows touched) in the last hour: a site or
 *    a release broke autofill for many users. One alert per 6 h.
 *  - EXTENSION_NOT_SIGNED_IN: >= 20 'Not signed in' failures in 24 h. Sign-in/token problems look like fill failures.
 *    One alert per 24 h.
 * Counts only: no domains, labels, users. Never throws; returns null when the numbers cannot be read.
 */
import { reportFailure } from '../utils/failureReporter.js';

const HOUR = 3600_000;

export function createMonitor({ db, report = reportFailure, now = Date.now, staleAfterH = 30, fillPerHour = 25, notSignedIn24h = 20 } = {}) {
  const last = {};
  const throttled = (k, ms) => last[k] != null && now() - last[k] < ms;
  const fire = (k, ms, msg, ctx) => { last[k] = now(); report('monitor', new Error(msg), ctx); return msg; };

  async function check() {
    try {
      const [ing, fill, nsi] = await Promise.all([
        db.query(`SELECT EXTRACT(EPOCH FROM (now() - max(last_ingested_at)))/3600 AS age_h FROM discovered_company`),
        db.query(`SELECT count(*)::int AS n FROM repair_queue WHERE last_seen > now() - interval '1 hour'`),
        db.query(`SELECT count(*)::int AS n FROM repair_queue WHERE last_seen > now() - interval '24 hours' AND fail_reason ILIKE 'not signed in%'`),
      ]);
      const ageH = ing.rows?.[0]?.age_h == null ? null : Number(ing.rows[0].age_h);
      const fills = Number(fill.rows?.[0]?.n ?? 0);
      const signedOut = Number(nsi.rows?.[0]?.n ?? 0);
      const alerts = [];
      if ((ageH === null || ageH > staleAfterH) && !throttled('ingest', 12 * HOUR)) alerts.push(fire('ingest', 0, 'INGEST_STALE', { age_hours: ageH === null ? 'never' : String(Math.round(ageH)), limit_hours: String(staleAfterH) }));
      if (fills >= fillPerHour && !throttled('fill', 6 * HOUR)) alerts.push(fire('fill', 0, 'EXTENSION_FILL_FAILURES_HIGH', { failures_1h: String(fills) }));
      if (signedOut >= notSignedIn24h && !throttled('nsi', 24 * HOUR)) alerts.push(fire('nsi', 0, 'EXTENSION_NOT_SIGNED_IN', { failures_24h: String(signedOut) }));
      return { ageH, fills, signedOut, alerts };
    } catch (e) {
      console.warn(`[monitoring] check skipped: ${e?.message || 'error'}`);
      return null;
    }
  }
  return { check };
}

/** unref'd so it never keeps the process alive. First run after 5 minutes, then every 30. */
export function startMonitoringSweep(monitor, intervalMs = 30 * 60_000, firstRunMs = 5 * 60_000) {
  const first = setTimeout(() => { void monitor.check(); }, firstRunMs); first.unref?.();
  const t = setInterval(() => { void monitor.check(); }, intervalMs); t.unref?.();
  return t;
}
