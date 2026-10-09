import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FeedPage from './FeedPage';
import { useFeed } from './useFeed';
import { fetchStats, fetchSuggest, fetchRoles } from './feedApi';
import { guessPlace, savePlace as savePlaceSpy } from './place';

jest.mock('./useFeed');
jest.mock('./feedApi');
jest.mock('./place', () => {
  const actual = jest.requireActual('./place');
  return {
    ...actual,
    guessPlace: jest.fn(),
    savePlace: jest.fn(),
  };
});

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
  sessionStorage.clear();
  // CRA sets resetMocks, so implementations are installed per test.
  guessPlace.mockImplementation(() => ({ country: 'US', region: '', city: '', label: 'United States' }));
  savePlaceSpy.mockImplementation((p) => localStorage.setItem('sa_place', JSON.stringify(p)));
  feed = baseFeed();
  useFeed.mockImplementation(({ filters }) => ({ resultFilters: filters, ...feed }));
  fetchStats.mockResolvedValue({ jobs: 1234, companies: 56, remote: 7 });
  fetchSuggest.mockResolvedValue([]);
  fetchRoles.mockResolvedValue([]);
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

const seedSaved = (p) => localStorage.setItem('sa_place', JSON.stringify(p));
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
  seedSaved({ country: 'US', region: '', city: '', label: 'United States' });
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
  seedSaved({ country: 'DE', region: '', city: '', label: 'Germany' });
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

// ---- fix round 1: widening rules and explicit place choice ----
const setInput = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const placesSeen = () => {
  const seen = [];
  useFeed.mock.calls.forEach(([a]) => { if (!seen.includes(a.filters.place)) seen.push(a.filters.place); });
  return seen;
};
const withJobs = () => ({ ...baseFeed(), jobs: [job(1)], count: 1 });

test('guessed place + zero jobs + keyword does NOT widen', async () => {
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  await act(async () => { setInput(container.querySelector('input[type=search]'), 'rust'); });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(lastFilters().q).toBe('rust');
  feed = baseFeed();
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).toBe('US');
});

test('guessed place + zero jobs + a pill on does NOT widen', async () => {
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  await act(async () => { button('Remote').click(); });
  expect(lastFilters().remote).toBe(true);
  feed = baseFeed();
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).toBe('US');
});

test('guessed place + zero jobs + no keyword/pills widens exactly once (no loop)', async () => {
  await mount();
  await mount();
  const seen = placesSeen();
  expect(seen.length).toBe(2);
  expect(seen[0].country).toBe('US');
  expect(seen[1].country).toBe('');
  expect(container.querySelector('.feed-heading')).not.toBeNull();
});

test('choosing the same label as the guess saves it and later empty results do not widen', async () => {
  fetchSuggest.mockResolvedValue([{ type: 'country', label: 'United States', country: 'US', region: '', city: '', count: 5 }]);
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  const input = container.querySelector('input[role=combobox]');
  await act(async () => { input.focus(); setInput(input, 'Uni'); });
  await act(async () => { await new Promise(r => setTimeout(r, 250)); });
  const opt = container.querySelector('[role=option]');
  expect(opt).not.toBeNull();
  await act(async () => { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(savePlaceSpy).toHaveBeenCalledTimes(1);
  expect(savePlaceSpy.mock.calls[0][0].label).toBe('United States');
  feed = baseFeed();
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).toBe('US');
});

test('clearing the field is a user choice of everywhere (saved, no widen)', async () => {
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  const input = container.querySelector('input[role=combobox]');
  await act(async () => { setInput(input, ''); });
  expect(savePlaceSpy).toHaveBeenCalledTimes(1);
  expect(savePlaceSpy.mock.calls[0][0].country).toBe('');
  expect(lastFilters().place.country).toBe('');
});

test('combobox exposes active option id and only sets aria-controls while the list is shown', async () => {
  fetchSuggest.mockResolvedValue([{ type: 'country', label: 'Canada', country: 'CA', region: '', city: '', count: 3 }]);
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  const input = container.querySelector('input[role=combobox]');
  expect(input.hasAttribute('aria-controls')).toBe(false);
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  await act(async () => { input.focus(); setInput(input, 'Can'); });
  await act(async () => { await new Promise(r => setTimeout(r, 250)); });
  const opt = container.querySelector('[role=option]');
  expect(opt.id).toBeTruthy();
  expect(input.getAttribute('aria-controls')).toBe('feed-place-list');
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(input.getAttribute('aria-activedescendant')).toBe(opt.id);
});

test('widen ignores a stale empty result: keyword cleared while the hook still holds the old refined result', async () => {
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  await act(async () => { setInput(container.querySelector('input[type=search]'), 'rust'); });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const refined = lastFilters();
  expect(refined.q).toBe('rust');
  // refined query came back empty: no widen
  useFeed.mockImplementation(() => ({ ...baseFeed(), resultFilters: refined }));
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).toBe('US');
  // keyword cleared; the hook still reports the OLD empty result for the OLD filters
  await act(async () => { setInput(container.querySelector('input[type=search]'), ''); });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(lastFilters().q).toBe('');
  expect(lastFilters().place.country).toBe('US');
  // the unrefined result lands (empty, for the current filters): now it widens, once
  const current = lastFilters();
  useFeed.mockImplementation(() => ({ ...baseFeed(), resultFilters: current }));
  await mount({ selectedJob: job(1) });
  expect(lastFilters().place.country).toBe('');
  expect(placesSeen().filter(p => p.country === '').length).toBe(1);
});

