import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { sendEmail, requireSendConfig } from '../../src/services/email.js';
import { dripEmail, DRIP_STEPS } from '../../src/services/email-templates.js';

// One bounded pass of the drip, launched by launchd every couple of hours.
// Everyone here confirmed their address (double opt-in); copy is templated.
// Guard rails enforced in code:
//   STOP file      -> send nothing (touch ~/.simplyapply-drip/STOP)
//   per-run cap    -> at most DRIP_MAX_PER_RUN emails (default 10, hard ceiling 25)
//   one step max   -> a subscriber gets at most one email per run, and steps are >= 48h apart
//   never twice    -> the email_sends row is claimed BEFORE sending (unique subscriber+step)
//   status re-check-> unsubscribed/bounced/complained addresses are re-checked right before send
//   deadline, disk floor, missing-config refusal

const BASE = join(homedir(), '.simplyapply-drip');
const STOP = join(BASE, 'STOP');
const RUNS = join(BASE, 'runs.jsonl');
const DEADLINE_MS = 20 * 60_000;
const MIN_FREE_MB = 400;
const MIN_GAP_MS = 48 * 3600_000;
const RETRY_AFTER_MS = 2 * 3600_000;
const MAX_ATTEMPTS = 3;
const dryRun = process.env.DRY_RUN === '1';

