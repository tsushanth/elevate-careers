import { feedUrl, fetchFeed, fetchSuggest } from './feedApi';

const base = 'https://api.example.com';

test('feedUrl includes only the filters that are set', () => {
  const u = new URL(feedUrl(base, { place: { country: 'US', region: 'TX', city: '', label: 'x' }, q: '', remote: true, type: '', days: '', cursor: '' }));
  expect(u.pathname).toBe('/v2/jobs/feed');
  expect(u.searchParams.get('country')).toBe('US');
  expect(u.searchParams.get('region')).toBe('TX');
  expect(u.searchParams.get('remote')).toBe('true');
  expect(u.searchParams.has('city')).toBe(false);
  expect(u.searchParams.has('q')).toBe(false);
  expect(u.searchParams.has('cursor')).toBe(false);
});

test('feedUrl carries the cursor and encodes the keyword', () => {
  const u = new URL(feedUrl(base, { place: { country: '', region: '', city: '', label: '' }, q: 'staff engineer', cursor: 'abc_-' }));
  expect(u.searchParams.get('q')).toBe('staff engineer');
  expect(u.searchParams.get('cursor')).toBe('abc_-');
  expect(u.searchParams.has('country')).toBe(false);
});

test('fetchFeed sends the token and throws on an error status', async () => {
  const calls = [];
  global.fetch = jest.fn(async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => ({ jobs: [], nextCursor: null, count: 0, countIsCapped: false }) }; });
  await fetchFeed(base, { place: { country: 'US' } }, { token: 't1' });
  expect(calls[0][1].headers.Authorization).toBe('Bearer t1');
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await expect(fetchFeed(base, { place: {} })).rejects.toThrow(/500/);
});

test('fetchSuggest returns [] for blank input without calling the network', async () => {
  global.fetch = jest.fn();
  expect(await fetchSuggest(base, '   ')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

const reply = (places) => ({ ok: true, json: async () => ({ places }) });

test('fetchSuggest expands a typed code to the full name before calling the API', async () => {
  global.fetch = jest.fn(async () => reply([{ type: 'state', label: 'New York, United States' }]));
  const out = await fetchSuggest(base, 'NY');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe(`${base}/v2/geo/suggest?q=New%20York`);
  expect(out).toHaveLength(1);
});

test('fetchSuggest merges and de-duplicates ambiguous codes such as CA', async () => {
  global.fetch = jest.fn(async (url) => reply(url.endsWith('California')
    ? [{ type: 'state', label: 'California, United States' }]
    : [{ type: 'country', label: 'Canada' }, { type: 'state', label: 'California, United States' }]));
  const out = await fetchSuggest(base, 'CA');
  expect(global.fetch.mock.calls.map(c => c[0])).toEqual([`${base}/v2/geo/suggest?q=California`, `${base}/v2/geo/suggest?q=Canada`]);
  expect(out.map(p => p.label)).toEqual(['California, United States', 'Canada']);
});

test('fetchSuggest sends ordinary names as typed', async () => {
  global.fetch = jest.fn(async () => reply([]));
  await fetchSuggest(base, 'Austin');
  expect(global.fetch.mock.calls[0][0]).toBe(`${base}/v2/geo/suggest?q=Austin`);
});
