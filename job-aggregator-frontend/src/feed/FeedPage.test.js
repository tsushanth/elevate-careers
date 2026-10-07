import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FeedPage from './FeedPage';
import { useFeed } from './useFeed';
import { fetchStats, fetchSuggest } from './feedApi';

jest.mock('./useFeed');
jest.mock('./feedApi');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const job = (id, over = {}) => ({
  id, title: `Job ${id}`, company_name: 'Acme', city: 'Austin', region_code: 'TX', country: 'United States',
  country_code: 'US', remote: false, autofill_ready: true, posted_at: new Date().toISOString(), ...over,
});

const baseFeed = () => ({
  jobs: [], nextCursor: null, count: null, countIsCapped: false, loading: false, loadingMore: false,
  error: null, loaded: true, loadMore: jest.fn(), retry: jest.fn(),
});

let feed;
let container;
let root;
let onSelectJob;

async function mount(props = {}) {
  await act(async () => {
    root.render(
      <FeedPage apiBase="http://api" session={null} selectedJob={null} onSelectJob={onSelectJob}
        detail={<div>DETAIL</div>} extensionUrl="http://ext" {...props} />
    );
  });
}

const text = () => container.textContent;
const button = (label) => [...container.querySelectorAll('button')].find(b => b.textContent === label);

beforeEach(() => {
  localStorage.clear();
  feed = baseFeed();
  useFeed.mockImplementation(() => feed);
  fetchStats.mockResolvedValue({ jobs: 1234, companies: 56, remote: 7 });
  fetchSuggest.mockResolvedValue([]);
  onSelectJob = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  jest.clearAllMocks();
});

const savePlace = (p) => localStorage.setItem('sa_place', JSON.stringify(p));
const lastFilters = () => useFeed.mock.calls[useFeed.mock.calls.length - 1][0].filters;

test('before the first load completes skeletons show and no empty message', async () => {
  feed = { ...baseFeed(), loaded: false, loading: true };
  await mount();
  expect(container.querySelector('.feed-skeleton')).not.toBeNull();
  expect(text()).not.toContain('No jobs match');
});

test('loaded with zero jobs shows the empty copy', async () => {
  await mount();
  expect(text()).toContain('No jobs match. Try a wider place or turn off filters.');
  expect(container.querySelector('.feed-skeleton')).toBeNull();
});

test('error shows message and Retry calls retry', async () => {
  feed = { ...baseFeed(), error: new Error('x') };
  await mount();
  expect(text()).toContain("Couldn't load jobs.");
  expect(text()).not.toContain('No jobs match');
  await act(async () => { button('Retry').click(); });
  expect(feed.retry).toHaveBeenCalledTimes(1);
});

test('cards render; Show more jobs only with a cursor, calls loadMore, shows Loading while loadingMore', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2)] };
  await mount({ selectedJob: job(1) });
  expect(container.querySelectorAll('.feed-card').length).toBe(2);
  expect(button('Show more jobs')).toBeUndefined();

  feed = { ...feed, nextCursor: 'c1' };
  await mount({ selectedJob: job(1) });
  await act(async () => { button('Show more jobs').click(); });
  expect(feed.loadMore).toHaveBeenCalledTimes(1);

  feed = { ...feed, loadingMore: true };
  await mount({ selectedJob: job(1) });
  expect(button('Loading…')).toBeDefined();
  expect(button('Loading…').disabled).toBe(true);
});

test('heading shows count and place, with + when capped', async () => {
  savePlace({ country: 'US', region: '', city: '', label: 'United States' });
  feed = { ...baseFeed(), jobs: [job(1)], count: 1234, countIsCapped: false };
  await mount({ selectedJob: job(1) });
  expect(container.querySelector('.feed-heading').textContent).toBe('1,234 jobs in United States');
  feed = { ...feed, countIsCapped: true };
  await mount({ selectedJob: job(1) });
  expect(container.querySelector('.feed-heading').textContent).toBe('1,234+ jobs in United States');
});

test('clicking a card selects a mapped job and opens the mobile sheet; Back closes it', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2)] };
  await mount({ selectedJob: job(1) });
  const detail = container.querySelector('.feed-detail');
  expect(detail.classList.contains('is-open')).toBe(false);
  await act(async () => { container.querySelectorAll('.feed-card')[1].click(); });
  expect(onSelectJob).toHaveBeenCalledTimes(1);
  const arg = onSelectJob.mock.calls[0][0];
  expect(arg.id).toBe(2);
  expect(arg.cities).toEqual(['Austin']);
  expect(arg.countries).toEqual(['United States']);
  expect(detail.classList.contains('is-open')).toBe(true);
  await act(async () => { button('Back to jobs').click(); });
  expect(detail.classList.contains('is-open')).toBe(false);
});

test('first job is auto-selected once when nothing is selected, not when one is', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2)] };
  await mount();
  expect(onSelectJob).toHaveBeenCalledTimes(1);
  expect(onSelectJob.mock.calls[0][0].id).toBe(1);
  expect(onSelectJob.mock.calls[0][0].cities).toEqual(['Austin']);
  await mount();
  expect(onSelectJob).toHaveBeenCalledTimes(1);

  onSelectJob.mockClear();
  const jobs = [job(1), job(2)];
  feed = { ...baseFeed(), jobs };
  await mount({ selectedJob: job(2) });
  expect(onSelectJob).not.toHaveBeenCalled();
});

test('a guessed place with zero jobs widens to everywhere', async () => {
  await mount();
  expect(lastFilters().place.country).toBe('');
  expect(lastFilters().place.label).toBe('');
});

test('a saved place with zero jobs does not widen', async () => {
  savePlace({ country: 'DE', region: '', city: '', label: 'Germany' });
  await mount();
  expect(lastFilters().place.country).toBe('DE');
  expect(text()).toContain('No jobs match');
});

test('a guessed place with jobs is kept', async () => {
  feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).not.toBe('');
});

test('stats line shows formatted real numbers', async () => {
  await mount();
  expect(text()).toContain('1,234 open jobs from 56 companies');
});

test('nothing is invented when stats fail', async () => {
  fetchStats.mockRejectedValue(new Error('down'));
  await mount();
  expect(container.querySelector('.feed-stats')).toBeNull();
  expect(text()).not.toContain('open jobs from');
});
