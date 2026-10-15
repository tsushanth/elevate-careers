import React, { useCallback, useEffect, useRef, useState } from 'react';
import AutofillDemo from './AutofillDemo';
import { EXTENSION_URL, trackOnboarding } from './constants';
import * as defaultApi from './api';
import { canInstallExtension, browserLabel, isExtensionInstalled, watchExtension } from './extension';
import {
  EDUCATION_LEVELS, toForm, buildSavePayload, cleanParsed, hasSavedProfile, previewRows, SAMPLE_PROFILE,
} from './profileFields';
import './wizard.css';

const TEXT_FIELDS = [
  ['firstName', 'First name', 'given-name'], ['lastName', 'Last name', 'family-name'],
  ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'],
  ['city', 'City', 'address-level2'], ['state', 'State / region', 'address-level1'],
  ['country', 'Country', 'country-name'], ['postalCode', 'Postal code', 'postal-code'],
  ['linkedin', 'LinkedIn', 'off'], ['github', 'GitHub', 'off'], ['portfolio', 'Website / portfolio', 'off'],
  ['schoolName', 'School', 'off'], ['fieldOfStudy', 'Field of study', 'off'], ['graduationYear', 'Graduation year', 'off'],
];

function Stepper({ step }) {
  const names = ['Resume', 'Install', 'See it work'];
  return (
    <ol className="obw-steps" aria-label="Setup progress">
      {names.map((n, i) => (
        <li key={n} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
          <span>{i + 1}</span> {n}
        </li>
      ))}
    </ol>
  );
}

/**
 * Props
 *  session      supabase session (access_token, user.email)
 *  onClose(why) why: 'skipped' | 'done' | 'jobs'
 *  api          injectable API module (tests)
 *  nav, doc     injectable navigator/document (tests)
 */
