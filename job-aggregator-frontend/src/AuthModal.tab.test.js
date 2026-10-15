import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AuthModal from './AuthModal';

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

test('opens on Sign In by default and on Sign Up when asked', () => {
  const a = open({});
  expect(a.host.querySelector('.auth-tab.active').textContent).toBe('Sign In');
  a.done();
  const b = open({ initialTab: 'signup' });
  expect(b.host.querySelector('.auth-tab.active').textContent).toBe('Sign Up');
  expect(b.host.querySelector('.auth-submit').textContent).toBe('Create Account');
  b.done();
});
