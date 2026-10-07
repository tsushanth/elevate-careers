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
