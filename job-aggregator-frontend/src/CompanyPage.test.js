import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CompanyPage from './CompanyPage';

jest.mock('react-router-dom', () => ({ useParams: () => ({ slug: 'acme' }), useNavigate: () => () => {} }), { virtual: true });
jest.mock('./supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null } }) } } }));
jest.mock('./track', () => ({ trackFunnel: jest.fn() }));
jest.mock('./descriptionHtml', () => ({ descriptionToSafeHtml: (s) => s }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const jobs = [
  { id: 1, title: 'First role', apply_url: 'https://example.com/1' },
  { id: 2, title: 'Second role', apply_url: 'https://example.com/2' },
];
let container;
let root;
let scrolled;

async function open(narrow) {
  window.matchMedia = () => ({ matches: narrow });
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () => (url.endsWith('/jobs') ? { jobs } : { name: 'Acme', open_jobs: 2 }),
  }));
  await act(async () => { root.render(<CompanyPage />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const tapSecondRole = () => act(async () => {
  [...container.querySelectorAll('.company-job-list > div')][1].click();
});

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.className); };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('on a phone, tapping a role brings its detail and apply button into view', async () => {
  await open(true);
  await tapSecondRole();
  expect(container.querySelector('.company-job-detail h2').textContent).toBe('Second role');
  expect(scrolled).toEqual(['company-job-detail']);
});

test('on a wide screen the page does not jump', async () => {
  await open(false);
  await tapSecondRole();
  expect(scrolled).toEqual([]);
});

test('the layout is one column on narrow screens', () => {
  const css = fs.readFileSync(path.join(__dirname, 'CompanyPage.css'), 'utf8');
  expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.company-jobs \{ grid-template-columns: minmax\(0, 1fr\)/);
});
