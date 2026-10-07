import React from 'react';

function age(iso) {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));
  return d === 0 ? 'Today' : `${d}d ago`;
}

function place(job) {
  const bits = [job.city, job.region_code, job.city ? null : job.country].filter(Boolean);
  return bits.length ? bits.join(', ') : '';
}

function salary(job) {
  if (!job.salary_min && !job.salary_max) return '';
  const k = (n) => `${Math.round(n / 1000)}k`;
  const cur = job.salary_currency && job.salary_currency !== 'USD' ? ` ${job.salary_currency}` : '';
  return job.salary_min && job.salary_max ? `$${k(job.salary_min)}–${k(job.salary_max)}${cur}` : `$${k(job.salary_min || job.salary_max)}${cur}`;
}

export default function JobCard({ job, selected, onSelect }) {
  const where = place(job);
  const pay = salary(job);
  return (
    <button type="button" className={`feed-card${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined} onClick={() => onSelect(job)}>
      <span className="feed-card-title">{job.title}</span>
      <span className="feed-card-company">{job.company_name}</span>
      <span className="feed-card-meta">
        {where || (job.remote ? '' : 'Location not specified')}
        {job.remote && <span className="feed-chip">Remote</span>}
        {pay && <span className="feed-card-pay">{pay}</span>}
      </span>
      <span className="feed-card-foot">
        {job.autofill_ready && <span className="feed-autofill" title="The extension can autofill this application">Autofill</span>}
        <span className="feed-card-age">{job.posted_at ? age(job.posted_at) : ''}</span>
      </span>
    </button>
  );
}
