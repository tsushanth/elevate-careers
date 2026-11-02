import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AuthModal from './AuthModal';
import { resetSiteStats } from './siteStats';

jest.mock('./supabase', () => ({ supabase: { auth: {} } }));
jest.mock('./track', () => ({ trackFunnel: jest.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const open = (props) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<AuthModal onSuccess={() => {}} onClose={() => {}} {...props} />));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
};

beforeEach(() => { resetSiteStats(); global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })); });

test('opens on Sign In by default and on Sign Up when asked', () => {
  const a = open({});
  expect(a.host.querySelector('.auth-tab.active').textContent).toBe('Sign In');
  a.done();
  const b = open({ initialTab: 'signup' });
  expect(b.host.querySelector('.auth-tab.active').textContent).toBe('Sign Up');
  expect(b.host.querySelector('.auth-submit').textContent).toBe('Create Account');
  b.done();
});

const subtitle = (host) => host.querySelector('.auth-subtitle').textContent;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test('sign-up subtitle has no number until /v2/stats answers, then shows the live counts', async () => {
  resetSiteStats();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ jobs: 101489, remote: 8784, companies: 7342 }) }));
  const a = open({ initialTab: 'signup' });
  expect(subtitle(a.host)).not.toMatch(/\d/);
  await settle();
  expect(subtitle(a.host)).toMatch(/^101,489 open jobs from 7,342 companies/);
  a.done();
});

test('sign-up subtitle stays number-free when /v2/stats fails', async () => {
  resetSiteStats();
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const a = open({ initialTab: 'signup' });
  await settle();
  expect(subtitle(a.host)).toMatch(/^Real jobs from company career pages/);
  expect(subtitle(a.host)).not.toMatch(/\d/);
  a.done();
});
