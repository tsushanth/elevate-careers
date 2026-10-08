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
