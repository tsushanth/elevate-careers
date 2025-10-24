import React, { useState, useEffect } from 'react';
import { Search, MapPin, DollarSign, Briefcase, Clock, Bookmark, ExternalLink } from 'lucide-react';
import './App.css';

const API_URL = 'https://elevate-careers-917362189743.europe-west1.run.app';

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

  useEffect(() => {
    fetchJobs();
  }, [filters]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: 50,
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.remote && { remote: 'true' }),
        ...(filters.location && { location: filters.location }),
        ...(filters.employmentType && { employment_type: filters.employmentType }),
      });

      const response = await fetch(`${API_URL}/jobs?${params}`);
      const data = await response.json();
      setJobs(data.jobs || []);
      setTotalCount(data.count || 0);
      if (data.jobs && data.jobs.length > 0 && !selectedJob) {
        setSelectedJob(data.jobs[0]);
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchJobs();
  };

  const formatSalary = (job) => {
    if (job.salary_min && job.salary_max) {
      return `$${(job.salary_min / 1000).toFixed(0)}K - $${(job.salary_max / 1000).toFixed(0)}K/yr`;
    }
    return null;
  };

  const getCompanyLogo = (companyName) => {
    // Using a placeholder service - you can replace with actual logos
    const name = companyName?.toLowerCase() || 'company';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(companyName)}&size=48&background=random&bold=true`;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1 className="logo">Elevate Careers</h1>
          <nav className="nav">
            <a href="#jobs">Jobs</a>
            <a href="#saved">Saved</a>
            <a href="#applications">Applications</a>
          </nav>
        </div>
      </header>

      {/* Search Bar */}
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
          <div className="search-input-group">
            <MapPin className="search-icon" size={20} />
            <input
              type="text"
              placeholder="Location"
              value={filters.location}
              onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              className="search-input"
            />
          </div>
          <button type="submit" className="search-button">
            Search
          </button>
        </form>

        {/* Filters */}
        <div className="filters">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={filters.remote}
              onChange={(e) => setFilters({ ...filters, remote: e.target.checked })}
            />
            <span>Remote only</span>
          </label>
          <select
            value={filters.employmentType}
            onChange={(e) => setFilters({ ...filters, employmentType: e.target.value })}
            className="filter-select"
          >
            <option value="">All types</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Job List */}
        <div className="job-list">
          <div className="job-list-header">
            <h2>Top job picks for you</h2>
            <p className="results-count">{totalCount} results</p>
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
                  onClick={() => setSelectedJob(job)}
                >
                  <div className="job-card-header">
                    <img
                      src={getCompanyLogo(job.company_name)}
                      alt={job.company_name}
                      className="company-logo"
                    />
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
                    <span className="promoted">Promoted</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Job Detail */}
        {selectedJob && (
          <div className="job-detail">
            <div className="job-detail-header">
              <div className="job-detail-company">
                <img
                  src={getCompanyLogo(selectedJob.company_name)}
                  alt={selectedJob.company_name}
                  className="company-logo-large"
                />
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
    </div>
  );
}

export default App;