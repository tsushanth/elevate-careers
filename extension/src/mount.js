import { findRule, mergeRules } from './rules.js';
import staticRules from './static-rules.js';
import { reportFailure, RULES_URL } from './reporter.js';

// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = 'https://elevate-careers-api.fly.dev/api/ai-resume';

const JOB_HOSTS = [
  'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'ashbyhq.com',
  'smartrecruiters.com', 'jobvite.com', 'icims.com', 'taleo.net',
  'successfactors.com', 'workable.com', 'gem.com', 'rippling.com',
  'bamboohr.com', 'recruitee.com', 'dover.com', 'pinpoint.works',
  'amazon.jobs', 'jobs.apple.com', 'careers.google.com',
  'linkedin.com/jobs', 'indeed.com', 'glassdoor.com',
  'jobvite.com', 'ultipro.com', 'paylocity.com', 'paycom.com',
  'fountainhq.com', 'breezy.hr', 'applytojob.com', 'hire.com',
  'jobs.netflix.net', 'careers.netflix.com',
  'jobs.meta.com', 'metacareers.com',
  'microsoft.com/en-us/careers', 'careers.microsoft.com',
  'amazon.jobs', 'jobs.amazon.com',
  'stripe.com/jobs', 'grnh.se',
  'jobs.lever.co', 'apply.workable.com',
  'jobs.twilio.com', 'careers.twilio.com',
  'jobs.airbnb.com', 'careers.airbnb.com',
  'jobs.dropbox.com', 'jobs.squarespace.com',
  'jobs.cloudflare.com', 'careers.cloudflare.com',
  'jobs.stripe.com', 'jobs.shopify.com',
  'boards.greenhouse.io', 'jobs.greenhouse.io',
  'careers.jobvite.com', 'hire.withgoogle.com',
  // Custom career sites detected by detect-ats.js and injected via scripting API
  'kula.ai',
];

// Run on job sites in any frame, but only once per frame (guard re-injection)
// Check both hostname and path since some entries contain path prefixes (e.g. stripe.com/jobs)
const _loc = location.hostname + location.pathname;
// window.__simplyApplyForceInject is set by detect-ats.js before scripting injection
// to bypass the JOB_HOSTS guard on custom company career pages
if (!window.__simplyApplyForceInject && !JOB_HOSTS.some(h => _loc.includes(h))) { /* not a job site */ }
else if (window.__simplyApplyRunning) { /* already injected in this frame */ }
else {
  window.__simplyApplyRunning = true;
  const _runFn = main();
  // Auto-fill trigger: simplyappl.ai opens job URL with ?sa_autofill=1
  if (new URLSearchParams(location.search).get('sa_autofill') === '1' && !window.__saAutoTriggered) {
    window.__saAutoTriggered = true;
    Promise.resolve(_runFn).then(run => {
      if (typeof run === 'function') setTimeout(() => run(false).catch(() => {}), 3500);
    });
  }
}

function main() {

// No bundled resume/cover-letter asset URLs — those pointed at the
// founder's own real documents (name, contact info, and for the cover
// letter, visa/work-authorization status) and were silently attached to
// any user's application who hadn't uploaded their own. See the
// isCoverLetterField branch and /resume/tailor for the replacement
// behavior: fail clearly instead of substituting someone else's identity.

// ── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire  = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));

async function getToken() {
  return new Promise(resolve => {
    try { chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, r => resolve(r?.token || null)); }
    catch (_) { resolve(null); }
  });
}

async function apiCall(path, body, profile) {
  const token = await getToken();
  if (!token) throw new Error('Not signed in — open ⚙ to sign in');
  const res = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify({ ...body, profile }) } : {}),
  });
  if (res.status === 401) throw new Error('Session expired — open ⚙ to sign in again');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.error || `API ${res.status}`);
  }
  return res.json();
}

