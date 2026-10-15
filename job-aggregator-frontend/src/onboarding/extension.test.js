import { isExtensionInstalled, canInstallExtension, watchExtension, browserLabel } from './extension';
import { shouldAutoOpen } from './trigger';
import { hasStoredSession } from './storedSession';
import { trackOnboarding, ONBOARDING_STEPS } from './constants';

test('marker on <html> means installed', () => {
  document.documentElement.removeAttribute('data-simplyapply-ext');
  expect(isExtensionInstalled(document)).toBe(false);
  document.documentElement.setAttribute('data-simplyapply-ext', '1.7.0');
  expect(isExtensionInstalled(document)).toBe(true);
  document.documentElement.removeAttribute('data-simplyapply-ext');
});

test('browser capability and honest labels', () => {
  const chrome = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537' };
  expect(canInstallExtension(chrome)).toBe(true);
  expect(canInstallExtension({ userAgent: 'Mozilla/5.0 Firefox/130.0' })).toBe(false);
  expect(canInstallExtension({ userAgent: 'Mozilla/5.0 (Macintosh) Version/17 Safari/605' })).toBe(false);
  expect(canInstallExtension({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' })).toBe(false);
  expect(browserLabel({ userAgent: 'Firefox/130.0' })).toBe('Firefox');
  expect(browserLabel({ userAgent: 'Version/17 Safari/605' })).toBe('Safari');
});

test('watchExtension fires when the marker appears and stops', () => {
  jest.useFakeTimers();
  const cb = jest.fn();
  const stop = watchExtension(cb, { doc: document, intervalMs: 100 });
  jest.advanceTimersByTime(300);
  expect(cb).not.toHaveBeenCalled();
  document.documentElement.setAttribute('data-simplyapply-ext', '2');
  jest.advanceTimersByTime(150);
  expect(cb).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  expect(cb).toHaveBeenCalledTimes(1);
  stop();
  document.documentElement.removeAttribute('data-simplyapply-ext');
  jest.useRealTimers();
});

test('shouldAutoOpen: only when profile positively missing and not seen', async () => {
  const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
  const base = { uid: 'u', token: 't', storage: mem(), enabled: true };
  expect(await shouldAutoOpen({ ...base, fetchProfileImpl: async () => null })).toBe(true);
  expect(await shouldAutoOpen({ ...base, fetchProfileImpl: async () => ({ firstName: 'A' }) })).toBe(false);
  expect(await shouldAutoOpen({ ...base, fetchProfileImpl: async () => undefined })).toBe(false);
  expect(await shouldAutoOpen({ ...base, enabled: false, fetchProfileImpl: async () => null })).toBe(false);
  const seen = mem(); seen.setItem('sa_ob_seen_u', '1');
  expect(await shouldAutoOpen({ ...base, storage: seen, fetchProfileImpl: async () => null })).toBe(false);
});

test('hasStoredSession detects supabase token keys', () => {
  const mk = (keys) => ({ length: keys.length, key: (i) => keys[i], getItem: () => '{"a":1}' });
  expect(hasStoredSession(mk(['sb-abc-auth-token']))).toBe(true);
  expect(hasStoredSession(mk(['other']))).toBe(false);
});

test('trackOnboarding only emits allowlisted step names, nothing else', () => {
  const t = jest.fn();
  expect(trackOnboarding('resume_parsed', t)).toBe(true);
  expect(t).toHaveBeenCalledWith('onboarding_step', { step: 'resume_parsed' });
  expect(trackOnboarding('my resume says Jane', t)).toBe(false);
  expect(t).toHaveBeenCalledTimes(1);
  expect(ONBOARDING_STEPS).toEqual(['resume_shown', 'resume_parsed', 'profile_saved', 'install_shown', 'install_clicked', 'preview_shown', 'done', 'skipped']);
});
