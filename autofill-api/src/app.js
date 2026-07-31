import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Service-role client for server-side auth verification
function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// Free tier: 30 AI fills per month
const FREE_MONTHLY_LIMIT = 30;

export function createApp({ legacyToken, claudeClient } = {}) {
  const app = new Hono();

  app.use('*', cors({
    origin: ['https://elevatecareers.us', 'chrome-extension://*', '*'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  // ── Auth middleware ───────────────────────────────────────────────────────────
  // Supports two modes:
  //   1. Supabase JWT (new): Authorization: Bearer <supabase_access_token>
  //   2. Legacy static token (personal use): Authorization: Bearer <legacyToken>
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();

    const header = c.req.header('Authorization') || '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    // Legacy single-user token (extension personal use)
    if (legacyToken && token === legacyToken) {
      c.set('userId', 'legacy');
      c.set('tier', 'pro');
      return next();
    }

    // Supabase JWT
    try {
      const supabase = getSupabase();
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

      c.set('userId', user.id);
      c.set('userEmail', user.email);

      // Check subscription tier from user_profile
      const { data: profile } = await supabase
        .from('user_profile')
        .select('subscription_tier, monthly_ai_count, monthly_ai_reset_at')
        .eq('user_id', user.id)
        .single();

      c.set('tier', profile?.subscription_tier || 'free');
      c.set('monthlyCount', profile?.monthly_ai_count || 0);
      c.set('resetAt', profile?.monthly_ai_reset_at);
    } catch (_) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  });

  app.get('/health', c => c.json({ ok: true }));

  // ── Profile ───────────────────────────────────────────────────────────────────
  app.get('/profile', async c => {
    const userId = c.get('userId');
    if (userId === 'legacy') return c.json({ ok: true, profile: {} });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_profile')
      .select('autofill_data, subscription_tier, monthly_ai_count')
      .eq('user_id', userId)
      .single();

    if (error) return c.json({ profile: null });
    return c.json({ profile: data?.autofill_data || {}, tier: data?.subscription_tier || 'free', monthlyCount: data?.monthly_ai_count || 0 });
  });

  app.put('/profile', async c => {
    const userId = c.get('userId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);

    if (userId === 'legacy') return c.json({ ok: true });

    const supabase = getSupabase();
    await supabase.from('user_profile').upsert({
      user_id: userId,
      autofill_data: body,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return c.json({ ok: true });
  });

  // ── AI usage gate ─────────────────────────────────────────────────────────────
  async function checkAndIncrementUsage(c) {
    const userId = c.get('userId');
    if (userId === 'legacy') return { allowed: true };

    const tier = c.get('tier');
    if (tier === 'pro') return { allowed: true };

    const supabase = getSupabase();
    const { data: profile } = await supabase
      .from('user_profile')
      .select('monthly_ai_count, monthly_ai_reset_at')
      .eq('user_id', userId)
      .single();

    const now = new Date();
    const resetAt = profile?.monthly_ai_reset_at ? new Date(profile.monthly_ai_reset_at) : null;
    const needsReset = !resetAt || now > resetAt;

    let count = needsReset ? 0 : (profile?.monthly_ai_count || 0);

    if (count >= FREE_MONTHLY_LIMIT) {
      return { allowed: false, count, limit: FREE_MONTHLY_LIMIT };
    }

    // Increment
    await supabase.from('user_profile').upsert({
      user_id: userId,
      monthly_ai_count: count + 1,
      monthly_ai_reset_at: needsReset
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
        : profile.monthly_ai_reset_at,
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' });

    return { allowed: true, count: count + 1, limit: FREE_MONTHLY_LIMIT };
  }

  // ── Copilot answer ────────────────────────────────────────────────────────────
  app.post('/copilot/answer', async c => {
    const usage = await checkAndIncrementUsage(c);
    if (!usage.allowed) {
      return c.json({ error: 'free_limit_reached', count: usage.count, limit: usage.limit }, 402);
    }

    const { question, jobDescription, profile } = await c.req.json().catch(() => ({}));
    if (!question) return c.json({ error: 'question required' }, 400);

    const answer = await askClaude(claudeClient, question, jobDescription, profile || {});
    return c.json({ answer, usage: { count: usage.count, limit: usage.limit } });
  });

  app.post('/copilot/answer/batch', async c => {
    const { questions, jobDescription, profile } = await c.req.json().catch(() => ({}));
    if (!Array.isArray(questions) || questions.length === 0) {
      return c.json({ error: 'questions array required' }, 400);
    }

    const usage = await checkAndIncrementUsage(c);
    if (!usage.allowed) {
      return c.json({ error: 'free_limit_reached', count: usage.count, limit: usage.limit }, 402);
    }

    const answers = await Promise.all(
      questions.map(q => askClaude(claudeClient, q, jobDescription, profile || {}).then(answer => ({ question: q, answer })))
    );
    return c.json({ answers });
  });

  // ── Resume tailor ─────────────────────────────────────────────────────────────
  app.post('/resume/tailor', async c => {
    const usage = await checkAndIncrementUsage(c);
    if (!usage.allowed) {
      return c.json({ error: 'free_limit_reached', count: usage.count, limit: usage.limit }, 402);
    }

    const { jobDescription, jobTitle, resumeText } = await c.req.json().catch(() => ({}));
    if (!jobDescription) return c.json({ error: 'jobDescription required' }, 400);

    const pdfBytes = await tailorResume(claudeClient, jobDescription, jobTitle || '', resumeText);
    const b64 = Buffer.from(pdfBytes).toString('base64');
    return c.json({ pdf: b64, filename: 'Resume.pdf', usage: { count: usage.count, limit: usage.limit } });
  });

  // ── Subscription status ───────────────────────────────────────────────────────
  app.get('/subscription', async c => {
    const userId = c.get('userId');
    const tier = c.get('tier');
    const count = c.get('monthlyCount') || 0;
    return c.json({ tier, monthlyCount: count, limit: FREE_MONTHLY_LIMIT, userId });
  });

  return app;
}

// ── Claude helpers ────────────────────────────────────────────────────────────
const MASTER_RESUME = `SUSHANTH TIRUVAIPATI
Bay Area, CA · t.sushanth@gmail.com · 425-628-4887 · linkedin.com/in/tsushanth · github.com/tsushanth

EXPERIENCE

Software Engineer · Google  |  Sep 2015 – Present
Delivering high-impact projects across Ads, Cloud, Play, and YouTube, with experience leading teams and mentoring engineers.

Ads — Dynamic Display Ads & Conversion Tracking  [ C++ · Python · SQL · TensorFlow · Spanner · Borg ]
- Lead conversion attribution systems that model how users interact with ads across Shopping, Search, Gmail, and YouTube to improve ad relevance and bidding accuracy.
- Drove unification of conversion tracking signals across Google's ad surfaces, enabling consistent measurement and attribution at scale.
- Led a team of 5 engineers researching proprietary and experimental user-attribution methodologies.
- Ensured ad systems remained compliant with evolving privacy regulations including the EU Digital Markets Act (DMA).

Google Cloud — Contact Center AI (CCAI)  [ Java · Python · TensorFlow · NLP · gRPC ]
- Part of the Cloud AI organization building AI-powered vertical solutions for enterprise customers.
- Contributed to Contact Center AI, a platform transforming the contact-center industry with conversational AI and NLU.
- Built topic-modeling solutions that automatically extract and summarize key topics from customer conversations at scale.

Google Play — Search Ranking  [ C++ · Python · TensorFlow · MapReduce · A/B experimentation ]
- Worked on prefix search ranking for the Google Play Store, improving relevance and quality of real-time query results.
- Developed and iterated on ranking models balancing user-intent signals, app quality, and engagement metrics.

YouTube — Data & ML (Promo Performance)  [ Java · Python · SQL · Hadoop · MapReduce · Dataflow ]
- Built and maintained large-scale data pipelines for analyzing promotional campaign performance.

Founder & Sole Engineer · KreativeKoala Solutions LLC  |  2021 – Present
Solo-operator mobile portfolio of 70+ shipped apps with active users and revenue across App Store and Google Play.

- Designed, built, and operate 70+ iOS / Android apps end-to-end — UI, backend, payments, ASO, App Store / Play Store compliance, growth analytics.
- Shipped deep LLM integration (Anthropic, OpenAI) into multiple consumer apps — Audexa, ScribeAI, MeetingMind.
- Operate a unified PaywallKit + RatingKit cross-app SDK with server-driven A/B testing across the portfolio.
- Built production AI app-generation pipeline: orchestrates Claude Code CLI as a build engine with sandboxed per-project workers.

EARLIER EXPERIENCE
Member of Technical Staff · VMware  |  Mar 2015 – Sep 2015
Software Development Engineer · Microsoft  |  Nov 2012 – Feb 2015
Software Development Engineer · Amazon  |  Oct 2011 – Oct 2012

EDUCATION
Carnegie Mellon University — M.S., Information Networking  |  2009 – 2011
Indian Institute of Information Technology — B.Tech., Information Technology  |  2004 – 2008

SKILLS
Languages: Python · Java · Swift · Kotlin · TypeScript/JavaScript · C/C++ · SQL · Go
AI/ML: LLM integration (Anthropic, OpenAI) · TensorFlow · NLP · Ranking models · Ray
Infrastructure: Kubernetes · Docker · Google Cloud · AWS · Hadoop · Dataflow · gRPC
Mobile: iOS (Swift, SwiftUI) · Android (Kotlin, Jetpack Compose) · App Store/Play Store`;

async function tailorResume(client, jobDescription, jobTitle, customResumeText) {
  const resumeToUse = customResumeText || MASTER_RESUME;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: `You are an expert resume writer optimizing resumes for ATS systems and specific job descriptions.
Rules:
- NEVER invent experience, companies, dates, or skills not in the master resume
- DO reorder bullet points to surface the most relevant ones first
- DO add keywords from the job description that are genuinely represented in the experience
- DO adjust phrasing of bullets to mirror language from the job description
- Keep all dates, company names, and titles exactly as-is
- Return ONLY the plain text resume, no commentary, no markdown formatting`,
    messages: [{
      role: 'user',
      content: `Job Title: ${jobTitle}\n\nJob Description:\n${jobDescription.slice(0, 3000)}\n\nMaster Resume:\n${resumeToUse}\n\nRewrite the resume optimized for this role. Return plain text only.`,
    }],
  });

  return buildPdf(msg.content[0].text.trim());
}

async function askClaude(client, question, jobDescription, prof) {
  const systemPrompt = `You are filling out a job application on behalf of the user.
Always give a direct, confident answer. Never say you lack information or ask for clarification — just answer naturally.
For questions about how you heard about the company, default to "LinkedIn" unless the job description implies otherwise.
Be concise (1-3 sentences max). Write in first person. Be specific and genuine.
Never mention immigration, visa status, or work authorization unless directly asked.
Never disclose employment gaps, leave of absence, or that the user is not actively working at their current employer.
For vague fields like "Additional Information", write a brief genuine closing statement. Never say "here is" or describe what you're about to write.
Never invent companies, dates, or credentials not in the profile.

Profile:
${prof.background || ''}

Resume:
${prof.resume || ''}`;

  const userContent = jobDescription
    ? `Job description context:\n${jobDescription.slice(0, 1500)}\n\nQuestion to answer: ${question}`
    : `Question to answer: ${question}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  return msg.content[0].text.trim();
}

async function buildPdf(text) {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 50, marginY = 50;
  const pageW = 612, pageH = 792;
  const maxW = pageW - marginX * 2;
  const lineH = 13, fontSize = 9.5;

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - marginY;

  function newPage() { page = doc.addPage([pageW, pageH]); y = pageH - marginY; }

  function drawLine(txt, opts = {}) {
    if (y < marginY + lineH) newPage();
    const f = opts.bold ? bold : font;
    const size = opts.size || fontSize;
    const col = opts.color || rgb(0, 0, 0);
    const x = marginX + (opts.indent || 0);
    const avail = maxW - (opts.indent || 0);
    const words = txt.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(test, size) > avail && line) {
        page.drawText(line, { x, y, size, font: f, color: col });
        y -= lineH; if (y < marginY + lineH) newPage(); line = w;
      } else { line = test; }
    }
    if (line) { page.drawText(line, { x, y, size, font: f, color: col }); y -= lineH; }
  }

  function drawBlank(n = 1) { y -= lineH * n; }
  function drawRule() {
    if (y < marginY + lineH * 2) newPage();
    page.drawLine({ start: { x: marginX, y }, end: { x: pageW - marginX, y }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
    y -= 6;
  }

  let isFirst = true;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line) { drawBlank(0.5); continue; }
    if (isFirst && !line.startsWith('-')) { drawLine(line, { bold: true, size: 14 }); drawBlank(0.3); isFirst = false; continue; }
    if (/^[A-Z][A-Z &\/]+$/.test(line.trim())) { drawBlank(0.5); drawRule(); drawLine(line.trim(), { bold: true, size: 10.5 }); drawBlank(0.3); continue; }
    if (line.trimStart().startsWith('-')) { drawLine('•' + line.trimStart().slice(1), { indent: 12 }); continue; }
    if (line.includes('·') || line.includes('|')) { drawLine(line, { bold: true }); continue; }
    drawLine(line);
  }

  return doc.save();
}