// ── Extension ping ───────────────────────────────────────────────────────────
// Fire once per day to track active installs. Fire-and-forget, never blocks autofill.
(async function pingExtensionInstall() {
  try {
    const { ext_ping_day } = await chrome.storage.local.get('ext_ping_day');
    const today = new Date().toISOString().slice(0, 10);
    if (ext_ping_day === today) return;
    const token = await getToken();
    if (!token) return;
    const ok = await fetch(`${API_BASE}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }).then(r => r.ok).catch(() => false);
    if (ok) await chrome.storage.local.set({ ext_ping_day: today });
  } catch (_) {}
})();

// ── Remote rules ─────────────────────────────────────────────────────────────
// Fetched once per session by sw.js and cached in chrome.storage.local.
// Merged with staticRules at run start; remote wins on same id + higher version.
let _activeRules = staticRules;

async function loadActiveRules() {
  try {
    const { remoteRules } = await chrome.storage.local.get('remoteRules');
    _activeRules = mergeRules(staticRules, remoteRules || []);
  } catch (_) {
    _activeRules = staticRules;
  }
}

function getRuleFor(field) {
  return findRule(_activeRules, {
    domain:    location.hostname,
    url:       location.href,
    fieldType: field.type,
    label:     field.label || '',
    el:        field.el,
  });
}

// ── Answer cache ─────────────────────────────────────────────────────────────
// Keyed by normalized question text. Persists across sessions in chrome.storage.local.
// Populated two ways: (a) user manually edits a field after autofill, (b) AI answer saved.
let answerCache = {};

async function loadCache() {
  try {
    const { answerCache: c } = await chrome.storage.local.get('answerCache');
    if (c && typeof c === 'object') answerCache = c;
  } catch (_) {}
}

async function saveCache() {
  try { await chrome.storage.local.set({ answerCache }); } catch (_) {}
}

function cacheKey(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

function getCached(label) {
  return answerCache[cacheKey(label)];
}

function setCached(label, value) {
  const key = cacheKey(label);
  if (answerCache[key] === value) return; // no change
  answerCache[key] = value;
  saveCache();
}

// ── Learned answers — user-entered values stored for future runs ──────────────
// Higher priority than answerCache (AI-generated). Sent to the AI as context.
let learnedAnswers = {};

async function loadLearnedAnswers() {
  try {
    const { learnedAnswers: la } = await chrome.storage.local.get('learnedAnswers');
    if (la && typeof la === 'object') learnedAnswers = la;
  } catch (_) {}
}

function getLearnedAnswer(label) {
  return learnedAnswers[cacheKey(label)];
}

function saveLearnedAnswer(label, value) {
  const key = cacheKey(label);
  if (learnedAnswers[key] === value) return;
  learnedAnswers[key] = value;
  try { chrome.storage.local.set({ learnedAnswers }); } catch (_) {}
  // Mirror into answerCache so next run picks it up immediately
  setCached(label, value);
}

// ── Label extraction (Simplify-style: walk up DOM) ───────────────────────────
const LABEL_TAGS = new Set(['LABEL','LEGEND','SPAN','P','DIV','H1','H2','H3','H4','DT','LI']);
// Pronouns deliberately excluded — unlike race/veteran-status/disability/etc,
// it's not an EEOC-protected self-identification category the same way, and
// the profile has a real preference to fill it with rather than skip it.
const SKIP_EEOC  = /gender|lgbtq|race|ethnic|hispanic|latino|veteran|disability|sexual|transgender/i;
const AGREE_RE   = /i agree|i consent|i acknowledge|i certify|terms|privacy policy|by (checking|selecting|clicking)/i;

function cleanText(t) {
  return (t || '')
    .replace(/\s+/g, ' ')
    .replace(/^Q\.\s*/i, '')
    .replace(/\s*Question\b.*$/i, '')
    .replace(/\s*Required\b.*$/i, '')
    .replace(/[*:]+$/, '')
    .trim();
}

// Finds the shared question text for a radio group (e.g. "Pronouns"), as
// opposed to extractLabel() on a single radio, which finds that ONE
// option's own text ("She/her"). Tries <fieldset><legend> first, then
// walks up from the group's container looking for a heading that precedes
// it, then falls back to the shared `name` attribute.
function groupLabelFor(inputs) {
  for (const el of inputs) {
    const fieldset = el.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend) {
      const t = cleanText(legend.textContent);
      if (t) return t;
    }
  }
  const anchor = inputs[0];
  const container = anchor.closest('div, section, fieldset') || anchor.parentElement;
  let node = container?.parentElement;
  for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
    for (const child of node.children) {
      if (child === container || child.contains(anchor)) break;
      if (LABEL_TAGS.has(child.tagName)) {
        const t = cleanText(child.textContent);
        if (t && t.length < 200) return t;
      }
    }
  }
  return (anchor.name || '').replace(/[_-]/g, ' ').trim() || null;
}

function extractLabel(el) {
  // 1. <label for="id">
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return cleanText(lbl.textContent);
  }

  // 2. aria-label
  const al = el.getAttribute('aria-label');
  if (al?.trim()) return cleanText(al);

  // 3. aria-labelledby
  const alb = el.getAttribute('aria-labelledby');
  if (alb) {
    const t = alb.split(' ').map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    if (t.trim()) return cleanText(t);
  }

  // 4. Walk up DOM — stop as soon as a container holds >1 interactive element
  //    Exception: radio/checkbox groups share a container but are one logical field
  const INPUT_SEL = 'input:not([type=hidden]), select, textarea';
  const isRadioGroup = (node) => {
    const inputs = [...node.querySelectorAll(INPUT_SEL)];
    return inputs.length > 1 && inputs.every(i => i.type === 'radio' || i.type === 'checkbox') &&
      new Set(inputs.map(i => i.name)).size === 1;
  };
  let node = el.parentElement;
  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    const inputCount = node.querySelectorAll(INPUT_SEL).length;
    if (inputCount > 1 && !isRadioGroup(node)) break;

    // a. label child that doesn't wrap the input
    for (const lbl of node.querySelectorAll('label')) {
      if (!lbl.contains(el)) {
        const t = cleanText(lbl.textContent);
        if (t && t.length < 200) return t;
      }
    }

    // b. preceding sibling with text
    const sib = depth === 0 ? el.previousElementSibling : node.previousElementSibling;
    if (sib && LABEL_TAGS.has(sib.tagName)) {
      const t = cleanText(sib.textContent);
      if (t && t.length < 200) return t;
    }

    // c. first text-bearing child before the input
    for (const child of node.children) {
      if (child === el || child.contains(el)) break;
      if (LABEL_TAGS.has(child.tagName)) {
        const t = cleanText(child.textContent);
        if (t && t.length < 200) return t;
      }
    }
  }

  // 5. Fallback: normalize name/id bracket notation
  const raw = el.placeholder || el.name || el.id || '';
  return raw.replace(/.*\[(.+)\]$/, '$1').replace(/[_-]/g, ' ').trim();
}

// ── Field → profile key matching ──────────────────────────────────────────────
const KEYWORD_RULES = [
  { re: /visa sponsorship|require.*sponsor|sponsor.*visa|h-?1b/i,         key: 'sponsorship' },
  { re: /authori[sz]ed to work|work auth|legally authoris|eligible to work/i, key: 'workAuth' },
  { re: /\bphone\b|\bmobile\b|telephone|cell number/i,                    key: 'phone' },
  { re: /\bcountry\b/i,                                                   key: 'country' },
  { re: /\bstate\b|\bprovince\b/i,                                        key: 'state' },
  { re: /\bcity\b/i,                                                      key: 'city' },
  { re: /zip|postal code/i,                                               key: 'postalCode' },
  { re: /linkedin/i,                                                      key: 'linkedin' },
  { re: /github/i,                                                        key: 'github' },
  { re: /website|portfolio/i,                                             key: 'portfolio' },
  { re: /\bfull name\b|^name$|your name/i,                                 key: 'fullName' },
  { re: /pronoun/i,                                                       key: 'pronouns' },
  { re: /first name|given name|forename/i,                                key: 'firstName' },
  { re: /last name|surname|family name/i,                                 key: 'lastName' },
  { re: /\bemail\b/i,                                                     key: 'email' },
  { re: /street|address line|mailing address/i,                           key: 'address' },
  { re: /location\b/i,                                                    key: 'location' },
  { re: /education level|degree level|highest.*degree|level.*education/i, key: 'educationLevel' },
  { re: /school name|university|college|institution/i,                    key: 'schoolName' },
  { re: /field of study|area.*study|major|discipline/i,                   key: 'fieldOfStudy' },
  { re: /graduation year|year.*grad|grad.*year/i,                         key: 'graduationYear' },
  { re: /salary|compensation|pay expectation|desired.*pay|expected.*salary/i, key: 'salary' },
  { re: /how.*hear|how.*find|how.*learn|where.*hear|referral source/i,    key: 'heardAbout' },
  { re: /current.*company|most recent.*company|employer/i,                key: 'currentCompany' },
];

function matchKey(label) {
  const t = label.toLowerCase();
  for (const { re, key } of KEYWORD_RULES) {
    if (re.test(t)) return key;
  }
  return null;
}

// ── Document field detection ──────────────────────────────────────────────────
const RESUME_RE = /\bresume\b/i;
const COVER_RE  = /cover.?letter/i;

function fileFieldHaystack(field) {
  const parts = [field.label, field.el.name, field.el.id, field.el.getAttribute('data-field') || ''];
  let node = field.el.parentElement;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const heading = node.querySelector('h1,h2,h3,h4,h5,label,legend,strong');
    if (heading && heading !== field.el) parts.push(heading.textContent);
    for (const sib of node.children) {
      if (sib === field.el || sib.contains(field.el)) break;
      if (/^(LABEL|LEGEND|SPAN|P|DIV|H[1-6]|STRONG)$/.test(sib.tagName)) parts.push(sib.textContent);
    }
  }
  return parts.join(' ');
}

function isResumeField(field) {
  if (field.type !== 'file') return false;
  const haystack = fileFieldHaystack(field);
  if (/linkedin/i.test(field.label + field.el.name + field.el.id)) return false;
  if (COVER_RE.test(haystack)) return false;
  if (RESUME_RE.test(haystack)) return true;
  const accept = field.el.accept || '';
  return /pdf/i.test(accept) && !COVER_RE.test(haystack);
}

function isCoverLetterField(field) {
  if (field.type !== 'file') return false;
  const haystack = fileFieldHaystack(field);
  return COVER_RE.test(haystack);
}

// Agreement checkboxes/selects — auto-check or select "I agree / I consent" style fields
function isAgreementField(field) {
  const haystack = [field.label, field._contextLabel || '', field.el.name, field.el.id,
    field.el.closest('label,p,div')?.textContent || ''].join(' ');
  if (!AGREE_RE.test(haystack)) return false;
  if (field.type === 'checkbox' || field.type === 'radio') return true;
  if (field.type === 'select-one') {
    return [...(field.el.options || [])].some(o => /agree|consent|accept/i.test(o.textContent));
  }
  return false;
}

// Detect unlabeled country-code dropdowns paired with a phone input
function isCountryCodeField(field) {
  if (field.label && field.label !== '(Unlabeled)') return false;
  if (field.type !== 'select-one') return false;
  const opts = [...(field.el.options || [])];
  // Match: "+1", "United States", flag emoji options (🇺🇸), or values like "US" / "1" / "+1"
  return opts.length > 5 && opts.some(o =>
    /^\+\d|united states|🇺🇸/i.test(o.textContent) ||
    /^(US|\+1|1)$/.test(o.value.trim())
  );
}

// Decode base64 PDF from API and attach it to a file input
async function attachPdfB64(el, b64, filename) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const file = new File([blob], filename, { type: 'application/pdf' });
  await attachFileObj(el, file);
}

// Core attach logic shared by both static and generated PDFs
async function attachFileObj(el, file) {
  const dt = new DataTransfer();
  dt.items.add(file);

  const prev = { display: el.style.display, visibility: el.style.visibility, opacity: el.style.opacity };
  el.style.cssText += ';display:block!important;visibility:visible!important;opacity:1!important;';

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
  if (nativeSetter) nativeSetter.call(el, dt.files);
  else el.files = dt.files;

  el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

  try {
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (fiberKey) {
      let fiber = el[fiberKey];
      while (fiber) {
        const onChange = fiber.memoizedProps?.onChange;
        if (typeof onChange === 'function') {
          const noop = () => {};
          onChange({ target: el, currentTarget: el, bubbles: true, nativeEvent: new Event('change'), stopPropagation: noop, preventDefault: noop, isPropagationStopped: () => false });
          break;
        }
        fiber = fiber.return;
      }
    }
  } catch (_) {}

  const dropZone = el.closest('[class*="upload"],[class*="drop"],[class*="attach"],[class*="resume"],[class*="file"]') || el.parentElement;
  if (dropZone && dropZone !== el) {
    dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dropZone.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
  }

  el.style.display    = prev.display;
  el.style.visibility = prev.visibility;
  el.style.opacity    = prev.opacity;

  if (!el.files?.length) throw new Error('attach blocked by browser');
}

// ── Open-ended detection ─────────────────────────────────────────────────────
function isOpenEnded(field) {
  if (field.key) return false;
  if (isResumeField(field) || isCoverLetterField(field)) return false;
  if (isAgreementField(field) || isCountryCodeField(field)) return false;
  if (SKIP_EEOC.test(field.label)) return false;
  // combobox/datalist handled separately — never treat as plain text
  if (field.type === 'combobox' || field.type === 'datalist') return false;
  if (field.el.tagName === 'TEXTAREA') return true;
  if (field.type === 'text' && field.label.length > 20 && /\?|why|tell|describe|explain|share|what/i.test(field.label)) return true;
  // Selects with no key but a real label — try cache then AI
  if (field.label && field.label !== '(Unlabeled)' && !SKIP_EEOC.test(field.label)) {
    if (field.type === 'select-one') return true;
  }
  return false;
}

// ── DOM scan ─────────────────────────────────────────────────────────────────
const FIELD_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=search]), select, textarea';
// Custom div-based dropdowns: comboboxes and elements with a listbox popup
const CUSTOM_DD_SEL = '[role="combobox"]:not([disabled]), [aria-haspopup="listbox"]:not([disabled]), [aria-haspopup="true"]:not([disabled])';
const SEARCH_RE = /\bsearch\b/i;

function fieldsFromDoc(doc) {
  try {
    const fields = [...doc.querySelectorAll(FIELD_SEL)].filter(el => {
      if (el.disabled || el.readOnly) return false;
      // Skip search/nav inputs that aren't part of a job application form
      if (SEARCH_RE.test(el.className) || SEARCH_RE.test(el.name) || SEARCH_RE.test(el.id)) return false;
      if (el.closest('nav, header, [role=search], form[action*="search"], form[action*="positions"]')) return false;
      if (el.type === 'file') return true;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).map(el => {
      const label = extractLabel(el);
      const key   = matchKey(label) || matchKey(el.name || '') || matchKey(el.placeholder || '');
      let type = (el.type || el.tagName).toLowerCase();
      // Detect combobox: input with role=combobox OR aria-autocomplete OR aria-haspopup=listbox
      if (type === 'text' || type === 'search') {
        if (el.getAttribute('role') === 'combobox' ||
            el.getAttribute('aria-autocomplete') ||
            el.getAttribute('aria-haspopup')) {  // "listbox", "true", or any truthy value
          type = 'combobox';
        } else if (el.getAttribute('list')) {
          type = 'datalist';
        }
      }
      return { el, label: label || '(Unlabeled)', key, type };
    });

    // Merge same-name radio inputs into one logical field. Previously each
    // radio (e.g. "She/her", "He/him", "Ze/hir"...) became its own field
    // with no `key` and type 'radio', so every option showed up separately
    // as an unfillable "unknown" row instead of one pickable question.
    const radiosByName = new Map();
    for (const f of fields) {
      if (f.type !== 'radio' || !f.el.name) continue;
      if (!radiosByName.has(f.el.name)) radiosByName.set(f.el.name, []);
      radiosByName.get(f.el.name).push(f);
    }
    for (const [, group] of radiosByName) {
      if (group.length < 2) continue;
      const groupLabel = groupLabelFor(group.map(f => f.el)) || group[0].label;
      const merged = {
        el: group[0].el,
        label: groupLabel,
        key: matchKey(groupLabel),
        type: 'radio-group',
        radioOptions: group.map(f => ({ el: f.el, text: f.label })),
      };
      const firstIdx = fields.indexOf(group[0]);
      for (const f of group) fields.splice(fields.indexOf(f), 1);
      fields.splice(firstIdx, 0, merged);
    }

    // Also scan for custom div/span dropdowns (Greenhouse work-auth, location, etc.)
    // Exclude elements that are already inside a native select or that ARE an input/select
    const nativeEls = new Set(fields.map(f => f.el));
    for (const el of doc.querySelectorAll(CUSTOM_DD_SEL)) {
      if (nativeEls.has(el)) continue; // already captured as native input
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') continue;
      if (el.closest('nav, header, [role=search]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = extractLabel(el);
      const key   = matchKey(label) || matchKey(el.getAttribute('name') || '') || matchKey(el.getAttribute('aria-label') || '');
      fields.push({ el, label: label || '(Unlabeled)', key, type: 'custom-select' });
    }

    // Second pass: unlabeled fields inherit context from their nearest preceding labeled sibling
    // This handles: EEOC radio inputs, agreement checkboxes, country-code selects
    for (let i = 1; i < fields.length; i++) {
      const f = fields[i];
      if (f.label !== '(Unlabeled)' || f.key) continue;
      // Walk back to find the nearest field with a real label
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prev = fields[j];
        if (prev.label && prev.label !== '(Unlabeled)') {
          f._contextLabel = prev.label;
          break;
        }
      }
    }

    return fields;
  } catch { return []; }
}

function scanFields() {
  const fields = fieldsFromDoc(document);
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      const doc = iframe.contentDocument;
      if (doc) fields.push(...fieldsFromDoc(doc));
    } catch { /* cross-origin — skip */ }
  }
  return fields;
}

// ── Fill helpers ─────────────────────────────────────────────────────────────
const _nativeInputSet    = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,    'value')?.set;
const _nativeTextareaSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
const _nativeSelectSet   = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,   'value')?.set;

function nativeSet(el, value) {
  const setter = el.tagName === 'TEXTAREA' ? _nativeTextareaSet : _nativeInputSet;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function nativeSelectSet(el, value) {
  if (_nativeSelectSet) _nativeSelectSet.call(el, value);
  else el.value = value;
}

async function typeIn(el, value, delay = 12) {
  el.focus();
  nativeSet(el, '');
  fire(el, 'input');
  // Track the intended string locally instead of reading el.value back each
  // keystroke — on a React-controlled field, the page's own re-render can
  // reset/clobber the DOM value mid-typing, and re-reading el.value builds
  // the rest of the string on top of that corrupted value. Only the tail
  // typed after the last reset used to survive (e.g. a full LinkedIn URL
  // ending up as just "hanth/").
  let typed = '';
  for (const ch of String(value)) {
    typed += ch;
    nativeSet(el, typed);
    fire(el, 'input');
    await sleep(delay);
  }
  fire(el, 'change');
  await sleep(50);
  if (el.value !== typed) {
    nativeSet(el, typed);
    fire(el, 'input');
    fire(el, 'change');
    await sleep(50);
  }

  // Some sites (URL fields especially) validate/reset the value ON BLUR,
  // not on input/change — e.g. Applied Intuition's LinkedIn/GitHub fields
  // silently cleared to empty after blur despite typing + the check above
  // both succeeding beforehand. Checking only pre-blur can't catch that,
  // since blur happens after. Verify again post-blur and do one more
  // repair-and-reblur cycle before giving up.
  el.blur();
  await sleep(80);
  if (el.value !== typed) {
    el.focus();
    nativeSet(el, typed);
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    await sleep(80);
  }

  // If it's STILL wrong, the status must say so — a field silently left
  // empty while the UI claims "filled" is worse than an honest failure.
  if (el.value !== typed) throw new Error(`value did not stick after typing (site cleared it on blur)`);
}

async function fillStructured(field, profile) {
  const { el, key, type } = field;
  const raw = profile[key]
    ?? (key === 'fullName' ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || null : null);
  const value = (raw === '' || raw == null) ? null : raw;
  if (value == null) throw new Error('no data for ' + key);

  if (type === 'select-one' || el.tagName === 'SELECT') {
    const opts = [...el.options].map(o => ({ el: o, text: o.textContent.trim() })).filter(o => o.text);
    const pick = fuzzyPickOption(opts, value);
    if (!pick) throw new Error(`no option for "${value}"`);
    nativeSelectSet(el, pick.el.value);
    fire(el, 'input');
    fire(el, 'change');
    return;
  }

  if (type === 'radio-group') {
    const pick = fuzzyPickOption(field.radioOptions, value);
    if (!pick) throw new Error(`no option for "${value}"`);
    if (!pick.el.checked) pick.el.click();
    return;
  }

  if (type === 'checkbox' || type === 'radio') {
    const want = String(value).toLowerCase() !== 'no' && !!value;
    if (el.checked !== want) el.click();
    return;
  }

  if (type === 'file') throw new Error('file — select manually');

  await typeIn(el, value);
}

async function fillCountryCode(field) {
  const el = field.el;
  const opts = [...el.options];
  const pick =
    opts.find(o => /united states/i.test(o.textContent)) ||
    opts.find(o => /🇺🇸/.test(o.textContent)) ||
    opts.find(o => /^\+1\b/.test(o.textContent.trim())) ||
    opts.find(o => o.textContent.trim() === '+1') ||
    opts.find(o => ['US', '+1', '1'].includes(o.value.trim()));
  if (!pick) throw new Error('US option not found in country code dropdown');
  nativeSelectSet(el, pick.value);
  fire(el, 'input');
  fire(el, 'change');
}

// ── Fuzzy option picker ────────────────────────────────────────────────────────
// opts: array of { text: string, el?: any }
// hint: string from profile or AI answer
// returns the matched item or null
function fuzzyPickOption(opts, hint) {
  const h = String(hint).toLowerCase().trim();
  return (
    opts.find(o => o.text.toLowerCase() === h) ||
    opts.find(o => o.text.toLowerCase().startsWith(h)) ||
    opts.find(o => o.text.toLowerCase().includes(h)) ||
    opts.find(o => h.includes(o.text.toLowerCase()) && o.text.length > 1) ||
    // "Yes" matches any option starting with "Yes" (e.g. "Yes, no restriction.")
    (/^yes/i.test(h) && opts.find(o => /^yes\b/i.test(o.text))) ||
    // "No" matches any option starting with "No" but prefers ones without sponsorship mention
    (/^no/i.test(h)  && (opts.find(o => /^no\b/i.test(o.text) && !/sponsor/i.test(o.text)) || opts.find(o => /^no\b/i.test(o.text)))) ||
    null
  );
}

// ── AI-assisted option picking ────────────────────────────────────────────────
// Fallback for when fuzzyPickOption can't confidently match visible dropdown
// options against a hint (phrasing mismatch, no textual overlap, etc). Sends
// the field label + exact option list to the server as a closed-set
// classification task and gets back an index — cached per-label afterward so
// repeat fills of the same field never re-hit the API.
async function pickOptionViaAI(field, opts, jobDesc, profile) {
  const cached = getLearnedAnswer(field.label) ?? getCached(field.label);
  if (cached !== undefined) {
    const pick = fuzzyPickOption(opts, cached);
    if (pick) return pick;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE}/copilot/pick-option`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        label: field.label,
        options: opts.map(o => o.text),
        profile,
        jobDescription: jobDesc,
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const { index } = await res.json();
    if (index === -1 || index == null || !opts[index]) return null;
    setCached(field.label, opts[index].text);
    return opts[index];
  } catch (_) {
    return null; // timeout, network error, etc. — caller falls back to local heuristic
  }
}

// ── Combobox/datalist fill ─────────────────────────────────────────────────────
// For inputs that reveal a dropdown when focused (role=combobox, aria-autocomplete, datalist)

function visibleOptions() {
  return [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]')]
    .filter(o => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(o => ({ text: o.textContent.trim(), el: o }))
    .filter(o => o.text);
}

async function fillCombobox(field, hint, ctx = {}) {
  const el = field.el;

  // datalist: read options directly from the linked <datalist>
  if (field.type === 'datalist') {
    const listId = el.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (datalist) {
      const opts = [...datalist.options].map(o => ({ text: (o.label || o.value).trim(), val: o.value })).filter(o => o.text);
      const pick = fuzzyPickOption(opts, hint) || await pickOptionViaAI(field, opts, ctx.jobDesc, ctx.profile);
      if (pick) {
        await typeIn(el, pick.val || pick.text);
        return;
      }
    }
    await typeIn(el, hint);
    return;
  }

  // Open the menu using React-compatible events (mousedown+mouseup+click)
  const control = el.closest('[class*="control"]') || el.parentElement?.parentElement;
  if (control && control !== el) reactClick(control); else reactClick(el);
  await sleep(400);

  // Pass 1: pick from options that appeared
  let opts = visibleOptions();
  if (opts.length > 0) {
    const pick = fuzzyPickOption(opts, hint);
    if (pick) {
      pick.el.click();
      await sleep(100);
      return;
    }
    // Options visible but no match — close, then type to filter
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
  }

  // Pass 2: type hint to trigger React Select filter, then click best result
  if (control && control !== el) reactClick(control); else reactClick(el);
  await sleep(300);
  await typeIn(el, hint);
  await sleep(450);
  opts = visibleOptions();
  if (opts.length > 0) {
    const pick = fuzzyPickOption(opts, hint) || await pickOptionViaAI(field, opts, ctx.jobDesc, ctx.profile) || opts[0];
    pick.el.click();
    await sleep(100);
    return;
  }

  // Nothing worked — leave typed text (last resort)
}

// ── React-compatible click — dispatches mousedown+mouseup+click ───────────────
// Raw .click() only fires a synthetic click; React Select listens on mousedown.
function reactClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

// ── Probe for a hidden dropdown on any <input type="text"> ────────────────────
async function probeDropdown(el) {
  const control = el.closest('[class*="control"]') || el.parentElement?.parentElement;
  if (control && control !== el) reactClick(control);
  else reactClick(el);
  await sleep(400);
  return visibleOptions();
}

async function fillOpenEndedWithCache(field, jobDesc, profile) {
  const learned = getLearnedAnswer(field.label);
  if (learned !== undefined) return { answer: learned, fromCache: true };
  const cached = getCached(field.label);
  if (cached !== undefined) return { answer: cached, fromCache: true };
  const { answer } = await apiCall('/copilot/answer', { question: field.label, jobDescription: jobDesc, learnedAnswers }, profile);
  setCached(field.label, answer);
  return { answer, fromCache: false };
}

async function fillSelect(field, jobDesc, profile) {
  const allOpts = [...field.el.options].map(o => ({ el: o, text: o.textContent.trim() })).filter(o => o.text);

  const preferred = getLearnedAnswer(field.label) ?? getCached(field.label);
  if (preferred !== undefined) {
    const pick = fuzzyPickOption(allOpts, preferred);
    if (pick) {
      nativeSelectSet(field.el, pick.el.value);
      fire(field.el, 'input');
      fire(field.el, 'change');
      return { fromCache: true };
    }
  }

  // Closed-set classification: ask the server to pick the option index directly,
  // instead of asking for free text and fuzzy-matching it back onto an option.
  const pick = await pickOptionViaAI(field, allOpts, jobDesc, profile);
  if (!pick) throw new Error(`AI could not match any option for "${field.label}"`);
  nativeSelectSet(field.el, pick.el.value);
  fire(field.el, 'input');
  fire(field.el, 'change');
  setCached(field.label, pick.text);
  return { fromCache: false };
}

// ── Custom div-based dropdown fill ───────────────────────────────────────────
// Handles Greenhouse-style aria/div dropdowns (role=combobox, aria-haspopup=listbox, etc.)
async function fillCustomDropdown(field, value, ctx = {}) {
  const el = field.el;
  // Open with React-compatible events
  reactClick(el);
  await sleep(300);

  // Option containers may be appended to body or be inside a sibling/child element
  // Search progressively: inside el, in body portals, then document-wide
  function collectOptions(root) {
    return [...root.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="listitem"], li[data-value], li[class*="option"], div[class*="option"]'
    )].map(o => ({ text: o.textContent.trim(), el: o })).filter(o => o.text);
  }

  const opts = [...collectOptions(el.parentElement || el), ...collectOptions(document.body)];
  const seen = new Set();
  const deduped = opts.filter(o => { if (seen.has(o.text)) return false; seen.add(o.text); return true; });
  const pick = fuzzyPickOption(deduped, value) || await pickOptionViaAI(field, deduped, ctx.jobDesc, ctx.profile);
  if (!pick) throw new Error(`custom dropdown: no option for "${value}"`);
  pick.el.click();
  await sleep(100);
}

// ── Rule-driven fill ─────────────────────────────────────────────────────────
// Called when findRule() returns a match. Applies the rule's fix on top of
// whatever value the normal logic would use. Returns 'skip', true, or false.
async function applyRuleFix(rule, field, value) {
  if (!value) return false;
  const fix = rule.fix;

  const el = (fix.selectorOverride && document.querySelector(fix.selectorOverride)) || field.el;
  if (fix.waitMs) await sleep(fix.waitMs);

  switch (fix.fillMethod) {
    case 'execCommand': {
      // _valueTracker reset + native setter: the approach that works for React
      // controlled textareas (e.g. Ashby) where execCommand inserts text but React
      // resets it on re-render because its internal tracker wasn't updated.
      el.focus();
      el.select?.();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        if (el._valueTracker) el._valueTracker.setValue('');
        nativeSetter.call(el, String(value));
      } else {
        nativeSet(el, String(value));
      }
      fire(el, 'input');
      fire(el, 'change');
      el.blur();
      break;
    }
    case 'nativeSet':
      nativeSet(el, String(value));
      (fix.eventSequence || ['input', 'change']).forEach(e => fire(el, e));
      break;
    case 'reactClick':
      await fillCombobox(field, value);
      break;
    case 'skip':
      return 'skip';
    default:
      await typeIn(el, String(value));
  }
  return true;
}

