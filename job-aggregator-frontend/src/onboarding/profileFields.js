// The profile the Chrome extension fills from (user_profile.autofill_data).
// Field names are copied from extension/src/options.js FIELDS; profileFields.test.js
// fails if they drift apart.

export const FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'pronouns',
  'city', 'state', 'country', 'postalCode',
  'linkedin', 'github', 'portfolio',
  'educationLevel', 'schoolName', 'fieldOfStudy', 'graduationYear',
  'workAuth', 'sponsorship', 'salary', 'heardAbout',
  'background', 'resume',
];

export const EDUCATION_LEVELS = [
  'High School Diploma', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'MBA', 'Doctorate', 'Other',
];

// Fields the resume reader fills (the rest are personal answers the user gives).
export const PARSED_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country', 'postalCode',
  'linkedin', 'github', 'portfolio', 'educationLevel', 'schoolName', 'fieldOfStudy', 'graduationYear', 'background',
];

// Same defaults the extension itself uses when a field is missing.
export const DEFAULTS = { workAuth: 'Yes', sponsorship: 'No' };

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// A profile counts as saved once it holds a name or a resume. (A bare default like
// workAuth: 'Yes' written by an older client is not a profile.)
export function hasSavedProfile(p) {
  if (!p || typeof p !== 'object') return false;
  return !!(str(p.firstName).trim() || str(p.lastName).trim() || str(p.resume).trim());
}

export function toForm(profile, { email = '' } = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const form = {};
  for (const k of FIELDS) form[k] = str(p[k]);
  if (!form.email) form.email = email;
  if (!form.workAuth) form.workAuth = DEFAULTS.workAuth;
  if (!form.sponsorship) form.sponsorship = DEFAULTS.sponsorship;
  return form;
}

// Merge confirmed edits over what is already saved so fields the wizard does not
// show (salary, pronouns, heardAbout, ...) are never wiped by POST /profile/sync,
// which replaces autofill_data wholesale.
export function buildSavePayload(existing, form, { keepResume = true } = {}) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const out = { ...base };
  for (const k of FIELDS) {
    if (k === 'resume') continue;
    if (k in form) out[k] = str(form[k]).trim();
  }
  if ('resume' in form) out.resume = keepResume ? str(form.resume) : '';
  return out;
}

export function cleanParsed(parsed) {
  const out = {};
  for (const k of PARSED_FIELDS) out[k] = str(parsed && parsed[k]).trim();
  if (!EDUCATION_LEVELS.includes(out.educationLevel)) out.educationLevel = '';
  return out;
}

// Rows for the animated form. Order = the order fields fill.
export const PREVIEW_ROWS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['city', 'City'], ['state', 'State'], ['linkedin', 'LinkedIn'], ['schoolName', 'School'],
];

export function previewRows(profile) {
  const p = profile || {};
  return PREVIEW_ROWS.map(([id, label]) => ({ id, label, value: str(p[id]).trim() })).filter((r) => r.value);
}

// Clearly fictional: example.com and a 555-01xx number are reserved for documentation.
export const SAMPLE_PROFILE = {
  firstName: 'Alex', lastName: 'Morgan', email: 'alex.morgan@example.com', phone: '(555) 010-0142',
  city: 'Austin', state: 'Texas', linkedin: 'linkedin.com/in/alex-morgan-sample', schoolName: 'State University',
};
