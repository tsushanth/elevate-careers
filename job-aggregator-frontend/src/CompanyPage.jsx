import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, ExternalLink, ArrowLeft, Briefcase } from 'lucide-react';
import { supabase } from './supabase';
import { descriptionToSafeHtml } from './descriptionHtml';
import { trackFunnel } from './track';
import { extensionVersion } from './onboarding/extension';
import './CompanyPage.css';

const API_URL = 'https://elevate-careers-api.fly.dev';
const NARROW = '(max-width: 760px)'; // keep in step with CompanyPage.css

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatSalary(job) {
  if (job.salary_min && job.salary_max)
    return `$${(job.salary_min / 1000).toFixed(0)}K – $${(job.salary_max / 1000).toFixed(0)}K/yr`;
  if (job.salary_min)
    return `$${(job.salary_min / 1000).toFixed(0)}K+/yr`;
  return null;
}

export default function CompanyPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [signedIn, setSignedIn] = useState(null); // null until the session check answers
  const detailRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    // Not passed a `session` prop — this page is routed standalone (see
    // index.js), unlike App.jsx which owns its own supabase.auth.getSession()
    // call. Fetch it directly here so the auth token can be sent, letting
    // the backend apply the user's US-only preference the same way
    // "Recommended for you" already does — without it, /companies/:slug/jobs
    // has no way to know who's asking and falls back to unfiltered (correct
    // for an anonymous/bot visitor, but not for a signed-in user with a
    // location preference set).
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session);
      const authHeaders = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      Promise.all([
        fetch(`${API_URL}/companies/${slug}`).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/companies/${slug}/jobs`, { headers: authHeaders }).then(r => r.ok ? r.json() : { jobs: [] }),
      ]).then(([co, jobData]) => {
        setCompany(co);
        setJobs(jobData.jobs || []);
        if (jobData.jobs?.length > 0) setSelectedJob(jobData.jobs[0]);
        setLoading(false);
      }).catch(() => setLoading(false));
    });
  }, [slug]);

  const handleOpen = (job) => {
    trackFunnel('job_open', { job_id: Number(job.id), from: 'company' });
    setSelectedJob(job);
    // On a phone the detail sits above the list: bring it, and its apply button, into view.
    if (window.matchMedia?.(NARROW).matches) detailRef.current?.scrollIntoView({ block: 'start' });
  };

  const handleApply = (job) => {
    trackFunnel('apply_click', { job_id: Number(job.id), signed_in: !!signedIn, ext: extensionVersion() !== null, from: 'company' });
    window.open(job.apply_url, '_blank', 'noopener');
  };

  const handleSignUp = () => {
    trackFunnel('company_signup_click', { signed_in: false });
    navigate('/?signup=1');
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#00000099' }}>
      Loading…
    </div>
  );

  if (!company) return (
    <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', color: '#00000099' }}>
      <p style={{ fontSize: 18 }}>Company not found.</p>
      <button onClick={() => navigate('/')} style={backBtnStyle}>← Back to jobs</button>
    </div>
  );

  const domain = company.domain?.replace(/\.jobspy$/, '');
  const logoUrl = domain ? `https://logo.clearbit.com/${domain}` : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f3f2ef' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #0000001f' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#00000099', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <ArrowLeft size={16} /> Jobs
          </button>
        </div>
      </div>

      {/* Company hero */}
      <div style={{ background: '#fff', borderBottom: '1px solid #0000001f' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt={company.name}
              onError={e => { e.target.style.display = 'none'; }}
              style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'contain', border: '1px solid #0000001f', background: '#fff', padding: 6 }}
            />
          )}
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: '#000000e6', margin: 0 }}>{company.name}</h1>
            {domain && (
              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: '#0a66c2', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                {domain} <ExternalLink size={12} />
              </a>
            )}
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#00000099' }}>
              <Briefcase size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {company.open_jobs} open role{company.open_jobs !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Sign-up step for visitors who arrive here from a search engine */}
      {signedIn === false && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px 0' }}>
          <div style={{ background: '#fff', border: '1px solid #0a66c2', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#000000e6' }}>Create a free SimplyApply account</div>
              <div style={{ fontSize: 13, color: '#00000099', marginTop: 4 }}>
                Save your details once, then the SimplyApply Chrome extension fills job applications for you on desktop.
              </div>
            </div>
            <button type="button" onClick={handleSignUp} style={{ background: '#0a66c2', color: '#fff', border: 'none', borderRadius: 20, padding: '10px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Sign up free
            </button>
          </div>
        </div>
      )}

      {/* Job list + detail */}
      <div className="company-jobs">
        {/* Left: job list */}
        <div className="company-job-list">
          {jobs.length === 0 && (
            <div style={{ color: '#00000099', fontSize: 14, padding: '20px 0' }}>No open roles found.</div>
          )}
          {jobs.map(job => (
            <div
              key={job.id}
              onClick={() => handleOpen(job)}
              style={{
                background: '#fff',
                border: `1px solid ${selectedJob?.id === job.id ? '#0a66c2' : '#0000001f'}`,
                borderRadius: 12,
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'border-color .15s',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: '#000000e6', marginBottom: 4 }}>{job.title}</div>
              <div style={{ fontSize: 12, color: '#00000099', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {job.remote && <span style={{ color: '#057642' }}>Remote</span>}
                {(job.cities?.[0] || job.countries?.[0]) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <MapPin size={11} /> {job.cities?.[0] || job.countries?.[0]}
                  </span>
                )}
                {formatSalary(job) && <span>{formatSalary(job)}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Right: job detail */}
        {selectedJob && (
          <div ref={detailRef} className="company-job-detail">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: '#000000e6', margin: 0 }}>{selectedJob.title}</h2>
                <div style={{ fontSize: 13, color: '#00000099', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {selectedJob.remote && <span style={{ color: '#057642', fontWeight: 600 }}>Remote</span>}
                  {(selectedJob.cities?.[0] || selectedJob.countries?.[0]) && (
                    <span><MapPin size={12} style={{ verticalAlign: 'middle' }} /> {selectedJob.cities?.[0] || selectedJob.countries?.[0]}</span>
                  )}
                  {selectedJob.employment_type && <span>{selectedJob.employment_type.replace('_', ' ')}</span>}
                  {formatSalary(selectedJob) && <span style={{ color: '#057642', fontWeight: 600 }}>{formatSalary(selectedJob)}</span>}
                </div>
              </div>
              <button
                onClick={() => handleApply(selectedJob)}
                style={{ background: '#0a66c2', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
              >
                Apply on company site <ExternalLink size={14} />
              </button>
            </div>
            {selectedJob.description_excerpt && (
              <div
                className="company-job-description"
                dangerouslySetInnerHTML={{ __html: descriptionToSafeHtml(selectedJob.description_excerpt) }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const backBtnStyle = {
  marginTop: 16, background: '#0a66c2', color: '#fff', border: 'none',
  borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 14,
};
