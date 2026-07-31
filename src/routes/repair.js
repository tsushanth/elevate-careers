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

import { Router } from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

function requireAdminSecret(req, res, next) {
  const secret = process.env.REPAIR_ADMIN_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const router = Router();

// ── POST /queue ───────────────────────────────────────────────────────────────
// Receives a failure report from the extension. Upserts by (domain, label):
// first report creates the row; subsequent ones increment count + refresh HTML.
// Fire-and-forget from the client — always returns 200.
router.post('/queue', async (req, res) => {
  res.json({ ok: true }); // respond immediately, don't block the user's fill run

  const { domain, label, fieldType, outerHTML, failReason, fillTried } = req.body || {};
  if (!domain || !label) return;

  const html = typeof outerHTML === 'string' ? outerHTML.slice(0, 3000) : null;

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
    `, [domain, label, fieldType, html, failReason, fillTried]);
  } catch (e) {
    logger.error({ error: e, domain, label }, 'repair_queue upsert failed');
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
    res.json(rows);
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
