// What the repair queue may keep about a field the extension failed to fill. The extension sends its error message and the
// element's markup, and both can carry what it tried to type (a phone number, an email, an address). A rule is chosen from
// the label, the field type, the markup's structure and the kind of failure, so no typed value is ever needed.
// public.simplyapply_redact_fail_reason (supabase/migrations/20261126000000_*) applies the same fail_reason list in SQL.

export const OTHER_REASON = 'other error (text not stored)';

// Messages that hold no value, exactly as shipped versions of the extension throw them.
const FIXED_REASONS = new Set([
  OTHER_REASON,
  'Not signed in', 'Not signed in — open ⚙ to sign in', 'Session expired — open ⚙ to sign in again',
  'value did not stick after typing (site cleared it on blur)', 'No cover letter uploaded — add one in extension settings',
  'US option not found in country code dropdown', 'attach blocked by browser', 'custom dropdown: no options found',
  'file — select manually', 'needs user file selection', 'no data', 'no matching option',
  'validation failed', 'AI could not write an answer for this question. Type it in yourself.',
]);

/** An allow list: a message that is not known to be free of values is not kept. */
export function redactFailReason(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (FIXED_REASONS.has(s)) return s;
  if (/^no data for [A-Za-z][A-Za-z0-9_]{0,39}$/.test(s) || /^(?:API|fetch) \d{3}$/.test(s)) return s; // a profile key name, a status
  const quoted = s.match(/^((?:custom dropdown: )?no option for|AI could not match (?:any )?option for) "/);
  if (quoted) return `${quoted[1]} "[redacted]"`;
  if (s.startsWith('AI answer "')) return 'AI answer "[redacted]" matched no option';
  return OTHER_REASON;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Written as a phone number: +country ..., (425) 628 4887, 425-628-4887.
const PHONE = /\+\d[\d ().-]{7,}\d|(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g;
const scrub = (s) => s.replace(EMAIL, '[email]').replace(PHONE, '[phone]');

/** A field label is page text; it also keys the row, so only emails and phone numbers are taken out. */
export function redactLabel(label) {
  return scrub(String(label).slice(0, 1000)).replace(/\b\d{10,}\b/g, '[number]');
}

// An attribute that holds a field's content. The closing quote is optional: the markup arrives cut at 3000 characters.
const VALUE_ATTR = /(\s(?:value|data-value|defaultvalue|aria-valuetext)\s*=\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s"'>]+)/gi;

/** Keeps the markup's structure (tags, ids, classes) and drops what was typed into it. Bare digit runs stay: they are ids. */
export function redactHtml(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let s = raw.slice(0, 3000)
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>|$)/gi, '$1$2')
    .replace(VALUE_ATTR, '$1"[redacted]"');
  if (/\scontenteditable(?!\s*=\s*["']?false)/i.test(s)) s = s.replace(/>[^<]+/g, '>'); // typed text is the element's text
  return scrub(s);
}

/** fieldType and fillTried are short identifiers ("select-one", "typeIn/AI"); anything else is not kept. */
export const identifierOrNull = (v) => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9/_-]{0,39}$/.test(v) ? v : null);

/** A fixed one-minute window, per caller and overall. Memory is bounded by `total`. */
export function createRateLimiter({ perKey = 120, total = 600, windowMs = 60_000, now = Date.now } = {}) {
  let started = now();
  let all = 0;
  const keys = new Map();
  return (key) => {
    if (now() - started >= windowMs) { started = now(); all = 0; keys.clear(); }
    const n = (keys.get(key) || 0) + 1;
    if (n > perKey || all >= total) return false;
    keys.set(key, n);
    all += 1;
    return true;
  };
}