test('Enter with no highlighted option chooses the first option (was: did nothing, leaving typed text that disagreed with the place)', async () => {
  fetchSuggest.mockResolvedValue([{ type: 'country', label: 'Canada', country: 'CA', region: '', city: '', count: 3 }]);
  feed = withJobs();
  await mount({ selectedJob: job(1) });
  const input = container.querySelector('input[role=combobox]');
  await act(async () => { input.focus(); setInput(input, 'Can'); });
  await act(async () => { await new Promise(r => setTimeout(r, 250)); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(savePlaceSpy).toHaveBeenCalledTimes(1);
  expect(savePlaceSpy.mock.calls[0][0]).toMatchObject({ country: 'CA', label: 'Canada' });
  expect(input.value).toBe('Canada');
});

describe('externalQuery (Growth tab links)', () => {
  test('initial n=0 leaves q empty; a new n applies the keyword', async () => {
    await mount({ externalQuery: { q: '', n: 0 } });
    expect(lastFilters().q).toBe('');
    await mount({ externalQuery: { q: 'react', n: 1 } });
    expect(lastFilters().q).toBe('react');
  });

  test('re-rendering with the same n does not reset a q the user has since edited', async () => {
    await mount({ externalQuery: { q: 'react', n: 1 } });
    expect(lastFilters().q).toBe('react');
    const input = container.querySelector('input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'python');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await mount({ externalQuery: { q: 'react', n: 1 } });
    expect(lastFilters().q).not.toBe('react');
  });

  test('a new click (n=2) re-applies even the same keyword', async () => {
    await mount({ externalQuery: { q: 'react', n: 1 } });
    // the user changes the query away, via the controlled SearchBar callback path
    const input = container.querySelector('input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'go');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(lastFilters().q).toBe('go');
    await mount({ externalQuery: { q: 'react', n: 2 } });
    expect(lastFilters().q).toBe('react');
  });
});

describe('mobile sheet accessibility', () => {
  const setMobile = (matches) => {
    window.matchMedia = jest.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
  };
  const keydown = (k, opts = {}) => act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
  const openSheet = async () => {
    feed = { ...baseFeed(), jobs: [job(1), job(2)] };
    await mount({ selectedJob: job(1), detail: <a href="#x" id="detail-link">Apply</a> });
    const card = container.querySelectorAll('.feed-card')[1];
    card.focus();
    await act(async () => { card.click(); });
    return card;
  };
  afterEach(() => { delete window.matchMedia; document.body.style.overflow = ''; });

  test('opening makes it a labelled modal dialog and moves focus in', async () => {
    setMobile(true);
    await openSheet();
    const d = container.querySelector('.feed-detail');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toBe('Job details');
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('Escape closes, restores focus to the opener and releases scroll lock', async () => {
    setMobile(true);
    const card = await openSheet();
    await keydown('Escape');
    expect(container.querySelector('.feed-detail').classList.contains('is-open')).toBe(false);
    expect(container.querySelector('.feed-detail').hasAttribute('role')).toBe(false);
    expect(document.activeElement).toBe(card);
    expect(document.body.style.overflow).toBe('');
  });

  test('Tab wraps within the sheet in both directions', async () => {
    setMobile(true);
    await openSheet();
    const back = button('Back to jobs');
    const link = container.querySelector('#detail-link');
    link.focus();
    await keydown('Tab');
    expect(document.activeElement).toBe(back);
    await keydown('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(link);
  });

  test('unmounting while open releases the scroll lock', async () => {
    setMobile(true);
    await openSheet();
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => root.unmount());
    expect(document.body.style.overflow).toBe('');
    root = createRoot(container);
  });

  test('on desktop widths it is not a modal and does not lock scroll', async () => {
    setMobile(false);
    await openSheet();
    const d = container.querySelector('.feed-detail');
    expect(d.hasAttribute('role')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('selection always belongs to the visible list', () => {
  const setMobile = (matches) => {
    window.matchMedia = jest.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));
  };
  afterEach(() => { delete window.matchMedia; });

  test('a selected job that is not in the loaded list (restored from session, or dropped by exclusions) is replaced by the first job', async () => {
    feed = { ...baseFeed(), jobs: [job(2), job(3)] };
    await mount({ selectedJob: job(1, { title: 'Spotify role' }) });
    expect(onSelectJob).toHaveBeenCalledTimes(1);
    expect(onSelectJob.mock.calls[0][0].id).toBe(2);
  });

  test('a signed-in refetch that drops the auto-selected job reselects the new first job', async () => {
    feed = { ...baseFeed(), jobs: [job(1), job(2)] };
    await mount();
    expect(onSelectJob.mock.calls[0][0].id).toBe(1);
    onSelectJob.mockClear();
    feed = { ...baseFeed(), jobs: [job(2), job(3)] };
    await mount({ selectedJob: job(1) });
    expect(onSelectJob).toHaveBeenCalledTimes(1);
    expect(onSelectJob.mock.calls[0][0].id).toBe(2);
  });

  test('a selected job still in the list is left alone, even if not first', async () => {
    feed = { ...baseFeed(), jobs: [job(2), job(1)] };
    await mount({ selectedJob: job(1) });
    expect(onSelectJob).not.toHaveBeenCalled();
  });

  test('while a refetch is in flight the stale list does not trigger a reselect', async () => {
    feed = { ...baseFeed(), jobs: [job(2)], loading: true };
    await mount({ selectedJob: job(1) });
    expect(onSelectJob).not.toHaveBeenCalled();
  });

  test('an explicitly clicked job stays shown after the list drops it', async () => {
    feed = { ...baseFeed(), jobs: [job(1), job(2)] };
    await mount({ selectedJob: job(1) });
    await act(async () => { container.querySelectorAll('.feed-card')[1].click(); });
    onSelectJob.mockClear();
    feed = { ...baseFeed(), jobs: [job(1), job(3)] };
    await mount({ selectedJob: job(2) });
    expect(onSelectJob).not.toHaveBeenCalled();
  });

  test('mobile: a stale selection is not replaced and the sheet does not open', async () => {
    setMobile(true);
    feed = { ...baseFeed(), jobs: [job(2), job(3)] };
    await mount({ selectedJob: job(1) });
    expect(onSelectJob).not.toHaveBeenCalled();
    expect(container.querySelector('.feed-detail').classList.contains('is-open')).toBe(false);
  });
});

test('jobs applied to leave the list at once, and the detail pane moves to the next job', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2), job(3)], count: 3 };
  await mount({ appliedJobIds: new Set([1]) });
  const titles = [...container.querySelectorAll('.feed-card-title')].map(n => n.textContent);
  expect(titles).toEqual(['Job 2', 'Job 3']);
  expect(onSelectJob).toHaveBeenCalledTimes(1);
  expect(onSelectJob.mock.calls[0][0].id).toBe(2);
});

test('an applied job that is the explicitly opened one stays in the detail pane but not in the list', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2)], count: 2 };
  const sel = job(2);
  await mount({ selectedJob: sel, appliedJobIds: new Set() });
  await act(async () => { container.querySelectorAll('.feed-card')[1].click(); });
  onSelectJob.mockClear();
  await mount({ selectedJob: sel, appliedJobIds: new Set([2]) });
  expect([...container.querySelectorAll('.feed-card-title')].map(n => n.textContent)).toEqual(['Job 1']);
  expect(onSelectJob).not.toHaveBeenCalled();
});

test('opening a job dims it and the choice is remembered', async () => {
  feed = { ...baseFeed(), jobs: [job(1), job(2)], count: 2 };
  await mount({ selectedJob: job(1) });
  expect(container.querySelectorAll('.is-viewed')).toHaveLength(0);
  await act(async () => { container.querySelectorAll('.feed-card')[1].click(); });
  expect(container.querySelectorAll('.is-viewed')).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('sa_viewed'))).toEqual([2]);
});

