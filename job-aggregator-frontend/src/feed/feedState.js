export const initialFeedState = {
  jobs: [], nextCursor: null, count: null, countIsCapped: false,
  loading: false, loadingMore: false, error: '', loaded: false,
};

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
          loading: false, loadingMore: false, error: '', loaded: true };
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
