import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSaved } from './useSaved';
import JobCard from './JobCard';

global.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = 'https://api.example.com';
const SESSION = { access_token: 'tok', user: { id: 'u1' } };

let api; let host; let root;
function Probe({ session }) {
  api = useSaved({ apiBase: BASE, session });
  return <p id="ids">{[...api.ids].sort().join(',')}|{api.error}</p>;
}
const text = () => host.querySelector('#ids').textContent;
const resp = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('does not call the API when signed out, and toggle reports signed-out', async () => {
  global.fetch = jest.fn();
  await act(async () => root.render(<Probe session={null} />));
  expect(global.fetch).not.toHaveBeenCalled();
  let r;
  await act(async () => { r = await api.toggle(5); });
  expect(r).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(api.isSaved(5)).toBe(false);
});

test('loads the saved ids once for the session', async () => {
  global.fetch = jest.fn(async () => resp({ jobs: [{ id: 3 }, { id: '7' }], count: 2 }));
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  expect(text()).toBe('3,7|');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe(`${BASE}/api/saved-jobs`);
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  await act(async () => root.render(<Probe session={{ ...SESSION, access_token: 'refreshed' }} />));
  expect(global.fetch).toHaveBeenCalledTimes(1);   // a token refresh does not reload
});

test('save is optimistic and sends PUT with the token', async () => {
  let release;
  global.fetch = jest.fn(async (url, opts = {}) => {
    if (opts.method === 'PUT') { await new Promise((r) => { release = r; }); return resp({ ok: true }); }
    return resp({ jobs: [] });
  });
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  let p;
  act(() => { p = api.toggle(42); });
  expect(api.isSaved(42)).toBe(true);            // already on screen before the server answers
  await act(async () => { release(); await p; });
  const put = global.fetch.mock.calls.find((c) => c[1]?.method === 'PUT');
  expect(put[0]).toBe(`${BASE}/api/saved-jobs/42`);
  expect(put[1].headers.Authorization).toBe('Bearer tok');
  expect(api.isSaved(42)).toBe(true);
});

test('unsave sends DELETE', async () => {
  global.fetch = jest.fn(async (url, opts = {}) => (opts.method ? resp({ ok: true }) : resp({ jobs: [{ id: 9 }] })));
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  await act(async () => { await api.toggle(9); });
  const del = global.fetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
  expect(del[0]).toBe(`${BASE}/api/saved-jobs/9`);
  expect(api.isSaved(9)).toBe(false);
});

test('a refused save rolls back and shows an error', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async (url, opts = {}) => (opts.method === 'PUT' ? resp({}, false, 404) : resp({ jobs: [] })));
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  await act(async () => { await api.toggle(11); });
  expect(api.isSaved(11)).toBe(false);
  expect(text()).toMatch(/Couldn't save it/);
  await act(async () => { jest.advanceTimersByTime(5100); });
  expect(text()).not.toMatch(/Couldn't/);
  jest.useRealTimers();
});

test('a network failure on unsave puts the bookmark back', async () => {
  global.fetch = jest.fn(async (url, opts = {}) => { if (opts.method === 'DELETE') throw new Error('offline'); return resp({ jobs: [{ id: 9 }] }); });
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  await act(async () => { await api.toggle(9); });
  expect(api.isSaved(9)).toBe(true);
});

test('ignores a second toggle for the same job while one is in flight', async () => {
  let release;
  global.fetch = jest.fn(async (url, opts = {}) => {
    if (opts.method === 'PUT') { await new Promise((r) => { release = r; }); return resp({ ok: true }); }
    return resp({ jobs: [] });
  });
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  let p1; let p2;
  act(() => { p1 = api.toggle(1); p2 = api.toggle(1); });
  await act(async () => { release(); await p1; await p2; });
  expect(global.fetch.mock.calls.filter((c) => c[1]?.method).length).toBe(1);
  expect(api.isSaved(1)).toBe(true);
});

test('signing out clears the saved ids', async () => {
  global.fetch = jest.fn(async () => resp({ jobs: [{ id: 3 }] }));
  await act(async () => root.render(<Probe session={SESSION} />));
  await settle();
  expect(text()).toBe('3|');
  await act(async () => root.render(<Probe session={null} />));
  expect(text()).toBe('|');
});

// ---- JobCard bookmark ----
const job = { id: 5, title: 'Staff Engineer', company_name: 'Acme', city: 'Austin', region_code: 'TX', posted_at: new Date().toISOString() };

test('card without onToggleSave has no bookmark; with it, the bookmark is a sibling button, not nested', () => {
  act(() => root.render(<JobCard job={job} onSelect={() => {}} />));
  expect(host.querySelector('.feed-save')).toBeNull();
  act(() => root.render(<JobCard job={job} onSelect={() => {}} saved={false} onToggleSave={() => {}} />));
  const save = host.querySelector('.feed-save');
  expect(save).not.toBeNull();
  expect(save.closest('.feed-card')).toBeNull();
  expect(save.getAttribute('aria-pressed')).toBe('false');
  expect(save.getAttribute('aria-label')).toBe('Add Staff Engineer to your shortlist');
});

test('clicking the bookmark toggles without opening the job', () => {
  const onSelect = jest.fn(); const onToggleSave = jest.fn();
  act(() => root.render(<JobCard job={job} onSelect={onSelect} saved onToggleSave={onToggleSave} />));
  const save = host.querySelector('.feed-save');
  expect(save.getAttribute('aria-pressed')).toBe('true');
  expect(save.getAttribute('aria-label')).toMatch(/^Remove Staff Engineer/);
  act(() => save.click());
  expect(onToggleSave).toHaveBeenCalledWith(job);
  expect(onSelect).not.toHaveBeenCalled();
  act(() => host.querySelector('.feed-card').click());
  expect(onSelect).toHaveBeenCalledTimes(1);
});