describe('saved preferences note', () => {
  const session = { access_token: 't' };
  beforeEach(() => sessionStorage.clear());

  test('signed in with the preference-filtered default list: note shows, Show all jobs sends prefs=off and is remembered', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied' };
    await mount({ session, selectedJob: job(1) });
    expect(text()).toContain('Showing jobs that match your preferences.');
    expect(lastFilters().prefsOff).toBe(false);
    await act(async () => { button('Show all jobs').click(); });
    expect(lastFilters().prefsOff).toBe(true);
    expect(sessionStorage.getItem('sa_prefs_off')).toBe('1');
  });

  test('the choice survives a remount in the same session and offers the way back', async () => {
    sessionStorage.setItem('sa_prefs_off', '1');
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'off' };
    await mount({ session, selectedJob: job(1) });
    expect(lastFilters().prefsOff).toBe(true);
    expect(text()).toContain('Showing all jobs.');
    await act(async () => { button('Use my preferences').click(); });
    expect(lastFilters().prefsOff).toBe(false);
    expect(sessionStorage.getItem('sa_prefs_off')).toBeNull();
  });

  test('no saved preferences, or anonymous: no note', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
    await mount({ session, selectedJob: job(1) });
    expect(container.querySelector('.feed-prefs-note')).toBeNull();
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied' };
    await mount({ session: null, selectedJob: job(1) });
    expect(container.querySelector('.feed-prefs-note')).toBeNull();
  });

  test('no note while a refetch for different filters is still in flight', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied' };
    useFeed.mockImplementation(() => ({ resultFilters: {}, ...feed }));
    await mount({ session, selectedJob: job(1) });
    expect(container.querySelector('.feed-prefs-note')).toBeNull();
  });
});

