import test from 'node:test';
import assert from 'node:assert/strict';
import { extTrackingDisabled, newInstallId, fillRows, recordFill, INSTALL_ID_RE } from './funnel.js';

const mkStore = (init = {}) => {
  const d = { ...init };
  return { d, get: async (keys) => Object.fromEntries(keys.map(k => [k, d[k]])), set: async (o) => { Object.assign(d, o); } };
};
const crypto = globalThis.crypto;

test('Do-Not-Track and GPC disable tracking', () => {
  assert.equal(extTrackingDisabled({ doNotTrack: '1' }), true);
  assert.equal(extTrackingDisabled({ doNotTrack: 'yes' }), true);
  assert.equal(extTrackingDisabled({ globalPrivacyControl: true }), true);
  assert.equal(extTrackingDisabled({}), false);
});

test('install id is random and url-safe', () => {
  const a = newInstallId(crypto), b = newInstallId(crypto);
  assert.match(a, INSTALL_ID_RE);
  assert.notEqual(a, b);
});

test('first fill emits first_fill + fill, later fills only fill', () => {
  assert.deepEqual(fillRows('x'.repeat(20), false).map(r => r.event_name), ['extension_first_fill', 'extension_fill']);
  assert.deepEqual(fillRows('x'.repeat(20), true).map(r => r.event_name), ['extension_fill']);
  for (const r of fillRows('x'.repeat(20), false)) assert.deepEqual(r.properties, {}), assert.equal(r.surface, 'extension');
});

test('recordFill creates an id, posts rows, and remembers the first fill only after success', async () => {
  const store = mkStore();
  const sent = [];
  assert.equal(await recordFill({ store, nav: {}, cryptoObj: crypto, post: async (rows) => { sent.push(rows); return false; } }), false);
  assert.equal(store.d.ext_first_fill_sent, undefined);
  assert.match(store.d.ext_vid, INSTALL_ID_RE);
  assert.equal(await recordFill({ store, nav: {}, cryptoObj: crypto, post: async (rows) => { sent.push(rows); return true; } }), true);
  assert.equal(store.d.ext_first_fill_sent, true);
  assert.equal(sent[1].length, 2);
  await recordFill({ store, nav: {}, cryptoObj: crypto, post: async (rows) => { sent.push(rows); return true; } });
  assert.equal(sent[2].length, 1);
});

test('DNT: nothing is posted and no id is created', async () => {
  const store = mkStore();
  let posted = 0;
  assert.equal(await recordFill({ store, nav: { doNotTrack: '1' }, cryptoObj: crypto, post: async () => { posted++; return true; } }), false);
  assert.equal(posted, 0);
  assert.equal(store.d.ext_vid, undefined);
});

test('failures never throw', async () => {
  const bad = { get: async () => { throw new Error('x'); }, set: async () => {} };
  assert.equal(await recordFill({ store: bad, nav: {}, cryptoObj: crypto, post: async () => true }), false);
  assert.equal(await recordFill({ store: mkStore(), nav: {}, cryptoObj: crypto, post: async () => { throw new Error('net'); } }), false);
  assert.equal(await recordFill({ store: mkStore(), nav: {}, cryptoObj: undefined, post: async () => true }), false);
});
