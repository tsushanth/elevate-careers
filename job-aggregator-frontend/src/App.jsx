import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, DollarSign, Briefcase, Clock, Bookmark, ExternalLink } from 'lucide-react';
import { supabase } from './supabase';
import AuthModal from './AuthModal';
import OnboardingModal, { shouldShowOnboarding, markOnboardingDone } from './OnboardingModal';
import ApplicationsTab from './ApplicationsTab';
import './App.css';

const API_URL = 'https://elevate-careers-api.fly.dev';
const EXTENSION_URL = 'https://chromewebstore.google.com/detail/simplyapply-%E2%80%94-ai-job-auto/ocdeebjeffdjmfgmclnlphkhfdcdpdkf';

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const dismissMenuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'none', border: 'none', color: '#cbd5e1',
  padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 6,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

function App() {
  const navigate = useNavigate();
  // Cached the same way selectedJob already was — otherwise every fresh
  // mount (navigating to a company page and back, browser back/forward)
  // blanks the list and shows a loading spinner even though the results
  // probably haven't changed since last visit.
  const [jobs, setJobs] = useState(() => {
    try { const s = sessionStorage.getItem('sa_jobs'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [selectedJob, setSelectedJob] = useState(() => {
    try { const s = sessionStorage.getItem('sa_selectedJob'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const selectJob = (job) => {
    setSelectedJob(job);
    try { sessionStorage.setItem('sa_selectedJob', JSON.stringify(job)); } catch {}
  };
  // Only true while there's no cached list to show yet — a background
  // refetch on top of cached results shouldn't blank the page.
  const [loading, setLoading] = useState(jobs.length === 0);
  const [filters, setFilters] = useState({
    keyword: '', remote: false, location: '', employmentType: '', datePosted: '',
  });
  const [totalCount, setTotalCount] = useState(() => {
    try { return parseInt(sessionStorage.getItem('sa_totalCount'), 10) || 0; } catch { return 0; }
  });
  const [session, setSession] = useState(null);
  // supabase.auth.getSession() resolves asynchronously, so `session` starts
  // as null even for a signed-in user for a brief moment. Without this flag,
  // the fetch effect below fired immediately on that still-unresolved null,
  // hit the unauthenticated (non-personalized) /jobs endpoint, and overwrote
  // the cached personalized list — invisible before caching was added (both
  // states were hidden behind the loading spinner), but visible as a flash
  // of the wrong list now that a cached list is shown immediately.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState('jobs');
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [seedingJob, setSeedingJob] = useState(null); // job id being seeded
  const [seedError, setSeedError] = useState('');
  const [pendingApply, setPendingApply] = useState(null); // { id, job_url, job_title, company }
  const [page, setPage] = useState(0);
  const [showApplied, setShowApplied] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [dismissMenuJobId, setDismissMenuJobId] = useState(null);
  // Screen coordinates for the portal-rendered dismiss menu below — it's
  // rendered into document.body via createPortal so it isn't clipped by the
  // job list's `overflow-y: auto`, which was cutting the menu off before.
  const [dismissMenuPos, setDismissMenuPos] = useState(null);
  // Marks jobs applied-to in this session so the card/button update the
  // instant Apply is clicked, without waiting for the next server refetch
  // (which excludes applied jobs, but only once it re-runs).
  const [appliedJobIds, setAppliedJobIds] = useState(() => {
    try { const s = sessionStorage.getItem('sa_appliedJobIds'); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });
  const markApplied = (jobId) => {
    setAppliedJobIds(prev => {
      const next = new Set(prev);
      next.add(jobId);
      try { sessionStorage.setItem('sa_appliedJobIds', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const fetchSeq = useRef(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setSessionChecked(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // detect.js sets this flag when the extension is active on simplyappl.ai
    setExtensionInstalled(!!window.__simplyApplyInstalled);
  }, []);

  useEffect(() => {
    if (dismissMenuJobId === null) return;
    const closeMenu = () => setDismissMenuJobId(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [dismissMenuJobId]);

  useEffect(() => {
    if (!sessionChecked) return; // wait for the real session before fetching
    setPage(0);
    fetchJobs(0);
  }, [filters, session, sessionChecked]);

  const fetchJobs = async (pageNum = page) => {
    // Guard against out-of-order responses: if session/filters change quickly
    // (e.g. session hydrating from null -> real on page load), an earlier
    // request can resolve after a later one and clobber it with stale/smaller
    // results. Only the response from the most-recently-issued call wins.
    const mySeq = ++fetchSeq.current;
    // Only show the blocking spinner when there's nothing cached to display —
    // a background refresh on top of an already-visible list shouldn't blank it.
    if (jobs.length === 0) setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.remote && { remote: 'true' }),
        ...(filters.location && { location: filters.location }),
        ...(filters.employmentType && { employment_type: filters.employmentType }),
        ...(filters.datePosted && { days: filters.datePosted }),
      });

      // Use personalized feed when signed in and no explicit keyword search
      const usePersonalized = session && !filters.keyword && !filters.location && !filters.remote;
      if (usePersonalized) params.set('show_applied', showApplied ? 'true' : 'false');
      const url = usePersonalized
        ? `${API_URL}/jobs/personalized?${params}`
        : `${API_URL}/jobs?${params}`;
      const headers = usePersonalized
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const response = await fetch(url, { headers });
      const data = await response.json();
      if (mySeq !== fetchSeq.current) return; // a newer request superseded this one
      const freshJobs = data.jobs || [];
      setJobs(freshJobs);
      setTotalCount(data.count || 0);
      try {
        sessionStorage.setItem('sa_jobs', JSON.stringify(freshJobs));
        sessionStorage.setItem('sa_totalCount', String(data.count || 0));
      } catch {}
      if (data.appliedCount !== undefined) setAppliedCount(data.appliedCount);
      // Only auto-select the first job when nothing is already selected —
      // otherwise a background refresh would keep snapping the detail pane
      // back to job #1 out from under whatever the user had picked.
      if (!selectedJob && freshJobs.length > 0) {
        selectJob(freshJobs[0]);
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      if (mySeq === fetchSeq.current) setLoading(false);
    }
  };

  // Re-fetch when showApplied toggle changes
  useEffect(() => { if (session) { setPage(0); fetchJobs(0); } }, [showApplied]); // eslint-disable-line

  const handleSearch = (e) => {
    e.preventDefault();
    fetchJobs();
  };

  // action: 'card' (this session only) | 'company' | 'title' (persisted to prefs)
  const removeJobsFromCache = (predicate) => {
    setJobs(prev => {
      const next = prev.filter(j => !predicate(j));
      try { sessionStorage.setItem('sa_jobs', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const dismissJob = async (job, action) => {
    setDismissMenuJobId(null);
    if (action === 'card') {
      removeJobsFromCache(j => j.id === job.id);
      return;
    }
    if (!session) return;
    try {
      const current = await fetch(`${API_URL}/api/preferences`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).then(r => r.json());

      const patch = action === 'company'
        ? { excluded_companies: [...new Set([...(current.excluded_companies || []), job.company_name])] }
        : { excluded_titles: [...new Set([...(current.excluded_titles || []), job.title])] };

      await fetch(`${API_URL}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...current, ...patch }),
      });

      removeJobsFromCache(j => action === 'company' ? j.company_name === job.company_name : j.title === job.title);
    } catch (e) {
      console.error('Failed to dismiss job', e);
    }
  };

  const formatSalary = (job) => {
    if (job.salary_min && job.salary_max) {
      return `$${(job.salary_min / 1000).toFixed(0)}K - $${(job.salary_max / 1000).toFixed(0)}K/yr`;
    }
    return null;
  };

  const getCompanyLogo = (companyName, companyDomain) => {
    if (companyDomain) return `https://logo.clearbit.com/${companyDomain}`;
    return null;
  };

  const CompanyLogo = ({ name, domain, className }) => {
    const [failed, setFailed] = React.useState(false);
    const src = getCompanyLogo(name, domain);
    const initials = (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    if (!src || failed) {
      return (
        <div className={className} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #1e3a5f, #1e40af)',
          color: '#93c5fd', fontWeight: 700, fontSize: className?.includes('large') ? 20 : 14,
          borderRadius: 8, flexShrink: 0,
        }}>{initials}</div>
      );
    }
    return <img src={src} alt={name} className={className} onError={() => setFailed(true)} />;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1 className="logo">SimplyApply</h1>
          <nav className="nav">
            <a href="#jobs" onClick={e => { e.preventDefault(); setActiveTab('jobs'); }} className={activeTab === 'jobs' ? 'nav-active' : ''}>Jobs</a>
            <a href="#applications" onClick={e => { e.preventDefault(); setActiveTab('applications'); }} className={activeTab === 'applications' ? 'nav-active' : ''}>Applications</a>
            {session ? (
              <div className="nav-user">
                <span className="nav-email">{session.user.email}</span>
                <button
                  className="nav-signout"
                  onClick={() => supabase.auth.signOut()}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                className="nav-signin"
                onClick={() => setShowAuthModal(true)}
              >
                Sign In
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Extension install banner — signed-in users only */}
      {session && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(37,99,235,0.18) 0%, rgba(16,185,129,0.12) 100%)',
          borderBottom: '1px solid rgba(37,99,235,0.25)',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          fontSize: 14,
        }}>
          <span style={{ color: '#1e3a8a' }}>
            ⚡ Autofill any job application in one click with the SimplyApply Chrome extension
          </span>
          <a
            href={EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: '#2563eb',
              color: '#fff',
              padding: '5px 16px',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Add to Chrome — Free
          </a>
        </div>
      )}

      {/* Applications Tab */}
      {activeTab === 'applications' && (
        <ApplicationsTab
          session={session}
          API_URL={API_URL}
          EXTENSION_URL={EXTENSION_URL}
          pendingApply={pendingApply}
          onPendingConsumed={() => setPendingApply(null)}
        />
      )}

      {/* Search Bar */}
      {activeTab === 'jobs' && <>
      <div className="search-section">
        <form onSubmit={handleSearch} className="search-form">
          <div className="search-input-group">
            <Search className="search-icon" size={20} />
            <input
              type="text"
              placeholder="Search jobs, titles, companies..."
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
              className="search-input"
            />
          </div>
          <button type="submit" className="search-button">
            Search
          </button>
        </form>

        <div className="filters">
          {[
            { label: 'Remote', key: 'remote', toggle: true },
            { label: 'Full-time', key: 'employmentType', value: 'full_time' },
            { label: 'Part-time', key: 'employmentType', value: 'part_time' },
            { label: 'Contract', key: 'employmentType', value: 'contract' },
            { label: 'Past week', key: 'datePosted', value: '7' },
            { label: 'Past month', key: 'datePosted', value: '30' },
          ].map(f => {
            const active = f.toggle ? filters.remote : filters[f.key] === f.value;
            return (
              <button
                key={f.label}
                className={`filter-pill${active ? ' active' : ''}`}
                onClick={() => {
                  if (f.toggle) {
                    setFilters({ ...filters, remote: !filters.remote });
                  } else {
                    setFilters({ ...filters, [f.key]: active ? '' : f.value });
                  }
                }}
              >
                {f.label} {active ? '✕' : '+'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Extension CTA — not signed in */}
      {!session && (
        <div style={{
          textAlign: 'center',
          padding: '14px 24px',
          background: 'rgba(37,99,235,0.08)',
          borderBottom: '1px solid rgba(37,99,235,0.15)',
          fontSize: 14,
          color: '#94a3b8',
        }}>
          Find a job you like?{' '}
          <a
            href={EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontWeight: 600 }}
          >
            Install the SimplyApply extension
          </a>
          {' '}to autofill the application in one click.
        </div>
      )}

      {/* Main Content */}
      <div className="main-content">
        {/* Job List */}
        <div className="job-list">
          <div className="job-list-header">
            <h2>{session && !filters.keyword && !filters.location && !filters.remote ? 'Recommended for you' : 'Top job picks for you'}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <p className="results-count">{totalCount} results</p>
              {session && appliedCount > 0 && (
                <button
                  onClick={() => setShowApplied(v => !v)}
                  style={{
                    background: showApplied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${showApplied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
                    color: showApplied ? '#22c55e' : '#94a3b8',
                    borderRadius: 6, padding: '4px 12px', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {showApplied ? `✓ Showing applied (${appliedCount})` : `Hide applied (${appliedCount})`}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="loading">Loading jobs...</div>
          ) : jobs.length === 0 ? (
            <div className="no-results">
              <p>No jobs found. Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="jobs">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className={`job-card ${selectedJob?.id === job.id ? 'selected' : ''}`}
                  onClick={() => selectJob(job)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="job-card-header">
                    <CompanyLogo name={job.company_name} domain={job.company_logo_domain || job.company_domain} className="company-logo" />
                    <div className="job-card-title">
                      <h3>{job.title}</h3>
                      <p className="company-name">{job.company_name}</p>
                      {appliedJobIds.has(job.id) && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600, color: '#22c55e',
                          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
                          borderRadius: 4, padding: '2px 6px', marginTop: 4,
                        }}>✓ Applied</span>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <button
                        className="close-button"
                        onClick={e => {
                          e.stopPropagation();
                          if (dismissMenuJobId === job.id) { setDismissMenuJobId(null); return; }
                          const r = e.currentTarget.getBoundingClientRect();
                          setDismissMenuPos({ top: r.bottom + 4, left: r.right });
                          setDismissMenuJobId(job.id);
                        }}
                      >×</button>
                      {dismissMenuJobId === job.id && dismissMenuPos && createPortal(
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'fixed', top: dismissMenuPos.top, left: dismissMenuPos.left,
                            transform: 'translateX(-100%)', zIndex: 1000,
                            background: '#111827', border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8, minWidth: 220, maxWidth: 280, padding: 4,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                          }}
                        >
                          <button
                            onClick={() => dismissJob(job, 'company')}
                            style={dismissMenuItemStyle}
                          >Don't show jobs from {job.company_name}</button>
                          <button
                            onClick={() => dismissJob(job, 'title')}
                            style={dismissMenuItemStyle}
                          >Don't show "{job.title}" roles</button>
                          <button
                            onClick={() => dismissJob(job, 'card')}
                            style={dismissMenuItemStyle}
                          >Just remove this card</button>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  <div className="job-card-info">
                    <div className="job-location">
                      <MapPin size={14} />
                      <span>
                        {job.locations && job.locations.length > 0
                          ? `${job.locations[0].city || ''} ${job.locations[0].country || ''}`
                          : 'Remote'}
                        {job.remote && ' (Remote)'}
                      </span>
                    </div>
                    {formatSalary(job) && (
                      <div className="job-salary">
                        <DollarSign size={14} />
                        <span>{formatSalary(job)}</span>
                      </div>
                    )}
                  </div>

                  <div className="job-card-footer">
                    <span className="job-time">
                      <Clock size={14} />
                      {new Date(job.posted_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>

                  </div>
                </div>
              ))}

              {/* Pagination */}
              {!loading && (page > 0 || totalCount === PAGE_SIZE) && (
                <div className="pagination">
                  <button className="page-btn prev-next" disabled={page === 0}
                    onClick={() => { const p = page - 1; setPage(p); fetchJobs(p); }}>←</button>
                  {[...Array(Math.min(5, page + (totalCount === PAGE_SIZE ? 2 : 1)))].map((_, i) => {
                    const start = Math.max(0, page - 2);
                    const p = start + i;
                    if (p > page && totalCount < PAGE_SIZE) return null;
                    return (
                      <button key={p} className={`page-btn${p === page ? ' active' : ''}`}
                        onClick={() => { if (p !== page) { setPage(p); fetchJobs(p); } }}>
                        {p + 1}
                      </button>
                    );
                  })}
                  <button className="page-btn prev-next" disabled={totalCount < PAGE_SIZE}
                    onClick={() => { const p = page + 1; setPage(p); fetchJobs(p); }}>→</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Job Detail */}
        {selectedJob && (
          <div className="job-detail">
            <div className="job-detail-header">
              <div className="job-detail-company">
                <CompanyLogo name={selectedJob.company_name} domain={selectedJob.company_logo_domain || selectedJob.company_domain} className="company-logo-large" />
                <h2
                  onClick={() => navigate(`/companies/${slugify(selectedJob.company_name)}`)}
                  style={{ cursor: 'pointer', color: '#6366f1' }}
                >{selectedJob.company_name}</h2>
              </div>
              <button className="more-button">⋯</button>
            </div>

            <h1 className="job-detail-title">{selectedJob.title}</h1>

            <div className="job-detail-meta">
              <span>
                {selectedJob.locations && selectedJob.locations.length > 0
                  ? `${selectedJob.locations[0].city || ''}, ${selectedJob.locations[0].country || ''}`
                  : 'Location not specified'}
              </span>
              <span>•</span>
              <span>
                Posted{' '}
                {Math.floor(
                  (Date.now() - new Date(selectedJob.posted_at)) / (1000 * 60 * 60 * 24)
                )}{' '}
                days ago
              </span>
              <span>•</span>
              <span>Over 100 people clicked apply</span>
            </div>

            <div className="job-detail-badges">
              {formatSalary(selectedJob) && (
                <span className="badge">{formatSalary(selectedJob)}</span>
              )}
              {selectedJob.remote && <span className="badge badge-remote">✓ Remote</span>}
              {selectedJob.employment_type && (
                <span className="badge">✓ {selectedJob.employment_type.replace('_', '-')}</span>
              )}
            </div>

            <div className="job-detail-actions">
              <button
                className="apply-button"
                disabled={seedingJob === selectedJob.id}
                onClick={async () => {
                  if (!session) { setShowAuthModal(true); return; }
                  setSeedingJob(selectedJob.id);
                  const url = new URL(selectedJob.apply_url);
                  url.searchParams.set('sa_autofill', '1');
                  window.open(url.toString(), '_blank', 'noopener,noreferrer');
                  setPendingApply({
                    id: `pending-${Date.now()}`,
                    job_url: selectedJob.apply_url,
                    job_title: selectedJob.title,
                    company: selectedJob.company_name,
                    status: 'opened',
                    created_at: new Date().toISOString(),
                  });
                  markApplied(selectedJob.id);
                  setSeedingJob(null);

                  // Persist the application — without this it only lived in
                  // local React state, so it vanished on refresh, never
                  // counted toward appliedCount, and never got excluded from
                  // future "Recommended for you" results.
                  try {
                    await fetch(`${API_URL}/api/ai-resume/applications/track`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                      body: JSON.stringify({
                        jobUrl: selectedJob.apply_url,
                        jobTitle: selectedJob.title,
                        company: selectedJob.company_name,
                      }),
                    });
                  } catch (e) {
                    console.error('Failed to record application', e);
                  }
                }}
              >
                {seedingJob === selectedJob.id
                  ? 'Opening…'
                  : appliedJobIds.has(selectedJob.id) ? '✓ Applied — Apply again?' : '⚡ Apply'} <ExternalLink size={16} />
              </button>
            </div>
            {extensionInstalled ? (
              <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 0' }}>
                ⚡ We'll auto-fill the form for you — just click Submit when ready.
              </p>
            ) : (
              <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 0' }}>
                ⚡ Auto-fill requires the{' '}
                <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', textDecoration: 'underline' }}>
                  SimplyApply Chrome extension
                </a>
                {' '}— install it once, then click Apply.
              </p>
            )}

            <div className="job-detail-description">
              <h3>About the job</h3>
              {selectedJob.description_excerpt ? (
                <div
                  className="description-content"
                  dangerouslySetInnerHTML={{ __html: selectedJob.description_excerpt }}
                />
              ) : (
                <p>No description available.</p>
              )}
            </div>

            {selectedJob.skills && selectedJob.skills.length > 0 && (
              <div className="job-skills">
                <h3>Skills</h3>
                <div className="skills-list">
                  {selectedJob.skills.map((skill, index) => (
                    <span key={index} className="skill-tag">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </>}
      {showAuthModal && (
        <AuthModal
          onSuccess={(s, isNewUser) => {
            setSession(s);
            if (isNewUser && shouldShowOnboarding()) setShowOnboarding(true);
          }}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {showOnboarding && (
        <OnboardingModal onDismiss={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}

export default App;