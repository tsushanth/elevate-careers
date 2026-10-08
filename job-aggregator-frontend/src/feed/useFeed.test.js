import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useFeed } from './useFeed';
import { fetchFeed } from './feedApi';

jest.mock('./feedApi');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const job = (id) => ({ id, title: `t${id}` });
const page = (ids, next = null, count = 10) => ({ jobs: ids.map(job), nextCursor: next, count, countIsCapped: false });
const ids = (r) => r.current.jobs.map(j => j.id);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let container, root, result;

function Probe(props) {
  result.current = useFeed(props);
  return null;
}

const F1 = { place: null, q: 'a' };
const F2 = { place: null, q: 'b' };

async function render(props) {
  await act(async () => { root.render(<Probe {...props} />); });
}

beforeEach(() => {
  fetchFeed.mockReset();
  result = { current: null };
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
});

test('loads the first page on mount and exposes jobs/count', async () => {
  fetchFeed.mockResolvedValue(page([1, 2], 'c1', 42));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(fetchFeed.mock.calls[0][0]).toBe('http://x');
  expect(fetchFeed.mock.calls[0][1]).toMatchObject({ q: 'a', cursor: '' });
  expect(ids(result)).toEqual([1, 2]);
  expect(result.current.count).toBe(42);
  expect(result.current.loading).toBe(false);
  expect(result.current.loaded).toBe(true);
});

