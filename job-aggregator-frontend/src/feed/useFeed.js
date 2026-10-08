import { useCallback, useEffect, useReducer, useRef } from 'react';
import { feedReducer, initialFeedState } from './feedState';
import { fetchFeed } from './feedApi';

// `preload` (optional) is the in-flight first-page request started by the
// inline script in index.html; it is only used for the very first load.
export function useFeed({ apiBase, filters, token, preload, onInvalidRole }) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const seq = useRef(0);
  const abort = useRef(null);
  const nextCursorRef = useRef(null);
  // Synchronous in-flight flag for the current run (not derived from state).
  const busyRef = useRef(false);
  const usedPreload = useRef(false);
  // Captured at mount only. The inline script clears window.__feedPreload
  // after one use, so a later render passes a different value; that must not
  // change `run` and trigger a second fetch.
  const preloadRef = useRef(preload);
  nextCursorRef.current = state.nextCursor;
  const onInvalidRoleRef = useRef(onInvalidRole);
  onInvalidRoleRef.current = onInvalidRole;

  const run = useCallback(async (append, cursor) => {
    const mySeq = ++seq.current;
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    busyRef.current = true;
    dispatch({ type: 'start', append });
    try {
      let data;
      // The preload is the anonymous page; a signed-in user's page is filtered per user, so never use it.
      if (!append && !usedPreload.current && preloadRef.current && !token && !filters.role) {
        usedPreload.current = true;
        try { data = await preloadRef.current(filters); } catch { data = undefined; }
      }
      if (mySeq !== seq.current) return;   // superseded while the preload was pending
      if (!data) data = await fetchFeed(apiBase, { ...filters, cursor }, { signal: abort.current.signal, token });
      if (mySeq !== seq.current) return;   // a newer request superseded this one
      busyRef.current = false;
      dispatch({ type: 'success', append, data, filters });
    } catch (e) {
      if (mySeq !== seq.current) return;
      busyRef.current = false;
      if (e.name === 'AbortError') return;
      // 400 invalid role: a saved slug the server no longer knows. The owner drops it, which changes the
      // filters and refetches without it; no error banner.
      if (!append && e.status === 400 && e.code === 'invalid role' && filters.role && onInvalidRoleRef.current) {
        onInvalidRoleRef.current(filters.role);
        return;
      }
      // 409: the cursor was minted under a different ordering (the server's ordering was switched while this
      // page was open). Start again from the top instead of showing an error; a first-page request has no cursor.
      if (append && e.status === 409) { run(false, ''); return; }
      dispatch({ type: 'error', message: e.message });
    }
  }, [apiBase, filters, token]);

  // Refetch from the top whenever the filters or the signed-in token change.
  useEffect(() => {
    run(false, '');
    // The cleanup intentionally bumps the counter to supersede in-flight requests,
    // so it must read the live ref values, not values captured at effect time.
    const seqRef = seq, busy = busyRef, ctl = abort;
    return () => { seqRef.current++; busy.current = false; ctl.current?.abort(); };
  }, [run]);

  // Ignore load-more while a request is in flight: it would abort a pending
  // refresh and append a page from a stale cursor.
  const loadMore = useCallback(() => {
    if (nextCursorRef.current && !busyRef.current) run(true, nextCursorRef.current);
  }, [run]);
  const retry = useCallback(() => run(false, ''), [run]);
  return { ...state, loadMore, retry };
}
