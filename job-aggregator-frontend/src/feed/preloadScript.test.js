import fs from 'fs';
import path from 'path';
import { guessPlace } from './place';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('__feedPreload'));

function run({ search = '', tz = 'America/New_York', langs = ['en-US'], store = {}, v2Default = false, failFetch = false } = {}) {
  const calls = [];
  const win = { __FEED_V2_DEFAULT: v2Default };
  const fake = {
    location: { pathname: '/', search },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    navigator: { languages: langs },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) },
    fetch: (url) => {
      calls.push(url);
      return failFetch ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, json: async () => ({ jobs: [] }) });
    },
  };
  new Function('window', 'location', 'localStorage', 'navigator', 'Intl', 'fetch', code)(
    win, fake.location, fake.localStorage, fake.navigator, fake.Intl, fake.fetch);
  return { win, calls };
}

const V2 = '?feed=v2';
const country = (opts) => { const u = run({ search: V2, ...opts }).calls[0]; const m = u && /country=([A-Za-z]+)/.exec(u); return m ? m[1] : null; };
const US = { place: { country: 'US', region: '', city: '' }, q: '', remote: false, type: '', days: '' };

test('the script exists in index.html', () => { expect(code).toBeTruthy(); });

test('does nothing unless v2 is on', () => {
  const r = run({});
  expect(r.calls).toEqual([]);
  expect(r.win.__feedPreload).toBeUndefined();
});

test('?feed=v2 preloads the place guessed from the timezone', () => {
  expect(run({ search: V2 }).calls[0]).toMatch(/\/v2\/jobs\/feed\?country=US$/);
  expect(run({ search: V2, tz: 'America/Toronto' }).calls[0]).toMatch(/country=CA$/);
  expect(run({ search: V2, tz: 'Europe/London' }).calls[0]).toMatch(/country=GB$/);
  expect(run({ search: V2, tz: 'Etc/UTC', langs: ['en-GB'] }).calls[0]).toMatch(/country=GB$/);
  expect(run({ search: V2, tz: 'Etc/UTC', langs: ['en'] }).calls[0]).toMatch(/country=US$/);
});

test('timezone edge cases: Canada, Mexico, US and Australia zones', () => {
  expect(country({ tz: 'America/Calgary' })).toBe('CA');
  expect(country({ tz: 'America/Ottawa' })).toBe('CA');
  expect(country({ tz: 'America/Tijuana' })).toBe('MX');
  expect(country({ tz: 'America/Phoenix' })).toBe('US');
  expect(country({ tz: 'America/Argentina/Buenos_Aires' })).toBe('US');
  expect(country({ tz: 'Australia/Sydney' })).toBe('AU');
});

test('language fallback handles extensions, scripts and unsupported regions', () => {
  expect(country({ tz: 'Etc/UTC', langs: ['en-US-u-ca-gregory'] })).toBe('US');
  expect(country({ tz: 'Etc/UTC', langs: ['en-GB-oxendict'] })).toBe('GB');
  expect(country({ tz: 'Etc/UTC', langs: ['en-Latn-GB'] })).toBe('GB');
  expect(country({ tz: 'Etc/UTC', langs: ['zh-Hans-CN', 'en-GB'] })).toBe('GB');
});

