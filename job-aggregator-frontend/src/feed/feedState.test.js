import { feedReducer, initialFeedState } from './feedState';

const job = (id) => ({ id, title: `t${id}` });
const page = (ids, next = null, count = 99) => ({ jobs: ids.map(job), nextCursor: next, count, countIsCapped: false });

test('first load: loading with no jobs, then success replaces', () => {
  let s = feedReducer(initialFeedState, { type: 'start', append: false });
  expect(s.loading).toBe(true);
  expect(s.jobs).toEqual([]);
  s = feedReducer(s, { type: 'success', append: false, data: page([1, 2], 'c1') });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2]);
  expect(s.nextCursor).toBe('c1');
  expect(s.loading).toBe(false);
  expect(s.loaded).toBe(true);
});

test('a refresh keeps the previous list visible until new data arrives', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1, 2]) });
  s = feedReducer(s, { type: 'start', append: false });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2]);   // not blanked
  expect(s.loading).toBe(true);
  s = feedReducer(s, { type: 'success', append: false, data: page([9]) });
  expect(s.jobs.map(j => j.id)).toEqual([9]);
});

test('load more appends and never duplicates an id', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1, 2], 'c1') });
  s = feedReducer(s, { type: 'start', append: true });
  expect(s.loadingMore).toBe(true);
  expect(s.loading).toBe(false);
  s = feedReducer(s, { type: 'success', append: true, data: page([2, 3], null) });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2, 3]);
  expect(s.nextCursor).toBeNull();
  expect(s.loadingMore).toBe(false);
});

test('append keeps the original count (later pages carry no count)', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1], 'c1', 500) });
  s = feedReducer(s, { type: 'success', append: true, data: { jobs: [job(2)], nextCursor: null, count: null, countIsCapped: false } });
  expect(s.count).toBe(500);
});

test('error keeps existing jobs and records the message', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1]) });
  s = feedReducer(s, { type: 'start', append: false });
  s = feedReducer(s, { type: 'error', message: 'Feed request failed (500)' });
  expect(s.jobs.map(j => j.id)).toEqual([1]);
  expect(s.error).toBe('Feed request failed (500)');
  expect(s.loading).toBe(false);
});

test('error after a load-more start keeps jobs and cursor and clears loadingMore', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1], 'c1') });
  s = feedReducer(s, { type: 'start', append: true });
  s = feedReducer(s, { type: 'error', message: 'x' });
  expect(s.jobs.map(j => j.id)).toEqual([1]);
  expect(s.nextCursor).toBe('c1');
  expect(s.loadingMore).toBe(false);
});

test('resultFilters: null initially, set by non-append success, kept by start, append and error', () => {
  const f1 = { q: 'a' };
  const f2 = { q: 'b' };
  expect(initialFeedState.resultFilters).toBeNull();
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1], 'c1'), filters: f1 });
  expect(s.resultFilters).toBe(f1);
  s = feedReducer(s, { type: 'start', append: false });
  expect(s.resultFilters).toBe(f1);
  s = feedReducer(s, { type: 'success', append: true, data: page([2]), filters: f1 });
  expect(s.resultFilters).toBe(f1);
  s = feedReducer(s, { type: 'start', append: false });
  s = feedReducer(s, { type: 'error', message: 'x' });
  expect(s.resultFilters).toBe(f1);
  s = feedReducer(s, { type: 'success', append: false, data: page([3]), filters: f2 });
  expect(s.resultFilters).toBe(f2);
});

test('the API prefs marker is kept for the first page and cleared by a page without it', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: { ...page([1]), prefs: 'applied' } });
  expect(s.prefs).toBe('applied');
  s = feedReducer(s, { type: 'success', append: true, data: page([2]) });
  expect(s.prefs).toBe('applied');
  s = feedReducer(s, { type: 'success', append: false, data: page([3]) });
  expect(s.prefs).toBeUndefined();
});

test('success keeps the match object of the first page and clears it on the next first page without one', () => {
  const match = { source: 'profile', roleSlug: null, roleLabel: null, labels: ['A'] };
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: { ...page([1]), prefs: 'applied', match } });
  expect(s.match).toEqual(match);
  s = feedReducer(s, { type: 'success', append: true, data: page([2]) });
  expect(s.match).toEqual(match);   // load-more pages carry no match
  s = feedReducer(s, { type: 'success', append: false, data: page([3]) });
  expect(s.match).toBeUndefined();
});

test('near is stored from the first page and cleared when the next response has none', () => {
  const near = { source: 'ip', regions: ['CA'], label: 'California' };
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: { ...page([1], 'c1'), near } });
  expect(s.near).toEqual(near);
  s = feedReducer(s, { type: 'success', append: true, data: page([2]) });
  expect(s.near).toEqual(near);   // later pages never change it
  s = feedReducer(s, { type: 'success', append: false, data: page([3]) });
  expect(s.near).toBeUndefined();
});

test('a malformed near is ignored', () => {
  const s = feedReducer(initialFeedState, { type: 'success', append: false, data: { ...page([1]), near: { source: 'ip', regions: [] } } });
  expect(s.near).toBeUndefined();
});
