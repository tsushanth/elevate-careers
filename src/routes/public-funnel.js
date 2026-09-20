import express from 'express';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { runStructuralAudit } from './ai-resume.js';
import { sendEmail, makeToken, verifyToken, escapeHtml, SITE_URL, requireSendConfig } from '../services/email.js';
import { confirmationEmail, CONSENT_TEXT, CONSENT_VERSION } from '../services/email-templates.js';

// Public, unauthenticated funnel: free resume check -> double opt-in -> drip
// (drip itself is sent by the Mac mini harness, see harness/email-drip).
const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PER_IP_CHECKS_PER_DAY = 3;
const PER_IP_SUBSCRIBES_PER_DAY = 5;
const globalDailyCap = () => Number(process.env.RESUME_CHECK_DAILY_CAP) || 200;

let _anthropic = null;
const getAnthropic = () => (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

function clientIp(req) {
  return req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}
const ipHash = (req) =>
  crypto.createHash('sha256').update(`${clientIp(req)}|${process.env.EMAIL_TOKEN_SECRET || ''}`).digest('hex').slice(0, 32);

const track = (event, properties = {}) =>
  db.query('insert into analytics_events (event_name, properties) values ($1, $2)', [event, JSON.stringify(properties)]).catch(() => {});

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:96px auto;padding:0 16px;color:#1a1d29"><h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${body}</p><p><a href="${SITE_URL()}">Back to SimplyApply</a></p></body></html>`;

// ── Free resume check (anonymous, rate limited, resume text never stored) ──────
router.post('/resume-check', async (req, res) => {
  try {
    const { resume, role, location, hp } = req.body || {};
    if (hp) return res.status(400).json({ error: 'invalid' });
    const text = typeof resume === 'string' ? resume.trim() : '';
    if (text.length < 200) return res.status(400).json({ error: 'resume_too_short', message: 'Paste at least a few paragraphs of your resume.' });
    if (text.length > 20000) return res.status(400).json({ error: 'resume_too_long', message: 'Please paste 20,000 characters or fewer.' });
    const roleClean = String(role || '').trim().slice(0, 120);
    const locationClean = String(location || '').trim().slice(0, 120);

    const h = ipHash(req);
    const { rows: [usage] } = await db.query(
      `select count(*) filter (where ip_hash = $1)::int as ip_count, count(*)::int as total
       from resume_checks where created_at > now() - interval '24 hours'`, [h]);
    if (usage.ip_count >= PER_IP_CHECKS_PER_DAY) return res.status(429).json({ error: 'rate_limited', message: 'You have used your free checks for today. Come back tomorrow.' });
    if (usage.total >= globalDailyCap()) return res.status(503).json({ error: 'busy', message: 'The free check is at capacity today. Please try again tomorrow.' });

    const structural = runStructuralAudit(text);
    let aiFindings = [];
    let score = null;
    try {
      const completion = await getAnthropic().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        temperature: 0,
        system: 'You are an ATS/resume quality auditor. Judge the resume on its own merits. Respond with ONLY JSON: {"overallScore": integer 0-100, "findings": [{"severity": "warn" or "info", "text": string}]} with at most 5 findings. Each finding must be specific and actionable and may quote the resume\'s own wording. Never invent facts.',
        messages: [{ role: 'user', content: `Resume text:\n${text.slice(0, 8000)}` }],
      });
      const parsed = JSON.parse(completion.content[0].text.trim().replace(/```json\n?|\n?```/g, ''));
      if (Number.isFinite(parsed.overallScore)) score = Math.max(0, Math.min(100, Math.round(parsed.overallScore)));
      aiFindings = (Array.isArray(parsed.findings) ? parsed.findings : []).filter((f) => f && typeof f.text === 'string');
    } catch (e) {
      logger.warn({ err: e.message }, 'public resume-check AI pass failed');
    }

    const all = [...structural, ...aiFindings];
    if (score === null) {
      const warns = all.filter((f) => f.severity === 'warn').length;
      score = Math.max(30, Math.min(95, 100 - warns * 12 - (all.length - warns) * 4));
    }
    const ordered = [...all.filter((f) => f.severity === 'warn'), ...all.filter((f) => f.severity !== 'warn')];
    const findings = ordered.slice(0, 5).map((f) => ({ severity: f.severity, text: String(f.text).slice(0, 300) }));

    let jobs = [];
    if (roleClean) {
      const params = [roleClean];
      let locSql = '';
      if (locationClean) {
        params.push(`%${locationClean}%`);
        locSql = 'and exists (select 1 from job_location jl where jl.job_id = j.id and (jl.city ilike $2 or jl.region ilike $2 or jl.country ilike $2))';
      }
      const r = await db.query(
        `select j.id, j.title, j.apply_url, j.remote, c.name as company_name
         from job j join company c on j.company_id = c.id
         where j.is_active = true and j.tsv @@ plainto_tsquery('english', $1) ${locSql}
         order by j.posted_at desc nulls last limit 5`, params);
      jobs = r.rows;
    }

    const result = { score, findings, fixes: findings.slice(0, 3).map((f) => f.text), jobs, role: roleClean, location: locationClean };
    const { rows: [saved] } = await db.query('insert into resume_checks (ip_hash, result) values ($1, $2) returning id', [h, JSON.stringify(result)]);
    track('resume_check_completed', { score, has_role: !!roleClean });
    res.json({ checkId: saved.id, score, findings, jobs });
  } catch (e) {
    logger.error({ err: e.message }, 'public resume-check failed');
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
});