export default function OnboardingWizard({ session, onClose, api = defaultApi, nav = typeof navigator === 'undefined' ? {} : navigator, doc = typeof document === 'undefined' ? null : document }) {
  const token = session && session.access_token;
  const accountEmail = (session && session.user && session.user.email) || '';
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('choose'); // choose | parsing | review
  const [inputTab, setInputTab] = useState('upload');
  const [pasted, setPasted] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState(() => toForm(null, { email: accountEmail }));
  const [resumeText, setResumeText] = useState('');
  const [keepResume, setKeepResume] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extFound, setExtFound] = useState(() => (doc ? isExtensionInstalled(doc) : false));
  const [saved, setSaved] = useState(null);
  const fileRef = useRef(null);
  const sent = useRef(new Set());
  const dialogRef = useRef(null);

  const emit = useCallback((s) => { if (!sent.current.has(s)) { sent.current.add(s); trackOnboarding(s); } }, []);

  const close = useCallback((why) => {
    if (why === 'skipped') emit('skipped');
    onClose(why);
  }, [emit, onClose]);

  // Existing profile (reopen from the header): prefill, and never overwrite fields we do not show.
  useEffect(() => {
    let live = true;
    (async () => {
      const p = await api.fetchProfile({ token });
      if (!live || !p) return;
      setExisting(p);
      setForm(toForm(p, { email: accountEmail }));
      setResumeText(typeof p.resume === 'string' ? p.resume : '');
    })();
    return () => { live = false; };
  }, [token, accountEmail, api]);

  useEffect(() => { if (step === 0) emit('resume_shown'); }, [step, emit]);
  useEffect(() => { if (step === 1) emit('install_shown'); }, [step, emit]);
  useEffect(() => { if (step === 2) emit('preview_shown'); }, [step, emit]);

  useEffect(() => {
    if (step !== 1 || !doc) return undefined;
    return watchExtension(() => setExtFound(true), { doc });
  }, [step, doc]);

  // Dialog basics: focus in, Escape closes, focus returns.
  useEffect(() => {
    const prev = doc && doc.activeElement;
    if (dialogRef.current) dialogRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') close('skipped'); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) { try { prev.focus(); } catch { /* gone */ } } };
  }, [close, doc]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function runParse(args) {
    setError(''); setNotice(''); setMode('parsing');
    try {
      const r = await api.parseResume({ token, ...args });
      const parsed = cleanParsed(r.profile);
      setForm((f) => {
        const next = { ...f };
        for (const k of Object.keys(parsed)) if (parsed[k]) next[k] = parsed[k];
        if (!next.email) next.email = accountEmail;
        return next;
      });
      setResumeText(r.resumeText || args.text || '');
      emit('resume_parsed');
      setNotice('We filled this in from your resume. Check each field and fix anything that is wrong.');
      setMode('review');
    } catch (e) {
      setMode('choose');
      setInputTab('paste');
      setError(`${e.message || 'We could not read that resume.'} You can paste your resume text below, or `);
    }
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (file) runParse({ file });
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const payload = buildSavePayload(existing, { ...form, resume: resumeText }, { keepResume });
      await api.saveProfile({ token, profile: payload });
      setExisting(payload);
      setSaved(payload);
      emit('profile_saved');
      setStep(1);
    } catch (e) {
      setError(e.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  }

  const installable = canInstallExtension(nav);
  const profileForPreview = saved || existing || null;
  const rows = previewRows(profileForPreview);
  const useReal = hasSavedProfile(profileForPreview) && rows.length >= 3;
  const demoRows = useReal ? rows : previewRows(SAMPLE_PROFILE);
  const demoLines = (useReal ? rows : previewRows(SAMPLE_PROFILE)).slice(0, 6).map((r) => r.value);

  return (
    <div className="obw-overlay" role="presentation">
      <div className="obw" role="dialog" aria-modal="true" aria-labelledby="obw-title" tabIndex={-1} ref={dialogRef}>
        <button type="button" className="obw-x" aria-label="Close setup" onClick={() => close('skipped')}>&times;</button>
        <Stepper step={step} />

        {step === 0 && (
          <section>
            <h2 id="obw-title">Start with your resume</h2>
            {mode !== 'review' && (
              <>
                <p className="obw-lead">We read it once and fill in your details so you do not retype them on every application. Your file is read and then discarded; only the details you confirm are saved.</p>
                {existing && hasSavedProfile(existing) && (
                  <p className="obw-lead"><button type="button" className="obw-link" onClick={() => { setNotice(''); setMode('review'); }}>Edit my saved details</button> or upload a new resume below.</p>
                )}
                <div className="obw-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={inputTab === 'upload'} className={inputTab === 'upload' ? 'is-on' : ''} onClick={() => setInputTab('upload')}>Upload file</button>
                  <button type="button" role="tab" aria-selected={inputTab === 'paste'} className={inputTab === 'paste' ? 'is-on' : ''} onClick={() => setInputTab('paste')}>Paste text</button>
                </div>
                {inputTab === 'upload' ? (
                  <div className="obw-drop">
                    <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain" onChange={onFile} disabled={mode === 'parsing'} aria-label="Resume file (PDF, DOCX or TXT, up to 5 MB)" />
                    <p className="obw-hint">PDF, DOCX or TXT, up to 5 MB.</p>
                  </div>
                ) : (
                  <div>
                    <textarea className="obw-text" rows={7} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste your resume text here" aria-label="Resume text" disabled={mode === 'parsing'} />
                    <button type="button" className="obw-btn" disabled={mode === 'parsing' || pasted.trim().length < 80} onClick={() => runParse({ text: pasted })}>Read my resume</button>
                  </div>
                )}
                {mode === 'parsing' && <p className="obw-status" role="status">Reading your resume&hellip;</p>}
                {error && (
                  <p className="obw-error" role="alert">{error}<button type="button" className="obw-link" onClick={() => { setError(''); setMode('review'); }}>fill the form in by hand</button>.</p>
                )}
              </>
            )}
            {mode === 'review' && (
              <form onSubmit={(e) => { e.preventDefault(); save(); }}>
                <h3 className="obw-h3">Does this look right?</h3>
                {notice && <p className="obw-hint" role="status">{notice}</p>}
                <div className="obw-grid">
                  {TEXT_FIELDS.slice(0, 8).map(([k, label, ac]) => (
                    <label key={k}>{label}<input value={form[k]} onChange={(e) => set(k, e.target.value)} autoComplete={ac} /></label>
                  ))}
                </div>
                <h4 className="obw-h4">Links</h4>
                <div className="obw-grid">
                  {TEXT_FIELDS.slice(8, 11).map(([k, label, ac]) => (
                    <label key={k}>{label}<input value={form[k]} onChange={(e) => set(k, e.target.value)} autoComplete={ac} /></label>
                  ))}
                </div>
                <h4 className="obw-h4">Education</h4>
                <div className="obw-grid">
                  <label>Highest degree
                    <select value={form.educationLevel} onChange={(e) => set('educationLevel', e.target.value)}>
                      <option value="">Select</option>
                      {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                  {TEXT_FIELDS.slice(11).map(([k, label, ac]) => (
                    <label key={k}>{label}<input value={form[k]} onChange={(e) => set(k, e.target.value)} autoComplete={ac} /></label>
                  ))}
                </div>
                <h4 className="obw-h4">Application answers</h4>
                <p className="obw-hint">We never guess these from your resume. They are what the extension answers on forms, so set them yourself.</p>
                <div className="obw-grid">
                  <label>Authorized to work where you apply?
                    <select value={form.workAuth} onChange={(e) => set('workAuth', e.target.value)}><option>Yes</option><option>No</option></select>
                  </label>
                  <label>Need visa sponsorship?
                    <select value={form.sponsorship} onChange={(e) => set('sponsorship', e.target.value)}><option>No</option><option>Yes</option></select>
                  </label>
                </div>
                <label className="obw-wide">Short summary (used to answer open questions)
                  <textarea rows={3} value={form.background} onChange={(e) => set('background', e.target.value)} />
                </label>
                {resumeText && (
                  <label className="obw-check">
                    <input type="checkbox" checked={keepResume} onChange={(e) => setKeepResume(e.target.checked)} />
                    Also save my resume text so the extension can use it to answer questions. Uncheck to save only the fields above.
                  </label>
                )}
                {error && <p className="obw-error" role="alert">{error}</p>}
                <div className="obw-actions">
                  <button type="submit" className="obw-btn" disabled={saving}>{saving ? 'Saving…' : 'Save and continue'}</button>
                  <button type="button" className="obw-link" onClick={() => { setMode('choose'); setError(''); }}>Back</button>
                </div>
              </form>
            )}
            <div className="obw-foot">
              <button type="button" className="obw-link" onClick={() => setStep(1)}>Skip this step</button>
              <button type="button" className="obw-link" onClick={() => close('skipped')}>Close setup</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2 id="obw-title">Add the Chrome extension</h2>
            <p className="obw-lead">The extension is what fills the application on the employer's site. Your saved details stay yours; it only reads the form you are on.</p>
            {!installable ? (
              <p className="obw-notice" role="note">Autofill runs in desktop Chrome and other Chromium browsers (Edge, Brave). You are using {browserLabel(nav)}, so you cannot install it here. You can still browse and save jobs; open SimplyApply in Chrome on a computer to install it.</p>
            ) : extFound ? (
              <p className="obw-ok" role="status">Extension detected. You are set.</p>
            ) : (
              <>
                <a className="obw-btn" href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" onClick={() => emit('install_clicked')}>Add to Chrome</a>
                <p className="obw-hint">Free. If the extension asks you to sign in, use {accountEmail || 'the same account'}.</p>
              </>
            )}
            <div className="obw-actions">
              {installable && !extFound && <button type="button" className="obw-btn obw-btn-2" onClick={() => setStep(2)}>I installed it</button>}
              {(extFound || !installable) && <button type="button" className="obw-btn" onClick={() => setStep(2)}>Continue</button>}
            </div>
            <div className="obw-foot">
              <button type="button" className="obw-link" onClick={() => setStep(2)}>Skip this step</button>
              <button type="button" className="obw-link" onClick={() => close('skipped')}>Close setup</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2 id="obw-title">See it work</h2>
            <p className="obw-lead">{useReal ? 'This is how your details land in an application form.' : 'You have not saved details yet, so this uses a made-up person. Add your resume any time from Set up autofill.'}</p>
            <AutofillDemo
              rows={demoRows}
              sourceTitle={useReal ? 'Your saved profile' : 'Sample resume'}
              sourceLines={demoLines}
              label={useReal ? 'Preview with your details' : 'Demo with sample data'}
              loop
            />
            <div className="obw-actions">
              <button type="button" className="obw-btn" onClick={() => { emit('done'); onClose('jobs'); }}>Open a real job</button>
            </div>
            <div className="obw-foot">
              <button type="button" className="obw-link" onClick={() => { emit('done'); onClose('done'); }}>Finish</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