describe('role filter', () => {
  const ROLES = [{ slug: 'software-engineering', label: 'Software engineering' }, { slug: 'design', label: 'Design' }];
  const roleSel = () => container.querySelector('select[aria-label="Role"]');
  const pick = (value) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(roleSel(), value);
    roleSel().dispatchEvent(new Event('change', { bubbles: true }));
  });
  beforeEach(() => { fetchRoles.mockResolvedValue(ROLES); });

  test('no roles: no control and no role in the filters', async () => {
    fetchRoles.mockResolvedValue([]);
    await mount();
    expect(roleSel()).toBeNull();
    expect(lastFilters().role).toBe('');
  });

  test('a failed roles request leaves no control and no role param, silently', async () => {
    fetchRoles.mockRejectedValue(new Error('down'));
    localStorage.setItem('sa_role', 'design');
    await mount();
    expect(roleSel()).toBeNull();
    expect(lastFilters().role).toBe('');
    expect(container.querySelector('.feed-error')).toBeNull();
  });

  test('choosing a role puts it in the filters, remembers it, and All roles clears it', async () => {
    await mount();
    expect(roleSel()).not.toBeNull();
    await pick('design');
    expect(lastFilters().role).toBe('design');
    expect(localStorage.getItem('sa_role')).toBe('design');
    await pick('');
    expect(lastFilters().role).toBe('');
    expect(localStorage.getItem('sa_role')).toBeNull();
  });

  test('a saved role is applied from the first request and selected once roles load', async () => {
    localStorage.setItem('sa_role', 'design');
    await mount();
    expect(useFeed.mock.calls[0][0].filters.role).toBe('design');
    expect(roleSel().value).toBe('design');
  });

  test('a saved role missing from the list is dropped', async () => {
    localStorage.setItem('sa_role', 'retired');
    await mount();
    expect(lastFilters().role).toBe('');
    expect(localStorage.getItem('sa_role')).toBeNull();
  });

  test('the owner callback for a 400 invalid role drops the saved slug', async () => {
    localStorage.setItem('sa_role', 'design');
    fetchRoles.mockReturnValue(new Promise(() => {}));   // list still pending
    await mount();
    expect(lastFilters().role).toBe('design');
    await act(async () => { useFeed.mock.calls[useFeed.mock.calls.length - 1][0].onInvalidRole('design'); });
    expect(lastFilters().role).toBe('');
    expect(localStorage.getItem('sa_role')).toBeNull();
  });

  test('heading names the role', async () => {
    localStorage.setItem('sa_role', 'software-engineering');
    feed = { ...baseFeed(), count: 1203 };
    await mount();
    expect(container.querySelector('.feed-heading').textContent).toBe('1,203 Software engineering jobs in United States');
  });

  test('a chosen role hides the profile match wording', async () => {
    const session = { access_token: 't' };
    const match = { source: 'profile', roleSlug: null, roleLabel: null, labels: ['Software Engineer'] };
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied', match };
    await mount({ session, selectedJob: job(1) });
    expect(text()).toContain('matched to your profile: Software Engineer.');
    await pick('design');
    expect(text()).not.toContain('matched to your profile');
  });

  test('switching off a profile match offers Use my profile', async () => {
    sessionStorage.clear();
    const session = { access_token: 't' };
    const match = { source: 'profile', roleSlug: null, roleLabel: null, labels: ['Software Engineer'] };
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied', match };
    await mount({ session, selectedJob: job(1) });
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'off' };
    await act(async () => { button('Show all jobs').click(); });
    expect(button('Use my profile')).toBeDefined();
  });
});