test('a saved place wins over the guess, including region and city', () => {
  const store = { sa_place: JSON.stringify({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin' }) };
  expect(run({ search: V2, tz: 'Europe/London', store }).calls[0]).toMatch(/country=US&region=TX&city=Austin$/);
  const worldwide = { sa_place: JSON.stringify({ country: '', region: '', city: '', label: '' }) };
  expect(run({ search: V2, store: worldwide }).calls[0]).toMatch(/\/v2\/jobs\/feed$/);
});

test('a corrupt saved place is ignored; non-string parts become empty', () => {
  for (const bad of ['{not json', '[]', '{"country":5}', 'null']) {
    expect(run({ search: V2, tz: 'Europe/London', store: { sa_place: bad } }).calls[0]).toMatch(/country=GB$/);
  }
  const r = run({ search: V2, store: { sa_place: '{"country":"US","region":5}' } });
  expect(r.calls[0]).toMatch(/\/v2\/jobs\/feed\?country=US$/);
  expect(r.win.__feedPreload({ ...US })).toBeDefined();
});

test('mode precedence: ?feed param beats storage; v1 turns it off even when v2 is the default', () => {
  expect(run({ v2Default: true }).calls.length).toBe(1);
  expect(run({ v2Default: true, search: '?feed=v1' }).calls).toEqual([]);
  expect(run({ v2Default: true, store: { sa_feed: 'v1' } }).calls).toEqual([]);
  expect(run({ search: V2, store: { sa_feed: 'v1' } }).calls.length).toBe(1);
  expect(run({ search: '?feed=v1', store: { sa_feed: 'v2' } }).calls).toEqual([]);
});

test('unknown ?feed values and unknown stored values are ignored', () => {
  expect(run({ search: '?feed=v3', store: { sa_feed: 'v2' } }).calls.length).toBe(1);
  expect(run({ search: '?feed=v3' }).calls).toEqual([]);
  expect(run({ store: { sa_feed: 'x' } }).calls).toEqual([]);
  expect(run({ store: { sa_feed: 'x' }, v2Default: true }).calls.length).toBe(1);
});

test('hands over the request once, and only for the matching unfiltered place', async () => {
  const { win } = run({ search: V2 });
  expect(win.__feedPreload({ ...US, q: 'engineer' })).toBeUndefined();     // filtered: not consumed
  expect(win.__feedPreload({ ...US, remote: true })).toBeUndefined();
  expect(win.__feedPreload({ ...US, type: 'full_time' })).toBeUndefined();
  expect(win.__feedPreload({ ...US, days: 7 })).toBeUndefined();
  expect(win.__feedPreload({ ...US, place: { country: 'GB', region: '', city: '' } })).toBeUndefined();
  const pending = win.__feedPreload(US);
  expect(typeof pending.then).toBe('function');
  expect(await pending).toEqual({ jobs: [] });
  expect(win.__feedPreload).toBeUndefined();                                // one use only
});

test('a failed preload request does not throw at page load', async () => {
  const { win } = run({ search: V2, failFetch: true });
  await expect(win.__feedPreload(US)).rejects.toThrow('offline');          // the hook catches this and falls back
});

test('PARITY: the script requests the same country as guessPlace() for every (timeZone, languages) pair', () => {
  const table = [
    ['America/New_York', ['en-US']], ['America/Los_Angeles', ['en']], ['America/Phoenix', ['en-US']],
    ['America/Argentina/Buenos_Aires', ['es-AR']], ['America/Toronto', ['en-CA']], ['America/Calgary', []],
    ['America/Ottawa', ['fr-CA']], ['America/Indiana/Indianapolis', ['en-US']], ['America/Mexico_City', ['es-MX']],
    ['America/Tijuana', ['es']], ['America/Monterrey', []], ['America/Sao_Paulo', ['pt-BR']],
    ['America/Bogota', ['es-CO']], ['Australia/Sydney', ['en-AU']], ['Australia/Perth', []],
    ['Europe/London', ['en-GB']], ['Europe/Dublin', ['en-IE']], ['Europe/Berlin', ['de-DE']],
    ['Europe/Paris', ['fr-FR']], ['Europe/Rome', ['it-IT']], ['Europe/Amsterdam', ['nl']],
    ['Asia/Kolkata', ['en-IN']], ['Asia/Calcutta', []], ['Asia/Tokyo', ['ja-JP']], ['Asia/Dubai', ['ar-AE']],
    ['Asia/Shanghai', ['zh-Hans-CN', 'en-GB']], ['Pacific/Auckland', ['en-NZ']],
    ['Etc/UTC', ['en-US-u-ca-gregory']], ['Etc/UTC', ['en-GB-oxendict']], ['Etc/UTC', ['en-Latn-GB']],
    ['Etc/UTC', ['en']], ['Etc/UTC', []], ['', ['en-AU']], ['Not/AZone', ['fr-FR', 'en-US']],
    ['Africa/Lagos', ['en-NG', 'en-IE']],
  ];
  expect(table.length).toBeGreaterThanOrEqual(25);
  const mismatches = [];
  for (const [timeZone, languages] of table) {
    const expected = guessPlace({ timeZone, languages }).country;
    const actual = country({ tz: timeZone, langs: languages });
    if (actual !== expected) mismatches.push(`tz=${JSON.stringify(timeZone)} langs=${JSON.stringify(languages)}: script=${actual} place.js=${expected}`);
  }
  expect(mismatches.join('\n')).toBe('');
});
