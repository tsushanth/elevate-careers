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

      {/* Hero Section — unauthenticated only */}
      {activeTab === 'jobs' && !session && (
        <div className="hero-wrapper">
        <div className="hero-section">
          <div className="hero-left">
            <h1 className="hero-headline">Find the job that's right for you.</h1>
            <p className="hero-sub">AI-powered job matching and one-click autofill — so you can apply faster and smarter.</p>
            <div className="hero-ctas">
              <button className="hero-cta-primary" onClick={() => setShowAuthModal(true)}>Sign up free</button>
              <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="hero-cta-secondary">Add to Chrome — Free</a>
            </div>
          </div>
          <div className="hero-right" aria-hidden="true">
            <svg viewBox="0 0 520 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="hero-illustration">
              {/* Background */}
              <rect width="520" height="400" rx="24" fill="#f0f4ff"/>

              {/* Bookshelf on the left wall */}
              <rect x="28" y="60" width="14" height="160" rx="3" fill="#c8a96e"/>
              <rect x="26" y="58" width="18" height="6" rx="2" fill="#b8925a"/>
              <rect x="30" y="70" width="10" height="28" rx="2" fill="#e07b54"/>
              <rect x="30" y="102" width="10" height="22" rx="2" fill="#4285f4"/>
              <rect x="30" y="128" width="10" height="30" rx="2" fill="#34a853"/>
              <rect x="30" y="162" width="10" height="20" rx="2" fill="#fbbc04"/>
              <rect x="30" y="186" width="10" height="26" rx="2" fill="#9c5de0"/>

              {/* Desk surface */}
              <rect x="60" y="248" width="400" height="14" rx="5" fill="#c8a96e"/>
              <rect x="80" y="262" width="8" height="80" rx="3" fill="#b8925a"/>
              <rect x="432" y="262" width="8" height="80" rx="3" fill="#b8925a"/>

              {/* Laptop base */}
              <rect x="150" y="210" width="200" height="126" rx="6" fill="#2d3748"/>
              <rect x="155" y="215" width="190" height="116" rx="4" fill="#1a202c"/>
              {/* Laptop screen content */}
              <rect x="163" y="222" width="174" height="102" rx="3" fill="#0f172a"/>
              {/* Browser chrome */}
              <rect x="163" y="222" width="174" height="14" rx="3" fill="#1e293b"/>
              <circle cx="172" cy="229" r="3" fill="#fc8181"/>
              <circle cx="182" cy="229" r="3" fill="#f6ad55"/>
              <circle cx="192" cy="229" r="3" fill="#68d391"/>
              <rect x="200" y="224" width="110" height="10" rx="5" fill="#2d3748"/>
              {/* Job listing rows on screen */}
              <rect x="168" y="242" width="80" height="6" rx="3" fill="#60a5fa"/>
              <rect x="168" y="252" width="55" height="4" rx="2" fill="#475569"/>
              <rect x="168" y="260" width="40" height="12" rx="4" fill="#0a66c2"/>
              <rect x="212" y="260" width="40" height="12" rx="4" fill="#1e293b" opacity="0.8"/>
              <rect x="168" y="278" width="80" height="6" rx="3" fill="#a78bfa"/>
              <rect x="168" y="288" width="55" height="4" rx="2" fill="#475569"/>
              <rect x="168" y="296" width="40" height="12" rx="4" fill="#0a66c2"/>
              <rect x="168" y="310" width="80" height="6" rx="3" fill="#34d399"/>
              <rect x="168" y="320" width="50" height="4" rx="2" fill="#475569"/>
              {/* Laptop hinge & keyboard */}
              <rect x="150" y="334" width="200" height="10" rx="3" fill="#4a5568"/>
              <rect x="180" y="338" width="140" height="4" rx="2" fill="#2d3748"/>

              {/* Coffee mug */}
              <rect x="380" y="220" width="36" height="40" rx="6" fill="#fff" stroke="#e2e8f0" strokeWidth="2"/>
              <path d="M416 234 Q430 234 430 244 Q430 254 416 254" stroke="#e2e8f0" strokeWidth="2" fill="none"/>
              <rect x="384" y="224" width="28" height="8" rx="3" fill="#fde68a" opacity="0.7"/>
              {/* Steam lines */}
              <path d="M390 218 Q392 212 390 206" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <path d="M398 216 Q400 210 398 204" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <path d="M406 218 Q408 212 406 206" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" fill="none"/>

              {/* Notepad */}
              <rect x="90" y="220" width="52" height="66" rx="4" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5"/>
              <rect x="96" y="228" width="38" height="3" rx="1.5" fill="#cbd5e1"/>
              <rect x="96" y="235" width="30" height="3" rx="1.5" fill="#cbd5e1"/>
              <rect x="96" y="242" width="34" height="3" rx="1.5" fill="#cbd5e1"/>
              <rect x="96" y="249" width="24" height="3" rx="1.5" fill="#cbd5e1"/>
              <rect x="96" y="256" width="32" height="3" rx="1.5" fill="#bfdbfe"/>
              <rect x="96" y="263" width="20" height="3" rx="1.5" fill="#bfdbfe"/>
              {/* Pencil */}
              <rect x="148" y="274" width="6" height="32" rx="2" transform="rotate(-20 148 274)" fill="#fbbc04"/>
              <polygon points="148,274 154,274 151,265" fill="#f87171"/>

              {/* Person sitting at desk */}
              {/* Chair back */}
              <rect x="222" y="300" width="56" height="70" rx="8" fill="#4a5568"/>
              <rect x="230" y="308" width="40" height="54" rx="6" fill="#64748b"/>
              {/* Body / torso */}
              <ellipse cx="250" cy="296" rx="30" ry="36" fill="#fbbf24"/>
              {/* Shirt */}
              <ellipse cx="250" cy="310" rx="28" ry="22" fill="#0a66c2"/>
              {/* Head */}
              <circle cx="250" cy="258" r="26" fill="#fde68a"/>
              {/* Hair */}
              <ellipse cx="250" cy="238" rx="26" ry="12" fill="#92400e"/>
              <ellipse cx="224" cy="248" rx="6" ry="12" fill="#92400e"/>
              <ellipse cx="276" cy="248" rx="6" ry="12" fill="#92400e"/>
              {/* Eyes */}
              <circle cx="241" cy="258" r="3.5" fill="#1e293b"/>
              <circle cx="259" cy="258" r="3.5" fill="#1e293b"/>
              <circle cx="242" cy="257" r="1.2" fill="#fff"/>
              <circle cx="260" cy="257" r="1.2" fill="#fff"/>
              {/* Smile */}
              <path d="M243 267 Q250 273 257 267" stroke="#92400e" strokeWidth="2" fill="none" strokeLinecap="round"/>
              {/* Arms reaching to keyboard */}
              <path d="M222 306 Q190 320 180 334" stroke="#fde68a" strokeWidth="14" strokeLinecap="round" fill="none"/>
              <path d="M278 306 Q310 320 320 334" stroke="#fde68a" strokeWidth="14" strokeLinecap="round" fill="none"/>

              {/* Floating badge: "New Match!" */}
              <rect x="340" y="130" width="110" height="40" rx="10" fill="#fff" stroke="#0a66c2" strokeWidth="1.5"/>
              <circle cx="358" cy="150" r="8" fill="#0a66c2"/>
              <text x="356" y="154" fontSize="9" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">✓</text>
              <rect x="372" y="142" width="68" height="7" rx="3.5" fill="#0a66c2"/>
              <rect x="372" y="153" width="48" height="5" rx="2.5" fill="#bfdbfe"/>

              {/* Floating badge: "Applied!" */}
              <rect x="56" y="130" width="90" height="36" rx="10" fill="#fff" stroke="#34a853" strokeWidth="1.5"/>
              <circle cx="74" cy="148" r="7" fill="#34a853"/>
              <text x="72" y="152" fontSize="8" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">✓</text>
              <rect x="86" y="141" width="50" height="6" rx="3" fill="#34a853"/>
              <rect x="86" y="151" width="36" height="5" rx="2.5" fill="#bbf7d0"/>

              {/* Stars / sparkles decoration */}
              <circle cx="460" cy="80" r="5" fill="#fbbc04"/>
              <circle cx="472" cy="62" r="3" fill="#fde68a"/>
              <circle cx="448" cy="65" r="3.5" fill="#fbbf24" opacity="0.7"/>
              <circle cx="62" cy="52" r="4" fill="#a78bfa" opacity="0.8"/>
              <circle cx="48" cy="40" r="2.5" fill="#c4b5fd"/>
              <circle cx="76" cy="38" r="3" fill="#818cf8" opacity="0.6"/>

              {/* Wall clock */}
              <circle cx="460" cy="160" r="28" fill="#fff" stroke="#e2e8f0" strokeWidth="2"/>
              <circle cx="460" cy="160" r="2.5" fill="#374151"/>
              <line x1="460" y1="160" x2="460" y2="140" stroke="#374151" strokeWidth="2" strokeLinecap="round"/>
              <line x1="460" y1="160" x2="474" y2="166" stroke="#374151" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
        </div>
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