describe('near-you note', () => {
  const near = { source: 'ip', regions: ['CA'], label: 'California' };
  const noteEls = () => [...container.querySelectorAll('.feed-notes > p')].map(p => p.textContent);

  test('shown when the response has near; the heading and list are unchanged', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, near };
    await mount({ selectedJob: job(1) });
    expect(noteEls()).toEqual(['Showing jobs near California first. Show all jobs equally']);
    expect(container.querySelector('.feed-heading').textContent).toBe('1 jobs in United States');
    expect(lastFilters().nearOff).toBe(false);
  });

  test('absent in the response: nothing, and the notes row takes no space', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
    await mount({ selectedJob: job(1) });
    expect(container.querySelector('.feed-near-note')).toBeNull();
    expect(container.querySelector('.feed-notes').children.length).toBe(0);
  });

  test('not shown for a list that is still being replaced', async () => {
    useFeed.mockImplementation(() => ({ ...baseFeed(), jobs: [job(1)], count: 1, near, resultFilters: {} }));
    await mount({ selectedJob: job(1) });
    expect(container.querySelector('.feed-near-note')).toBeNull();
  });

  test('Show all jobs equally sets nearOff, remembers it for the session and the label for the way back', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, near };
    await mount({ selectedJob: job(1) });
    feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
    await act(async () => { button('Show all jobs equally').click(); });
    expect(lastFilters().nearOff).toBe(true);
    expect(sessionStorage.getItem('sa_near_off')).toBe('1');
    expect(noteEls()).toEqual(['Showing jobs in the order posted. Show jobs near California first']);
    await act(async () => { button('Show jobs near California first').click(); });
    expect(lastFilters().nearOff).toBe(false);
    expect(sessionStorage.getItem('sa_near_off')).toBeNull();
  });

  test('off from the start with no label seen this session: no note', async () => {
    sessionStorage.setItem('sa_near_off', '1');
    feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
    await mount({ selectedJob: job(1) });
    expect(lastFilters().nearOff).toBe(true);
    expect(container.querySelector('.feed-near-note')).toBeNull();
  });

  test('off after a reload still offers the way back from the stored label', async () => {
    sessionStorage.setItem('sa_near_off', '1');
    sessionStorage.setItem('sa_near_label', 'Texas');
    feed = { ...baseFeed(), jobs: [job(1)], count: 1 };
    await mount({ selectedJob: job(1) });
    expect(noteEls()).toEqual(['Showing jobs in the order posted. Show jobs near Texas first']);
  });

  test('near and tz are not visible filters: nothing but nearOff changes the filters object', async () => {
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, near };
    await mount({ selectedJob: job(1) });
    const before = lastFilters();
    await mount({ selectedJob: job(1) });
    expect(lastFilters()).toBe(before);
    expect(Object.keys(before)).not.toContain('near');
    expect(Object.keys(before)).not.toContain('tz');
  });

  test('coexists with the profile note: both stack in one notes row, each with its own button', async () => {
    const match = { source: 'profile', roleSlug: null, roleLabel: null, labels: ['Software Engineer'] };
    feed = { ...baseFeed(), jobs: [job(1)], count: 1, prefs: 'applied', match, near };
    await mount({ session: { access_token: 't' }, selectedJob: job(1) });
    expect(noteEls()).toEqual([
      'Showing jobs matched to your profile: Software Engineer. Show all jobs',
      'Showing jobs near California first. Show all jobs equally',
    ]);
    await act(async () => { button('Show all jobs equally').click(); });
    expect(lastFilters().nearOff).toBe(true);
    expect(lastFilters().prefsOff).toBe(false);
  });
});
