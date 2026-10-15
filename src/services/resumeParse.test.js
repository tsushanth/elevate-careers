import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  extractResumeText, sanitizeProfile, parseWithModel, createDailyLimiter, makeParseHandler, parseBodyErrorHandler,
  ParseError, PARSE_TOOL, MODEL_FIELDS, EDUCATION_LEVELS, PDF_TYPE, DOCX_TYPE, TEXT_TYPE, DAILY_LIMIT, MAX_TEXT_CHARS,
} from './resumeParse.js';

const LONG = 'Jane Doe\njane@example.com | (555) 010-2030 | Austin, TX\nSenior engineer with ten years of experience building backend systems in Go and Python.\nEducation: B.S. Computer Science, State University, 2012';

// Smallest valid-enough PDF with one text line per entry (pdf.js rebuilds a missing xref).
function makePdf(lines) {
  const content = `BT /F1 12 Tf 50 750 Td ${lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj 0 -16 Td`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function makeDocx(paragraphs, extra = {}) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`),
    ...extra,
  }));
}

test('plain text: cleaned and returned', async () => {
  const t = await extractResumeText(Buffer.from(`${LONG}\r\n\r\n\r\n\r\nmore`), 'text/plain; charset=utf-8');
  assert.ok(t.startsWith('Jane Doe\njane@example.com'));
  assert.ok(!t.includes('\r'));
  assert.ok(!/\n{3}/.test(t));
});

test('plain text: capped at MAX_TEXT_CHARS', async () => {
  const t = await extractResumeText(Buffer.from('word '.repeat(10000)), TEXT_TYPE);
  assert.equal(t.length, MAX_TEXT_CHARS);
});

test('too short text is rejected with no_text (client falls back to paste)', async () => {
  await assert.rejects(extractResumeText(Buffer.from('hi there'), TEXT_TYPE), (e) => e.code === 'no_text' && e.status === 422);
});

test('file over 5 MB is rejected with 413', async () => {
  await assert.rejects(extractResumeText(Buffer.alloc(5 * 1024 * 1024 + 1, 65), TEXT_TYPE), (e) => e.code === 'too_large' && e.status === 413);
});

test('empty body and unsupported type', async () => {
  await assert.rejects(extractResumeText(Buffer.alloc(0), TEXT_TYPE), (e) => e.code === 'empty');
  await assert.rejects(extractResumeText(Buffer.from('x'.repeat(200)), 'image/png'), (e) => e.code === 'unsupported_type' && e.status === 415);
});

test('declared PDF/DOCX type must match magic bytes', async () => {
  await assert.rejects(extractResumeText(Buffer.from(LONG), PDF_TYPE), (e) => e.code === 'bad_file');
  await assert.rejects(extractResumeText(Buffer.from(LONG), DOCX_TYPE), (e) => e.code === 'bad_file');
});

test('PDF text extraction', async () => {
  const t = await extractResumeText(makePdf(['Jane Doe', 'jane@example.com', 'Senior engineer building backend systems in Go and Python for ten years']), PDF_TYPE);
  assert.match(t, /Jane Doe/);
  assert.match(t, /jane@example\.com/);
});

test('corrupt PDF -> bad_file, not a crash', async () => {
  await assert.rejects(extractResumeText(Buffer.from('%PDF-1.4\nthis is not a pdf at all'), PDF_TYPE), (e) => e instanceof ParseError && e.code === 'bad_file');
});

test('DOCX text extraction keeps paragraphs and decodes entities', async () => {
  const t = await extractResumeText(makeDocx(['Jane Doe', 'R&amp;D engineer &lt;Go&gt; and Python, ten years building backend systems and services at scale', 'jane@example.com']), DOCX_TYPE);
  assert.equal(t.split('\n')[0], 'Jane Doe');
  assert.match(t, /R&D engineer <Go>/);
});

test('DOCX without document.xml and non-zip are rejected cleanly', async () => {
  const noDoc = Buffer.from(zipSync({ 'readme.txt': strToU8('hello') }));
  await assert.rejects(extractResumeText(noDoc, DOCX_TYPE), (e) => e.code === 'bad_file');
  await assert.rejects(extractResumeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), DOCX_TYPE), (e) => e.code === 'bad_file');
});

test('DOCX: oversize inflated document.xml is skipped (zip-bomb guard)', async () => {
  const big = makeDocx(['x'], { 'word/document.xml': strToU8('<w:t>' + 'a'.repeat(21 * 1024 * 1024) + '</w:t>') });
  await assert.rejects(extractResumeText(big, DOCX_TYPE), (e) => e.code === 'bad_file');
});

test('schema: required == MODEL_FIELDS, strict, no extension-only personal answers', () => {
  const s = PARSE_TOOL.input_schema;
  assert.equal(s.additionalProperties, false);
  assert.deepEqual([...s.required].sort(), [...MODEL_FIELDS].sort());
  assert.deepEqual(Object.keys(s.properties).sort(), [...MODEL_FIELDS].sort());
  for (const k of ['workAuth', 'sponsorship', 'salary', 'pronouns', 'heardAbout', 'resume']) assert.ok(!(k in s.properties), k);
  assert.deepEqual(s.properties.educationLevel.enum, ['', ...EDUCATION_LEVELS]);
});

test('every model field is an extension autofill field', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../extension/src/options.js', import.meta.url), 'utf8');
  const list = src.match(/const FIELDS = \[([\s\S]*?)\];/)[1];
  const ext = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  for (const k of MODEL_FIELDS) assert.ok(ext.includes(k), `${k} missing from extension FIELDS`);
});

test('sanitizeProfile: whitelists, clips, validates', () => {
  const p = sanitizeProfile({
    firstName: ' Jane ', lastName: 'D'.repeat(500), email: 'not-an-email', phone: '+1 (555) 010-2030',
    linkedin: 'javascript:alert(1)', github: 'https://github.com/jane', portfolio: 'has space.com',
    educationLevel: 'Wizard', graduationYear: 'Class of 2012', background: 'a\n\n  b', evil: 'x', city: 42,
  });
  assert.deepEqual(Object.keys(p).sort(), [...MODEL_FIELDS].sort());
  assert.equal(p.firstName, 'Jane');
  assert.equal(p.lastName.length, 80);
  assert.equal(p.email, '');
  assert.equal(p.phone, '+1 (555) 010-2030');
  assert.equal(p.linkedin, '');
  assert.equal(p.github, 'https://github.com/jane');
  assert.equal(p.portfolio, '');
  assert.equal(p.educationLevel, '');
  assert.equal(p.graduationYear, '2012');
  assert.equal(p.background, 'a b');
  assert.equal(p.city, '');
  assert.ok(!('evil' in p));
  assert.deepEqual(Object.keys(sanitizeProfile(null)).length, MODEL_FIELDS.length);
});

const fakeClient = (input, usage = { input_tokens: 1000, output_tokens: 300 }) => ({
  messages: { create: async (args) => { fakeClient.last = args; return { content: [{ type: 'tool_use', name: 'save_profile', input }], usage }; } },
});

test('parseWithModel forces the tool and sanitizes the answer', async () => {
  const { profile } = await parseWithModel(fakeClient({ firstName: 'Jane', email: 'jane@example.com', junk: 1 }), LONG);
  assert.equal(profile.firstName, 'Jane');
  assert.ok(!('junk' in profile));
  assert.deepEqual(fakeClient.last.tool_choice, { type: 'tool', name: 'save_profile' });
  assert.match(fakeClient.last.messages[0].content, /<resume>/);
});

test('parseWithModel: no tool_use block -> model_no_result', async () => {
  const c = { messages: { create: async () => ({ content: [{ type: 'text', text: 'sorry' }] }) } };
  await assert.rejects(parseWithModel(c, LONG), (e) => e.code === 'model_no_result');
});

test('limiter: per user per day, refund, day rollover, redis path and redis failure', async () => {
  let t = Date.parse('2026-10-14T12:00:00Z');
  const lim = createDailyLimiter({ now: () => t });
  for (let i = 0; i < DAILY_LIMIT; i++) assert.equal((await lim.take('u1')).ok, true);
  assert.equal((await lim.take('u1')).ok, false);
  assert.equal((await lim.take('u2')).ok, true);
  await lim.refund('u1');
  assert.equal((await lim.take('u1')).ok, true);
  assert.equal((await lim.take('u1')).ok, false);
  t += 24 * 3600 * 1000;
  assert.equal((await lim.take('u1')).ok, true);

  const store = new Map();
  const redis = {
    incr: async (k) => { store.set(k, (store.get(k) || 0) + 1); return store.get(k); },
    decr: async (k) => { store.set(k, store.get(k) - 1); return store.get(k); },
    expire: async () => 1,
  };
  const rl = createDailyLimiter({ getRedis: () => redis });
  for (let i = 0; i < DAILY_LIMIT; i++) assert.equal((await rl.take('u')).ok, true);
  assert.equal((await rl.take('u')).ok, false);
  assert.equal([...store.values()][0], DAILY_LIMIT, 'denied attempt must not inflate the counter');

  const broken = createDailyLimiter({ getRedis: () => ({ incr: async () => { throw new Error('down'); } }) });
  assert.equal((await broken.take('x')).ok, true, 'falls back to memory');
});

function run(handler, { body, type = TEXT_TYPE, user = { id: 'u1' } } = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ body, headers: { 'content-type': type }, user }, res);
  });
}
const mk = (over = {}) => {
  const logs = [];
  const limiter = createDailyLimiter({});
  const h = makeParseHandler({ getClient: () => ({}), limiter, log: (f) => logs.push(f), hasKey: () => true,
    parse: async () => ({ profile: { firstName: 'Jane' }, usage: { input_tokens: 5, output_tokens: 6 } }), ...over });
  return { h, logs, limiter };
};

test('handler: success returns profile + resume_text, logs no content', async () => {
  const { h, logs } = mk();
  const r = await run(h, { body: Buffer.from(LONG) });
  assert.equal(r.code, 200);
  assert.equal(r.body.profile.firstName, 'Jane');
  assert.ok(r.body.resume_text.includes('jane@example.com'));
  assert.equal(r.body.remaining, DAILY_LIMIT - 1);
  const logged = JSON.stringify(logs);
  assert.ok(!logged.includes('Jane') && !logged.includes('jane@') && !logged.includes('Austin'), 'log must not carry resume content');
});

test('handler: 429 after the daily limit; extraction errors do not consume a slot', async () => {
  const { h } = mk();
  for (let i = 0; i < 3; i++) await run(h, { body: Buffer.from('short') }); // no_text, free
  for (let i = 0; i < DAILY_LIMIT; i++) assert.equal((await run(h, { body: Buffer.from(LONG) })).code, 200);
  const r = await run(h, { body: Buffer.from(LONG) });
  assert.equal(r.code, 429);
  assert.equal(r.body.error, 'rate_limited');
});

test('handler: model failure -> 502 with fallback message, slot refunded', async () => {
  const { h } = mk({ parse: async () => { throw new Error('upstream boom with resume text Jane'); } });
  for (let i = 0; i < DAILY_LIMIT + 2; i++) {
    const r = await run(h, { body: Buffer.from(LONG) });
    assert.equal(r.code, 502);
    assert.equal(r.body.error, 'parse_failed');
    assert.ok(!JSON.stringify(r.body).includes('boom'), 'internal error text is not leaked');
  }
});

test('handler: kill switch, missing key, missing/unsupported body', async () => {
  const { h } = mk();
  process.env.RESUME_PARSE_DISABLED = '1';
  try { assert.equal((await run(h, { body: Buffer.from(LONG) })).code, 503); } finally { delete process.env.RESUME_PARSE_DISABLED; }
  assert.equal((await run(mk({ hasKey: () => false }).h, { body: Buffer.from(LONG) })).code, 503);
  assert.equal((await run(h, { body: {}, type: 'application/json' })).code, 415);
});

test('body parser error handler maps too-large to 413 JSON', () => {
  let out;
  const res = { status(c) { out = { c }; return this; }, json(b) { out.b = b; } };
  parseBodyErrorHandler({ type: 'entity.too.large' }, {}, res, () => assert.fail());
  assert.equal(out.c, 413);
});

test('wired through real express: raw body, charset param, 413, 415, json header untouched', async () => {
  const { default: express } = await import('express');
  const { ACCEPTED_TYPES, MAX_FILE_BYTES } = await import('./resumeParse.js');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const { h } = mk();
  app.post('/p', (req, _res, next) => { req.user = { id: 'u9' }; next(); },
    express.raw({ type: ACCEPTED_TYPES, limit: MAX_FILE_BYTES }), parseBodyErrorHandler, h);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/p`;
  try {
    const ok = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: LONG });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).profile.firstName, 'Jane');
    const big = await fetch(base, { method: 'POST', headers: { 'Content-Type': PDF_TYPE }, body: Buffer.alloc(MAX_FILE_BYTES + 10, 37) });
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error, 'too_large');
    const json = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    assert.equal(json.status, 415);
    const png = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: LONG });
    assert.equal(png.status, 415);
  } finally { server.close(); }
});
