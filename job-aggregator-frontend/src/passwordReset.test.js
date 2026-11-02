import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AuthModal from './AuthModal';
import PasswordRecovery from './PasswordRecovery';
import { isRecoveryHash, resetLinkProblem } from './recovery';

const mockAuth = {
  resetPasswordForEmail: jest.fn(),
  updateUser: jest.fn(),
  signInWithPassword: jest.fn(),
};
jest.mock('./supabase', () => ({ supabase: { get auth() { return mockAuth; } } }));
jest.mock('./track', () => ({ trackFunnel: jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

let host; let root;
beforeEach(() => {
  mockAuth.resetPasswordForEmail.mockReset();
  mockAuth.updateUser.mockReset();
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (el) => { await act(async () => root.render(el)); };
const type = async (selector, value) => act(async () => {
  const el = host.querySelector(selector);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = async () => act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const click = async (text) => act(async () => {
  [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text).click();
});

test('Forgot password? is on the Sign In tab only', async () => {
  await render(<AuthModal onSuccess={() => {}} onClose={() => {}} />);
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Forgot password?')).toBe(true);
  await click('Sign Up');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Forgot password?')).toBe(false);
});

test('forgot view asks Supabase for a reset email with the site as redirect, and answers neutrally', async () => {
  mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  await render(<AuthModal onSuccess={() => {}} onClose={() => {}} />);
  await click('Forgot password?');
  expect(host.querySelector('.auth-title').textContent).toBe('Reset your password');
  await type('#auth-forgot-email', ' me@example.com ');
  await submit();
  expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('me@example.com', { redirectTo: window.location.origin + window.location.pathname });
  expect(host.querySelector('.auth-message').textContent).toMatch(/If an account exists/);
  expect(host.querySelector('.auth-error')).toBeNull();
});

test('forgot view shows the error when Supabase refuses (e.g. rate limit)', async () => {
  mockAuth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'Email rate limit exceeded' } });
  await render(<AuthModal onSuccess={() => {}} onClose={() => {}} initialView="forgot" />);
  await type('#auth-forgot-email', 'me@example.com');
  await submit();
  expect(host.querySelector('.auth-error').textContent).toBe('Email rate limit exceeded');
});

test('Back to sign in returns to the sign-in form', async () => {
  await render(<AuthModal onSuccess={() => {}} onClose={() => {}} initialView="forgot" />);
  await click('Back to sign in');
  expect(host.querySelector('.auth-tab.active').textContent).toBe('Sign In');
});

test('an expired-link notice is shown in the forgot view', async () => {
  await render(<AuthModal onSuccess={() => {}} onClose={() => {}} initialView="forgot" notice="That reset link has expired." />);
  expect(host.querySelector('.auth-message').textContent).toBe('That reset link has expired.');
});

test('PasswordRecovery rejects short and mismatched passwords without calling Supabase', async () => {
  await render(<PasswordRecovery onDone={() => {}} onClose={() => {}} />);
  await type('#recovery-password', 'abc');
  await type('#recovery-confirm', 'abc');
  await submit();
  expect(host.querySelector('.auth-error').textContent).toMatch(/at least 6/);
  await type('#recovery-password', 'abcdef');
  await type('#recovery-confirm', 'abcdeg');
  await submit();
  expect(host.querySelector('.auth-error').textContent).toMatch(/do not match/);
  expect(mockAuth.updateUser).not.toHaveBeenCalled();
});

test('PasswordRecovery calls updateUser, then offers Continue', async () => {
  mockAuth.updateUser.mockResolvedValue({ data: {}, error: null });
  const onDone = jest.fn();
  await render(<PasswordRecovery onDone={onDone} onClose={() => {}} />);
  await type('#recovery-password', 'newpass1');
  await type('#recovery-confirm', 'newpass1');
  await submit();
  expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: 'newpass1' });
  expect(host.querySelector('.auth-title').textContent).toBe('Password updated');
  await click('Continue');
  expect(onDone).toHaveBeenCalled();
});

test('PasswordRecovery shows the error from Supabase and stays on the form', async () => {
  mockAuth.updateUser.mockResolvedValue({ data: null, error: { message: 'New password should be different from the old password.' } });
  await render(<PasswordRecovery onDone={() => {}} onClose={() => {}} />);
  await type('#recovery-password', 'newpass1');
  await type('#recovery-confirm', 'newpass1');
  await submit();
  expect(host.querySelector('.auth-error').textContent).toMatch(/different from the old/);
  expect(host.querySelector('#recovery-password')).not.toBeNull();
});

test('recovery URL parsing', () => {
  expect(isRecoveryHash('#access_token=a&refresh_token=b&type=recovery')).toBe(true);
  expect(isRecoveryHash('#access_token=a&type=signup')).toBe(false);
  expect(isRecoveryHash('')).toBe(false);
  expect(resetLinkProblem('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBe('expired');
  expect(resetLinkProblem('#access_token=a&type=recovery')).toBeNull();
  expect(resetLinkProblem('#jobs')).toBeNull();
});
