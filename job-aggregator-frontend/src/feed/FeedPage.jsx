import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './feed.css';
import { useFeed } from './useFeed';
import { fetchStats } from './feedApi';
import { EMPTY_PLACE, guessPlace, loadSavedPlace, savePlace } from './place';
import SearchBar from './SearchBar';
import FilterPills from './FilterPills';
import JobCard from './JobCard';
import JobCardSkeleton from './JobCardSkeleton';

// The existing detail pane expects these shapes.
const toDetailJob = (card) => ({
  ...card,
  cities: card.city ? [card.city] : [],
  countries: card.country ? [card.country] : [],
});

export default function FeedPage({ apiBase, session, selectedJob, onSelectJob, detail, extensionUrl, preload }) {
  const initial = useMemo(() => {
    const saved = loadSavedPlace();
    if (saved) return { place: saved, source: 'saved' };
    return { place: guessPlace({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, languages: navigator.languages }), source: 'guess' };
  }, []);
  const [place, setPlace] = useState(initial.place);
  const [placeSource, setPlaceSource] = useState(initial.source);
  const [q, setQ] = useState('');
  const [pills, setPills] = useState({ remote: false, type: '', days: '' });
  const [stats, setStats] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);   // mobile: the detail pane as a full-screen sheet

  const filters = useMemo(() => ({ place, q, ...pills }), [place, q, pills]);
  const token = session?.access_token;
  const feed = useFeed({ apiBase, filters, token, preload });

  useEffect(() => { fetchStats(apiBase).then(setStats).catch(() => {}); }, [apiBase]);

  // A guessed (never chosen) place with no jobs widens to everywhere, at most once,
  // and only when no keyword or filter could be the reason for the empty result.
  const noRefinement = q === '' && !pills.remote && !pills.type && !pills.days;
  useEffect(() => {
    if (feed.loaded && !feed.loading && feed.resultFilters === filters && !feed.error && feed.jobs.length === 0
      && placeSource === 'guess' && noRefinement && place.country) {
      setPlace(EMPTY_PLACE);
      setPlaceSource('widened');
    }
  }, [feed.loaded, feed.loading, feed.resultFilters, filters, feed.jobs.length, feed.error, placeSource, noRefinement, place.country]);

  // Select the first job once, so the detail pane is never empty on desktop.
  useEffect(() => {
    if (!selectedJob && feed.jobs.length > 0) onSelectJob(toDetailJob(feed.jobs[0]));
  }, [feed.jobs, selectedJob, onSelectJob]);

  // `chosen` is true when the place came from an explicit typeahead choice (including clearing it).
  const onSearch = useCallback((nextQ, nextPlace, chosen) => {
    setQ(nextQ);
    if (chosen) { setPlace(nextPlace); setPlaceSource('user'); savePlace(nextPlace); }
  }, []);

  const choose = useCallback((job) => { onSelectJob(toDetailJob(job)); setSheetOpen(true); }, [onSelectJob]);

  const where = place.label || 'everywhere';
  const heading = feed.count == null ? 'Jobs' : `${feed.count.toLocaleString()}${feed.countIsCapped ? '+' : ''} jobs in ${where}`;

  return (
    <div className="feed-page">
      <div className="feed-top">
        <SearchBar apiBase={apiBase} q={q} place={place} onSearch={onSearch} />
        <FilterPills filters={pills} onChange={setPills} />
        {stats && (
          <p className="feed-stats">{stats.jobs.toLocaleString()} open jobs from {stats.companies.toLocaleString()} companies. <a href={extensionUrl} target="_blank" rel="noopener noreferrer">Add the Chrome extension</a> to autofill applications.</p>
        )}
      </div>
      <div className="feed-body">
        <section className="feed-list" aria-label="Job results" aria-busy={feed.loading}>
          <h2 className="feed-heading">{heading}</h2>
          {feed.error && (
            <div className="feed-error" role="alert">
              Couldn't load jobs. <button type="button" onClick={feed.retry}>Retry</button>
            </div>
          )}
          {!feed.loaded && <JobCardSkeleton />}
          {feed.loaded && feed.jobs.length === 0 && !feed.error && (
            <p className="feed-empty">No jobs match. Try a wider place or turn off filters.</p>
          )}
          <div className={feed.loading ? 'feed-stale' : ''}>
            {feed.jobs.map(job => (
              <JobCard key={job.id} job={job} selected={selectedJob?.id === job.id} onSelect={choose} />
            ))}
          </div>
          {feed.nextCursor && (
            <button type="button" className="feed-more" disabled={feed.loadingMore} onClick={feed.loadMore}>
              {feed.loadingMore ? 'Loading…' : 'Show more jobs'}
            </button>
          )}
        </section>
        <section className={`feed-detail${sheetOpen ? ' is-open' : ''}`} aria-label="Job details">
          <button type="button" className="feed-back" onClick={() => setSheetOpen(false)}>Back to jobs</button>
          {detail}
        </section>
      </div>
    </div>
  );
}
