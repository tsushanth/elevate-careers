// rules.test.mjs — unit tests for the rule engine
// Run: node --test extension/src/rules.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRule, mergeRules } from './rules.js';

// ── findRule ─────────────────────────────────────────────────────────────────

test('matches by domain glob', () => {
  const rules = [{ id: 'r1', match: { domain: '*.ashbyhq.com' }, fix: { fillMethod: 'execCommand' } }];
  const rule = findRule(rules, { domain: 'jobs.ashbyhq.com', url: '', fieldType: 'text', label: 'First name' });
  assert.equal(rule?.id, 'r1');
});

test('does not match wrong domain', () => {
  const rules = [{ id: 'r1', match: { domain: '*.ashbyhq.com' }, fix: {} }];
  const rule = findRule(rules, { domain: 'careers.kula.ai', url: '', fieldType: 'text', label: 'First name' });
  assert.equal(rule, null);
});

test('matches by fieldType', () => {
  const rules = [
    { id: 'r-text',     match: { fieldType: 'text'     }, fix: { fillMethod: 'nativeSet'   } },
    { id: 'r-textarea', match: { fieldType: 'textarea' }, fix: { fillMethod: 'execCommand' } },
  ];
  const rule = findRule(rules, { domain: 'any.com', url: '', fieldType: 'textarea', label: 'Bio' });
  assert.equal(rule?.id, 'r-textarea');
});

test('matches by labelPattern (case-insensitive)', () => {
  const rules = [{ id: 'r1', match: { labelPattern: 'excites you' }, fix: { fillMethod: 'execCommand' } }];
  const rule = findRule(rules, { domain: 'any.com', url: '', fieldType: 'textarea', label: 'What Excites You About Replit?' });
  assert.equal(rule?.id, 'r1');
});

test('ANDs all match conditions', () => {
  const rules = [{
    id: 'r1',
    match: { domain: '*.ashbyhq.com', fieldType: 'textarea', labelPattern: 'excites' },
    fix: {},
  }];
  // All three conditions match
  assert.ok(findRule(rules, { domain: 'jobs.ashbyhq.com', url: '', fieldType: 'textarea', label: 'What excites you' }));
  // fieldType mismatch
  assert.equal(findRule(rules, { domain: 'jobs.ashbyhq.com', url: '', fieldType: 'text', label: 'What excites you' }), null);
  // labelPattern mismatch
  assert.equal(findRule(rules, { domain: 'jobs.ashbyhq.com', url: '', fieldType: 'textarea', label: 'First name' }), null);
});

test('returns first matching rule', () => {
  const rules = [
    { id: 'r1', match: { fieldType: 'text' }, fix: { fillMethod: 'execCommand' } },
    { id: 'r2', match: { fieldType: 'text' }, fix: { fillMethod: 'nativeSet'   } },
  ];
  const rule = findRule(rules, { domain: 'any.com', url: '', fieldType: 'text', label: 'Name' });
  assert.equal(rule?.id, 'r1');
});

test('returns null when no rules match', () => {
  const rule = findRule([], { domain: 'any.com', url: '', fieldType: 'text', label: 'Name' });
  assert.equal(rule, null);
});

test('matches by urlPattern', () => {
  const rules = [{ id: 'r1', match: { urlPattern: '/apply' }, fix: {} }];
  assert.ok(findRule(rules, { domain: 'any.com', url: 'https://careers.acme.com/jobs/123/apply', fieldType: 'text', label: 'Name' }));
  assert.equal(findRule(rules, { domain: 'any.com', url: 'https://careers.acme.com/jobs', fieldType: 'text', label: 'Name' }), null);
});

// ── mergeRules ───────────────────────────────────────────────────────────────

test('remote rule with higher version replaces static', () => {
  const staticRules = [{ id: 'r1', version: 1, match: {}, fix: { fillMethod: 'nativeSet' } }];
  const remoteRules = [{ id: 'r1', version: 2, match: {}, fix: { fillMethod: 'execCommand' } }];
  const merged = mergeRules(staticRules, remoteRules);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].fix.fillMethod, 'execCommand');
});

test('remote rule with same version does not replace static', () => {
  const staticRules = [{ id: 'r1', version: 1, match: {}, fix: { fillMethod: 'nativeSet' } }];
  const remoteRules = [{ id: 'r1', version: 1, match: {}, fix: { fillMethod: 'execCommand' } }];
  const merged = mergeRules(staticRules, remoteRules);
  assert.equal(merged[0].fix.fillMethod, 'nativeSet');
});

test('new remote rule is appended', () => {
  const staticRules = [{ id: 'r1', version: 1, match: {}, fix: {} }];
  const remoteRules = [{ id: 'r2', version: 1, match: {}, fix: {} }];
  const merged = mergeRules(staticRules, remoteRules);
  assert.equal(merged.length, 2);
  assert.ok(merged.some(r => r.id === 'r2'));
});

test('empty remote rules returns static unchanged', () => {
  const staticRules = [{ id: 'r1', version: 1, match: {}, fix: {} }];
  const merged = mergeRules(staticRules, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'r1');
});

test('handles null/undefined gracefully', () => {
  assert.equal(findRule(null ?? [], { domain: 'x.com', url: '', fieldType: 'text', label: '' }), null);
  const merged = mergeRules(null, undefined);
  assert.deepEqual(merged, []);
});