// ── Post-fill observation: watch for user edits and cache them ────────────────
// Watches ALL non-EEOC labeled fields, including ones the extension skipped.
// Any value the user types is saved as a learnedAnswer and used on future runs.
function watchForUserEdits(fields) {
  for (const field of fields) {
    if (!field.label || field.label === '(Unlabeled)') continue;
    if (SKIP_EEOC.test(field.label)) continue;
    if (field.type === 'file') continue;

    const el = field.el;
    const handler = () => {
      let val;
      if (el.type === 'checkbox' || el.type === 'radio') {
        val = el.checked ? 'Yes' : 'No';
      } else if (field.type === 'combobox' || field.type === 'datalist') {
        // React Select keeps el.value empty; read the selected value from the control's display
        const container = el.closest('[class*="container"]');
        const singleVal = container?.querySelector('[class*="single-value"]')?.textContent?.trim();
        const multiVals = container ? [...container.querySelectorAll('[class*="multi-value__label"]')].map(e => e.textContent.trim()) : [];
        val = multiVals.length ? multiVals.join(', ') : singleVal;
      } else {
        val = el.value?.trim();
      }
      if (val) {
        saveLearnedAnswer(field.label, val);
      }
    };

    // For combobox: watch for React Select's mutation on the container
    if (field.type === 'combobox' || field.type === 'datalist') {
      const container = el.closest('[class*="container"]');
      if (container) {
        const obs = new MutationObserver(() => { handler(); });
        obs.observe(container, { childList: true, subtree: true });
        // Disconnect after 5 minutes (form submission should happen by then)
        setTimeout(() => obs.disconnect(), 5 * 60 * 1000);
        continue;
      }
    }
    el.addEventListener('change', handler, { once: true });
    el.addEventListener('blur',   handler, { once: true });
  }
}