test('changing filters refetches from the top and keeps previous jobs visible while loading', async () => {
  fetchFeed.mockResolvedValueOnce(page([1, 2], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  const d = deferred();
  fetchFeed.mockReturnValueOnce(d.promise);
  await render({ apiBase: 'http://x', filters: F2, token: null });
  expect(fetchFeed).toHaveBeenCalledTimes(2);
  expect(fetchFeed.mock.calls[1][1]).toMatchObject({ q: 'b', cursor: '' });
  expect(result.current.loading).toBe(true);
  expect(ids(result)).toEqual([1, 2]);
  await act(async () => { d.resolve(page([9])); });
  expect(ids(result)).toEqual([9]);
  expect(result.current.loading).toBe(false);
});

test('loadMore appends the next page via the cursor without duplicating ids', async () => {
  fetchFeed.mockResolvedValueOnce(page([1, 2], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  fetchFeed.mockResolvedValueOnce(page([2, 3], null, null));
  await act(async () => { result.current.loadMore(); });
  expect(fetchFeed.mock.calls[1][1]).toMatchObject({ q: 'a', cursor: 'c1' });
  expect(ids(result)).toEqual([1, 2, 3]);
  expect(result.current.nextCursor).toBeNull();
  expect(result.current.count).toBe(10);
  // no cursor left: loadMore is a no-op
  await act(async () => { result.current.loadMore(); });
  expect(fetchFeed).toHaveBeenCalledTimes(2);
});

test('a slow older response arriving after a newer one is ignored', async () => {
  const slow = deferred();
  const fast = deferred();
  fetchFeed.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
  await render({ apiBase: 'http://x', filters: F1, token: null });
  await render({ apiBase: 'http://x', filters: F2, token: null });
  await act(async () => { fast.resolve(page([2])); });
  expect(ids(result)).toEqual([2]);
  await act(async () => { slow.resolve(page([1])); });
  expect(ids(result)).toEqual([2]);
});

test('an error sets error and keeps jobs; retry refetches', async () => {
  fetchFeed.mockResolvedValueOnce(page([1], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  fetchFeed.mockRejectedValueOnce(new Error('Feed request failed (500)'));
  await act(async () => { result.current.retry(); });
  expect(result.current.error).toBe('Feed request failed (500)');
  expect(ids(result)).toEqual([1]);
  expect(result.current.loading).toBe(false);
  fetchFeed.mockResolvedValueOnce(page([5]));
  await act(async () => { result.current.retry(); });
  expect(result.current.error).toBe('');
  expect(ids(result)).toEqual([5]);
  expect(fetchFeed).toHaveBeenCalledTimes(3);
});

test('a resolving preload is used once; later preload prop changes cause no fetch', async () => {
  const preload = jest.fn().mockResolvedValue(page([7, 8], 'p1'));
  await render({ apiBase: 'http://x', filters: F1, token: null, preload });
  expect(preload).toHaveBeenCalledTimes(1);
  expect(fetchFeed).not.toHaveBeenCalled();
  expect(ids(result)).toEqual([7, 8]);
  await render({ apiBase: 'http://x', filters: F1, token: null, preload: undefined });
  await render({ apiBase: 'http://x', filters: F1, token: null, preload: jest.fn() });
  expect(fetchFeed).not.toHaveBeenCalled();
  expect(preload).toHaveBeenCalledTimes(1);
  expect(ids(result)).toEqual([7, 8]);
  // a later filter change fetches normally and does not reuse the preload
  fetchFeed.mockResolvedValueOnce(page([3]));
  await render({ apiBase: 'http://x', filters: F2, token: null, preload });
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(preload).toHaveBeenCalledTimes(1);
  expect(ids(result)).toEqual([3]);
});

test('a rejecting preload falls back to a normal fetchFeed call', async () => {
  const preload = jest.fn().mockRejectedValue(new Error('boom'));
  fetchFeed.mockResolvedValueOnce(page([4]));
  await render({ apiBase: 'http://x', filters: F1, token: null, preload });
  expect(preload).toHaveBeenCalledTimes(1);
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(ids(result)).toEqual([4]);
  expect(result.current.error).toBe('');
});

test('unmounting aborts the in-flight request', async () => {
  let signal;
  fetchFeed.mockImplementation((base, state, opts) => { signal = opts.signal; return new Promise(() => {}); });
  await render({ apiBase: 'http://x', filters: F1, token: null });
  expect(signal.aborted).toBe(false);
  await act(async () => { root.unmount(); });
  expect(signal.aborted).toBe(true);
  root = createRoot(container); // so afterEach can unmount cleanly
});

test('two loadMore calls in one tick request the cursor once', async () => {
  fetchFeed.mockResolvedValueOnce(page([1], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  const d = deferred();
  fetchFeed.mockReturnValueOnce(d.promise);
  await act(async () => { result.current.loadMore(); result.current.loadMore(); });
  expect(fetchFeed).toHaveBeenCalledTimes(2);
  expect(fetchFeed.mock.calls[1][1]).toMatchObject({ cursor: 'c1' });
  await act(async () => { d.resolve(page([2])); });
  expect(ids(result)).toEqual([1, 2]);
});

test('loadMore during a refresh does nothing', async () => {
  fetchFeed.mockResolvedValueOnce(page([1], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  const d = deferred();
  fetchFeed.mockReturnValueOnce(d.promise);
  await render({ apiBase: 'http://x', filters: F2, token: null });
  await act(async () => { result.current.loadMore(); });
  expect(fetchFeed).toHaveBeenCalledTimes(2);
  await act(async () => { d.resolve(page([9])); });
  expect(ids(result)).toEqual([9]);
});

test('loadMore guard is released after success and after an error', async () => {
  fetchFeed.mockResolvedValueOnce(page([1], 'c1'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  fetchFeed.mockResolvedValueOnce(page([2], 'c2'));
  await act(async () => { result.current.loadMore(); });
  expect(ids(result)).toEqual([1, 2]);
  fetchFeed.mockRejectedValueOnce(new Error('nope'));
  await act(async () => { result.current.loadMore(); });
  expect(result.current.error).toBe('nope');
  expect(ids(result)).toEqual([1, 2]);
  fetchFeed.mockResolvedValueOnce(page([3], null));
  await act(async () => { result.current.loadMore(); });
  expect(fetchFeed.mock.calls[3][1]).toMatchObject({ cursor: 'c2' });
  expect(ids(result)).toEqual([1, 2, 3]);
});

test('a preload resolving after the run was superseded neither dispatches nor fetches', async () => {
  const d = deferred();
  const preload = jest.fn().mockReturnValue(d.promise);
  fetchFeed.mockResolvedValueOnce(page([5]));
  await render({ apiBase: 'http://x', filters: F1, token: null, preload });
  await render({ apiBase: 'http://x', filters: F2, token: null, preload });
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(fetchFeed.mock.calls[0][1]).toMatchObject({ q: 'b' });
  await act(async () => { d.resolve(page([1])); });
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(ids(result)).toEqual([5]);
});

test('a preload resolving after unmount does not dispatch', async () => {
  const d = deferred();
  const preload = jest.fn().mockReturnValue(d.promise);
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await render({ apiBase: 'http://x', filters: F1, token: null, preload });
  const before = result.current;
  await act(async () => { root.unmount(); });
  await act(async () => { d.resolve(page([1])); });
  expect(fetchFeed).not.toHaveBeenCalled();
  expect(result.current).toBe(before);
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
  root = createRoot(container);
});

test('resultFilters is the filters object that produced the page; stays old until the new page lands', async () => {
  fetchFeed.mockResolvedValueOnce(page([1]));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  expect(result.current.resultFilters).toBe(F1);
  const d = deferred();
  fetchFeed.mockReturnValueOnce(d.promise);
  await render({ apiBase: 'http://x', filters: F2, token: null });
  expect(result.current.loading).toBe(true);
  expect(result.current.resultFilters).toBe(F1);
  await act(async () => { d.resolve(page([2])); });
  expect(result.current.resultFilters).toBe(F2);
});

test('a signed-in user never uses the anonymous preload', async () => {
  const preload = jest.fn().mockResolvedValue(page([7, 8], 'p1'));
  fetchFeed.mockResolvedValue(page([1, 2]));
  await render({ apiBase: 'http://x', filters: F1, token: 'tok', preload });
  expect(preload).not.toHaveBeenCalled();
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(ids(result)).toEqual([1, 2]);
});

test('a 409 on load-more (cursor from the other ordering) restarts from the first page without an error', async () => {
  fetchFeed.mockResolvedValueOnce(page([1, 2], 'old-cursor'));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  const conflict = Object.assign(new Error('Feed request failed (409)'), { status: 409 });
  fetchFeed.mockRejectedValueOnce(conflict).mockResolvedValueOnce(page([7, 8], 'new-cursor'));
  await act(async () => { result.current.loadMore(); });
  expect(fetchFeed).toHaveBeenCalledTimes(3);
  expect(fetchFeed.mock.calls[1][1]).toMatchObject({ cursor: 'old-cursor' });
  expect(fetchFeed.mock.calls[2][1]).toMatchObject({ cursor: '' });
  expect(ids(result)).toEqual([7, 8]);
  expect(result.current.error).toBe('');
  expect(result.current.nextCursor).toBe('new-cursor');
});

test('a 409 on the first page is a normal error (no restart loop)', async () => {
  fetchFeed.mockRejectedValue(Object.assign(new Error('Feed request failed (409)'), { status: 409 }));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  expect(fetchFeed).toHaveBeenCalledTimes(1);
  expect(result.current.error).toMatch(/409/);
});

test('changing the role refetches from the top with the role', async () => {
  fetchFeed.mockResolvedValueOnce(page([1, 2], 'c1')).mockResolvedValueOnce(page([9], null));
  await render({ apiBase: 'http://x', filters: F1, token: null });
  await render({ apiBase: 'http://x', filters: { ...F1, role: 'design' }, token: null });
  expect(fetchFeed).toHaveBeenCalledTimes(2);
  expect(fetchFeed.mock.calls[1][1]).toMatchObject({ role: 'design', cursor: '' });
  expect(ids(result)).toEqual([9]);
});

test('a 400 invalid role tells the owner to drop the slug and shows no error; the new filters refetch', async () => {
  const onInvalidRole = jest.fn();
  fetchFeed.mockRejectedValueOnce(Object.assign(new Error('Feed request failed (400)'), { status: 400, code: 'invalid role' }))
    .mockResolvedValueOnce(page([5], null));
  const FR = { ...F1, role: 'gone' };
  await render({ apiBase: 'http://x', filters: FR, token: null, onInvalidRole });
  expect(onInvalidRole).toHaveBeenCalledWith('gone');
  expect(result.current.error).toBe('');
  await render({ apiBase: 'http://x', filters: F1, token: null, onInvalidRole });
  expect(fetchFeed.mock.calls[1][1]).not.toHaveProperty('role');
  expect(ids(result)).toEqual([5]);
});

test('a 400 that is not an invalid role is a normal error', async () => {
  const onInvalidRole = jest.fn();
  fetchFeed.mockRejectedValue(Object.assign(new Error('Feed request failed (400)'), { status: 400, code: 'bad cursor' }));
  await render({ apiBase: 'http://x', filters: { ...F1, role: 'x' }, token: null, onInvalidRole });
  expect(onInvalidRole).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/400/);
});

test('the anonymous preload is never used for a role-filtered list', async () => {
  const preload = jest.fn(async () => page([100]));
  fetchFeed.mockResolvedValue(page([1]));
  await render({ apiBase: 'http://x', filters: { ...F1, role: 'design' }, token: null, preload });
  expect(preload).not.toHaveBeenCalled();
  expect(ids(result)).toEqual([1]);
});
