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
