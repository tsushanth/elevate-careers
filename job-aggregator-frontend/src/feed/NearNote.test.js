import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NearNote from './NearNote';
import { loadNearOff, saveNearOff, loadNearLabel, saveNearLabel, browserTimeZone } from './nearChoice';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); sessionStorage.clear(); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); });
const render = (props) => act(async () => { root.render(<NearNote {...props} />); });
const near = { source: 'ip', regions: ['CA'], label: 'California' };

test('near present: one line naming the place, with a real button that turns it off', async () => {
  const onTurnOff = jest.fn();
  await render({ near, onTurnOff });
  expect(container.textContent).toBe('Showing jobs near California first. Show all jobs equally');
  const b = container.querySelector('button');
  expect(b.type).toBe('button');
  await act(async () => { b.click(); });
  expect(onTurnOff).toHaveBeenCalledTimes(1);
});

test('near absent and not off: renders nothing', async () => {
  await render({});
  expect(container.innerHTML).toBe('');
  await render({ near: { source: 'ip', regions: [], label: '' } });
  expect(container.innerHTML).toBe('');
});

test('off with a remembered label: order-posted wording and the way back', async () => {
  const onTurnOn = jest.fn();
  await render({ off: true, lastLabel: 'California', onTurnOn });
  expect(container.textContent).toBe('Showing jobs in the order posted. Show jobs near California first');
  await act(async () => { container.querySelector('button').click(); });
  expect(onTurnOn).toHaveBeenCalledTimes(1);
});

test('off without a label seen this session: nothing', async () => {
  await render({ off: true, lastLabel: '' });
  expect(container.innerHTML).toBe('');
});

test('off ignores a near the server sent anyway', async () => {
  await render({ near, off: true, lastLabel: '' });
  expect(container.innerHTML).toBe('');
});

test('nearChoice remembers the choice and the label for the session', () => {
  expect(loadNearOff()).toBe(false);
  expect(loadNearLabel()).toBe('');
  saveNearOff(true); saveNearLabel('Texas');
  expect(loadNearOff()).toBe(true);
  expect(loadNearLabel()).toBe('Texas');
  saveNearOff(false); saveNearLabel('');
  expect(loadNearOff()).toBe(false);
  expect(loadNearLabel()).toBe('');
  expect(sessionStorage.length).toBe(0);
});

test('browserTimeZone returns the IANA zone', () => {
  expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});
