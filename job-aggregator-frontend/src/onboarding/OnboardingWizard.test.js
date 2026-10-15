import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OnboardingWizard from './OnboardingWizard';
import { trackOnboarding } from './constants';

jest.mock('./constants', () => ({
  ...jest.requireActual('./constants'),
  trackOnboarding: jest.fn(),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHROME = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537' };
const session = { access_token: 'tok', user: { email: 'me@example.com' } };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function setup({ api = {}, nav = CHROME, doc = document } = {}) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const fullApi = {
    fetchProfile: jest.fn().mockResolvedValue(null),
    parseResume: jest.fn().mockResolvedValue({ profile: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', educationLevel: 'Wizard' }, resumeText: 'RESUME TEXT', remaining: 4 }),
    saveProfile: jest.fn().mockResolvedValue(true),
    ...api,
  };
  const onClose = jest.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<OnboardingWizard session={session} onClose={onClose} api={fullApi} nav={nav} doc={doc} />));
  const q = (sel) => host.querySelector(sel);
  const click = (el) => act(() => { el.click(); });
  const byText = (t) => [...host.querySelectorAll('button,a')].find((b) => b.textContent.trim() === t);
  return { host, q, click, byText, api: fullApi, onClose, done: () => { act(() => root.unmount()); host.remove(); } };
}
const steps = () => trackOnboarding.mock.calls.map((c) => c[0]);
const type = (el, v) => act(() => {
  const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
  set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => { trackOnboarding.mockClear(); document.documentElement.removeAttribute('data-simplyapply-ext'); });

test('paste -> parse -> review -> save -> install -> preview -> open job, with the right events', async () => {
  const w = setup();
  await flush();
  expect(steps()).toEqual(['resume_shown']);
  w.click(w.byText('Paste text'));
  type(w.q('textarea[aria-label="Resume text"]'), 'x'.repeat(200));
  w.click(w.byText('Read my resume'));
  await flush();
  expect(w.api.parseResume).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok', text: 'x'.repeat(200) }));
  expect(w.q('h3').textContent).toBe('Does this look right?');
  expect(w.host.querySelector('input[autocomplete="given-name"]').value).toBe('Jane');
  expect(w.host.querySelector('select').value).toBe(''); // invalid degree dropped
  // The resume-text box is unticked by default (privacy): saving without it stores no resume text.
  expect(w.host.querySelector('.obw-check input').checked).toBe(false);
  w.click(w.byText('Save and continue'));
  await flush();
  const saved = w.api.saveProfile.mock.calls[0][0].profile;
  expect(saved).toMatchObject({ firstName: 'Jane', resume: '', workAuth: 'Yes', sponsorship: 'No' });
  expect(steps()).toEqual(['resume_shown', 'resume_parsed', 'profile_saved', 'install_shown']);
  expect(w.byText('Add to Chrome').getAttribute('href')).toMatch(/chromewebstore\.google\.com/);
  w.click(w.byText('Add to Chrome'));
  w.click(w.byText('I installed it'));
  expect(steps().slice(-2)).toEqual(['install_clicked', 'preview_shown']);
  expect(w.q('.ob-demo-badge').textContent).toBe('Preview with your details');
  w.click(w.byText('Open a real job'));
  expect(steps().slice(-1)).toEqual(['done']);
  expect(w.onClose).toHaveBeenCalledWith('jobs');
  w.done();
});

test('events never carry content', async () => {
  const w = setup();
  await flush();
  w.click(w.byText('Skip this step'));
  w.click(w.byText('Skip this step'));
  for (const c of trackOnboarding.mock.calls) expect(c).toHaveLength(1);
  w.done();
});

test('ticking keep-resume saves the resume text', async () => {
  const w = setup();
  await flush();
  w.click(w.byText('Paste text'));
  type(w.q('textarea[aria-label="Resume text"]'), 'y'.repeat(200));
  w.click(w.byText('Read my resume'));
  await flush();
  w.click(w.q('input[type=checkbox]'));
  w.click(w.byText('Save and continue'));
  await flush();
  expect(w.api.saveProfile.mock.calls[0][0].profile.resume).toBe('RESUME TEXT'); // the mocked parser returns the text
  w.done();
});

test('parse failure falls back to paste text and offers manual entry', async () => {
  const w = setup({ api: { parseResume: jest.fn().mockRejectedValue(Object.assign(new Error('We could not read that PDF.'), { code: 'bad_file' })) } });
  await flush();
  const input = w.q('input[type=file]');
  const file = new File(['x'], 'cv.pdf', { type: 'application/pdf' });
  await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
  expect(w.q('[role=alert]').textContent).toContain('We could not read that PDF.');
  expect(w.q('textarea[aria-label="Resume text"]')).not.toBeNull();
  w.click(w.byText('fill the form in by hand'));
  expect(w.q('h3').textContent).toBe('Does this look right?');
  expect(steps()).not.toContain('resume_parsed');
  w.done();
});

test('save failure keeps the form and shows the error', async () => {
  const w = setup({ api: { saveProfile: jest.fn().mockRejectedValue(new Error('Could not save your profile. Try again.')) } });
  await flush();
  w.click(w.byText('Paste text'));
  type(w.q('textarea[aria-label="Resume text"]'), 'z'.repeat(200));
  w.click(w.byText('Read my resume'));
  await flush();
  w.click(w.byText('Save and continue'));
  await flush();
  expect(w.q('[role=alert]').textContent).toContain('Could not save');
  expect(w.q('h3')).not.toBeNull();
  expect(steps()).not.toContain('profile_saved');
  w.done();
});

test('reopen with an existing profile prefills it and preserves unseen fields on save', async () => {
  const existing = { firstName: 'Old', salary: '120000', heardAbout: 'Friend', resume: 'old resume' };
  const w = setup({ api: { fetchProfile: jest.fn().mockResolvedValue(existing) } });
  await flush();
  w.click(w.byText('Edit my saved details'));
  expect(w.host.querySelector('input[autocomplete="given-name"]').value).toBe('Old');
  w.click(w.byText('Save and continue'));
  await flush();
  expect(w.api.saveProfile.mock.calls[0][0].profile).toMatchObject({ salary: '120000', heardAbout: 'Friend', resume: 'old resume', firstName: 'Old' });
  w.done();
});

test('install step: detects the marker, and is honest on non-Chromium browsers', async () => {
  const a = setup();
  await flush();
  a.click(a.byText('Skip this step'));
  expect(a.byText('I installed it')).toBeTruthy();
  document.documentElement.setAttribute('data-simplyapply-ext', '1.7.0');
  jest.useFakeTimers();
  a.done();
  jest.useRealTimers();

  const b = setup();
  document.documentElement.setAttribute('data-simplyapply-ext', '1.7.0');
  await flush();
  b.click(b.byText('Skip this step'));
  expect(b.q('.obw-ok').textContent).toMatch(/Extension detected/);
  expect(b.byText('Add to Chrome')).toBeUndefined();
  b.done();

  document.documentElement.removeAttribute('data-simplyapply-ext');
  const c = setup({ nav: { userAgent: 'Mozilla/5.0 Firefox/130.0' } });
  await flush();
  c.click(c.byText('Skip this step'));
  expect(c.q('.obw-notice').textContent).toMatch(/Firefox/);
  expect(c.byText('Add to Chrome')).toBeUndefined();
  expect(c.byText('Continue')).toBeTruthy();
  c.done();
});

test('preview without a saved profile is labelled as sample data', async () => {
  const w = setup();
  await flush();
  w.click(w.byText('Skip this step'));
  w.click(w.byText('Skip this step'));
  expect(w.q('.ob-demo-badge').textContent).toBe('Demo with sample data');
  expect(steps()).toContain('preview_shown');
  w.done();
});

test('close button and Escape both skip and emit skipped once', async () => {
  const w = setup();
  await flush();
  w.click(w.q('.obw-x'));
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(steps().filter((s) => s === 'skipped')).toHaveLength(1);
  expect(w.onClose).toHaveBeenCalledWith('skipped');
  w.done();
});
