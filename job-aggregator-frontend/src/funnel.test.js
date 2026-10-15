import { createFunnel, trackingDisabled, getVisitId, cleanProps, landingProps, isFreshSignup, bucket, FUNNEL_EVENTS } from './funnel';

const mem = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
};
const fakeCrypto = { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } };

function setup(over = {}) {
  const rows = [];
  const env = { insert: r => { rows.push(r); return Promise.resolve(); }, storage: mem(), session: mem(), nav: {}, win: {}, cryptoObj: fakeCrypto, ...over };
  return { rows, env, f: createFunnel(env) };
}

describe('opt-out', () => {
  test('Do-Not-Track and Global Privacy Control disable tracking', () => {
    expect(trackingDisabled({ doNotTrack: '1' }, mem(), {})).toBe(true);
    expect(trackingDisabled({ doNotTrack: 'yes' }, mem(), {})).toBe(true);
    expect(trackingDisabled({ globalPrivacyControl: true }, mem(), {})).toBe(true);
    expect(trackingDisabled({ msDoNotTrack: '1' }, mem(), {})).toBe(true);
    expect(trackingDisabled({}, mem(), { doNotTrack: '1' })).toBe(true);
    expect(trackingDisabled({ doNotTrack: '0' }, mem(), {})).toBe(false);
    expect(trackingDisabled({}, mem(), {})).toBe(false);
  });
  test('a stored opt-out disables tracking', () => {
    const s = mem(); s.setItem('sa_notrack', '1');
    expect(trackingDisabled({}, s, {})).toBe(true);
  });
  test('DNT: nothing is sent, no id is created, and an existing id is removed', () => {
    const { rows, env, f } = setup({ nav: { doNotTrack: '1' } });
    env.storage.setItem('sa_vid', '{"id":"abcdefghijklmnop","t":1}');
    expect(f.track('landing_view', { path: '/' })).toBe(false);
    expect(rows).toHaveLength(0);
    expect(env.storage.getItem('sa_vid')).toBeNull();
    expect(f.enabled()).toBe(false);
  });
  test('GPC: nothing is sent', () => {
    const { rows, f } = setup({ nav: { globalPrivacyControl: true } });
    f.track('job_open', { job_id: 1 });
    expect(rows).toHaveLength(0);
  });
});

