import React, { useState, useEffect, useRef } from 'react';

const API_URL = 'https://elevate-careers-api.fly.dev';

function statusBadge(status) {
  const map = {
    queued:    { bg: 'rgba(99,102,241,0.15)', color: '#a5b4fc', label: 'Queued' },
    running:   { bg: 'rgba(234,179,8,0.15)',  color: '#fde047', label: 'Running…' },
    preview:   { bg: 'rgba(59,130,246,0.15)', color: '#93c5fd', label: 'Preview' },
    submitted: { bg: 'rgba(34,197,94,0.15)',  color: '#86efac', label: '✓ Applied' },
    failed:    { bg: 'rgba(239,68,68,0.15)',  color: '#fca5a5', label: '✗ Failed' },
  };
  const s = map[status] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', label: status };
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

function ScreenshotModal({ b64, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
    }}>
      <img
        src={`data:image/png;base64,${b64}`}
        alt="Form screenshot"
        style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

function Tag({ label, onRemove }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: 'rgba(37,99,235,0.18)', color: '#93c5fd',
      borderRadius: 6, padding: '3px 10px', fontSize: 13, fontWeight: 500,
    }}>
      {label}
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
      >×</button>
    </span>
  );
}

export default function ApplyQueue({ session, pendingApply, onPendingConsumed }) {
  const [prefs, setPrefs] = useState({ keywords: [], remote: false, location: '', salary_min: '', excluded_companies: [], daily_limit: 10, enabled: false });
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [excludeInput, setExcludeInput] = useState('');

  const [queue, setQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const pollRef = useRef({});

  const token = () => session?.access_token;

  // Load preferences
  useEffect(() => {
    if (!session) return;
    setPrefsLoading(true);
    fetch(`${API_URL}/api/preferences`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setPrefs({
          keywords: data.keywords || [],
          remote: data.remote || false,
          location: data.location || '',
          salary_min: data.salary_min || '',
          excluded_companies: data.excluded_companies || [],
          daily_limit: data.daily_limit ?? 10,
          enabled: data.enabled || false,
        });
      })
      .catch(() => {})
      .finally(() => setPrefsLoading(false));
  }, [session]);

  const fetchQueue = async () => {
    if (!session) return;
    setQueueLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/apply/list`, { headers: { Authorization: `Bearer ${token()}` } });
      if (r.ok) setQueue(await r.json());
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => { fetchQueue(); }, [session]);

  // Optimistically prepend a job added from the job card, then let the real fetch catch up
  useEffect(() => {
    if (!pendingApply) return;
    setQueue(q => {
      if (q.find(j => j.id === pendingApply.id)) return q;
      return [pendingApply, ...q];
    });
    onPendingConsumed?.();
  }, [pendingApply]);

  // Poll active jobs
  useEffect(() => {
    const active = queue.filter(j => j.status === 'queued' || j.status === 'running');
    active.forEach(j => {
      if (pollRef.current[j.id]) return;
      pollRef.current[j.id] = setInterval(async () => {
        const r = await fetch(`${API_URL}/api/apply/status/${j.id}`, { headers: { Authorization: `Bearer ${token()}` } });
        if (!r.ok) return;
        const updated = await r.json();
        setQueue(q => q.map(item => item.id === j.id ? { ...item, ...updated } : item));
        if (updated.status !== 'queued' && updated.status !== 'running') {
          clearInterval(pollRef.current[j.id]);
          delete pollRef.current[j.id];
        }
      }, 3000);
    });
    return () => { Object.values(pollRef.current).forEach(clearInterval); pollRef.current = {}; };
  }, [queue.map(j => j.id + j.status).join(',')]);

  const savePrefs = async (patch = {}) => {
    const merged = { ...prefs, ...patch };
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await fetch(`${API_URL}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          ...merged,
          salary_min: merged.salary_min ? parseInt(merged.salary_min, 10) : null,
        }),
      });
      if (r.ok) {
        setPrefs(merged);
        setSaveMsg('Saved ✓');
        setTimeout(() => setSaveMsg(''), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || prefs.keywords.includes(kw)) { setKeywordInput(''); return; }
    setPrefs(p => ({ ...p, keywords: [...p.keywords, kw] }));
    setKeywordInput('');
  };

  const addExclude = () => {
    const co = excludeInput.trim();
    if (!co || prefs.excluded_companies.includes(co)) { setExcludeInput(''); return; }
    setPrefs(p => ({ ...p, excluded_companies: [...p.excluded_companies, co] }));
    setExcludeInput('');
  };

  const viewScreenshot = async (id) => {
    const r = await fetch(`${API_URL}/api/apply/status/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) return;
    const data = await r.json();
    if (data.screenshot_b64) setScreenshot(data.screenshot_b64);
  };

  if (!session) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 24px', color: '#64748b' }}>
        <p style={{ fontSize: 16 }}>Sign in to set up auto-apply.</p>
      </div>
    );
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '10px 14px', color: '#f1f5f9', fontSize: 14,
    outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  const labelStyle = { color: '#94a3b8', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>

      {/* Preferences panel */}
      <div style={{
        background: '#0f172a', border: '1px solid rgba(37,99,235,0.25)',
        borderRadius: 14, padding: '28px 28px 24px', marginBottom: 32,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, margin: 0 }}>Auto-Apply Preferences</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>
              Set what kinds of jobs to apply to. We'll search and apply automatically on a schedule.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 4 }}>
            <span style={{ color: prefs.enabled ? '#22c55e' : '#64748b', fontSize: 14, fontWeight: 600 }}>
              {prefs.enabled ? 'Auto-apply ON' : 'Auto-apply OFF'}
            </span>
            <div
              onClick={() => setPrefs(p => ({ ...p, enabled: !p.enabled }))}
              style={{
                width: 44, height: 24, borderRadius: 12, cursor: 'pointer',
                background: prefs.enabled ? '#16a34a' : 'rgba(255,255,255,0.12)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: prefs.enabled ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </div>
          </label>
        </div>

        {prefsLoading ? (
          <p style={{ color: '#475569', padding: '20px 0' }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>

            {/* Keywords */}
            <div>
              <label style={labelStyle}>Job keywords / titles</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {prefs.keywords.map(k => (
                  <Tag key={k} label={k} onRemove={() => setPrefs(p => ({ ...p, keywords: p.keywords.filter(x => x !== k) }))} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={keywordInput}
                  onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  placeholder="e.g. Software Engineer, React, TypeScript"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={addKeyword}
                  style={{ background: 'rgba(37,99,235,0.3)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 8, padding: '0 18px', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >Add</button>
              </div>
            </div>

            {/* Remote + location row */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={prefs.remote}
                  onChange={e => setPrefs(p => ({ ...p, remote: e.target.checked }))}
                  style={{ accentColor: '#2563eb', width: 16, height: 16 }}
                />
                Remote only
              </label>

              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>Location (optional)</label>
                <input
                  value={prefs.location}
                  onChange={e => setPrefs(p => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. San Francisco, New York"
                  style={inputStyle}
                />
              </div>

              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={labelStyle}>Min salary ($/yr)</label>
                <input
                  type="number"
                  value={prefs.salary_min}
                  onChange={e => setPrefs(p => ({ ...p, salary_min: e.target.value }))}
                  placeholder="e.g. 120000"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Daily limit + excluded companies */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 140 }}>
                <label style={labelStyle}>Daily apply limit</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={prefs.daily_limit}
                  onChange={e => setPrefs(p => ({ ...p, daily_limit: Math.max(1, Math.min(50, parseInt(e.target.value) || 10)) }))}
                  style={{ ...inputStyle, width: 100 }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Exclude companies</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {prefs.excluded_companies.map(c => (
                    <Tag key={c} label={c} onRemove={() => setPrefs(p => ({ ...p, excluded_companies: p.excluded_companies.filter(x => x !== c) }))} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={excludeInput}
                    onChange={e => setExcludeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addExclude())}
                    placeholder="Company name to skip"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={addExclude}
                    style={{ background: 'rgba(37,99,235,0.3)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 8, padding: '0 18px', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >Add</button>
                </div>
              </div>
            </div>

            {/* Save button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => savePrefs()}
                disabled={saving}
                style={{
                  background: saving ? 'rgba(37,99,235,0.4)' : '#2563eb',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '10px 28px', fontSize: 14, fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : 'Save Preferences'}
              </button>
              {saveMsg && <span style={{ color: '#22c55e', fontSize: 14, fontWeight: 600 }}>{saveMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Nudge when scheduler is off but there are queued jobs */}
      {!prefs.enabled && queue.length > 0 && (
        <div style={{
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <span style={{ color: '#c7d2fe', fontSize: 14 }}>
            ⚡ Auto-apply is <strong>off</strong> — jobs above were queued manually. Turn it on to apply automatically on a schedule.
          </span>
          <button
            onClick={() => savePrefs({ enabled: true })}
            style={{
              background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 7,
              padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >Turn on</button>
        </div>
      )}

      {/* Activity feed */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Apply History
        </h3>
        <button onClick={fetchQueue} style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 13, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {queueLoading && queue.length === 0 ? (
        <p style={{ color: '#475569', textAlign: 'center', padding: 40 }}>Loading…</p>
      ) : queue.length === 0 ? (
        <div style={{
          border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12,
          padding: '48px 24px', textAlign: 'center', color: '#475569', fontSize: 14,
        }}>
          No applications yet. Click "Auto Apply" on any job card to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queue.map(job => (
            <div key={job.id} style={{
              background: '#0f172a', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10, padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {job.company ? <strong>{job.company}</strong> : null}
                  {job.company && job.job_title ? ' — ' : null}
                  {job.job_title || null}
                  {!job.company && !job.job_title ? (
                    <a href={job.job_url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontSize: 13 }}>
                      {job.job_url.replace(/^https?:\/\//, '').slice(0, 60)}
                    </a>
                  ) : null}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: '#475569', fontSize: 12 }}>
                    {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {job.auto_applied && (
                    <span style={{ color: '#6366f1', fontSize: 12, fontWeight: 600 }}>⚡ Auto</span>
                  )}
                  {job.field_count > 0 && (
                    <span style={{ color: '#475569', fontSize: 12 }}>
                      ✓{job.filled_fields} filled · {job.skipped_fields} skipped
                      {job.errored_fields > 0 ? ` · ${job.errored_fields} errors` : ''}
                    </span>
                  )}
                  {job.ai_used && <span style={{ color: '#818cf8', fontSize: 12 }}>🤖 AI used</span>}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {statusBadge(job.status)}
                {(job.status === 'preview' || job.status === 'submitted') && (
                  <button
                    onClick={() => viewScreenshot(job.id)}
                    style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#94a3b8', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                    }}
                  >Screenshot</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {screenshot && <ScreenshotModal b64={screenshot} onClose={() => setScreenshot(null)} />}
    </div>
  );
}
