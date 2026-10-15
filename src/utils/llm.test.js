// Spend accounting wiring: labels, usage capture through the REAL Anthropic SDK (only fetch is faked), inert without a key,
// and a failing report never reaching a request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const SERVICE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCES = {
  'src/routes/ai-resume.js': ['resume_chat', 'resume_extract', 'resume_enhance', 'copilot_answer', 'copilot_pick_option', 'resume_tailor', 'resume_audit', 'job_fit_score', 'skill_check_generate'],
  'src/api/server.js': ['location_classify'],
  'src/routes/public-funnel.js': ['funnel'],
  'src/services/resumeParser.js': ['parse_resume'],
};

const claudeFetch = () => async () => new Response(JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'ok' }],
  usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

// Loads a fresh llm.js with the env and global fetch the test wants (the usage client captures both at creation).
async function load({ key, reportFetch }) {
  const saved = { key: process.env.LLM_USAGE_KEY, fetch: globalThis.fetch };
  if (key) process.env.LLM_USAGE_KEY = key; else delete process.env.LLM_USAGE_KEY;
  globalThis.fetch = reportFetch;
  try { return await import(`./llm.js?t=${Math.random()}`); }
  finally { if (saved.key === undefined) delete process.env.LLM_USAGE_KEY; else process.env.LLM_USAGE_KEY = saved.key; globalThis.fetch = saved.fetch; }
}

test('every Claude call site carries exactly its expected low-cardinality label', () => {
  for (const [file, labels] of Object.entries(SOURCES)) {
    const src = readFileSync(SERVICE_ROOT + file, 'utf8');
    const calls = src.match(/messages\.create\(/g) || [];
    const found = [...src.matchAll(/withFeature\('([^']*)', \(\) => \w+(?:\(\))?\.messages\.create\(\{/g)].map((m) => m[1]);
    assert.equal(calls.length, labels.length, `${file}: number of messages.create calls`);
    assert.deepEqual(found, labels, `${file}: labels`);
    for (const l of found) assert.match(l, /^[a-z][a-z0-9_]{0,39}$/);
  }
  const all = Object.values(SOURCES).flat();
  assert.equal(new Set(all).size, all.length, 'labels are unique');
});

test('no key: disabled, and nothing is ever sent', async () => {
  let sent = 0;
  const { llmUsage, trackedAnthropic, withFeature } = await load({ key: '', reportFetch: async () => { sent++; return new Response('{}'); } });
  assert.equal(llmUsage.enabled, false);
  const client = trackedAnthropic({ apiKey: 'sk-test', fetch: claudeFetch(), maxRetries: 0 });
  const res = await withFeature('funnel', () => client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }));
  assert.equal(res.content[0].text, 'ok');
  assert.equal(llmUsage.pending(), 0);
  await llmUsage.flush();
  assert.equal(sent, 0);
});

test('FAILURE_REPORTER_KEY alone does not enable it', async () => {
  const prev = process.env.FAILURE_REPORTER_KEY; process.env.FAILURE_REPORTER_KEY = 'other-apps-key';
  try {
    const { llmUsage } = await load({ key: '', reportFetch: async () => new Response('{}') });
    assert.equal(llmUsage.enabled, false);
  } finally { if (prev === undefined) delete process.env.FAILURE_REPORTER_KEY; else process.env.FAILURE_REPORTER_KEY = prev; }
});

test('with a key: real SDK call is recorded with app key, feature, model, tokens and cost', async () => {
  const posts = [];
  const { llmUsage, trackedAnthropic, withFeature } = await load({ key: 'test-key', reportFetch: async (url, init) => { posts.push({ url, init }); return new Response('{}', { status: 200 }); } });
  assert.equal(llmUsage.enabled, true);
  const client = trackedAnthropic({ apiKey: 'sk-test', fetch: claudeFetch(), maxRetries: 0 });
  await withFeature('resume_audit', () => client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'secret resume text' }] }));
  await llmUsage.flush();
  assert.equal(posts.length, 1);
  assert.match(String(posts[0].url), /\/v1\/llm$/);
  assert.equal(posts[0].init.headers['X-Report-Key'], 'test-key');
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.items.length, 1);
  const row = body.items[0];
  assert.equal(row.feature, 'resume_audit');
  assert.equal(row.model, 'claude-haiku-4-5');
  assert.equal(row.calls, 1);
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 200);
  assert.ok(Math.abs(row.cost_usd - 0.002) < 1e-9, `cost ${row.cost_usd}`); // 1000*$1/M + 200*$5/M
  assert.ok(!JSON.stringify(body).includes('secret resume text'), 'no prompt content leaves the process');
});

test('a failing or throwing report never throws into the request', async () => {
  for (const reportFetch of [async () => { throw new Error('network down'); }, () => { throw new Error('sync boom'); }, async () => new Response('x', { status: 500 })]) {
    const { llmUsage, trackedAnthropic, withFeature } = await load({ key: 'test-key', reportFetch });
    const client = trackedAnthropic({ apiKey: 'sk-test', fetch: claudeFetch(), maxRetries: 0 });
    const res = await withFeature('funnel', () => client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(res.content[0].text, 'ok');
    await assert.doesNotReject(llmUsage.flush());
  }
});

test('flushLlmUsage gives up after its cap when the Worker hangs', async () => {
  const { llmUsage, trackedAnthropic, flushLlmUsage } = await load({ key: 'test-key', reportFetch: () => new Promise(() => {}) });
  const client = trackedAnthropic({ apiKey: 'sk-test', fetch: claudeFetch(), maxRetries: 0 });
  await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
  const t0 = Date.now();
  await flushLlmUsage(100);
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(llmUsage.enabled, true);
});

test('a provider error is recorded as an error row and still rejects to the caller', async () => {
  const posts = [];
  const { llmUsage, trackedAnthropic, withFeature } = await load({ key: 'test-key', reportFetch: async (u, init) => { posts.push(JSON.parse(init.body)); return new Response('{}'); } });
  const failing = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const client = trackedAnthropic({ apiKey: 'sk-test', fetch: failing, maxRetries: 0 });
  await assert.rejects(withFeature('funnel', () => client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })));
  await llmUsage.flush();
  assert.equal(posts[0].items[0].errors, 1);
});

test('entry point wiring (source-level check): API shutdown starts and awaits the spend flush', () => {
  const src = readFileSync(SERVICE_ROOT + 'src/index.js', 'utf8');
  assert.match(src, /import \{ flushLlmUsage \} from '\.\/utils\/llm\.js'/);
  assert.match(src, /const llmFlushed = flushLlmUsage\(\);/);
  assert.match(src, /await llmFlushed;/);
});
