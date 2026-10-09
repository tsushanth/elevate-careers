import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILIES, roleList, isRoleSlug, roleLabel, roleMatchEnabled, compilePattern, patternAnchor, familyQuery, familyParts, roleFilter,
  cleanTitle, profilePhrases, phraseQuery, profileFilter, resolveFamilies, _clearFamilyMemo, titleMatches,
  fitRules, mismatchQuery, fitFilter, FIT_LABELS, behaviourPhrases, strongPhrases,
} from './roleMatch.js';
import { CORPUS } from './roleMatch.corpus.js';

test('roles: the 14 families in display order with their labels', () => {
  assert.deepEqual(roleList().map(r => r.slug), ['engineering', 'data-ml', 'product', 'design', 'sales', 'marketing', 'customer', 'operations',
    'finance', 'hr', 'healthcare', 'education', 'legal', 'frontline']);
  assert.equal(roleLabel('data-ml'), 'Data & machine learning');
  assert.equal(roleLabel('frontline'), 'Retail, food & hospitality');
  assert.equal(roleLabel('nope'), null);
  assert.ok(isRoleSlug('hr') && !isRoleSlug('') && !isRoleSlug('HR') && !isRoleSlug(undefined) && !isRoleSlug('__proto__'));
  assert.ok(Object.isFrozen(FAMILIES));
});

test('kill switch is off unless FEED_ROLE_MATCH is explicitly on', () => {
  assert.equal(roleMatchEnabled({}), false);
  assert.equal(roleMatchEnabled({ FEED_ROLE_MATCH: 'off' }), false);
  assert.equal(roleMatchEnabled({ FEED_ROLE_MATCH: '' }), false);
  assert.equal(roleMatchEnabled({ FEED_ROLE_MATCH: 'on' }), true);
  assert.equal(roleMatchEnabled({ FEED_ROLE_MATCH: 'ON' }), true);
});

test('pattern language: phrases, prefixes, alternatives', () => {
  assert.equal(compilePattern('sales'), `'sales'`);
  assert.equal(compilePattern('software engineer*'), `('software' <-> 'engineer':*)`);
  assert.equal(compilePattern('(a|b) c'), `(('a'|'b') <-> 'c')`);
  assert.equal(compilePattern('a (b|c)'), `('a' <-> ('b'|'c'))`);
  assert.equal(compilePattern('a (b c|d)'), `('a' <-> (('b' <-> 'c')|'d'))`);
  assert.equal(compilePattern("it's"), `'it''s'`);          // quotes are doubled, never injected
  assert.throws(() => compilePattern('   '));
});

test('a mixed single/phrase group is split so a stray word cannot sneak through', () => {
  const q = compilePattern('(product|senior product) (manager*|lead)');
  assert.ok(!q.includes(`'product' | 'senior'`), q);
  assert.match(q, /'senior' <-> 'product'/);
});

test('GIN anchors: the most specific token, never a generic role word', () => {
  assert.equal(patternAnchor('product manager*'), `'product'`);
  assert.equal(patternAnchor('(head|director) of sales'), `'sales'`);
  assert.equal(patternAnchor('senior (manager*|lead)'), `'senior'`);
  assert.equal(patternAnchor('hr (manager*|generalist)'), `'hr'`);
  assert.equal(patternAnchor('attorney*'), `'attorney':*`);
});

test('every family compiles, vetoes are separate, and the gate is a superset anchor list', () => {
  for (const f of FAMILIES) {
    const { pos, neg, gate } = familyParts(f.slug);
    assert.ok(pos && gate, f.slug);
    assert.equal(familyQuery(f.slug), neg ? `${pos} & !${neg}` : pos);
    if (f.gin) assert.ok(gate.length < pos.length, `${f.slug}: gate should be smaller than the positive tree`);
  }
});

test('roleFilter: dense families are scan-only, sparse ones carry a count gate, pages are never gated', () => {
  for (const slug of ['engineering', 'healthcare', 'frontline']) {
    const f = roleFilter(slug);
    assert.equal(f.gate, null, slug);
    assert.equal(f.pageGate, false);
    assert.equal(f.tsquery, familyQuery(slug));
  }
  for (const slug of ['legal', 'hr', 'product', 'design', 'education', 'sales']) {
    const f = roleFilter(slug);
    assert.ok(f.gate, slug);
    assert.equal(f.pageGate, false);
  }
  assert.throws(() => roleFilter('nope'));
});

test('titleMatches is the opaque function form, never the indexable operator', () => {
  assert.equal(titleMatches('$3'), `ts_match_vq(to_tsvector('simple', f.title), $3::tsquery)`);
});

// ---- profile -----------------------------------------------------------------------------