describe('visit id', () => {
  test('is random-looking, url-safe, and stable across calls', () => {
    const s = mem();
    const a = getVisitId({ storage: s, cryptoObj: fakeCrypto });
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(getVisitId({ storage: s, cryptoObj: fakeCrypto })).toBe(a);
  });
  test('expires after ~13 months', () => {
    const s = mem();
    let t = 1000;
    let calls = 0;
    const crypto2 = { getRandomValues: a => { calls++; for (let i = 0; i < a.length; i++) a[i] = (calls * 53 + i) % 256; return a; } };
    const a = getVisitId({ storage: s, cryptoObj: crypto2, now: () => t });
    t += 396 * 24 * 3600 * 1000;
    const b = getVisitId({ storage: s, cryptoObj: crypto2, now: () => t });
    expect(b).not.toBe(a);
  });
  test('corrupt storage value is replaced', () => {
    const s = mem(); s.setItem('sa_vid', 'not json');
    expect(getVisitId({ storage: s, cryptoObj: fakeCrypto })).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
  test('no crypto: no id, so no tracking', () => {
    expect(getVisitId({ storage: mem(), cryptoObj: undefined })).toBeNull();
    const { rows, f } = setup({ cryptoObj: undefined });
    expect(f.track('job_open', { job_id: 3 })).toBe(false);
    expect(rows).toHaveLength(0);
  });
  test('storage that throws never throws out', () => {
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    expect(getVisitId({ storage: bad, cryptoObj: fakeCrypto })).toBeNull();
    const { f } = setup({ storage: bad });
    expect(() => f.track('job_open', { job_id: 3 })).not.toThrow();
  });
});

describe('events', () => {
  test('only the funnel event names are accepted', () => {
    const { rows, f } = setup();
    expect(f.track('something_else')).toBe(false);
    expect(f.track('job_open', { job_id: 7 })).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_name: 'job_open', surface: 'web', properties: { job_id: 7 } });
    expect(rows[0].visit_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(rows[0].user_id).toBeUndefined();
  });
  test('all spec events are present', () => {
    for (const e of ['landing_view', 'jobs_view', 'job_open', 'search', 'signup_start', 'signup_complete', 'onboarding_step', 'save_job', 'apply_click', 'extension_install_seen', 'extension_first_fill', 'extension_fill']) {
      expect(FUNNEL_EVENTS).toContain(e);
    }
  });
  test('landing_view, jobs_view and extension_install_seen fire once per session', () => {
    const { rows, f } = setup();
    f.track('landing_view', {}); f.track('landing_view', {});
    f.track('jobs_view', {}); f.track('jobs_view', {});
    f.track('extension_install_seen', { v: '1.6.3' }); f.track('extension_install_seen', { v: '1.6.3' });
    f.track('job_open', { job_id: 1 }); f.track('job_open', { job_id: 2 });
    expect(rows.map(r => r.event_name)).toEqual(['landing_view', 'jobs_view', 'extension_install_seen', 'job_open', 'job_open']);
  });
  test('a rejected insert is swallowed', async () => {
    const { f } = setup({ insert: () => Promise.reject(new Error('net')) });
    expect(f.track('job_open', { job_id: 1 })).toBe(true);
    await Promise.resolve();
  });
  test('a synchronously throwing insert is swallowed', () => {
    const { f } = setup({ insert: () => { throw new Error('boom'); } });
    expect(() => f.track('job_open', { job_id: 1 })).not.toThrow();
  });
});

describe('property hygiene', () => {
  test('drops unknown keys (free text never leaves the browser)', () => {
    expect(cleanProps('search', { kind: 'query', has_q: true, q: 'my secret search', email: 'a@b.c' })).toEqual({ kind: 'query', has_q: true });
  });
  test('clips long strings and drops non-primitives', () => {
    const out = cleanProps('landing_view', { path: '/' + 'x'.repeat(200), ref: { a: 1 }, utm_source: ['x'] });
    expect(out.path.length).toBe(40);
    expect(out.ref).toBeUndefined();
    expect(out.utm_source).toBeUndefined();
  });
  test('extension fill events carry no properties', () => {
    expect(cleanProps('extension_fill', { url: 'https://x', company: 'Acme' })).toEqual({});
  });
  test('bucket', () => {
    expect([bucket(0), bucket(5), bucket(20), bucket(200)]).toEqual(['0', '1-9', '10-49', '50+']);
  });
});

describe('landingProps', () => {
  const loc = { pathname: '/', search: '?utm_source=hn&utm_medium=post&secret=1', hostname: 'www.simplyappl.ai' };
  test('keeps path, referrer host and utm_* only', () => {
    const p = landingProps({ loc, referrer: 'https://news.ycombinator.com/item?id=1234', width: 1200 });
    expect(p).toEqual({ path: '/', ref: 'news.ycombinator.com', utm_source: 'hn', utm_medium: 'post', utm_campaign: '', dev: 'd' });
  });
  test('same-site referrer and bad referrer are ignored; narrow screens are m', () => {
    expect(landingProps({ loc, referrer: 'https://www.simplyappl.ai/x', width: 400 })).toMatchObject({ ref: '', dev: 'm' });
    expect(landingProps({ loc, referrer: 'not a url', width: 400 }).ref).toBe('');
  });
});

describe('isFreshSignup', () => {
  test('first sign-in at creation time is a sign-up; a later sign-in is not', () => {
    expect(isFreshSignup({ created_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-01T10:00:02Z' })).toBe(true);
    expect(isFreshSignup({ created_at: '2026-10-01T10:00:00Z', last_sign_in_at: '2026-10-05T10:00:00Z' })).toBe(false);
    expect(isFreshSignup({})).toBe(false);
    expect(isFreshSignup(null)).toBe(false);
  });
});
