import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactFailReason, redactHtml, redactLabel, identifierOrNull, createRateLimiter, OTHER_REASON } from './repairRedaction.js';

const PHONE = '+1 415-555-0142';
const EMAIL = 'jo.person@example.com';

test('messages that carry no value are kept, so the queue and its monitors still read them', () => {
  for (const r of ['no data for portfolio', 'Not signed in — open ⚙ to sign in', 'Session expired — open ⚙ to sign in again',
    'value did not stick after typing (site cleared it on blur)', 'No cover letter uploaded — add one in extension settings', 'API 500']) {
    assert.equal(redactFailReason(r), r);
  }
});

test('a quoted typed value is removed from every message that quotes one', () => {
  assert.equal(redactFailReason(`no option for "${PHONE}"`), 'no option for "[redacted]"');
  assert.equal(redactFailReason(`custom dropdown: no option for "${EMAIL}"`), 'custom dropdown: no option for "[redacted]"');
  assert.equal(redactFailReason('no option for "12 "Quoted" Street"'), 'no option for "[redacted]"');
  assert.equal(redactFailReason('AI could not match any option for "Degree"'), 'AI could not match any option for "[redacted]"');
  assert.equal(redactFailReason('AI could not match option for "Degree"'), 'AI could not match option for "[redacted]"');
  assert.equal(redactFailReason('AI answer "Jo Person" matched no option'), 'AI answer "[redacted]" matched no option');
});

test('any other message is not stored: it may hold a value in a form nobody listed', () => {
  for (const r of [`The specified value "${PHONE}" cannot be parsed`, `could not save Jo Person`, `no data for ${EMAIL}`, EMAIL]) {
    assert.equal(redactFailReason(r), OTHER_REASON, r);
  }
  assert.equal(redactFailReason(undefined), null);
  assert.equal(redactFailReason({ a: 1 }), null);
});

test('redacting twice changes nothing', () => {
  for (const r of [`no option for "${PHONE}"`, 'AI answer "x" matched no option', 'anything else', 'no data for location']) {
    assert.equal(redactFailReason(redactFailReason(r)), redactFailReason(r));
  }
});

test('markup keeps its structure and loses what was typed, also when cut off mid value', () => {
  const html = redactHtml(`<input id="question_1234567890" class="x" value="Jo Person" data-value='${EMAIL}' aria-label="Phone ${PHONE}">`);
  assert.match(html, /id="question_1234567890" class="x" value="\[redacted\]" data-value="\[redacted\]"/);
  assert.doesNotMatch(html, /Jo Person|example\.com|555-0142/);
  assert.equal(redactHtml('<textarea id="a">My home address</textarea>'), '<textarea id="a"></textarea>');
  assert.equal(redactHtml('<textarea id="a">cut off address'), '<textarea id="a">');
  assert.equal(redactHtml('<input id="a" value="cut off addr'), '<input id="a" value="[redacted]"');
  assert.equal(redactHtml('<input value=Jo>'), '<input value="[redacted]">');
  assert.equal(redactHtml('<div contenteditable="true"><p>Dear team</p></div>'), '<div contenteditable="true"><p></p></div>');
  assert.equal(redactHtml(null), null);
});

test('labels lose emails and phone numbers only; identifiers must look like identifiers', () => {
  assert.equal(redactLabel(`Signed in as ${EMAIL} (4155550142)`), 'Signed in as [email] ([number])');
  assert.equal(redactLabel('Current location ✱'), 'Current location ✱');
  assert.equal(identifierOrNull('typeIn/AI'), 'typeIn/AI');
  assert.equal(identifierOrNull('select-one'), 'select-one');
  assert.equal(identifierOrNull(EMAIL), null);
});

test('the limiter bounds one caller and all callers, then opens again', () => {
  let t = 0;
  const allow = createRateLimiter({ perKey: 2, total: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('b'), allow('c')], [true, true, false, true, false]);
  t = 1000;
  assert.equal(allow('a'), true);
});

test('the SQL function lists the same fixed messages', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261126000000_repair_queue_redaction.sql', import.meta.url), 'utf8');
  const js = readFileSync(new URL('./repairRedaction.js', import.meta.url), 'utf8');
  const block = js.slice(js.indexOf('const FIXED_REASONS'), js.indexOf(']);'));
  for (const [, message] of block.matchAll(/'([^']*)'/g)) assert.ok(sql.includes(`'${message}'`), message);
});