test('cleanTitle with real preferred_titles', () => {
  const t = (s) => cleanTitle(s);
  assert.equal(t('Machine Learning Engineer, GAI Search Platform - Moveworks'), 'machine learning engineer');
  assert.equal(t('Senior Machine Learning Engineer'), 'machine learning engineer');
  assert.equal(t('Senior Software Engineer (Java)'), 'software engineer');
  assert.equal(t('Software Engineer (Backend)'), 'software engineer');
  assert.equal(t('Sr. Software Engineer Networking Team'), 'software engineer');
  assert.equal(t('Staff Software Engineer, Time and Scheduling'), 'software engineer');
  assert.equal(t('Team Lead, Software Engineering'), 'software engineering');
  assert.equal(t('Unity Software Engineer'), 'unity software engineer');
  assert.equal(t('Principal Product Manager - Growth at Acme'), 'product manager');
  assert.equal(t('Registered Nurse (RN) - ICU'), 'registered nurse');
  assert.equal(t('Software Engineer II'), 'software engineer');
  assert.equal(t('Marketing Manager, EMEA'), 'marketing manager');
  assert.equal(t('Engineer'), '');          // a bare role noun says nothing
  assert.equal(t(''), '');
  assert.equal(t(null), '');
});

test('profilePhrases: explicit keywords win and are used as given', () => {
  const r = profilePhrases({ keywords: ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'], preferredTitles: ['Senior Nurse'] });
  assert.equal(r.source, 'keywords');
  assert.deepEqual(r.phrases.map(p => p.label), ['Software Engineer', 'Full-Stack', 'Reinforcement Learning']);
  assert.deepEqual(profilePhrases({ keywords: ['  ', null, 'python', 'Python'] }).phrases.map(p => p.text), ['python']);
});

test('profilePhrases: without keywords the five most frequent cleaned titles (ties keep first-seen order)', () => {
  const preferredTitles = ['Machine Learning Engineer, GAI Search Platform - Moveworks', 'Senior Machine Learning Engineer', 'Artificial Intelligence Engineer', 'Software Engineer',
    'Senior Software Engineer (Java)', 'Software Engineer (Backend)', 'Unity Software Engineer', 'Sr. Software Engineer Networking Team', 'Staff Software Engineer, Time and Scheduling',
    'Team Lead, Software Engineering', 'Data Scientist', 'Data Analyst'];
  const r = profilePhrases({ keywords: [], preferredTitles });
  assert.equal(r.source, 'titles');
  assert.deepEqual(r.phrases.map(p => p.text), ['software engineer', 'machine learning engineer', 'artificial intelligence engineer', 'unity software engineer', 'software engineering']);
  assert.equal(r.phrases[0].label, 'Software Engineer');
});

test('profilePhrases: nothing usable -> no phrases; tech keywords (user_signals.keywords) are never read', () => {
  assert.deepEqual(profilePhrases({}).phrases, []);
  assert.deepEqual(profilePhrases({ keywords: [], preferredTitles: ['Engineer', ''] }), { phrases: [], source: null });
  assert.deepEqual(profilePhrases({ keywords: [], preferredTitles: [], userSignalKeywords: ['python'] }).phrases, []);
});

test('phraseQuery: phrase operator between words, hyphen splits, long last word is a prefix', () => {
  assert.equal(phraseQuery('Full-Stack'), `'full' <-> 'stack'`);
  assert.equal(phraseQuery('Software Engineer'), `'software' <-> 'engineer':*`);
  assert.equal(phraseQuery('Reinforcement Learning'), `'reinforcement' <-> 'learning':*`);
  assert.equal(phraseQuery('Sales'), `'sales'`);                 // short last words stay exact: 'sales' must not become 'salesforce'
  assert.equal(phraseQuery(`O'Reilly "Editor"`), `'o' <-> 'reilly' <-> 'editor':*`);   // quotes never reach the tsquery text
  assert.equal(phraseQuery('   '), null);
  assert.equal(phraseQuery('C++ Developer'), `'c' <-> 'developer':*`);
});

test('profileFilter: literal phrases OR the families; GIN gating follows density', () => {
  const ph = ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'].map(text => ({ text }));
  const f = profileFilter(ph, ['engineering']);
  assert.match(f.tsquery, /^\('software' <-> 'engineer':\*\) \| \('full' <-> 'stack'\) \| \('reinforcement' <-> 'learning':\*\) \| \(/);
  assert.ok(f.tsquery.includes(familyQuery('engineering')));
  assert.equal(f.gate, null);                      // engineering is dense: scan only
  assert.equal(f.pageGate, false);

  const sparse = profileFilter([{ text: 'paralegal' }], ['legal']);
  assert.ok(sparse.gate.includes(familyParts('legal').gate));
  assert.equal(sparse.pageGate, false);            // a family pages fine off the ordered index

  const lit = profileFilter([{ text: 'quantum chemist' }], []);
  assert.ok(lit.gate && lit.pageGate);             // unknown density: let the planner use GIN for pages too
  assert.equal(profileFilter([], []), null);
  assert.equal(profileFilter([{ text: '   ' }], []), null);
});

test('resolveFamilies: one query, memoised, failures are not cached', async () => {
  _clearFamilyMemo();
  let calls = 0, fail = false;
  const db = { async query(sql, params) {
    calls++;
    if (fail) throw new Error('boom');
    assert.deepEqual(params[1], FAMILIES.map(f => f.slug));
    return { rows: [{ phrase: 'software engineer', slug: 'engineering' }, { phrase: 'machine learning engineer', slug: 'engineering' }, { phrase: 'machine learning engineer', slug: 'data-ml' }] };
  } };
  assert.deepEqual(await resolveFamilies(db, ['software engineer', 'machine learning engineer']), ['engineering', 'data-ml']);
  assert.deepEqual(await resolveFamilies(db, ['machine learning engineer']), ['engineering', 'data-ml']);
  assert.equal(calls, 1);
  _clearFamilyMemo();
  fail = true;
  await assert.rejects(resolveFamilies(db, ['x']), /boom/);
  fail = false;
  assert.deepEqual(await resolveFamilies(db, ['software engineer']), ['engineering']);   // not poisoned by the failure
});

test('corpus is well formed (the Postgres test checks each title against its family)', () => {
  assert.deepEqual(Object.keys(CORPUS), FAMILIES.map(f => f.slug));
  for (const [slug, c] of Object.entries(CORPUS)) assert.ok(c.yes.length >= 5 && c.no.length >= 3, slug);
});

// ---- fit ranking (FEED_FIT_RANK) ----
const ME = { keywords: ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'],
  preferredTitles: ['Machine Learning Engineer, GAI Search Platform - Moveworks', 'Senior Machine Learning Engineer', 'Artificial Intelligence Engineer', 'Software Engineer',
    'Senior Software Engineer (Java)', 'Software Engineer (Backend)', 'Unity Software Engineer', 'Sr. Software Engineer Networking Team', 'Staff Software Engineer, Time and Scheduling', 'Team Lead, Software Engineering'] };

test('fitRules: the example account has a seniority signal and is an individual contributor', () => {
  assert.deepEqual(fitRules(ME), { level: true, ic: true, labels: ['Senior-level roles', 'Individual contributor roles'] });
});

test('fitRules: level rule needs senior / sr / staff / principal / lead as a whole word in keywords or preferred titles', () => {
  const lvl = (kw, titles = []) => fitRules({ keywords: kw, preferredTitles: titles }).level;
  for (const t of ['Senior Software Engineer', 'Sr. Software Engineer', 'sr software engineer', 'Staff Engineer', 'Principal Engineer', 'Team Lead, Software', 'Tech LEAD']) assert.equal(lvl([], [t]), true, t);
  assert.equal(lvl(['Senior Backend'], []), true);                    // keywords count too
  for (const t of ['Software Engineer', 'Seniority Analyst', 'Leader Engineer', 'Staffing Coordinator', 'Leadership Program', 'Junior Developer']) assert.equal(lvl([t], []), false, t);
  assert.equal(lvl([], []), false);
});

test('fitRules: the management rule is off when ANY of director / vp / vice president / head / chief / manager is in the profile', () => {
  const ic = (kw, titles = []) => fitRules({ keywords: kw, preferredTitles: titles }).ic;
  assert.equal(ic(['Software Engineer']), true);
  for (const t of ['Director of Engineering', 'VP Engineering', 'Vice President, Product', 'Head of Data', 'Chief Technology Officer', 'Engineering Manager', 'engineering manager']) {
    assert.equal(ic([], [t]), false, t);
    assert.equal(ic([t]), false, t);
  }
  assert.equal(ic(['Headhunter Support', 'Managerial Accountant', 'Vice Chair']), true);   // whole words / the pair 'vice president' only
  assert.deepEqual(fitRules({ keywords: ['Engineering Manager'], preferredTitles: [] }), { level: false, ic: false, labels: [] });
  assert.deepEqual(fitRules({}), { level: false, ic: true, labels: [FIT_LABELS.ic] });
});

test('mismatchQuery: tsquery text per active rule, null when none', () => {
  assert.equal(mismatchQuery({ level: false, ic: false }), null);
  assert.equal(mismatchQuery({ level: true, ic: false }),
    "('intern') | ('internship') | ('junior') | ('jr') | ('apprentice') | ('trainee') | ('new' <-> 'grad') | ('new' <-> 'graduate') | ('entry' <-> 'level') | ('graduate' <-> ('programme' | 'program')) | ('new' <-> 'college' <-> 'graduate') | ('college' <-> 'graduate') | ('college' <-> 'grad') | ('university' <-> 'graduate') | ('recent' <-> 'graduate') | ('early' <-> 'career')");
  assert.equal(mismatchQuery({ level: false, ic: true }), "('director') | ('vp') | ('vice' <-> 'president') | ('head' <-> 'of') | ('chief') | ('manager')");
  assert.ok(mismatchQuery({ level: true, ic: true }).includes(" | ('director')"));
});

test('fitFilter: strong = literal phrases AND NOT mismatch; no literal phrase -> null', () => {
  const { phrases } = profilePhrases(ME);
  const f = fitFilter(phrases, ME, ['engineering']);
  assert.equal(f.strong, "(('software' <-> 'engineer':*) | ('full' <-> 'stack') | ('reinforcement' <-> 'learning':*) | ('machine' <-> 'learning' <-> 'engineer':*)) & !(" + mismatchQuery({ level: true, ic: true }) + ")");
  assert.deepEqual(f.labels, ['Senior-level roles', 'Individual contributor roles']);
  assert.equal(f.bucket1, null);                                       // families present: bucket 1 is dense, no gate
  // no rule active: strong is the bare literal query, no negation
  const mgr = { keywords: ['Software Engineer', 'Engineering Manager'] };
  const noRule = fitFilter(profilePhrases(mgr).phrases, mgr, ['engineering']);
  assert.equal(noRule.strong, "('software' <-> 'engineer':*) | ('engineering' <-> 'manager':*)");
  assert.deepEqual(noRule.labels, []);
  assert.equal(fitFilter([{ text: '!!!' }], { keywords: ['!!!'], preferredTitles: [] }), null);
});

test('fitFilter: without a family bucket 1 is pruned (no rule) or gated by the positive mismatch words', () => {
  const ph = [{ text: 'Paralegal' }];
  assert.deepEqual(fitFilter(ph, { keywords: ['Paralegal', 'Legal Manager'] }, []).bucket1, { empty: true });
  assert.deepEqual(fitFilter(ph, { keywords: ['Paralegal'] }, []).bucket1, { gate: mismatchQuery({ level: false, ic: true }) });
});

test('the strong tsquery text is valid for to_tsquery input (balanced, phrase operators only between lexemes)', () => {
  const { phrases } = profilePhrases(ME);
  const { strong } = fitFilter(phrases, ME, []);
  assert.equal((strong.match(/\(/g) || []).length, (strong.match(/\)/g) || []).length);
  assert.doesNotMatch(strong, /[A-Z]/);
});

test('behaviourPhrases: cleaned core of preferred titles that repeat, else the top five; strongPhrases = keywords UNION those', () => {
  assert.deepEqual(behaviourPhrases(ME.preferredTitles), ['software engineer', 'machine learning engineer']);   // 5x and 2x; the single ones do not count
  assert.deepEqual(strongPhrases(profilePhrases(ME).phrases, ME), ['Software Engineer', 'Full-Stack', 'Reinforcement Learning', 'machine learning engineer']);   // 'software engineer' is already a keyword
  // nothing repeats: the top five by frequency, first-seen order on ties
  assert.deepEqual(behaviourPhrases(['Senior Data Scientist', 'Product Designer', 'Staff Backend Engineer', 'UX Researcher', 'Technical Writer', 'Recruiter, Tech', 'Data Analyst']).length, 5);
  assert.deepEqual(behaviourPhrases(['Senior Data Scientist', 'Product Designer']), ['data scientist', 'product designer']);
  assert.deepEqual(behaviourPhrases([]), []); assert.deepEqual(behaviourPhrases(null), []); assert.deepEqual(behaviourPhrases(['Engineer', '']), []);
  // more than five repeated phrases: the five most frequent
  const many = ['Data Scientist', 'Data Scientist', 'Product Designer', 'Product Designer', 'Backend Engineer', 'Backend Engineer', 'Technical Writer', 'Technical Writer', 'Data Analyst', 'Data Analyst', 'Account Executive', 'Account Executive', 'Data Scientist'];
  assert.equal(behaviourPhrases(many).length, 5); assert.equal(behaviourPhrases(many)[0], 'data scientist');
  // no keywords: profile phrases are the top cleaned titles already; the union adds nothing twice
  const t = { keywords: [], preferredTitles: ['Senior Machine Learning Engineer', 'Machine Learning Engineer'] };
  assert.deepEqual(strongPhrases(profilePhrases(t).phrases, t), ['machine learning engineer']);
});