// ── Job description extraction ────────────────────────────────────────────────
function getJobDescription() {
  const selectors = [
    '[class*="job-description"]', '[class*="jobDescription"]', '[class*="job_description"]',
    '[id*="job-description"]', '.posting-description', 'article', 'main',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.length > 200) return el.innerText.slice(0, 3000);
  }
  return document.body.innerText.slice(0, 3000);
}

// ── Widget UI ─────────────────────────────────────────────────────────────────
document.getElementById('__autofill_host')?.remove();

const host = document.createElement('div');
host.id = '__autofill_host';
host.style.cssText = 'all:initial;position:fixed!important;top:20px!important;right:20px!important;z-index:2147483647!important;';
document.documentElement.appendChild(host);

new MutationObserver(() => {
  if (!document.getElementById('__autofill_host')) document.documentElement.appendChild(host);
}).observe(document.documentElement, { childList: true });

host.addEventListener('click', e => e.stopPropagation());

const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :host { font-family: system-ui, sans-serif; }
  #fab { all:unset; position:relative; width:52px; height:52px; border-radius:14px; background:#0f172a; border:none;
         box-shadow:0 4px 20px rgba(0,0,0,.35); cursor:pointer; font-size:22px;
         display:flex; align-items:center; justify-content:center; }
  #fab:hover { background:#1e293b; box-shadow:0 6px 28px rgba(0,0,0,.45); }
  #fitBadge { display:none; position:absolute; top:-6px; right:-6px; min-width:20px; height:20px;
              border-radius:10px; background:#94a3b8; color:#fff; font-size:10px; font-weight:700;
              align-items:center; justify-content:center; padding:0 4px; border:2px solid #fff; }
  #fitBadge.good { background:#22c55e; } #fitBadge.mid { background:#f59e0b; }
  #fitBadge.low { background:#ef4444; } #fitBadge.blocker { background:#dc2626; }
  #fitLine { display:none; font-size:11px; font-weight:600; color:#334155; flex-basis:100%; order:2; padding:0 0 2px; }
  #blockerBanner { display:none; background:#fef2f2; color:#991b1b; font-size:11px; line-height:1.4;
                   padding:6px 12px; border-bottom:1px solid #fecaca; }
  #panel { position:fixed; top:82px; right:20px; width:360px; max-height:72vh;
           background:#fff; border:1px solid #e2e8f0; border-radius:14px;
           box-shadow:0 8px 40px rgba(0,0,0,.18); display:none; flex-direction:column; }
  #panel.open { display:flex; }
  #hdr { display:flex; align-items:center; gap:6px; padding:8px 12px; border-bottom:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  #hdr strong { font-size:13px; }
  #status { flex:1; min-width:100%; font-size:11px; color:#64748b; order:1; padding-top:2px; }
  #list { overflow-y:auto; flex:1; padding:6px 12px; list-style:none; margin:0; }
  .row { display:flex; align-items:flex-start; gap:8px; padding:5px 0; border-bottom:1px dashed #f1f5f9; }
  .row:last-child { border:none; }
  .dot { width:9px; height:9px; border-radius:50%; margin-top:4px; flex-shrink:0; background:#e2e8f0; }
  .done { background:#22c55e; } .skip { background:#94a3b8; } .err { background:#ef4444; } .filling { background:#f59e0b; } .review { background:#f59e0b; outline:2px solid #f59e0b; outline-offset:1px; }
  .lbl { font-size:12px; font-weight:500; }
  .sub { font-size:11px; color:#94a3b8; margin-top:1px; }
  #footer { display:flex; gap:6px; padding:8px 12px; border-top:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  .btn { padding:5px 10px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafa; cursor:pointer; }
  .btn:hover { background:#f1f5f9; }
  .btn.primary { background:#0f172a; color:#fff; border-color:#0f172a; }
  .btn.primary:hover { background:#1e293b; }
</style>
<button id="fab">⚡<span id="fitBadge"></span></button>
<div id="panel">
  <div id="blockerBanner"></div>
  <div id="hdr">
    <strong>Autofill</strong>
    <span id="fitLine"></span>
    <span id="status">Ready</span>
    <button class="btn" id="rescan" title="Re-scan" style="margin-left:auto;padding:2px 7px;font-size:13px;">↺</button>
    <button class="btn" id="settings" title="Edit profile" style="padding:2px 7px;font-size:13px;">⚙</button>
  </div>
  <ul id="list"></ul>
  <div id="footer">
    <button class="btn" id="dry">Dry-run</button>
    <button class="btn primary" id="fill">Fill</button>
    <button class="btn" id="pause">Pause</button>
  </div>
</div>
`;

const $ = id => shadow.getElementById(id);
const fab    = $('fab');
const panel  = $('panel');
const status = $('status');
const list   = $('list');
const setStatus = t => { status.textContent = t; };

fab.addEventListener('click', () => panel.classList.toggle('open'));
$('rescan').addEventListener('click', () => {
  list.innerHTML = '';
  setStatus('Scanning…');
  autoScan();
  fitChecked = false;
  checkJobFit();
});

// A "real" application form has at least one anchor field: name, email, phone, or file upload.
// This prevents the widget showing on listing/search pages that happen to have a search box.
const APP_ANCHOR = /first.?name|last.?name|email|phone|resume|cover.?letter/i;
function isApplicationForm(fields) {
  return fields.some(f =>
    f.el.type === 'file' ||
    f.el.type === 'email' ||
    APP_ANCHOR.test(f.label) ||
    APP_ANCHOR.test(f.el.placeholder || '') ||
    APP_ANCHOR.test(f.el.name || '')
  );
}

function autoScan() {
  if (running) return;
  const fields = scanFields();
  if (fields.length === 0) return;
  list.innerHTML = '';
  fields.forEach(addRow);
  // Only auto-open panel when this looks like a real application form
  if (isApplicationForm(fields)) {
    setStatus(`${fields.length} fields — click Fill`);
    panel.classList.add('open');
  } else {
    setStatus(`${fields.length} fields found`);
  }
}

// Retry a few times to handle slow-rendering SPAs and Greenhouse iframes
setTimeout(autoScan, 800);
setTimeout(autoScan, 2000);
setTimeout(autoScan, 4000);

// ── Job fit check ────────────────────────────────────────────────────────────
// Runs once per page load, independent of whether this is a fillable
// application form yet — the point is to flag a bad fit or a hard blocker
// (citizenship/clearance/no-sponsorship vs. a profile that needs
// sponsorship) before the user spends time on the application at all.
let fitChecked = false;
function renderJobFit({ fitScore, fitSummary, blockers }) {
  const badge = $('fitBadge');
  const banner = $('blockerBanner');
  const fitLine = $('fitLine');

  if (blockers && blockers.length > 0) {
    badge.textContent = '!';
    badge.className = 'blocker';
    badge.style.display = 'flex';
    banner.textContent = `⚠ ${blockers.join(' · ')}`;
    banner.style.display = 'block';
  }

  if (typeof fitScore === 'number') {
    if (!blockers?.length) {
      badge.textContent = String(fitScore);
      badge.className = fitScore >= 70 ? 'good' : fitScore >= 40 ? 'mid' : 'low';
      badge.style.display = 'flex';
    }
    fitLine.textContent = `${fitScore}% fit${fitSummary ? ' — ' + fitSummary : ''}`;
    fitLine.style.display = 'block';
  }
}

async function checkJobFit() {
  if (fitChecked) return;
  const jobDesc = getJobDescription();
  if (!jobDesc || jobDesc.length < 200) return;
  fitChecked = true;
  try {
    const stored = await chrome.storage.local.get('profile');
    const profile = stored.profile || {};
    if (!profile.resume && !profile.background) return; // nothing to score against yet
    const result = await apiCall('/job-fit', { jobDescription: jobDesc, jobTitle: document.title }, profile);
    renderJobFit(result);
  } catch (_) {
    fitChecked = false; // allow a retry on the next timer if this attempt failed (e.g. slow-loading JD)
  }
}
setTimeout(checkJobFit, 1800);
setTimeout(checkJobFit, 4500);
setTimeout(checkJobFit, 9000);

// ── Row rendering ─────────────────────────────────────────────────────────────
function rowHint(field) {
  if (isResumeField(field))      return 'resume PDF';
  if (isCoverLetterField(field)) return 'cover letter PDF';
  if (isAgreementField(field))   return '✓ agree';
  if (isCountryCodeField(field)) return 'country code';
  if (field.type === 'custom-select') return field.key ? `dropdown·${field.key}` : 'dropdown';
  if (field.type === 'combobox')      return field.key ? `combobox·${field.key}` : 'combobox';
  if (field.type === 'datalist')      return field.key ? `datalist·${field.key}` : 'datalist';
  if (isOpenEnded(field))        return '🤖 AI';
  if (field.key)                 return field.key;
  if (field._contextLabel) {
    const k = matchKey(field._contextLabel);
    if (k) return k;
    if (SKIP_EEOC.test(field._contextLabel)) return 'EEOC';
    if (AGREE_RE.test(field._contextLabel))  return '✓ agree';
  }
  return 'unknown';
}

function addRow(field) {
  const li = document.createElement('li');
  li.className = 'row';
  li.innerHTML = `
    <div class="dot" data-dot></div>
    <div style="flex:1;min-width:0">
      <div class="lbl">${field.label.slice(0, 80)}</div>
      <div class="sub" data-sub>${rowHint(field)} · pending</div>
      <a data-link href="#" target="_blank" style="display:none;font-size:11px;color:#6366f1;text-decoration:none;" title="Open tailored resume">↗ view resume</a>
    </div>`;
  list.appendChild(li);
  field._dot  = li.querySelector('[data-dot]');
  field._sub  = li.querySelector('[data-sub]');
  field._link = li.querySelector('[data-link]');
}

function setRow(field, state, msg) {
  field._dot.className = `dot ${state}`;
  field._sub.textContent = `${rowHint(field)} · ${msg}`;
  if (state === 'review') {
    // Make the row clickable to scroll to and focus the field
    field._sub.innerHTML = `${rowHint(field)} · ${msg} <span style="color:#d97706;text-decoration:underline;cursor:pointer;" data-scroll-to>↑ fill it</span>`;
    field._sub.querySelector('[data-scroll-to]').addEventListener('click', (e) => {
      e.preventDefault();
      field.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.el.focus();
      // For combobox: trigger a reactClick to open the dropdown
      if (field.type === 'combobox') {
        const ctrl = field.el.closest('[class*="control"]') || field.el.parentElement?.parentElement;
        const opts = { bubbles: true, cancelable: true, view: window };
        const target = (ctrl && ctrl !== field.el) ? ctrl : field.el;
        target.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
      }
    });
  }
}

// ── Autofill run ─────────────────────────────────────────────────────────────
let running = false;
let paused  = false;

async function run(dryRun) {
  if (running) return;
  running = true;
  paused  = false;

  await loadCache();
  await loadLearnedAnswers();
  await loadActiveRules();

  const fields = scanFields();
  list.innerHTML = '';
  fields.forEach(addRow);
  setStatus(`${fields.length} fields found`);

  const jobDesc = getJobDescription();

  // No identity/contact/location/salary defaults — those were the founder's
  // own real data, hardcoded here and used directly on live job application
  // forms for ANY user with no saved profile yet (no review step, unlike
  // the options-page prefill). Only genuinely generic, non-identifying
  // smart-defaults belong here. See also: the MASTER_RESUME fix.
  const DEFAULT_PROFILE = {
    firstName:'',lastName:'',
    email:'',phone:'',pronouns:'',
    city:'',state:'',country:'',postalCode:'',
    linkedin:'',github:'',portfolio:'',
    educationLevel:'',schoolName:'',fieldOfStudy:'',graduationYear:'',
    workAuth:'Yes',sponsorship:'No',salary:'',heardAbout:'LinkedIn',
    background:'',resume:'',
  };

  let profile;
  try {
    const stored = await chrome.storage.local.get('profile');
    profile = { ...DEFAULT_PROFILE, ...(stored.profile || {}) };
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('invalidated') || msg.includes('Extension context')) {
      setStatus('⚠ Page needs a reload — press ⌘R');
      running = false;
      return;
    }
    profile = { ...DEFAULT_PROFILE };
  }


  let filled = 0, skipped = 0, errors = 0;

  $('pause').onclick = () => {
    paused = !paused;
    $('pause').textContent = paused ? 'Resume' : 'Pause';
  };

  for (const field of fields) {
    while (paused) await sleep(150);

    field.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.el.style.outline = '2px solid #f59e0b';
    setRow(field, 'filling', 'working…');

    try {
      // ── Rule engine: check before default fill logic ──────────────────────
      if (!dryRun) {
        const rule = getRuleFor(field);
        if (rule) {
          const value = (field.key && profile[field.key]) || getLearnedAnswer(field.label) || getCached(field.label);
          const result = await applyRuleFix(rule, field, value);
          if (result === 'skip') { setRow(field, 'skip', `rule:${rule.id}`); skipped++; field.el.style.outline = ''; continue; }
          if (result === true)   { setRow(field, 'done', `rule:${rule.id}`); filled++;  field.el.style.outline = ''; continue; }
          // result === false means no value — fall through to default logic
        }
      }

      if (dryRun) {
        setRow(field, 'skip', `dry-run · ${rowHint(field)}`);
        skipped++;
      } else if (isResumeField(field)) {
        setRow(field, 'filling', '🤖 tailoring resume…');
        const { pdf, filename: apiFilename } = await apiCall('/resume/tailor', { jobDescription: jobDesc, jobTitle: document.title }, profile);
        const filename = apiFilename || `${(profile.firstName || 'Resume')}_${(profile.lastName || 'Resume')}_Resume.pdf`.replace(/\s+/g, '_');
        await attachPdfB64(field.el, pdf, filename);
        setRow(field, 'done', '📄 attached — ↗ view');
        const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        field._link.href = blobUrl;
        field._link.style.display = 'inline';
        filled++;
      } else if (isCoverLetterField(field)) {
        // No fallback to the bundled asset — COVER_URL pointed at the
        // founder's own real cover letter (name, contact info, and visa/
        // work-authorization status), silently attached to any user's
        // application who hadn't uploaded their own yet. Fail clearly
        // instead, same principle as the resume-tailor fix.
        const { coverLetterPdfDataUrl } = await chrome.storage.local.get('coverLetterPdfDataUrl');
        if (!coverLetterPdfDataUrl) throw new Error('No cover letter uploaded — add one in extension settings');
        setRow(field, 'filling', 'attaching cover letter…');
        const res = await fetch(coverLetterPdfDataUrl);
        const blob = await res.blob();
        const name = `${profile.firstName || 'Cover'}_${profile.lastName || 'Letter'}_CoverLetter.pdf`.replace(/\s+/g, '_');
        await attachFileObj(field.el, new File([blob], name, { type: 'application/pdf' }));
        setRow(field, 'done', '📄 cover letter attached');
        filled++;
      } else if (isAgreementField(field) || (field._contextLabel && AGREE_RE.test(field._contextLabel) && field.type === 'checkbox')) {
        if (!field.el.checked) field.el.click();
        setRow(field, 'done', '✓ agreed');
        filled++;
      } else if (isCountryCodeField(field)) {
        await fillCountryCode(field);
        setRow(field, 'done', '+1 filled');
        filled++;
      } else if (field.type === 'custom-select' && field.key) {
        const value = profile[field.key];
        if (!value) throw new Error('no data for ' + field.key);
        await fillCustomDropdown(field, value, { jobDesc, profile });
        setRow(field, 'done', 'filled');
        filled++;
      } else if (field.type === 'custom-select') {
        // No profile key — ask AI for the best option based on visible text of options
        setRow(field, 'filling', '🤖 asking AI…');
        // Open dropdown to discover options
        field.el.click();
        await sleep(300);
        const optEls = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]')]
          .filter(o => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (!optEls.length) { field.el.click(); throw new Error('custom dropdown: no options found'); }
        const opts = optEls.map(o => ({ text: o.textContent.trim(), el: o })).filter(o => o.text);
        if (field.label && field.label !== '(Unlabeled)' && !SKIP_EEOC.test(field.label)) {
          const pick = await pickOptionViaAI(field, opts, jobDesc, profile);
          if (!pick) { field.el.click(); throw new Error(`AI could not match option for "${field.label}"`); }
          pick.el.click();
          await sleep(100);
          setRow(field, 'done', '🤖 AI filled');
          filled++;
        } else {
          field.el.click(); // close dropdown
          setRow(field, 'skip', 'unknown');
          skipped++;
        }
      } else if (field.type === 'combobox' || field.type === 'datalist') {
        if (SKIP_EEOC.test(field.label) || SKIP_EEOC.test(field.key || '')) {
          setRow(field, 'skip', 'EEOC — skipped');
          skipped++;
        } else if (field.key) {
          const value = profile[field.key];
          if (!value) throw new Error('no data for ' + field.key);
          await fillCombobox(field, value, { jobDesc, profile });
          setRow(field, 'done', 'filled');
          filled++;
        } else if (field.label && field.label !== '(Unlabeled)' && !SKIP_EEOC.test(field.label)) {
          // Multi-select fields (id ends with []) are location/city preferences — skip if not cached,
          // mark "fill once" so user enters it manually and the cache persists for next time.
          const isMultiSelect = field.el.id?.endsWith('[]');
          // Multi-select: only use explicitly learned answers (user-entered), not AI cache
          const learnedVal = getLearnedAnswer(field.label);
          if (isMultiSelect && learnedVal === undefined) {
            setRow(field, 'review', '⚠️ fill once → saved for next run');
            skipped++;
            field.el.closest('[class*="container"]')?.style && (field.el.closest('[class*="container"]').style.outline = '2px solid #f59e0b');
            continue;
          }
          if (isMultiSelect && learnedVal !== undefined) {
            await fillCombobox(field, learnedVal, { jobDesc, profile });
            setRow(field, 'done', '📦 from your saved answer');
            filled++;
            field.el.style.outline = '';
            continue;
          }
          const preferred = learnedVal ?? getCached(field.label);
          // Check learned/cache before hitting AI
          if (preferred !== undefined) {
            await fillCombobox(field, preferred, { jobDesc, profile });
            setRow(field, 'done', '📦 from cache');
            filled++;
            field.el.style.outline = '';
            continue;
          }
          setRow(field, 'filling', '🤖 asking AI…');
          // Open dropdown with React-compatible events (mousedown+mouseup+click)
          const ctrl = field.el.closest('[class*="control"]') || field.el.parentElement?.parentElement;
          if (ctrl && ctrl !== field.el) reactClick(ctrl); else reactClick(field.el);
          await sleep(450);
          const openOpts = visibleOptions();
          // Ask AI to pick directly from the exact visible option list (closed-set
          // classification), rather than the old free-text-answer + fuzzy-match hack.
          if (openOpts.length > 0) {
            const pick = await pickOptionViaAI(field, openOpts, jobDesc, profile);
            if (pick) {
              pick.el.click();
              await sleep(100);
              setRow(field, 'done', '🤖 AI filled');
              filled++;
              field.el.style.outline = '';
              continue;
            }
            // Close before type-filter
            field.el.blur();
            await sleep(100);
          }
          // Fallback: nothing visible yet, or AI couldn't confidently match —
          // type the field's own label to trigger the filter, then retry via fillCombobox
          await fillCombobox(field, field.label, { jobDesc, profile });
          setRow(field, 'done', '🤖 filled (best effort)');
          filled++;
        } else {
          setRow(field, 'skip', 'unknown');
          skipped++;
        }
      } else if (field.key && !SKIP_EEOC.test(field.label) && !SKIP_EEOC.test(field.key)) {
        field._lastFillMethod = 'fillStructured';
        await fillStructured(field, profile);
        setRow(field, 'done', 'filled');
        filled++;
      } else if (isOpenEnded(field)) {
        field._lastFillMethod = 'typeIn/AI';
        setRow(field, 'filling', '🤖 asking AI…');
        if (field.type === 'select-one') {
          const { fromCache } = await fillSelect(field, jobDesc, profile);
          setRow(field, 'done', fromCache ? '📦 from cache' : '🤖 AI filled');
        } else {
          const { answer, fromCache } = await fillOpenEndedWithCache(field, jobDesc, profile);
          // Probe for a hidden dropdown before typing
          const dropOpts = await probeDropdown(field.el);
          if (dropOpts.length > 0) {
            const pick = fuzzyPickOption(dropOpts, answer);
            if (pick) {
              pick.el.click();
              await sleep(100);
              setRow(field, 'done', fromCache ? '📦 dropdown·cache' : '🤖 dropdown·AI');
              filled++;
              field.el.style.outline = '';
              continue;
            }
            field.el.blur();
            await sleep(100);
          }
          await typeIn(field.el, answer);
          setRow(field, 'done', fromCache ? '📦 from cache' : '🤖 AI filled');
        }
        filled++;
      } else if (SKIP_EEOC.test(field.label) || (field._contextLabel && SKIP_EEOC.test(field._contextLabel))) {
        setRow(field, 'skip', 'EEOC — skipped');
        skipped++;
      } else if (field._contextLabel && !field.key) {
        // Inherit profile key from the labeled field above (handles unlabeled Yes/No inputs)
        const inheritedKey = matchKey(field._contextLabel);
        if (inheritedKey) {
          field.key = inheritedKey;
          try {
            await fillStructured(field, profile);
            setRow(field, 'done', 'filled');
            filled++;
          } catch (e2) {
            setRow(field, 'skip', 'skip');
            skipped++;
          }
        } else {
          setRow(field, 'skip', 'unknown');
          skipped++;
        }
      } else {
        setRow(field, 'skip', 'unknown');
        skipped++;
      }
    } catch (err) {
      setRow(field, 'err', err.message);
      errors++;
      if (!dryRun) reportFailure(field, err.message, field._lastFillMethod || 'unknown');
    } finally {
      field.el.style.outline = '';
    }

    setStatus(`✓${filled} ·skip${skipped} ·err${errors}`);
    if (!dryRun) await sleep(80);
  }

  // After fill, watch for user corrections and save as learned answers
  if (!dryRun) {
    watchForUserEdits(fields);

    // Show a "needs your input" banner for any REVIEW fields
    const reviewFields = fields.filter(f => f._dot?.className?.includes('review'));
    if (reviewFields.length > 0) {
      const reviewBanner = document.createElement('div');
      reviewBanner.style.cssText = 'margin:6px 0 0;padding:8px 10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:8px;font-size:11px;color:#92400e;';
      reviewBanner.innerHTML = `<strong style="display:block;margin-bottom:4px;">⚠️ Fill these — saved for next time:</strong>${
        reviewFields.map(f => `<div style="margin-top:2px;">• ${f.label.slice(0, 60)}</div>`).join('')
      }`;
      list.appendChild(reviewBanner);
    }


    if (filled > 0) {
      const company = (() => {
        try {
          const u = new URL(location.href);
          // Greenhouse: job-boards.greenhouse.io/COMPANY/... or boards.greenhouse.io/COMPANY
          const ghMatch = u.pathname.match(/^\/(?:embed\/job_app\?.*?for=([^&]+)|([^/]+)\/)/);
          if (u.hostname.includes('greenhouse.io')) {
            const forParam = u.searchParams.get('for');
            if (forParam) return forParam;
            const seg = u.pathname.split('/').find(s => s && s !== 'embed');
            if (seg && seg !== 'job_app') return seg;
          }
          // Lever: jobs.lever.co/COMPANY
          if (u.hostname.includes('lever.co')) return u.pathname.split('/')[1] || null;
          // Ashby: jobs.ashbyhq.com/COMPANY
          if (u.hostname.includes('ashbyhq.com')) return u.pathname.split('/')[1] || null;
          // Workday: COMPANY.myworkdayjobs.com
          if (u.hostname.includes('myworkdayjobs.com')) return u.hostname.split('.')[0];
          // Generic fallback: second-level domain (stripe.com → stripe)
          const parts = u.hostname.replace(/^www\./, '').split('.');
          return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        } catch { return null; }
      })();

      // Track fill attempt with outcome counts; hold the row ID for self-report
      apiCall('/applications/track', {
        jobUrl:     location.href,
        jobTitle:   document.title.slice(0, 200),
        company,
        fieldCount: filled + skipped + errors,
        aiUsed:     fields.some(f => isOpenEnded(f)),
        filled, skipped, errors,
      }, {}).then(res => {
        if (!res?.id) return;
        const rowId = res.id;

        // Show self-report buttons in the footer
        const footer = shadow.getElementById('footer');
        const reportBar = document.createElement('div');
        reportBar.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;margin-top:4px;font-size:12px;color:#64748b;';
        reportBar.innerHTML = `
          <span style="flex:1">Did it submit?</span>
          <button class="btn" id="rpt-yes">✓ Applied</button>
          <button class="btn" id="rpt-no">✗ Failed</button>`;
        footer.appendChild(reportBar);

        const done = (ok) => {
          reportBar.innerHTML = `<span style="color:${ok ? '#22c55e' : '#ef4444'};font-size:12px;flex:1">${ok ? '✓ Recorded as submitted' : '✗ Recorded as failed'}</span>`;
          apiCall(`/applications/${rowId}/report`, { submitted: ok }, {}).catch(() => {});
        };

        shadow.getElementById('rpt-yes').onclick = () => done(true);
        shadow.getElementById('rpt-no').onclick  = () => done(false);

        // Rating prompt — show once after 3rd successful fill
        chrome.storage.local.get(['autofill_count', 'rated'], ({ autofill_count = 0, rated }) => {
          const newCount = autofill_count + 1;
          chrome.storage.local.set({ autofill_count: newCount });
          if (!rated && newCount === 3) {
            const ratingBar = document.createElement('div');
            ratingBar.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;margin-top:6px;padding:8px 10px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:8px;font-size:12px;';
            ratingBar.innerHTML = `
              <span style="flex:1;color:#c7d2fe">⭐ Enjoying SimplyApply? A quick review helps a lot!</span>
              <a href="https://chromewebstore.google.com/detail/ocdeebjeffdjmfgmclnlphkhfdcdpdkf/reviews" target="_blank"
                style="background:#6366f1;color:#fff;padding:4px 12px;border-radius:6px;font-weight:600;text-decoration:none;white-space:nowrap;font-size:11px;">
                Rate it ⭐
              </a>
              <button id="rate-dismiss" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 2px;">×</button>`;
            footer.appendChild(ratingBar);
            shadow.getElementById('rate-dismiss').onclick = () => {
              chrome.storage.local.set({ rated: true });
              ratingBar.remove();
            };
            ratingBar.querySelector('a').onclick = () => chrome.storage.local.set({ rated: true });
          }
        });
      }).catch(() => {});
    }
  }

  setStatus(`Done — ✓${filled} skip${skipped} err${errors}`);
  running = false;
}

function isContextValid() {
  try { return !!chrome.runtime?.id; } catch (_) { return false; }
}

function handleRunError(err) {
  const msg = err?.message || '';
  if (msg.includes('invalidated') || msg.includes('Extension context') || !isContextValid()) {
    setStatus('⚠ Extension reloaded — refresh page (⌘R)');
  } else {
    setStatus('⚠ ' + msg);
  }
  running = false;
}

$('dry').addEventListener('click',      () => run(true).catch(handleRunError));
$('fill').addEventListener('click',     () => run(false).catch(handleRunError));
$('settings').addEventListener('click', () => {
  if (!isContextValid()) { location.reload(); return; }
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  } catch (_) {
    location.reload();
  }
});

return run;
} // end main()
