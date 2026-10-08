import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PlaceTypeahead from './PlaceTypeahead';
import { fetchSuggest } from './feedApi';
import { EMPTY_PLACE } from './place';

jest.mock('./feedApi');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AUSTIN = { type: 'city', label: 'Austin, TX', country: 'US', region: 'TX', city: 'austin', count: 40 };
const DALLAS = { type: 'city', label: 'Dallas, TX', country: 'US', region: 'TX', city: 'dallas', count: 30 };
const CURRENT = { country: 'GB', region: '', city: '', label: 'United Kingdom' };

let container;
let root;
let onChange;

async function mount(place = CURRENT) {
  await act(async () => {
    root.render(<PlaceTypeahead apiBase="http://api" place={place} onChange={onChange} />);
  });
}

const input = () => container.querySelector('input');
const options = () => [...container.querySelectorAll('[role="option"]')];

async function type(value) {
  await act(async () => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { jest.advanceTimersByTime(130); });
}

async function key(k) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchSuggest.mockResolvedValue([AUSTIN, DALLAS]);
  onChange = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
});

test('typing shows the suggested options', async () => {
  await mount();
  await type('aus');
  expect(fetchSuggest).toHaveBeenCalledWith('http://api', 'aus', expect.anything());
  expect(options().map(o => o.textContent)).toEqual(['Austin, TX40', 'Dallas, TX30']);
});

test('ArrowDown, ArrowUp and Enter choose the highlighted option', async () => {
  await mount();
  await type('aus');
  await key('ArrowDown');
  await key('ArrowDown');
  expect(options()[1].getAttribute('aria-selected')).toBe('true');
  await key('ArrowUp');
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
  await key('Enter');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ country: 'US', region: 'TX', city: 'austin', label: 'Austin, TX' });
  expect(input().value).toBe('Austin, TX');
  expect(options()).toHaveLength(0);
});

test('Enter with no highlighted option chooses the first option', async () => {
  await mount();
  await type('aus');
  await key('Enter');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].label).toBe('Austin, TX');
  expect(input().value).toBe('Austin, TX');
});

test('Enter with no options resets the text to the current place and does not call onChange', async () => {
  fetchSuggest.mockResolvedValue([]);
  await mount();
  await type('zzzz');
  expect(input().value).toBe('zzzz');
  await key('Enter');
  expect(onChange).not.toHaveBeenCalled();
  expect(input().value).toBe('United Kingdom');
});

test('Escape closes the list', async () => {
  await mount();
  await type('aus');
  expect(options()).toHaveLength(2);
  await key('Escape');
  expect(options()).toHaveLength(0);
  expect(onChange).not.toHaveBeenCalled();
});

test('clearing the field calls onChange(EMPTY_PLACE) once', async () => {
  await mount();
  await type('');
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(EMPTY_PLACE);
});

test('blur closes the list after a tick without losing a mouse selection', async () => {
  await mount();
  await type('aus');
  // a click on an option fires mousedown (choose) before the input blurs
  await act(async () => {
    options()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input().blur();
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].label).toBe('Dallas, TX');
  await act(async () => { jest.advanceTimersByTime(130); });
  expect(input().value).toBe('Dallas, TX');
  expect(options()).toHaveLength(0);
});

test('blur alone closes the list after a tick', async () => {
  await mount();
  await type('aus');
  await act(async () => { input().blur(); });
  expect(options()).toHaveLength(2);
  await act(async () => { jest.advanceTimersByTime(130); });
  expect(options()).toHaveLength(0);
});

test('combobox wiring: aria-expanded/controls, activedescendant follows the arrows', async () => {
  await mount();
  expect(input().getAttribute('role')).toBe('combobox');
  expect(input().getAttribute('aria-expanded')).toBe('false');
  await type('aus');
  expect(input().getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('#' + input().getAttribute('aria-controls')).getAttribute('role')).toBe('listbox');
  await key('ArrowDown');
  expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  await key('ArrowDown');
  expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
  await key('ArrowUp');
  expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
});

test('Escape closes the list; ArrowDown reopens it', async () => {
  await mount();
  await type('aus');
  expect(options()).toHaveLength(2);
  await key('Escape');
  expect(options()).toHaveLength(0);
  expect(input().getAttribute('aria-expanded')).toBe('false');
  await key('ArrowDown');
  await act(async () => { jest.advanceTimersByTime(130); });
  expect(options()).toHaveLength(2);
});

test('Enter before the suggestions for the typed text have arrived fetches them and picks the first (does not reset to the old place)', async () => {
  const INDIA = { type: 'country', label: 'India', country: 'IN', region: '', city: '', count: 5000 };
  fetchSuggest.mockResolvedValue([INDIA]);
  await mount();
  await act(async () => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input(), 'India');
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  // no debounce tick yet: no suggestions exist for "India"
  await key('Enter');
  await act(async () => { await Promise.resolve(); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].label).toBe('India');
  expect(input().value).toBe('India');
});

test('Enter with suggestions left over from an earlier keystroke does not choose from the stale list', async () => {
  const INDIANA = { type: 'state', label: 'Indiana, United States', country: 'US', region: 'IN', city: '', count: 900 };
  const INDIA = { type: 'country', label: 'India', country: 'IN', region: '', city: '', count: 5000 };
  fetchSuggest.mockImplementation(async (_b, term) => (term === 'Ind' ? [INDIANA] : [INDIA]));
  await mount();
  await type('Ind');
  expect(options().map(o => o.textContent)).toEqual(['Indiana, United States900']);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input(), 'India');
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await key('Enter');
  await act(async () => { await Promise.resolve(); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].label).toBe('India');
});