// ── Subscribe (double opt-in) ──────────────────────────────────────────────────
async function sendConfirmation(subscriber) {
  const confirmUrl = `${SITE_URL()}/api/public/confirm?token=${encodeURIComponent(subscriber.confirm_token)}`;
  const mail = confirmationEmail({ confirmUrl });
  const out = await sendEmail({ to: subscriber.email, ...mail });
  if (out.ok) await db.query('update email_subscribers set last_confirm_sent_at = now() where id = $1', [subscriber.id]);
  return out;
}

router.post('/subscribe', async (req, res) => {
  try {
    const { email, consent, checkId, role, location, source, hp } = req.body || {};
    if (hp) return res.json({ ok: true });
    if (consent !== true) return res.status(400).json({ error: 'consent_required', message: 'Please tick the box to agree to receive emails.' });
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254) return res.status(400).json({ error: 'invalid_email', message: 'Please enter a valid email address.' });
    const problem = requireSendConfig();
    if (problem) {
      logger.error({ problem }, 'subscribe unavailable');
      return res.status(503).json({ error: 'email_unavailable', message: 'Email signup is temporarily unavailable.' });
    }

    const h = ipHash(req);
    const { rows: [rl] } = await db.query(`select count(*)::int as n from email_subscribers where consent_ip_hash = $1 and created_at > now() - interval '24 hours'`, [h]);
    if (rl.n >= PER_IP_SUBSCRIBES_PER_DAY) return res.status(429).json({ error: 'rate_limited', message: 'Too many signups from this network today.' });

    const consentText = `${CONSENT_VERSION}: ${CONSENT_TEXT}`;
    const token = crypto.randomBytes(24).toString('base64url');
    const { rows: [existing] } = await db.query('select * from email_subscribers where lower(email) = $1', [e]);
    let subscriber = existing;

    if (existing) {
      if (['bounced', 'complained', 'active'].includes(existing.status)) return res.json({ ok: true });
      if (existing.status === 'unsubscribed') {
        const { rows: [u] } = await db.query(
          `update email_subscribers set status = 'pending', confirm_token = $2, consent_text = $3, consent_at = now(), consent_ip_hash = $4,
             target_role = $5, target_location = $6, unsubscribed_at = null, confirmed_at = null where id = $1 returning *`,
          [existing.id, token, consentText, h, String(role || '').slice(0, 120) || null, String(location || '').slice(0, 120) || null]);
        subscriber = u;
      } else if (existing.last_confirm_sent_at && Date.now() - new Date(existing.last_confirm_sent_at).getTime() < 10 * 60_000) {
        return res.json({ ok: true });
      }
    } else {
      const { rows: [c] } = await db.query(
        `insert into email_subscribers (email, source, target_role, target_location, consent_text, consent_ip_hash, confirm_token)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [e, String(source || 'resume-check').slice(0, 60), String(role || '').slice(0, 120) || null, String(location || '').slice(0, 120) || null, consentText, h, token]);
      subscriber = c;
    }

    // bigint ids come back from pg as strings, so accept digit strings as well as numbers
    const checkIdNum = Number(checkId);
    if (Number.isInteger(checkIdNum) && checkIdNum > 0) await db.query('update resume_checks set subscriber_id = $1 where id = $2 and subscriber_id is null', [subscriber.id, checkIdNum]);
    const sent = await sendConfirmation(subscriber);
    if (!sent.ok) logger.error({ error: sent.error }, 'confirmation email failed');
    track('email_subscribe_requested');
    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e.message }, 'subscribe failed');
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
});

router.get('/confirm', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const { rows: [s] } = await db.query('select id, status from email_subscribers where confirm_token = $1', [token]);
    if (!s) return res.status(400).send(page('This link isn\'t valid', 'The confirmation link is invalid or has expired. You can request a new one from the resume check page.'));
    if (s.status === 'pending') {
      await db.query(`update email_subscribers set status = 'active', confirmed_at = now() where id = $1`, [s.id]);
      track('email_confirmed');
    }
    res.send(page('You\'re confirmed', 'Thanks. Your results and a few job-search tips are on the way.'));
  } catch (e) {
    logger.error({ err: e.message }, 'confirm failed');
    res.status(500).send(page('Something went wrong', 'Please try the link again in a moment.'));
  }
});

// GET (link click) and POST (RFC 8058 one-click) both unsubscribe.
router.all('/unsubscribe', async (req, res) => {
  try {
    const email = verifyToken(String(req.query.token || ''));
    if (!email) return res.status(400).send(page('This link isn\'t valid', 'If you want to stop receiving our emails, reply to any of them and we\'ll remove you.'));
    await db.query(`update email_subscribers set status = 'unsubscribed', unsubscribed_at = now() where lower(email) = $1 and status in ('pending', 'active')`, [email]);
    track('email_unsubscribed');
    res.send(page('You\'re unsubscribed', `${escapeHtml(email)} won't receive any more emails from SimplyApply.`));
  } catch (e) {
    logger.error({ err: e.message }, 'unsubscribe failed');
    res.status(500).send(page('Something went wrong', 'Please try again, or reply to any of our emails and we\'ll remove you.'));
  }
});

// Resend delivery webhook: stop mailing addresses that bounce or complain.
router.post('/webhooks/resend', async (req, res) => {
  const expected = process.env.RESEND_WEBHOOK_TOKEN || '';
  const given = String(req.query.token || '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
  const status = { 'email.bounced': 'bounced', 'email.complained': 'complained' }[req.body?.type];
  if (!status) return res.json({ ok: true, ignored: true });
  const recipients = (req.body?.data?.to || []).map((x) => String(x).toLowerCase());
  if (recipients.length) await db.query(`update email_subscribers set status = $1 where lower(email) = any($2::text[]) and status <> 'unsubscribed'`, [status, recipients]);
  res.json({ ok: true });
});

export default router;
