import { useCallback, useEffect, useReducer, useRef } from 'react';
import { feedReducer, initialFeedState } from './feedState';
import { fetchFeed } from './feedApi';

// `preload` (optional) is the in-flight first-page request started by the
// inline script in index.html; it is only used for the very first load.
export function useFeed({ apiBase, filters, token, preload }) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const seq = useRef(0);
  const abort = useRef(null);
  const nextCursorRef = useRef(null);
  const busyRef = useRef(false);
  const usedPreload = useRef(false);
  // Captured at mount only. The inline script clears window.__feedPreload
  // after one use, so a later render passes a different value; that must not
  // change `run` and trigger a second fetch.
  const preloadRef = useRef(preload);
  nextCursorRef.current = state.nextCursor;
  busyRef.current = state.loading || state.loadingMore;

  const run = useCallback(async (append, cursor) => {
    const mySeq = ++seq.current;
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    dispatch({ type: 'start', append });
    try {
      let data;
      if (!append && !usedPreload.current && preloadRef.current) {
        usedPreload.current = true;
        try { data = await preloadRef.current(filters); } catch { data = undefined; }
      }
      if (mySeq !== seq.current) return;   // superseded while the preload was pending
      if (!data) data = await fetchFeed(apiBase, { ...filters, cursor }, { signal: abort.current.signal, token });
      if (mySeq !== seq.current) return;   // a newer request superseded this one
      dispatch({ type: 'success', append, data });
    } catch (e) {
      if (e.name === 'AbortError' || mySeq !== seq.current) return;
      dispatch({ type: 'error', message: e.message });
    }
  }, [apiBase, filters, token]);

  // Refetch from the top whenever the filters or the signed-in token change.
  useEffect(() => {
    run(false, '');
    return () => { seq.current++; abort.current?.abort(); };
  }, [run]);

  // Ignore load-more while a request is in flight: it would abort a pending
  // refresh and append a page from a stale cursor.
  const loadMore = useCallback(() => {
    if (nextCursorRef.current && !busyRef.current) run(true, nextCursorRef.current);
  }, [run]);
  const retry = useCallback(() => run(false, ''), [run]);
  return { ...state, loadMore, retry };
}
