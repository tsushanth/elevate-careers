import assert from 'assert';

// Extract the URL parsing logic from discover.js as a pure function
function detectAts(url) {
  let provider = null;
  let org = null;

  const ghMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-zA-Z0-9_-]+)/);
  if (ghMatch) { provider = 'greenhouse'; org = ghMatch[1]; }

  const levMatch = url.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/);
  if (levMatch) { provider = 'lever'; org = levMatch[1]; }

  const ashMatch = url.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/);
  if (ashMatch) { provider = 'ashby'; org = ashMatch[1]; }

  const srMatch = url.match(/careers\.smartrecruiters\.com\/([a-zA-Z0-9_-]+)/);
  if (srMatch) { provider = 'smartrecruiters'; org = srMatch[1]; }

  if (!provider || !org) return null;
  return { provider, org };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log('\nGreenhouse');
test('boards.greenhouse.io', () => {
  const r = detectAts('https://boards.greenhouse.io/stripe/jobs/12345');
  assert.deepEqual(r, { provider: 'greenhouse', org: 'stripe' });
});
test('job-boards.greenhouse.io', () => {
  const r = detectAts('https://job-boards.greenhouse.io/anthropic');
  assert.deepEqual(r, { provider: 'greenhouse', org: 'anthropic' });
});
test('slug with hyphens', () => {
  const r = detectAts('https://boards.greenhouse.io/dbt-labs/jobs/1');
  assert.deepEqual(r, { provider: 'greenhouse', org: 'dbt-labs' });
});
test('slug with underscores', () => {
  const r = detectAts('https://boards.greenhouse.io/weights_and_biases');
  assert.deepEqual(r, { provider: 'greenhouse', org: 'weights_and_biases' });
});

console.log('\nLever');
test('jobs.lever.co', () => {
  const r = detectAts('https://jobs.lever.co/netflix');
  assert.deepEqual(r, { provider: 'lever', org: 'netflix' });
});
test('lever with job path', () => {
  const r = detectAts('https://jobs.lever.co/uber/abc-123-def');
  assert.deepEqual(r, { provider: 'lever', org: 'uber' });
});

console.log('\nAshby');
test('jobs.ashbyhq.com', () => {
  const r = detectAts('https://jobs.ashbyhq.com/rippling');
  assert.deepEqual(r, { provider: 'ashby', org: 'rippling' });
});
test('ashby with job id', () => {
  const r = detectAts('https://jobs.ashbyhq.com/linear/abc123');
  assert.deepEqual(r, { provider: 'ashby', org: 'linear' });
});

console.log('\nSmartRecruiters');
test('careers.smartrecruiters.com', () => {
  const r = detectAts('https://careers.smartrecruiters.com/Bosch/');
  assert.deepEqual(r, { provider: 'smartrecruiters', org: 'Bosch' });
});

console.log('\nNo match / edge cases');
test('unrelated URL returns null', () => {
  assert.equal(detectAts('https://linkedin.com/jobs/view/123'), null);
});
test('simplyappl.ai returns null', () => {
  assert.equal(detectAts('https://simplyappl.ai/jobs'), null);
});
test('partial domain returns null', () => {
  assert.equal(detectAts('https://notgreenhouse.io/stripe'), null);
});
test('root domain with no slug returns null', () => {
  // jobs.lever.co/ with no org segment
  assert.equal(detectAts('https://jobs.lever.co/'), null);
});
test('greenhouse.io without boards subdomain returns null', () => {
  assert.equal(detectAts('https://greenhouse.io/stripe'), null);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
