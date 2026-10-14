// First-party, anonymous funnel analytics.
//
// What it does: writes a handful of named events (no free text) to the existing
// analytics_events table, tagged with a random per-browser visit id.
// What it does not do: no IP or user-agent storage, no fingerprinting, no
// cross-site tracking, no third-party scripts, no link to the account (user_id
// stays null). Do-Not-Track and Global Privacy Control switch it off entirely.
// Every function is fail-silent: tracking must never block or break the UI.

export const FUNNEL_EVENTS = [
  'landing_view', 'jobs_view', 'job_open', 'search', 'signup_start', 'signup_complete',
  'onboarding_step', 'save_job', 'apply_click', 'extension_install_seen',
  'extension_first_fill', 'extension_fill',
];

// Events that are only counted once per browser session (page reloads would inflate them).
const ONCE_PER_SESSION = new Set(['landing_view', 'jobs_view', 'extension_install_seen']);

// Allowed property keys per event. Anything else is dropped; strings are clipped.
// Free text (search terms, job titles) is deliberately never sent.
const PROPS = {
  landing_view: ['path', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'dev'],
  jobs_view: ['signed_in', 'n'],
  job_open: ['job_id', 'ready'],
  search: ['kind', 'has_q', 'has_place', 'remote'],
  signup_start: ['method'],
  signup_complete: ['method'],
  onboarding_step: ['step'],
  save_job: ['job_id'],
  apply_click: ['job_id', 'signed_in', 'ext'],
  extension_install_seen: ['v'],
  extension_first_fill: [],
  extension_fill: [],
};

const VID_KEY = 'sa_vid';
const OPT_OUT_KEY = 'sa_notrack';
const ID_MAX_AGE_MS = 395 * 24 * 3600 * 1000; // ~13 months, then a fresh random id
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// True when the browser asks not to be tracked, or the visitor opted out here.
export function trackingDisabled(nav, storage, win) {
  try {
    const n = nav || {};
    if (n.globalPrivacyControl === true) return true;
    if (n.doNotTrack === '1' || n.doNotTrack === 'yes') return true;
    if (n.msDoNotTrack === '1') return true;
    if (win && (win.doNotTrack === '1' || win.doNotTrack === 'yes')) return true;
    if (storage && storage.getItem(OPT_OUT_KEY) === '1') return true;
    return false;
  } catch {
    return true; // when in doubt, do not track
  }
}

function newId(cryptoObj) {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Random id kept in this browser only. Returns null when it cannot be stored or created.
export function getVisitId({ storage, cryptoObj, now = Date.now }) {
  try {
    const raw = storage.getItem(VID_KEY);
    if (raw) {
      let o = null;
      try { o = JSON.parse(raw); } catch { /* corrupt value: replaced below */ }
      if (o && ID_RE.test(o.id) && now() - o.t < ID_MAX_AGE_MS) return o.id;
    }
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return null;
    const id = newId(cryptoObj);
    storage.setItem(VID_KEY, JSON.stringify({ id, t: now() }));
    return id;
  } catch {
    return null;
  }
}

const clip = (v) => String(v).slice(0, 40);

// Keep only whitelisted keys with primitive values.
export function cleanProps(event, props) {
  const out = {};
  const allowed = PROPS[event] || [];
  for (const k of allowed) {
    const v = props ? props[k] : undefined;
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === 'string') out[k] = clip(v);
  }
  return out;
}

// Coarse bucket so a count does not become an identifier.
export const bucket = (n) => (n <= 0 ? '0' : n < 10 ? '1-9' : n < 50 ? '10-49' : '50+');

// Landing details: path only, referrer host only (never full URLs or query strings except utm_*).
export function landingProps({ loc, referrer, width }) {
  const p = new URLSearchParams(loc.search || '');
  let ref = '';
  try {
    const h = referrer ? new URL(referrer).hostname : '';
    if (h && h !== loc.hostname) ref = h;
  } catch { /* ignore */ }
  return {
    path: loc.pathname,
    ref,
    utm_source: p.get('utm_source') || '',
    utm_medium: p.get('utm_medium') || '',
    utm_campaign: p.get('utm_campaign') || '',
    dev: width && width < 700 ? 'm' : 'd',
  };
}

// A user whose first sign-in is (almost) the moment the account was created.
// Used for OAuth sign-ups, which come back through a redirect with no callback.
export function isFreshSignup(user, windowMs = 120000) {
  try {
    const c = Date.parse(user.created_at);
    const l = Date.parse(user.last_sign_in_at);
    return Number.isFinite(c) && Number.isFinite(l) && Math.abs(l - c) <= windowMs;
  } catch { return false; }
}

// env: { insert(row) -> Promise|void, storage, session, nav, win, cryptoObj, now }
export function createFunnel(env) {
  const { insert, storage, session, nav, win, cryptoObj, now = Date.now } = env;

  function track(event, props = {}) {
    try {
      if (!FUNNEL_EVENTS.includes(event)) return false;
      if (trackingDisabled(nav, storage, win)) {
        try { storage.removeItem(VID_KEY); } catch { /* ignore */ }
        return false;
      }
      if (ONCE_PER_SESSION.has(event)) {
        const k = `sa_ev_${event}`;
        if (session && session.getItem(k)) return false;
        if (session) session.setItem(k, '1');
      }
      const visit_id = getVisitId({ storage, cryptoObj, now });
      if (!visit_id) return false;
      const r = insert({ event_name: event, visit_id, surface: 'web', properties: cleanProps(event, props) });
      if (r && typeof r.then === 'function') r.then(() => {}, () => {});
      return true;
    } catch {
      return false;
    }
  }

  const enabled = () => !trackingDisabled(nav, storage, win);

  return { track, enabled };
}
