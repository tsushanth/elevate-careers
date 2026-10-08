import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PrefsNote from './PrefsNote';
import { loadPrefsOff, savePrefsOff } from './prefsChoice';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); sessionStorage.clear(); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });
const render = (props) => act(async () => { root.render(<PrefsNote {...props} />); });

test('applied: one-line note with a Show all jobs button', async () => {
  const onShowAll = jest.fn();
  await render({ status: 'applied', onShowAll });
  expect(container.textContent).toBe('Showing jobs that match your preferences. Show all jobs');
  await act(async () => { container.querySelector('button').click(); });
  expect(onShowAll).toHaveBeenCalledTimes(1);
});

test('off: offers the way back', async () => {
  const onUsePreferences = jest.fn();
  await render({ status: 'off', onUsePreferences });
  expect(container.textContent).toContain('Showing all jobs.');
  await act(async () => { container.querySelector('button').click(); });
  expect(onUsePreferences).toHaveBeenCalledTimes(1);
});

test('no preferences (status undefined): renders nothing', async () => {
  await render({});
  expect(container.innerHTML).toBe('');
});

test('prefsChoice remembers the choice for the session and clears it', () => {
  expect(loadPrefsOff()).toBe(false);
  savePrefsOff(true);
  expect(loadPrefsOff()).toBe(true);
  savePrefsOff(false);
  expect(loadPrefsOff()).toBe(false);
});

describe('profile match wording', () => {
  const match = (labels, source = 'profile') => ({ source, roleSlug: null, roleLabel: null, labels });

  test('names the matched labels and keeps the Show all jobs button', async () => {
    const onShowAll = jest.fn();
    await render({ status: 'applied', match: match(['Software Engineer', 'Full-Stack', 'Reinforcement Learning']), onShowAll });
    expect(container.textContent).toBe('Showing jobs matched to your profile: Software Engineer, Full-Stack, Reinforcement Learning. Show all jobs');
    await act(async () => { container.querySelector('button').click(); });
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  test('more than three labels are cut with +N more', async () => {
    await render({ status: 'applied', match: match(['A', 'B', 'C', 'D', 'E']) });
    expect(container.textContent).toContain('A, B, C +2 more.');
  });

  test('soft preferences only (no match, or a non-profile match): today wording', async () => {
    await render({ status: 'applied' });
    expect(container.textContent).toBe('Showing jobs that match your preferences. Show all jobs');
    await render({ status: 'applied', match: match(['X'], 'role') });
    expect(container.textContent).toBe('Showing jobs that match your preferences. Show all jobs');
    await render({ status: 'applied', match: match([]) });
    expect(container.textContent).toContain('match your preferences.');
  });

  test('off: the way back names the profile only when the switched-off list was a profile match', async () => {
    await render({ status: 'off', hadProfile: true });
    expect(container.querySelector('button').textContent).toBe('Use my profile');
    await render({ status: 'off' });
    expect(container.querySelector('button').textContent).toBe('Use my preferences');
  });
});
