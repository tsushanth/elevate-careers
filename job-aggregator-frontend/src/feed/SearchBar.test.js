import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SearchBar from './SearchBar';
import { fetchSuggest } from './feedApi';

jest.mock('./feedApi');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AUSTIN = { type: 'city', label: 'Austin, TX', country: 'US', region: 'TX', city: 'austin', count: 40 };
const CURRENT = { country: 'GB', region: '', city: '', label: 'United Kingdom' };

let container;
let root;
let onSearch;

const placeInput = () => container.querySelector('input[role="combobox"]');

async function typePlace(value) {
  await act(async () => {
    placeInput().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(placeInput(), value);
    placeInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { jest.advanceTimersByTime(130); });
}

const submit = () => act(async () => {
  container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

beforeEach(async () => {
  jest.useFakeTimers();
  onSearch = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<SearchBar apiBase="http://api" q="" place={CURRENT} onSearch={onSearch} />); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('submitting with typed place text and suggestions picks the first suggestion', async () => {
  fetchSuggest.mockResolvedValue([AUSTIN]);
  await typePlace('aus');
  await submit();
  expect(onSearch).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenCalledWith('', expect.objectContaining({ label: 'Austin, TX' }), true);
  expect(placeInput().value).toBe('Austin, TX');
});

test('submitting with typed place text and no suggestions resets the box and keeps the place', async () => {
  fetchSuggest.mockResolvedValue([]);
  await typePlace('zzzz');
  await submit();
  expect(placeInput().value).toBe('United Kingdom');
  expect(onSearch).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenCalledWith('', CURRENT, false);
});

test('submitting with an unchanged place just searches', async () => {
  await submit();
  expect(onSearch).toHaveBeenCalledWith('', CURRENT, false);
});
