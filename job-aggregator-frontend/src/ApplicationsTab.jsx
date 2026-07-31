import React, { useState, useEffect, useRef } from 'react';

function statusBadge(status) {
  const map = {
    queued: { label: 'Queued', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    running: { label: 'Running', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    submitted: { label: 'Submitted', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    failed: { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  };
  const s = map[status] || { label: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`,
    }}>{s.label}</span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtSalary(min, max) {
  if (min && max) return `$${Math.round(min / 1000)}K–$${Math.round(max / 1000)}K`;
  if (min) return `$${Math.round(min / 1000)}K+`;
  return null;
}

export default function ApplicationsTab({ session, API_URL, EXTENSION_URL, pendingApply, onPendingConsumed }) {
  // Preferences strip
  const [prefs, setPrefs] = useState({ keywords: [], remote: false, location: '', salary_min: '', daily_limit: 10, auto_apply_similar: false });
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [kwInput, setKwInput] = useState('');

  // Applications list (merged)
  const [queueApps, setQueueApps] = useState([]); // from /api/apply/list
  const [extApps, setExtApps] = useState([]);     // from /api/ai-resume/applications
  const [appsLoading, setAppsLoading] = useState(false);

  // Suggested jobs
  const [suggested, setSuggested] = useState([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestedHasMore, setSuggestedHasMore] = useState(false);
  const [suggestedOffset, setSuggestedOffset] = useState(0);
  const [seeding, setSeeding] = useState(null); // job.id being seeded
  const [dismissed, setDismissed] = useState(new Set());
  const [selectedSuggested, setSelectedSuggested] = useState(null);

  const pollRef = useRef({});

  // ── Load preferences ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    fetch(`${API_URL}/api/preferences`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => {
        setPrefs({
          keywords: data.keywords || [],
          remote: data.remote || false,
          location: data.location || '',
          salary_min: data.salary_min || '',
          daily_limit: data.daily_limit || 10,
          auto_apply_similar: data.auto_apply_similar || false,
        });
      })
      .catch(() => {});
  }, [session]);

  // ── Save preferences ──────────────────────────────────────────────────────
  const savePrefs = async () => {
    if (!session) return;
    setPrefsSaving(true);
    try {
      await fetch(`${API_URL}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          ...prefs,
          salary_min: prefs.salary_min ? parseInt(prefs.salary_min, 10) : null,
          daily_limit: parseInt(prefs.daily_limit, 10) || 10,
          excluded_companies: [],
          enabled: true,
        }),
      });
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 2500);
    } finally {
      setPrefsSaving(false);
    }
  };

  // ── Load applications ─────────────────────────────────────────────────────
  const fetchApplications = async () => {
    if (!session) return;
    setAppsLoading(true);
    try {
      const [qRes, extRes] = await Promise.all([
        fetch(`${API_URL}/api/apply/list`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch(`${API_URL}/api/ai-resume/applications`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);
      const qData = await qRes.json();
      const extData = await extRes.json();
      setQueueApps(Array.isArray(qData) ? qData : (qData.applications || []));
      setExtApps(extData.applications || []);
    } catch (e) {
      console.error('Failed to fetch applications', e);
    } finally {
      setAppsLoading(false);
    }
  };

  useEffect(() => { fetchApplications(); }, [session]);

  // Prepend pendingApply optimistically
  useEffect(() => {
    if (!pendingApply) return;
    setQueueApps(prev => {
      if (prev.find(a => a.id === pendingApply.id)) return prev;
      return [pendingApply, ...prev];
    });
    if (onPendingConsumed) onPendingConsumed();
  }, [pendingApply]);

  // Poll active jobs every 5s
  useEffect(() => {
    if (!session) return;
    const active = queueApps.filter(a => a.status === 'queued' || a.status === 'running');
    active.forEach(app => {
      if (pollRef.current[app.id]) return;
      pollRef.current[app.id] = setInterval(async () => {
        try {
          const r = await fetch(`${API_URL}/api/apply/status/${app.id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!r.ok) return;
          const data = await r.json();
          setQueueApps(prev => prev.map(a => a.id === app.id ? { ...a, ...data } : a));
          if (data.status !== 'queued' && data.status !== 'running') {
            clearInterval(pollRef.current[app.id]);
            delete pollRef.current[app.id];
          }
        } catch {}
      }, 5000);
    });
    return () => {
      Object.values(pollRef.current).forEach(clearInterval);
      pollRef.current = {};
    };
  }, [queueApps.map(a => a.id + a.status).join(',')]);

  // ── Load suggested jobs ───────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    setSuggestedLoading(true);
    fetch(`${API_URL}/api/preferences/suggested?limit=20&offset=0`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => { setSuggested(data.jobs || []); setSuggestedHasMore(!!data.hasMore); setSuggestedOffset(20); })
      .catch(() => {})
      .finally(() => setSuggestedLoading(false));
  }, [session]);

  const loadMoreSuggested = () => {
    if (suggestedLoading) return;
    setSuggestedLoading(true);
    fetch(`${API_URL}/api/preferences/suggested?limit=20&offset=${suggestedOffset}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => {
        setSuggested(prev => [...prev, ...(data.jobs || [])]);
        setSuggestedHasMore(!!data.hasMore);
        setSuggestedOffset(o => o + 20);
      })
      .catch(() => {})
      .finally(() => setSuggestedLoading(false));
  };

  // ── Auto-apply a suggested job ────────────────────────────────────────────
  const autoApplySuggested = async (job) => {
    if (!session) return;
    setSeeding(job.id);
    try {
      if (!window.__simplyApplyInstalled) {
        window.open(EXTENSION_URL, '_blank', 'noopener,noreferrer');
        return;
      }
      const url = new URL(job.apply_url);
      url.searchParams.set('sa_autofill', '1');
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } finally {
      setSeeding(null);
    }
  };

  // ── Merge and sort applications ───────────────────────────────────────────
  const mergedApps = [
    ...queueApps.map(a => ({ ...a, _source: 'queue' })),
    ...extApps.map(a => ({ ...a, _source: 'ext', created_at: a.filled_at })),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const visibleSuggested = suggested.filter(j => !dismissed.has(j.id));

  return (
    <>
    <div style={{ minHeight: '100vh', background: '#0a0f1e', paddingBottom: 60 }}>
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px' }}>

      {/* ── Preferences strip ── */}
      {session && (
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 28,
        }}>
          {/* Keywords row */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Keywords</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {prefs.keywords.map(k => (
                <span key={k} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'rgba(37,99,235,0.18)', color: '#93c5fd',
                  borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 500,
                }}>
                  {k}
                  <button
                    onClick={() => setPrefs(p => ({ ...p, keywords: p.keywords.filter(x => x !== k) }))}
                    style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
                  >×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={kwInput}
                onChange={e => setKwInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const kw = kwInput.trim();
                    if (kw && !prefs.keywords.includes(kw)) setPrefs(p => ({ ...p, keywords: [...p.keywords, kw] }));
                    setKwInput('');
                  }
                }}
                placeholder="e.g. Software Engineer, React, TypeScript — press Enter to add"
                style={{ ...inputStyle, width: '100%', flex: 1 }}
              />
              <button
                onClick={() => {
                  const kw = kwInput.trim();
                  if (kw && !prefs.keywords.includes(kw)) setPrefs(p => ({ ...p, keywords: [...p.keywords, kw] }));
                  setKwInput('');
                }}
                style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'rgba(37,99,235,0.3)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.4)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >Add</button>
            </div>
          </div>

          {/* Filters row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
            <input type="checkbox" checked={prefs.remote} onChange={e => setPrefs(p => ({ ...p, remote: e.target.checked }))} />
            Remote
          </label>
          <input
            type="text"
            placeholder="Location"
            value={prefs.location}
            onChange={e => setPrefs(p => ({ ...p, location: e.target.value }))}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Min salary $"
            value={prefs.salary_min}
            onChange={e => setPrefs(p => ({ ...p, salary_min: e.target.value }))}
            style={{ ...inputStyle, width: 110 }}
          />
          <input
            type="number"
            placeholder="Daily limit"
            min={1} max={50}
            value={prefs.daily_limit}
            onChange={e => setPrefs(p => ({ ...p, daily_limit: e.target.value }))}
            style={{ ...inputStyle, width: 90 }}
          />
          {/* Auto-apply similar pill toggle */}
          <button
            onClick={() => setPrefs(p => ({ ...p, auto_apply_similar: !p.auto_apply_similar }))}
            title="When on, the scheduler will auto-apply to similar jobs daily without prompting"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: 'none', transition: 'all 0.15s',
              background: prefs.auto_apply_similar ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
              color: prefs.auto_apply_similar ? '#22c55e' : '#94a3b8',
              outline: `1px solid ${prefs.auto_apply_similar ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <span style={{
              width: 12, height: 12, borderRadius: '50%', display: 'inline-block',
              background: prefs.auto_apply_similar ? '#22c55e' : '#475569',
              transition: 'background 0.15s',
            }} />
            Auto-apply similar
          </button>
          <button
            onClick={savePrefs}
            disabled={prefsSaving}
            style={{
              padding: '5px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
              opacity: prefsSaving ? 0.6 : 1,
            }}
          >
            {prefsSaving ? 'Saving…' : 'Save'}
          </button>
          {prefsSaved && <span style={{ fontSize: 12, color: '#22c55e' }}>Saved ✓</span>}
          </div>
        </div>
      )}

      {/* ── Applications section ── */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Applications</h2>
          <span style={{
            background: 'rgba(37,99,235,0.15)', color: '#60a5fa',
            borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600,
          }}>{mergedApps.length}</span>
        </div>

        {!session ? (
          <div style={{ color: '#64748b', fontSize: 14, padding: '24px 0' }}>Sign in to see your applications.</div>
        ) : appsLoading ? (
          <div style={{ color: '#64748b', fontSize: 14, padding: '24px 0' }}>Loading…</div>
        ) : mergedApps.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 14, padding: '24px 0' }}>
            No applications yet.{' '}
            {EXTENSION_URL && (
              <>Install the <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>SimplyApply extension</a> to autofill jobs — they'll appear here.</>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mergedApps.map(app => (
              <div key={(app._source === 'ext' ? 'ext-' : '') + app.id} style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 8, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 13 }}>{app.company || '—'}</span>
                  {' · '}
                  <a
                    href={app.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#93c5fd', fontSize: 13, textDecoration: 'none' }}
                    title={app.job_url}
                  >
                    {(app.job_title || app.job_url || '').slice(0, 70)}
                  </a>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{fmtDate(app.created_at)}</span>
                  {app._source === 'queue' && statusBadge(app.status)}
                  {app._source === 'queue' && (app.source === 'auto' || app.auto_applied) && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: '#a78bfa',
                      background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)',
                      borderRadius: 4, padding: '2px 7px',
                    }}>⚡ Auto</span>
                  )}
                  {app._source === 'ext' && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: '#22c55e',
                      background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                      borderRadius: 4, padding: '2px 7px',
                    }}>✓ Filled</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Suggested section ── */}
      {session && (
        <div>
          <div style={{ marginBottom: 4 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: '0 0 2px' }}>Similar Jobs</h2>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>Based on your applications</p>
          </div>

          {prefs.auto_apply_similar && (
            <div style={{
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#86efac',
              marginBottom: 14,
            }}>
              Auto-applying to similar jobs daily. They'll appear in Applications when queued.
            </div>
          )}

          {suggestedLoading ? (
            <div style={{ color: '#64748b', fontSize: 14 }}>Loading…</div>
          ) : visibleSuggested.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 14, padding: '16px 0' }}>
              No similar jobs found yet. Apply to a few jobs first.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleSuggested.map(job => (
                <div
                  key={job.id}
                  onClick={() => setSelectedSuggested(job)}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 8, padding: '12px 14px', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14 }}>{job.company_name}</div>
                  <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>{job.title}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {job.locations?.[0]?.city && (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>📍 {job.locations[0].city}</span>
                    )}
                    {job.remote && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#38bdf8', background: 'rgba(56,189,248,0.1)', borderRadius: 4, padding: '1px 6px' }}>Remote</span>
                    )}
                    {fmtSalary(job.salary_min, job.salary_max) && (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtSalary(job.salary_min, job.salary_max)}</span>
                    )}
                  </div>
                </div>
              ))}
            {suggestedHasMore && (
              <button
                onClick={loadMoreSuggested}
                disabled={suggestedLoading}
                style={{
                  marginTop: 12, width: '100%', padding: '9px 0', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#94a3b8', fontSize: 13, cursor: 'pointer',
                  opacity: suggestedLoading ? 0.5 : 1,
                }}
              >
                {suggestedLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
            </div>
          )}
        </div>
      )}
    </div>
    </div>

    {/* ── Suggested job detail panel ── */}
    {selectedSuggested && (
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
        background: '#0f172a', borderLeft: '1px solid rgba(255,255,255,0.08)',
        overflowY: 'auto', zIndex: 100, padding: '24px 20px',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        <button
          onClick={() => setSelectedSuggested(null)}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', marginBottom: 16, padding: 0 }}
        >✕</button>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9', marginBottom: 4 }}>{selectedSuggested.title}</div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 12 }}>{selectedSuggested.company_name}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {selectedSuggested.locations?.[0]?.city && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>📍 {selectedSuggested.locations[0].city}</span>
          )}
          {selectedSuggested.remote && (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', background: 'rgba(56,189,248,0.1)', borderRadius: 4, padding: '2px 8px' }}>Remote</span>
          )}
          {fmtSalary(selectedSuggested.salary_min, selectedSuggested.salary_max) && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{fmtSalary(selectedSuggested.salary_min, selectedSuggested.salary_max)}</span>
          )}
        </div>
        <button
          onClick={() => autoApplySuggested(selectedSuggested)}
          disabled={seeding === selectedSuggested.id}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 700,
            background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
            opacity: seeding === selectedSuggested.id ? 0.6 : 1, marginBottom: 20,
          }}
        >
          {seeding === selectedSuggested.id ? 'Opening…' : '⚡ Auto Apply'}
        </button>
        {selectedSuggested.description_excerpt ? (
          <div
            style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: selectedSuggested.description_excerpt }}
          />
        ) : selectedSuggested.description ? (
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>{selectedSuggested.description}</p>
        ) : (
          <p style={{ fontSize: 13, color: '#64748b' }}>No description available.</p>
        )}
      </div>
    )}
    </>
  );
}

const inputStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#f1f5f9',
  fontSize: 12,
  padding: '5px 10px',
  width: 130,
  outline: 'none',
};
