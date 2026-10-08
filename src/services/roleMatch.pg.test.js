// Role families against a real Postgres (skipped unless TEST_DATABASE_URL is set): every corpus title must be
// (or not be) in its family exactly as the live to_tsvector('simple', title) sees it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { FAMILIES, familyQuery, familyParts, resolveFamilies, profileFilter, profilePhrases, _clearFamilyMemo, roleFilter, titleMatches } from './roleMatch.js';
import { parseFeedParams, buildFeedQuery, buildCountQuery } from './feedQuery.js';
import { CORPUS } from './roleMatch.corpus.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS role_match_test CASCADE');
  await admin.query('CREATE SCHEMA role_match_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2, options: '-c search_path=role_match_test' });
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261011000000_job_feed_company_rank.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  // every corpus title becomes one US job; the index of the manual file is created too, so the GIN path is real
  const titles = [...new Set(Object.values(CORPUS).flatMap(c => [...c.yes, ...c.no]))];
  for (const [i, t] of titles.entries()) {
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,'US','TX','austin','Austin', now() - ($1::bigint::int * interval '1 minute'), $2,'Acme','acme','https://x',true,true,true)`, [i + 1, t]);
  }
  await pool.query(fs.readFileSync(new URL('../../supabase/manual/20261012000100_job_feed_title_gin.sql', import.meta.url), 'utf8')
    .replaceAll('public.', '').replace('concurrently ', ''));
  await pool.query('ANALYZE job_feed');
});
after(async () => { if (pool) { await pool.query('DROP SCHEMA role_match_test CASCADE'); await pool.end(); } });

const matching = async (slug, where = 'true') =>
  new Set((await pool.query(`SELECT title FROM job_feed f WHERE ${where} AND ${titleMatches('$1')}`, [familyQuery(slug)])).rows.map(r => r.title));

for (const f of FAMILIES) {
  test(`family ${f.slug}: known titles match, known false positives do not`, { skip }, async () => {
    const hits = await matching(f.slug);
    for (const t of CORPUS[f.slug].yes) assert.ok(hits.has(t), `${f.slug} should match ${JSON.stringify(t)}`);
    for (const t of CORPUS[f.slug].no) assert.ok(!hits.has(t), `${f.slug} should NOT match ${JSON.stringify(t)}`);
  });
}

test('engineering never matches the bare word "engineer" or the other engineering disciplines', { skip }, async () => {
  const r = await pool.query(
    `SELECT t FROM unnest($1::text[]) t WHERE ts_match_vq(to_tsvector('simple', t), $2::tsquery)`,
    [['Engineer', 'Lead Engineer', 'Senior Engineer', 'Principal Engineer', 'Chief Building Engineer', 'Engineer II', 'Staff Engineer'], familyQuery('engineering')]);
  assert.deepEqual(r.rows, []);
});

test('GIN gate is a true superset: no family title is missed by its gate', { skip }, async () => {
  for (const f of FAMILIES) {
    const { gate } = familyParts(f.slug);
    const miss = await pool.query(
      `SELECT title FROM job_feed f WHERE ${titleMatches('$1')} AND NOT to_tsvector('simple', f.title) @@ $2::tsquery`, [familyQuery(f.slug), gate]);
    assert.deepEqual(miss.rows, [], `${f.slug} gate misses ${JSON.stringify(miss.rows)}`);
  }
});

test('page and count queries return the same set with and without the gate', { skip }, async () => {
  for (const f of FAMILIES) {
    const p = parseFeedParams({ country: 'US', role: f.slug, limit: '50' }).params;
    const page = buildFeedQuery(p, {}, { mode: 'sort_at' });
    const rows = (await pool.query(page.text, page.values)).rows;
    const cnt = buildCountQuery(p);
    assert.equal((await pool.query(cnt.text, cnt.values)).rows[0].n, (await matching(f.slug)).size, `${f.slug} count`);
    assert.equal(rows.length, Math.min(50, (await matching(f.slug)).size), `${f.slug} page`);
    assert.match(cnt.text, roleFilter(f.slug).gate ? /to_tsvector\('simple', f\.title\) @@ \$\d+::tsquery/ : /ts_match_vq/);
    assert.doesNotMatch(page.text, /to_tsvector\('simple', f\.title\) @@/, 'pages never use the indexable operator for a family');
  }
});

test('resolveFamilies asks the database: a phrase falls in every family whose own query matches it', { skip }, async () => {
  _clearFamilyMemo();
  const got = await resolveFamilies(pool, ['software engineer', 'machine learning engineer', 'paralegal', 'registered nurse', 'reinforcement learning', 'full-stack']);
  assert.ok(got.includes('engineering') && got.includes('data-ml') && got.includes('legal') && got.includes('healthcare'));
  assert.ok(!got.includes('sales'));
  assert.deepEqual(await resolveFamilies(pool, ['reinforcement learning']), []);   // falls in no family: only the literal phrase finds it
});

test('profile for the example account: phrases plus the families they fall in', { skip }, async () => {
  _clearFamilyMemo();
  const { phrases } = profilePhrases({ keywords: ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'] });
  const fams = await resolveFamilies(pool, phrases.map(p => p.text));
  assert.deepEqual(fams, ['engineering']);
  const f = profileFilter(phrases, fams);
  const hits = new Set((await pool.query(`SELECT title FROM job_feed f WHERE ${titleMatches('$1')}`, [f.tsquery])).rows.map(r => r.title));
  for (const t of ['Senior Software Engineer', 'Full-Stack Developer', 'Backend Engineer (Node.js/Typescript)', 'Shopify Developer', 'Machine Learning Engineer']) assert.ok(hits.has(t), t);
  for (const t of ['Sales Engineer', 'Mechanical Engineer', 'Registered Nurse (RN)', 'Senior Product Manager']) assert.ok(!hits.has(t), t);
});
