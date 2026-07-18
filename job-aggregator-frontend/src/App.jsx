import React, { useState, useEffect } from 'react';
import { Search, MapPin, DollarSign, Briefcase, Clock, Bookmark, ExternalLink } from 'lucide-react';
import { supabase } from './supabase';
import AuthModal from './AuthModal';
import './App.css';

const API_URL = 'https://elevate-careers-api.fly.dev';

function App() {
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: '',
    remote: false,
    location: '',
    employmentType: '',
  });
  const [totalCount, setTotalCount] = useState(0);
  const [session, setSession] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [activeTab, setActiveTab] = useState('jobs');
  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [showApplied, setShowApplied] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setPage(0);
    fetchJobs(0);
  }, [filters, session]);

  const fetchJobs = async (pageNum = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.remote && { remote: 'true' }),
        ...(filters.location && { location: filters.location }),
        ...(filters.employmentType && { employment_type: filters.employmentType }),
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
      setJobs(data.jobs || []);
      setTotalCount(data.count || 0);
      if (data.appliedCount !== undefined) setAppliedCount(data.appliedCount);
      if (data.jobs && data.jobs.length > 0) {
        setSelectedJob(data.jobs[0]);
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when showApplied toggle changes
  useEffect(() => { if (session) { setPage(0); fetchJobs(0); } }, [showApplied]); // eslint-disable-line

  const handleSearch = (e) => {
    e.preventDefault();
    fetchJobs();
  };

  const fetchApplications = async () => {
    if (!session) return;
    setAppsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/ai-resume/applications`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setApplications(data.applications || []);
    } catch (e) {
      console.error('Error fetching applications:', e);
    } finally {
      setAppsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'applications') fetchApplications();
  }, [activeTab, session]);

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

      {/* Applications Tab */}
      {activeTab === 'applications' && (
        <div className="applications-view">
          <div className="applications-header">
            <h2>Applied Jobs</h2>
            <p className="results-count">{applications.length} applications</p>
          </div>
          {!session ? (
            <div className="no-results"><p>Sign in to see your applications.</p></div>
          ) : appsLoading ? (
            <div className="loading">Loading…</div>
          ) : applications.length === 0 ? (
            <div className="no-results"><p>No applications yet. Use the Elevate extension to autofill job forms and they'll appear here.</p></div>
          ) : (
            <table className="apps-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Job Title</th>
                  <th>Date</th>
                  <th>Fields</th>
                  <th>AI</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {applications.map(app => (
                  <tr key={app.id}>
                    <td><strong>{app.company || '—'}</strong></td>
                    <td>
                      <a href={app.job_url} target="_blank" rel="noopener noreferrer" title={app.job_url}>
                        {app.job_title ? app.job_title.slice(0, 60) : app.job_url.replace(/^https?:\/\//, '').slice(0, 50)}
                      </a>
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {new Date(app.filled_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
                    </td>
                    <td style={{textAlign:'center'}}>
                      <span title={`✓${app.fields_filled} skip${app.fields_skipped} err${app.fields_errored}`}>
                        ✓{app.fields_filled} {app.fields_errored > 0 && <span style={{color:'#ef4444'}}>✗{app.fields_errored}</span>}
                      </span>
                    </td>
                    <td style={{textAlign:'center'}}>{app.ai_used ? '🤖' : '—'}</td>
                    <td style={{textAlign:'center'}}>
                      {app.submitted === true && <span style={{color:'#22c55e',fontWeight:600}}>✓ Applied</span>}
                      {app.submitted === false && <span style={{color:'#ef4444',fontWeight:600}}>✗ Failed</span>}
                      {app.submitted === null && <span style={{color:'#94a3b8'}}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={filters.remote}
              onChange={(e) => setFilters({ ...filters, remote: e.target.checked })}
            />
            <span>Remote only</span>
          </label>
        </div>
      </div>

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
                  onClick={() => { setSelectedJob(job); window.open(job.apply_url, '_blank', 'noopener,noreferrer'); }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="job-card-header">
                    <CompanyLogo name={job.company_name} domain={job.company_domain} className="company-logo" />
                    <div className="job-card-title">
                      <h3>{job.title}</h3>
                      <p className="company-name">{job.company_name}</p>
                    </div>
                    <button className="close-button">×</button>
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
            </div>
          )}

          {/* Pagination */}
          {!loading && totalCount > PAGE_SIZE && (
            <div className="pagination">
              <button
                className="page-btn"
                disabled={page === 0}
                onClick={() => { const p = page - 1; setPage(p); fetchJobs(p); }}
              >← Prev</button>
              <span className="page-info">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <button
                className="page-btn"
                disabled={(page + 1) * PAGE_SIZE >= totalCount}
                onClick={() => { const p = page + 1; setPage(p); fetchJobs(p); }}
              >Next →</button>
            </div>
          )}
        </div>

        {/* Job Detail */}
        {selectedJob && (
          <div className="job-detail">
            <div className="job-detail-header">
              <div className="job-detail-company">
                <CompanyLogo name={selectedJob.company_name} domain={selectedJob.company_domain} className="company-logo-large" />
                <h2>{selectedJob.company_name}</h2>
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
              <a
                href={selectedJob.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="apply-button"
              >
                Apply <ExternalLink size={16} />
              </a>
              <button className="save-button">
                <Bookmark size={18} />
                Save
              </button>
            </div>

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
          onSuccess={(s) => setSession(s)}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}

export default App;