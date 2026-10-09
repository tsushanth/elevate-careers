export const initialFeedState = {
  jobs: [], nextCursor: null, count: null, countIsCapped: false,
  loading: false, loadingMore: false, error: '', loaded: false,
  match: undefined,      // API: what the default list was matched to (profile/role), absent when nothing was
  near: undefined,       // API: { source, regions, label } when the server ordered jobs near the user first, else absent
  prefs: undefined,      // API: 'applied' | 'off' | absent (no saved preferences in play)
  resultFilters: null,   // the filters object that produced the current first page
};

const validNear = (n) => (n && typeof n.label === 'string' && n.label ? n : undefined);

export function feedReducer(state, action) {
  switch (action.type) {
    case 'start':
      return action.append
        ? { ...state, loadingMore: true, error: '' }
        : { ...state, loading: true, error: '' };
    case 'success': {
      const { data, append } = action;
      if (!append) {
        return { ...state, jobs: data.jobs, nextCursor: data.nextCursor, count: data.count, countIsCapped: data.countIsCapped,
          prefs: data.prefs, near: validNear(data.near), match: data.match, loading: false, loadingMore: false, error: '', loaded: true, resultFilters: action.filters };
      }
      const seen = new Set(state.jobs.map(j => j.id));
      const fresh = data.jobs.filter(j => !seen.has(j.id));
      return { ...state, jobs: [...state.jobs, ...fresh], nextCursor: data.nextCursor,
        count: data.count ?? state.count, countIsCapped: data.count == null ? state.countIsCapped : data.countIsCapped,
        loading: false, loadingMore: false, error: '', loaded: true };
    }
    case 'error':
      return { ...state, loading: false, loadingMore: false, error: action.message, loaded: true };
    default:
      return state;
  }
}
