// routes/repair.js — Self-healing rule engine
//
// Public (extension):
//   POST /api/repair/queue  — report a failed field
//   GET  /api/repair/rules  — fetch approved remote rules
//
// Admin (repair-agent CLI only, requires REPAIR_ADMIN_SECRET):
//   GET  /api/repair/admin/queue   — list unresolved failures
//   POST /api/repair/admin/rules   — upsert an approved rule
//   POST /api/repair/admin/resolve — mark queue items resolved

import { reportFailure } from '../utils/failureReporter.js';
import express, { Router } from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { redactFailReason, redactHtml, redactLabel, identifierOrNull, createRateLimiter, failKind } from '../utils/repairRedaction.js';

function requireAdminSecret(req, res, next) {
  const secret = process.env.REPAIR_ADMIN_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const router = Router();

// A field report is the only sign the server gets of an autofill run that filled nothing (shipped extensions record a run
// only when something was filled). One anonymous row per site per 10 minutes, roughly one per run: site and kind of
// failure, with no account, id, label or value. Runs that neither fill nor fail a field still leave nothing.
const FILL_ERROR_EVENT = `
  INSERT INTO analytics_events (event_name, surface, properties)
  SELECT 'extension_fill_error', 'extension', jsonb_build_object('host', $1::text, 'reason', $2::text)
  WHERE NOT EXISTS (
    SELECT 1 FROM analytics_events
    WHERE event_name = 'extension_fill_error' AND created_at > now() - interval '10 minutes' AND properties->>'host' = $1::text)`;

// POST /queue needs no sign-in (the extension reports signed-out failures too), so it is bounded instead. Mounted by
// server.js before the global 50x larger parser. Shipped extensions send with keepalive, which the browser caps at 64 KB.
// A refused body is answered here: the app-wide handler would turn it into a 500 and log the raw body of a bad one.
export const queueBodyLimit = [
  express.json({ limit: '64kb' }),
  (err, _req, res, _next) => res.status(err.status || 400).json({ ok: false }),
];
const allowReport = createRateLimiter();

// ── POST /queue ───────────────────────────────────────────────────────────────
// Receives a failure report from the extension. Upserts by (domain, label):
// first report creates the row; subsequent ones increment count + refresh HTML.
// Fire-and-forget from the client — always returns 200.
router.post('/queue', async (req, res) => {
  // The extension never reads the answer, so a refused report costs the user nothing.
  if (!allowReport(String(req.headers['fly-client-ip'] || req.ip))) return res.status(429).json({ ok: false });
  res.json({ ok: true }); // respond immediately, don't block the user's fill run

  const { domain, label, fieldType, outerHTML, failReason, fillTried } = req.body || {};
  if (typeof domain !== 'string' || !/^[A-Za-z0-9._-]{1,253}$/.test(domain) || typeof label !== 'string' || !label) return;

  // Redacted before anything is stored or logged (utils/repairRedaction.js).
  const safeLabel = redactLabel(label);
  const safeReason = redactFailReason(failReason);

  try {
    await db.query(FILL_ERROR_EVENT, [domain.toLowerCase(), failKind(safeReason)]);
  } catch (e) {
    logger.warn({ error: e, domain }, 'fill error event not recorded');
  }

  try {
    await db.query(`
      INSERT INTO repair_queue (domain, label, field_type, outer_html, fail_reason, fill_tried)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (domain, label) DO UPDATE SET
        outer_html  = EXCLUDED.outer_html,
        fail_reason = EXCLUDED.fail_reason,
        fill_tried  = EXCLUDED.fill_tried,
        count       = repair_queue.count + 1,
        last_seen   = now(),
        resolved    = false
    `, [domain, safeLabel, identifierOrNull(fieldType), redactHtml(outerHTML), safeReason, identifierOrNull(fillTried)]);
  } catch (e) {
    logger.error({ error: e, domain, label: safeLabel }, 'repair_queue upsert failed');
    reportFailure('repair:queue_upsert_failed', new Error('repair_queue upsert failed')); // the client got 200 already: this is the only signal
  }
});

// ── GET /rules ────────────────────────────────────────────────────────────────
// Returns all active approved rules in the same JSON schema as static-rules.js.
// Cached by sw.js every 6 hours.
router.get('/rules', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, version, match_json AS match, fix_json AS fix
      FROM ats_rules
      WHERE active = true
      ORDER BY approved_at ASC
    `);
    res.json(rows);
  } catch (e) {
    logger.error({ error: e }, 'ats_rules fetch failed');
    res.status(500).json({ error: 'failed to fetch rules' });
  }
});

// ── GET /admin/queue ──────────────────────────────────────────────────────────
// Returns unresolved failures for the repair-agent CLI. Optional ?domain= filter.
router.get('/admin/queue', requireAdminSecret, async (req, res) => {
  const { domain } = req.query;
  const params = [];
  let where = 'WHERE resolved = false';
  if (domain) { where += ' AND domain = $1'; params.push(domain); }

  try {
    const { rows } = await db.query(
      `SELECT domain, label, field_type, outer_html, fail_reason, fill_tried, count, last_seen
       FROM repair_queue ${where} ORDER BY count DESC, last_seen DESC LIMIT 50`,
      params,
    );
    // Redacted again on the way out: rows stored before redaction still hold typed values.
    res.json(rows.map((row) => ({
      ...row,
      outer_html: redactHtml(row.outer_html),
      fail_reason: redactFailReason(row.fail_reason),
      fill_tried: identifierOrNull(row.fill_tried),
    })));
  } catch (e) {
    logger.error({ error: e }, 'admin/queue fetch failed');
    res.status(500).json({ error: 'query failed' });
  }
});

// ── POST /admin/rules ─────────────────────────────────────────────────────────
// Upserts an approved rule into ats_rules. On conflict (same id) upgrades the version.
router.post('/admin/rules', requireAdminSecret, async (req, res) => {
  const { id, version, match, fix, note } = req.body;
  if (!id || !match || !fix) return res.status(400).json({ error: 'id, match, fix required' });

  try {
    await db.query(
      `INSERT INTO ats_rules (id, version, match_json, fix_json, note, active, approved_at)
       VALUES ($1, $2, $3, $4, $5, true, now())
       ON CONFLICT (id) DO UPDATE SET
         version     = EXCLUDED.version,
         match_json  = EXCLUDED.match_json,
         fix_json    = EXCLUDED.fix_json,
         note        = EXCLUDED.note,
         active      = true,
         approved_at = now()`,
      [id, version ?? 1, JSON.stringify(match), JSON.stringify(fix), note ?? null],
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error({ error: e, id }, 'ats_rules upsert failed');
    res.status(500).json({ error: 'upsert failed' });
  }
});

// ── POST /admin/resolve ───────────────────────────────────────────────────────
// Marks queue items as resolved after a rule is approved. Pass label to resolve
// just one field; omit label to resolve all failures for the domain.
router.post('/admin/resolve', requireAdminSecret, async (req, res) => {
  const { domain, label } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  try {
    const q = label
      ? 'UPDATE repair_queue SET resolved = true WHERE domain = $1 AND label = $2'
      : 'UPDATE repair_queue SET resolved = true WHERE domain = $1';
    await db.query(q, label ? [domain, label] : [domain]);
    res.json({ ok: true });
  } catch (e) {
    logger.error({ error: e }, 'admin/resolve failed');
    res.status(500).json({ error: 'update failed' });
  }
});

export default router;
