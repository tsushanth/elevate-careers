import React, { useState } from 'react';

// Must match CONSENT_TEXT in src/services/email-templates.js (the server stores its own copy).
const CONSENT_TEXT = 'Email me my resume check results and occasional job-search tips from SimplyApply. I can unsubscribe anytime.';

const box = { maxWidth: 720, margin: '0 auto', padding: '32px 16px', fontFamily: '-apple-system, Segoe UI, sans-serif', color: '#1a1d29' };
const input = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' };
const button = { background: '#2563eb', color: '#fff', border: 0, borderRadius: 8, padding: '11px 18px', fontSize: 15, cursor: 'pointer' };
const card = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 20, background: '#fff' };

async function post(path, body) {
  const res = await fetch(`/api/public/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
  return data;
}

export default function ResumeCheck() {
  const [resume, setResume] = useState('');
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const runCheck = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setResult(await post('resume-check', { resume, role, location, hp })); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  const subscribe = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('subscribe', { email, consent, checkId: result?.checkId, role, location, source: 'resume-check', hp });
      setSubscribed(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div style={box}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Free resume check</h1>
      <p style={{ color: '#4b5563', marginTop: 0 }}>Paste your resume to get an ATS-style score and the top fixes. We don't store your resume text.</p>

      {!result && (
        <form onSubmit={runCheck}>
          <textarea style={{ ...input, minHeight: 220 }} placeholder="Paste your resume text here" value={resume} onChange={(e) => setResume(e.target.value)} required />
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: 1, minWidth: 200 }} placeholder="Role you want (e.g. data analyst)" value={role} onChange={(e) => setRole(e.target.value)} />
            <input style={{ ...input, flex: 1, minWidth: 200 }} placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} value={hp} onChange={(e) => setHp(e.target.value)} name="website" />
          <button style={{ ...button, marginTop: 16, opacity: busy ? 0.6 : 1 }} disabled={busy}>{busy ? 'Checking…' : 'Check my resume'}</button>
        </form>
      )}

      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      {result && (
        <>
          <div style={card}>
            <div style={{ fontSize: 40, fontWeight: 700 }}>{result.score}<span style={{ fontSize: 18, color: '#6b7280' }}>/100</span></div>
            <ul style={{ paddingLeft: 18 }}>
              {result.findings.map((f, i) => <li key={i} style={{ marginBottom: 8 }}>{f.text}</li>)}
            </ul>
          </div>

          {result.jobs.length > 0 && (
            <div style={card}>
              <strong>Open roles that match what you searched for</strong>
              <ul style={{ paddingLeft: 18 }}>
                {result.jobs.map((j) => <li key={j.id}><a href={j.apply_url} target="_blank" rel="noopener noreferrer">{j.title}</a> at {j.company_name}</li>)}
              </ul>
            </div>
          )}

          <div style={card}>
            {subscribed ? (
              <p style={{ margin: 0 }}>Check your inbox and click the confirmation link. We'll send your results and a few tips after that.</p>
            ) : (
              <form onSubmit={subscribe}>
                <strong>Want these results and job-search tips by email?</strong>
                <input style={{ ...input, marginTop: 12 }} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <label style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 14, color: '#374151' }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{CONSENT_TEXT}</span>
                </label>
                <button style={{ ...button, marginTop: 12, opacity: busy || !consent ? 0.6 : 1 }} disabled={busy || !consent}>Email me</button>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 0 }}>You'll get one confirmation email first. See our <a href="/privacy">privacy policy</a>.</p>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
