import { describe, it, expect, vi, afterEach } from 'vitest';

// Regression: with a reporter key in the environment the reporter posted from any test (no sink set) unless NODE_ENV was exactly
// 'test', so a test run with NODE_ENV unset or overridden posted fake errors to the live reporter.
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('failure reporter under the test runner', () => {
  it('never posts with a key set and NODE_ENV=production', async () => {
    expect(process.env.VITEST).toBeTruthy(); // sanity: running under vitest
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FAILURE_REPORTER_KEY', 'test-key');
    vi.stubEnv('FAILURE_REPORTER_DISABLED', '');
    vi.stubEnv('FAILURE_REPORTER_FORCE', '');
    const { reportFailure, reportBackendError, reportCrash, _setSink } = await import('./failureReporter.js');
    _setSink(null);
    reportFailure('x', new Error('must not leave the process'));
    reportBackendError('x', new Error('nor this'));
    await reportCrash('x', new Error('nor this either'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
