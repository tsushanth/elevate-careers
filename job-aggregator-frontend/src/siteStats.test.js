import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSiteStats, resetSiteStats, useSiteStats, fmtCount } from './siteStats';

global.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => resetSiteStats());

const reply = (body, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));

test('loadSiteStats returns the live numbers and caches them', async () => {
  global.fetch = reply({ jobs: 101489, remote: 8784, companies: 7342 });
  expect(await loadSiteStats('https://api.example.com')).toEqual({ jobs: 101489, remote: 8784, companies: 7342 });
  await loadSiteStats('https://api.example.com');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe('https://api.example.com/v2/stats');
});

test('loadSiteStats gives null (never a made-up number) on an error, bad shape or zero counts', async () => {
  global.fetch = reply({}, false);
  expect(await loadSiteStats('x')).toBeNull();
  resetSiteStats();
  global.fetch = reply({ jobs: 'lots', companies: 3 });
  expect(await loadSiteStats('x')).toBeNull();
  resetSiteStats();
  global.fetch = reply({ jobs: 0, companies: 0, remote: 0 });
  expect(await loadSiteStats('x')).toBeNull();
  resetSiteStats();
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  expect(await loadSiteStats('x')).toBeNull();
});

function Probe({ enabled }) {
  const s = useSiteStats('https://api.example.com', enabled);
  return <p id="out">{s ? `${fmtCount(s.jobs)}|${fmtCount(s.companies)}` : 'none'}</p>;
}

test('useSiteStats renders nothing numeric first, then the live values; disabled never fetches', async () => {
  global.fetch = reply({ jobs: 101489, remote: 8784, companies: 7342 });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Probe enabled={false} />));
  expect(host.textContent).toBe('none');
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe enabled />));
  expect(host.textContent).toBe('101,489|7,342');
  act(() => root.unmount());
  host.remove();
});