const clamp = (v, max, fallback) => { const n = Number(v); return Math.min(max, Math.max(0, Number.isFinite(n) ? Math.floor(n) : fallback)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

function freeMb() {
  try { return Math.floor(Number(execSync("df -k / | awk 'NR==2 {print $4}'").toString().trim()) / 1024); } catch { return Infinity; }
}

async function matchingJobs(sb, role, location) {
  if (!role) return [];
  const base = () => sb.from('job').select('id,title,apply_url,company!inner(name)').eq('is_active', true)
    .textSearch('tsv', role, { type: 'plain', config: 'english' }).order('posted_at', { ascending: false, nullsFirst: false }).limit(5);
  let rows = [];
  if (location) {
    const like = `%${location.replace(/[,%()]/g, ' ')}%`;
    const { data } = await sb.from('job').select('id,title,apply_url,company!inner(name),job_location!inner(city,region,country)')
      .eq('is_active', true).textSearch('tsv', role, { type: 'plain', config: 'english' })
      .or(`city.ilike.${like},region.ilike.${like},country.ilike.${like}`, { referencedTable: 'job_location' })
      .order('posted_at', { ascending: false, nullsFirst: false }).limit(5);
    rows = data || [];
  }
  if (!rows.length) rows = (await base()).data || [];
  const seen = new Set();
  return rows
    .map((j) => ({ id: j.id, title: j.title, apply_url: j.apply_url, company_name: j.company?.name || 'a company' }))
    .filter((j) => { const k = `${j.title}|${j.company_name}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function main() {
  mkdirSync(BASE, { recursive: true });
  if (existsSync(STOP)) { log('STOP file present, sending nothing'); return 0; }
  const free = freeMb();
  if (free < MIN_FREE_MB) { console.error(`only ${free} MB free, skipping`); return 2; }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set'); return 2; }

  const cap = clamp(process.env.DRIP_MAX_PER_RUN, 25, 10);
  const started = Date.now();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const { data: subs, error } = await sb.from('email_subscribers')
    .select('id,email,target_role,target_location,confirmed_at').eq('status', 'active').not('confirmed_at', 'is', null).limit(2000);
  if (error) throw new Error(`load subscribers: ${error.message}`);

  const sendsBySub = new Map();
  const ids = (subs || []).map((s) => s.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await sb.from('email_sends').select('subscriber_id,step,status,attempts,created_at,sent_at').in('subscriber_id', ids.slice(i, i + 200));
    for (const r of rows || []) { if (!sendsBySub.has(r.subscriber_id)) sendsBySub.set(r.subscriber_id, []); sendsBySub.get(r.subscriber_id).push(r); }
  }

  // Work out each subscriber's single next action (new step, or retry of a failed one).
  const due = [];
  const now = Date.now();
  for (const s of subs || []) {
    const rows = sendsBySub.get(s.id) || [];
    const byStep = new Map(rows.map((r) => [r.step, r]));
    for (const { step, dayOffset } of DRIP_STEPS) {
      const existing = byStep.get(step);
      if (existing) {
        if (existing.status === 'sent') continue; // settled, look at the next step
        const retriable = existing.status === 'failed' && existing.attempts < MAX_ATTEMPTS && now - new Date(existing.created_at).getTime() > RETRY_AFTER_MS;
        if (retriable) due.push({ sub: s, step, retry: existing, dueAt: now });
        break; // in flight, skipped, or out of retries: nothing more for this subscriber
      }
      const prev = byStep.get(step - 1);
      if (step > 1 && prev?.status !== 'sent') break; // never skip ahead of an unsent earlier step
      const prevAt = prev ? new Date(prev.sent_at || prev.created_at).getTime() : 0;
      const dueAt = Math.max(new Date(s.confirmed_at).getTime() + dayOffset * 86400_000, prev ? prevAt + MIN_GAP_MS : 0);
      if (dueAt <= now) due.push({ sub: s, step, retry: null, dueAt });
      break;
    }
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  const batch = due.slice(0, cap);
  log(`${subs?.length ?? 0} active subscribers, ${due.length} due, sending up to ${cap}${dryRun ? ' (DRY RUN)' : ''}`);

  // Only complain about missing send config when there is actually something to send.
  const cfg = requireSendConfig();
  if (cfg && !dryRun && batch.length) { console.error(`refusing to send: ${cfg}`); return 2; }

  const summary = { at: new Date().toISOString(), dryRun, active: subs?.length ?? 0, due: due.length, sent: 0, failed: 0, skipped: 0 };
  for (const item of batch) {
    if (existsSync(STOP) || Date.now() - started > DEADLINE_MS) { log('stopping early (STOP file or deadline)'); break; }
    const { sub, step } = item;
    if (dryRun) { log(`would send step ${step} to ${sub.email}`); continue; }

    // Claim the step first; a unique (subscriber, step) row makes a double send impossible.
    let claimed;
    if (item.retry) {
      const { data } = await sb.from('email_sends').update({ status: 'sending', attempts: item.retry.attempts + 1 })
        .eq('subscriber_id', sub.id).eq('step', step).eq('status', 'failed').select('id');
      claimed = !!data?.length;
    } else {
      const { error: e } = await sb.from('email_sends').insert({ subscriber_id: sub.id, step, status: 'sending' });
      claimed = !e;
    }
    if (!claimed) { summary.skipped++; continue; }

    // Final status re-check right before sending.
    const { data: fresh } = await sb.from('email_subscribers').select('status').eq('id', sub.id).single();
    if (fresh?.status !== 'active') {
      await sb.from('email_sends').update({ status: 'skipped', error: `subscriber is ${fresh?.status}` }).eq('subscriber_id', sub.id).eq('step', step);
      summary.skipped++; continue;
    }

    let score, fixes = [];
    if (step === 1) {
      const { data: rc } = await sb.from('resume_checks').select('result').eq('subscriber_id', sub.id).order('created_at', { ascending: false }).limit(1);
      score = rc?.[0]?.result?.score; fixes = rc?.[0]?.result?.fixes || [];
    }
    const jobs = await matchingJobs(sb, sub.target_role, sub.target_location);
    const mail = dripEmail(step, { role: sub.target_role, score, fixes, jobs });
    const out = await sendEmail({ to: sub.email, ...mail });
    if (out.ok) {
      await sb.from('email_sends').update({ status: 'sent', sent_at: new Date().toISOString(), resend_id: out.id, error: null }).eq('subscriber_id', sub.id).eq('step', step);
      summary.sent++; log(`sent step ${step} to ${sub.email}`);
    } else {
      await sb.from('email_sends').update({ status: 'failed', error: String(out.error).slice(0, 300) }).eq('subscriber_id', sub.id).eq('step', step);
      summary.failed++; log(`FAILED step ${step} to ${sub.email}: ${out.error}`);
    }
    await sleep(700);
  }
  appendFileSync(RUNS, JSON.stringify(summary) + '\n');
  log(JSON.stringify(summary));
  return summary.failed > 0 && summary.sent === 0 ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('drip harness crashed:', e); process.exit(1); });
