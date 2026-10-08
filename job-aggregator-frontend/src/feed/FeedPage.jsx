import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './feed.css';
import { useFeed } from './useFeed';
import { fetchStats, fetchRoles } from './feedApi';
import { EMPTY_PLACE, guessPlace, loadSavedPlace, savePlace } from './place';
import SearchBar from './SearchBar';
import FilterPills from './FilterPills';
import JobCard from './JobCard';
import JobCardSkeleton from './JobCardSkeleton';
import { useIsMobile, useSheetA11y } from './useSheetA11y';
import { loadViewed, addViewed } from './viewed';
import PrefsNote from './PrefsNote';
import { loadPrefsOff, savePrefsOff } from './prefsChoice';
import { loadRole, saveRole } from './roleChoice';

// The existing detail pane expects these shapes.
const toDetailJob = (card) => ({
  ...card,
  cities: card.city ? [card.city] : [],
  countries: card.country ? [card.country] : [],
});

export default function FeedPage({ apiBase, session, selectedJob, onSelectJob, detail, extensionUrl, preload, externalQuery, appliedJobIds }) {
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
  const isMobile = useIsMobile();
  const modal = sheetOpen && isMobile;
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useSheetA11y({ active: modal, sheetRef, openerRef, onClose: closeSheet });

  // A new click on a Growth-tab skill/title (externalQuery.n increments) sets the keyword.
  // Keyed on n only, so re-renders with the same n never override what the user typed.
  const externalN = externalQuery?.n || 0;
  const externalQ = externalQuery?.q || '';
  useEffect(() => { if (externalN > 0) setQ(externalQ); }, [externalN]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Show all jobs" on the preferences note: sent as prefs=off, remembered for the session.
  const [prefsOff, setPrefsOff] = useState(loadPrefsOff);
  const choosePrefsOff = useCallback((off) => { setPrefsOff(off); savePrefsOff(off); }, []);

  // Role (job family). `roles` is null until /v2/roles answers, then the list ([] = feature off or fetch failed).
  // A saved slug is sent optimistically while the list is pending, so a returning user gets one request, not two.
  const [roles, setRoles] = useState(null);
  const [roleSlug, setRoleSlug] = useState(loadRole);
  useEffect(() => {
    let live = true;
    Promise.resolve(fetchRoles(apiBase)).then(r => { if (live) setRoles(Array.isArray(r) ? r : []); }, () => { if (live) setRoles([]); });
    return () => { live = false; };
  }, [apiBase]);
  const chooseRole = useCallback((slug) => { setRoleSlug(slug); saveRole(slug); }, []);
  // A saved slug the server no longer knows (400) or the list no longer offers is dropped for good.
  const dropRole = useCallback(() => chooseRole(''), [chooseRole]);
  useEffect(() => {
    if (roles && roles.length > 0 && roleSlug && !roles.some(r => r.slug === roleSlug)) dropRole();
  }, [roles, roleSlug, dropRole]);
  // Feature off or list unavailable: no control and no role param (the saved slug stays for when it returns).
  const role = roles === null || roles.some(r => r.slug === roleSlug) ? roleSlug : '';
  const roleLabel = roles?.find(r => r.slug === role)?.label || '';

  const filters = useMemo(() => ({ place, q, ...pills, prefsOff, role }), [place, q, pills, prefsOff, role]);
  const token = session?.access_token;
  const feed = useFeed({ apiBase, filters, token, preload, onInvalidRole: dropRole });

  // Jobs applied to in this session leave the list at once (the server also hides them on the next fetch).
  // Opened jobs are dimmed, not removed: removing the card being read would break the list and detail layout.
  const [viewed, setViewed] = useState(loadViewed);
  const visibleJobs = useMemo(
    () => (appliedJobIds && appliedJobIds.size ? feed.jobs.filter(j => !appliedJobIds.has(j.id)) : feed.jobs),
    [feed.jobs, appliedJobIds],
  );

  useEffect(() => { fetchStats(apiBase).then(setStats).catch(() => {}); }, [apiBase]);

  // A guessed (never chosen) place with no jobs widens to everywhere, at most once,
  // and only when no keyword or filter could be the reason for the empty result.
  const noRefinement = q === '' && !pills.remote && !pills.type && !pills.days && !role;
  useEffect(() => {
    if (feed.loaded && !feed.loading && feed.resultFilters === filters && !feed.error && feed.jobs.length === 0
      && placeSource === 'guess' && noRefinement && place.country) {
      setPlace(EMPTY_PLACE);
      setPlaceSource('widened');
    }
  }, [feed.loaded, feed.loading, feed.resultFilters, filters, feed.jobs.length, feed.error, placeSource, noRefinement, place.country]);

  // Keep the detail pane tied to the visible list. Empty selection: select the first job.
  // Stale selection (restored from sessionStorage, or chosen from an earlier response that the
  // signed-in refetch then filtered by dismissed jobs / excluded companies): once the new list has
  // settled and no longer contains it, select the first job of the new list, on desktop only (on
  // mobile the sheet must not open by itself and the stale pane is hidden). A job the user opened
  // explicitly in this view stays shown even if the list drops it.
  const explicitIdRef = useRef(null);
  const selectedId = selectedJob?.id;
  const settled = feed.loaded && !feed.loading && !feed.error && feed.resultFilters === filters;
  useEffect(() => {
    if (!selectedJob) {
      if (visibleJobs.length > 0) onSelectJob(toDetailJob(visibleJobs[0]));
      return;
    }
    if (!settled || isMobile || visibleJobs.length === 0) return;
    if (explicitIdRef.current === selectedId) return;
    if (!visibleJobs.some(j => j.id === selectedId)) onSelectJob(toDetailJob(visibleJobs[0]));
  }, [visibleJobs, selectedJob, selectedId, settled, isMobile, onSelectJob]);

  // `chosen` is true when the place came from an explicit typeahead choice (including clearing it).
  const onSearch = useCallback((nextQ, nextPlace, chosen) => {
    setQ(nextQ);
    if (chosen) { setPlace(nextPlace); setPlaceSource('user'); savePlace(nextPlace); }
  }, []);

  const choose = useCallback((job, opener) => { openerRef.current = opener || document.activeElement; explicitIdRef.current = job.id; setViewed(addViewed(job.id)); onSelectJob(toDetailJob(job)); setSheetOpen(true); }, [onSelectJob]);

  // The note belongs to the list it was computed for, not to a refetch still in flight.
  const settledPrefs = !!token && feed.loaded && feed.resultFilters === filters && !feed.error;
  const where = place.label || 'everywhere';
  const heading = feed.count == null ? 'Jobs' : `${feed.count.toLocaleString()}${feed.countIsCapped ? '+' : ''} ${roleLabel ? `${roleLabel} jobs` : 'jobs'} in ${where}`;
  // Remember that the list the user switched off was a profile match, so the way back says "Use my profile".
  const hadProfileRef = useRef(false);
  useEffect(() => {
    if (feed.prefs === 'applied') hadProfileRef.current = feed.match?.source === 'profile';
  }, [feed.prefs, feed.match]);

  return (
    <div className="feed-page">
      <div className="feed-top">
        <SearchBar apiBase={apiBase} q={q} place={place} onSearch={onSearch} />
        <FilterPills filters={pills} onChange={setPills} roles={roles || []} role={role} onRoleChange={chooseRole} />
        {stats && (
          <p className="feed-stats">{stats.jobs.toLocaleString()} open jobs from {stats.companies.toLocaleString()} companies. <a href={extensionUrl} target="_blank" rel="noopener noreferrer">Add the Chrome extension</a> to autofill applications.</p>
        )}
      </div>
      <div className="feed-body">
        <section className="feed-list" aria-label="Job results" aria-busy={feed.loading}>
          <h2 className="feed-heading">{heading}</h2>
          {settledPrefs && <PrefsNote status={feed.prefs} match={role ? undefined : feed.match} hadProfile={hadProfileRef.current} onShowAll={() => choosePrefsOff(true)} onUsePreferences={() => choosePrefsOff(false)} />}
          {feed.error && (
            <div className="feed-error" role="alert">
              Couldn't load jobs. <button type="button" onClick={feed.retry}>Retry</button>
            </div>
          )}
          {!feed.loaded && <JobCardSkeleton />}
          {feed.loaded && visibleJobs.length === 0 && !feed.error && (
            <p className="feed-empty">No jobs match. Try a wider place or turn off filters.</p>
          )}
          <div className={feed.loading ? 'feed-stale' : ''}>
            {visibleJobs.map(job => (
              <JobCard key={job.id} job={job} selected={selectedJob?.id === job.id} viewed={viewed.has(job.id)} onSelect={choose} />
            ))}
          </div>
          {feed.nextCursor && (
            <button type="button" className="feed-more" disabled={feed.loadingMore} onClick={feed.loadMore}>
              {feed.loadingMore ? 'Loading…' : 'Show more jobs'}
            </button>
          )}
        </section>
        <section ref={sheetRef} className={`feed-detail${sheetOpen ? ' is-open' : ''}`} aria-label="Job details"
          {...(modal ? { role: 'dialog', 'aria-modal': 'true' } : {})}>
          <button type="button" className="feed-back" onClick={closeSheet}>Back to jobs</button>
          {detail}
        </section>
      </div>
    </div>
  );
}
