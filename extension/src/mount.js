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
];

// Run on job sites in any frame, but only once per frame (guard re-injection)
// Check both hostname and path since some entries contain path prefixes (e.g. stripe.com/jobs)
const _loc = location.hostname + location.pathname;
if (!JOB_HOSTS.some(h => _loc.includes(h))) { /* not a job site */ }
else if (window.__simplyApplyRunning) { /* already injected in this frame */ }
else { window.__simplyApplyRunning = true; main(); }

function main() {

// Asset URLs — only safe to call inside the extension context
const RESUME_URL = chrome.runtime.getURL('assets/resume.pdf');
const COVER_URL  = chrome.runtime.getURL('assets/cover_letter.pdf');

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
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
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

// ── Label extraction (Simplify-style: walk up DOM) ───────────────────────────
const LABEL_TAGS = new Set(['LABEL','LEGEND','SPAN','P','DIV','H1','H2','H3','H4','DT','LI']);
const SKIP_EEOC  = /gender|lgbtq|race|ethnic|veteran|disability|pronouns|sexual|transgender/i;
const AGREE_RE   = /i agree|i consent|i acknowledge|terms|privacy policy|by (checking|selecting|clicking)/i;

function cleanText(t) {
  return (t || '')
    .replace(/\s+/g, ' ')
    .replace(/^Q\.\s*/i, '')
    .replace(/\s*Question\b.*$/i, '')
    .replace(/\s*Required\b.*$/i, '')
    .replace(/[*:]+$/, '')
    .trim();
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
  { re: /authorized to work|work auth|legally authorized|eligible to work/i, key: 'workAuth' },
  { re: /\bphone\b|\bmobile\b|telephone|cell number/i,                    key: 'phone' },
  { re: /\bcountry\b/i,                                                   key: 'country' },
  { re: /\bstate\b|\bprovince\b/i,                                        key: 'state' },
  { re: /\bcity\b/i,                                                      key: 'city' },
  { re: /zip|postal code/i,                                               key: 'postalCode' },
  { re: /linkedin/i,                                                      key: 'linkedin' },
  { re: /github/i,                                                        key: 'github' },
  { re: /website|portfolio/i,                                             key: 'portfolio' },
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

async function attachFile(el, assetUrl, filename) {
  const res  = await fetch(assetUrl);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  await attachFileObj(el, new File([blob], filename, { type: 'application/pdf' }));
}

// ── Open-ended detection ─────────────────────────────────────────────────────
function isOpenEnded(field) {
  if (field.key) return false;
  if (isResumeField(field) || isCoverLetterField(field)) return false;
  if (isAgreementField(field) || isCountryCodeField(field)) return false;
  if (SKIP_EEOC.test(field.label)) return false;
  if (field.el.tagName === 'TEXTAREA') return true;
  if (field.type === 'text' && field.label.length > 20 && /\?|why|tell|describe|explain|share|what/i.test(field.label)) return true;
  // Selects / text inputs with no key but a real label — try cache then AI
  if (field.label && field.label !== '(Unlabeled)' && !SKIP_EEOC.test(field.label)) {
    if (field.type === 'select-one' || field.type === 'text') return true;
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
      return { el, label: label || '(Unlabeled)', key, type: (el.type || el.tagName).toLowerCase() };
    });

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
  // Clear via native setter so React registers the change
  nativeSet(el, '');
  fire(el, 'input');
  for (const ch of String(value)) {
    nativeSet(el, el.value + ch);
    fire(el, 'input');
    await sleep(delay);
  }
  fire(el, 'change');
  el.blur();
}

async function fillStructured(field, profile) {
  const { el, key, type } = field;
  const value = profile[key] ?? (key === 'currentCompany' ? 'Google' : null);
  if (value == null) throw new Error('no data for ' + key);

  if (type === 'select-one' || el.tagName === 'SELECT') {
    const v = String(value).toLowerCase();
    const opts = [...el.options];
    const pick =
      opts.find(o => o.textContent.trim().toLowerCase() === v) ||
      opts.find(o => o.textContent.trim().toLowerCase().startsWith(v)) ||
      opts.find(o => o.textContent.trim().toLowerCase().includes(v)) ||
      opts.find(o => v.includes(o.textContent.trim().toLowerCase()) && o.textContent.trim().length > 1) ||
      (v === 'yes' && opts.find(o => /^yes|^true/i.test(o.textContent.trim()))) ||
      (v === 'no'  && opts.find(o => /^no|^false/i.test(o.textContent.trim())));
    if (!pick) throw new Error(`no option for "${value}"`);
    nativeSelectSet(el, pick.value);
    fire(el, 'input');
    fire(el, 'change');
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

async function fillOpenEndedWithCache(field, jobDesc, profile) {
  const cached = getCached(field.label);
  if (cached !== undefined) return { answer: cached, fromCache: true };
  const { answer } = await apiCall('/copilot/answer', { question: field.label, jobDescription: jobDesc }, profile);
  setCached(field.label, answer);
  return { answer, fromCache: false };
}

async function fillSelect(field, jobDesc, profile) {
  const cached = getCached(field.label);
  if (cached !== undefined) {
    const opts = [...field.el.options];
    const pick = opts.find(o => o.textContent.trim().toLowerCase() === String(cached).toLowerCase()) ||
                 opts.find(o => o.value.toLowerCase() === String(cached).toLowerCase());
    if (pick) {
      nativeSelectSet(field.el, pick.value);
      fire(field.el, 'input');
      fire(field.el, 'change');
      return { fromCache: true };
    }
  }

  const opts = [...field.el.options].map(o => o.textContent.trim()).filter(Boolean);
  const question = `${field.label} (choose the best option from: ${opts.join(', ')})`;
  const { answer } = await apiCall('/copilot/answer', { question, jobDescription: jobDesc }, profile);

  const normalAnswer = answer.toLowerCase();
  const pick = [...field.el.options].find(o =>
    o.textContent.trim().toLowerCase() === normalAnswer ||
    normalAnswer.includes(o.textContent.trim().toLowerCase()) ||
    o.textContent.trim().toLowerCase().includes(normalAnswer)
  );
  if (!pick) throw new Error(`AI answer "${answer}" matched no option`);
  nativeSelectSet(field.el, pick.value);
  fire(field.el, 'input');
  fire(field.el, 'change');
  setCached(field.label, pick.textContent.trim());
  return { fromCache: false };
}

// ── Custom div-based dropdown fill ───────────────────────────────────────────
// Handles Greenhouse-style aria/div dropdowns (role=combobox, aria-haspopup=listbox, etc.)
async function fillCustomDropdown(el, value) {
  // Click trigger to open the dropdown
  el.click();
  await sleep(300);

  const v = String(value).toLowerCase();

  // Option containers may be appended to body or be inside a sibling/child element
  // Search progressively: inside el, in body portals, then document-wide
  function findOption(root) {
    const candidates = [...root.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="listitem"], li[data-value], li[class*="option"], div[class*="option"]'
    )];
    return (
      candidates.find(o => o.textContent.trim().toLowerCase() === v) ||
      candidates.find(o => o.textContent.trim().toLowerCase().startsWith(v)) ||
      candidates.find(o => o.textContent.trim().toLowerCase().includes(v)) ||
      candidates.find(o => v.includes(o.textContent.trim().toLowerCase()) && o.textContent.trim().length > 1)
    );
  }

  let pick = findOption(el.parentElement || el) || findOption(document.body);
  if (!pick) throw new Error(`custom dropdown: no option for "${value}"`);
  pick.click();
  await sleep(100);
}

// ── Post-fill observation: watch for user edits and cache them ────────────────
function watchForUserEdits(fields) {
  for (const field of fields) {
    if (!field.label || field.label === '(Unlabeled)') continue;
    if (SKIP_EEOC.test(field.label)) continue;
    if (field.type === 'file') continue;

    const el = field.el;
    const handler = () => {
      const val = el.type === 'checkbox' || el.type === 'radio'
        ? (el.checked ? 'Yes' : 'No')
        : el.value?.trim();
      if (val) setCached(field.label, val);
    };

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
  #fab { all:unset; width:52px; height:52px; border-radius:14px; background:#0f172a; border:none;
         box-shadow:0 4px 20px rgba(0,0,0,.35); cursor:pointer; font-size:22px;
         display:flex; align-items:center; justify-content:center; }
  #fab:hover { background:#1e293b; box-shadow:0 6px 28px rgba(0,0,0,.45); }
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
  .done { background:#22c55e; } .skip { background:#94a3b8; } .err { background:#ef4444; } .filling { background:#f59e0b; }
  .lbl { font-size:12px; font-weight:500; }
  .sub { font-size:11px; color:#94a3b8; margin-top:1px; }
  #footer { display:flex; gap:6px; padding:8px 12px; border-top:1px solid #f1f5f9; flex-shrink:0; flex-wrap:wrap; }
  .btn { padding:5px 10px; font-size:12px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafa; cursor:pointer; }
  .btn:hover { background:#f1f5f9; }
  .btn.primary { background:#0f172a; color:#fff; border-color:#0f172a; }
  .btn.primary:hover { background:#1e293b; }
</style>
<button id="fab">⚡</button>
<div id="panel">
  <div id="hdr">
    <strong>Autofill</strong>
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

// ── Row rendering ─────────────────────────────────────────────────────────────
function rowHint(field) {
  if (isResumeField(field))      return 'resume PDF';
  if (isCoverLetterField(field)) return 'cover letter PDF';
  if (isAgreementField(field))   return '✓ agree';
  if (isCountryCodeField(field)) return 'country code';
  if (field.type === 'custom-select') return field.key ? `dropdown·${field.key}` : 'dropdown';
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
}

// ── Autofill run ─────────────────────────────────────────────────────────────
let running = false;
let paused  = false;

async function run(dryRun) {
  if (running) return;
  running = true;
  paused  = false;

  await loadCache();

  const fields = scanFields();
  list.innerHTML = '';
  fields.forEach(addRow);
  setStatus(`${fields.length} fields found`);

  const jobDesc = getJobDescription();

  const DEFAULT_PROFILE = {
    firstName:'Sushanth',lastName:'Tiruvaipati',
    email:'t.sushanth@gmail.com',phone:'+1 425-628-4887',
    city:'San Jose',state:'California',country:'United States',postalCode:'95101',
    linkedin:'https://www.linkedin.com/in/tsushanth',github:'https://github.com/tsushanth',
    portfolio:'https://kreativekoala.llc',
    educationLevel:"Master's Degree",schoolName:'Carnegie Mellon University',
    fieldOfStudy:'Information Networking',graduationYear:'2011',
    workAuth:'Yes',sponsorship:'No',salary:'150000',heardAbout:'LinkedIn',
    background:`Sushanth Tiruvaipati is a software engineer with 10+ years at Google and an indie developer who has shipped 70+ iOS/Android apps generating real revenue. At Google he worked across Ads, Cloud AI, Play, and YouTube on large-scale distributed systems. Strong in TypeScript, Swift, Kotlin, Python, Go, C++, and cloud infrastructure. Located in Bay Area, CA, open to relocation. Compensation floor $150k base.`,
    resume:`SUSHANTH TIRUVAIPATI\nBay Area, CA · t.sushanth@gmail.com · 425-628-4887 · linkedin.com/in/tsushanth\n\nEXPERIENCE\nSoftware Engineer · Google | Sep 2015 – Present\n- Large-scale distributed systems across Ads, Cloud AI, Play, YouTube\nFounder & Sole Engineer · KreativeKoala Solutions LLC | 2021 – Present\n- Built and shipped 70+ iOS/Android apps end-to-end\nSoftware Development Engineer · Microsoft | Nov 2012 – Feb 2015\nSoftware Development Engineer · Amazon | Oct 2011 – Oct 2012\n\nEDUCATION\nCarnegie Mellon University — M.S., Information Networking · 2011`,
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
      if (dryRun) {
        setRow(field, 'skip', `dry-run · ${rowHint(field)}`);
        skipped++;
      } else if (isResumeField(field)) {
        setRow(field, 'filling', '🤖 tailoring resume…');
        const { pdf, filename } = await apiCall('/resume/tailor', { jobDescription: jobDesc, jobTitle: document.title }, profile);
        await attachPdfB64(field.el, pdf, filename);
        setRow(field, 'done', '📄 attached — ↗ view');
        const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        field._link.href = blobUrl;
        field._link.style.display = 'inline';
        filled++;
      } else if (isCoverLetterField(field)) {
        setRow(field, 'filling', 'attaching cover letter…');
        await attachFile(field.el, COVER_URL, 'Sushanth_Tiruvaipati_CoverLetter.pdf');
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
        await fillCustomDropdown(field.el, value);
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
        const opts = optEls.map(o => o.textContent.trim()).filter(Boolean);
        // Close dropdown before asking AI
        field.el.click();
        await sleep(100);
        if (field.label && field.label !== '(Unlabeled)' && !SKIP_EEOC.test(field.label)) {
          const question = `${field.label} (choose the best option from: ${opts.join(', ')})`;
          const { answer } = await apiCall('/copilot/answer', { question, jobDescription: jobDesc }, profile);
          await fillCustomDropdown(field.el, answer);
          setCached(field.label, answer);
          setRow(field, 'done', '🤖 AI filled');
          filled++;
        } else {
          setRow(field, 'skip', 'unknown');
          skipped++;
        }
      } else if (field.key) {
        await fillStructured(field, profile);
        setRow(field, 'done', 'filled');
        filled++;
      } else if (isOpenEnded(field)) {
        setRow(field, 'filling', '🤖 asking AI…');
        if (field.type === 'select-one') {
          const { fromCache } = await fillSelect(field, jobDesc, profile);
          setRow(field, 'done', fromCache ? '📦 from cache' : '🤖 AI filled');
        } else {
          const { answer, fromCache } = await fillOpenEndedWithCache(field, jobDesc, profile);
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
    } finally {
      field.el.style.outline = '';
    }

    setStatus(`✓${filled} ·skip${skipped} ·err${errors}`);
    if (!dryRun) await sleep(80);
  }

  // After fill, watch for user corrections and cache them
  if (!dryRun) {
    watchForUserEdits(fields);

    if (filled > 0) {
      const company = (() => {
        try { return new URL(location.href).hostname.replace(/^www\./, '').split('.')[0]; } catch { return null; }
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

} // end main()
