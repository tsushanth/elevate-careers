import { isFeedV2Enabled } from './flag';

const store = (initial = {}) => {
  const m = { ...initial };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
};

test('?feed=v2 turns it on and remembers; ?feed=v1 turns it off and remembers', () => {
  const s = store();
  expect(isFeedV2Enabled('?feed=v2', s, false)).toBe(true);
  expect(isFeedV2Enabled('', s, false)).toBe(true);        // remembered
  expect(isFeedV2Enabled('?feed=v1', s, true)).toBe(false);
  expect(isFeedV2Enabled('', s, true)).toBe(false);        // remembered
});

test('with nothing set, the default applies', () => {
  expect(isFeedV2Enabled('', store(), false)).toBe(false);
  expect(isFeedV2Enabled('', store(), true)).toBe(true);
});

test('broken storage does not throw', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  expect(isFeedV2Enabled('?feed=v2', bad, false)).toBe(true);
  expect(isFeedV2Enabled('', bad, true)).toBe(true);
});
