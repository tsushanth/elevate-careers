/**
 * Sends failures to the unified app-failure-reporter Worker (dedupes per fingerprint per hour, emails the owner).
 * Fire-and-forget: never throws, never blocks. Needs FAILURE_REPORTER_KEY (the reporter's per-app key) - without it every call
 * is a no-op, so nothing breaks before the key is provisioned. Silent under NODE_ENV=test unless a test sets a sink.
 * Never pass user content (job titles, resumes, answers, emails, user ids) as message or context: stable messages per class only.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const APP_VERSION = process.env.FLY_IMAGE_REF || process.env.npm_package_version || 'unknown';

let sink = null;
/** Tests only: capture reports instead of sending. */
export function _setSink(fn) { sink = fn; }

async function post(kind, flow, err, context, timeoutMs) {
  const e = err instanceof Error ? err : new Error(String(err));
  if (sink) { sink({ kind, flow, message: e.message, context }); return; }
  const key = process.env.FAILURE_REPORTER_KEY;
  if (!key || process.env.FAILURE_REPORTER_DISABLED === '1' || process.env.NODE_ENV === 'test') return;
  // Test runners (node --test, vitest, jest) never post; FAILURE_REPORTER_FORCE=1 overrides, for the reporter's own tests.
  if ((process.env.VITEST || process.env.JEST_WORKER_ID || process.env.NODE_TEST_CONTEXT) && process.env.FAILURE_REPORTER_FORCE !== '1') return;
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': key },
      body: JSON.stringify({ kind, platform: 'backend', version: APP_VERSION, flow, message: e.message || e.name, stack: e.stack ?? '', context }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

export function reportFailure(flow, err, context = {}) { void post('failure', flow, err, context, 5000); }
export function reportBackendError(flow, err, context = {}) { void post('backend_error', flow, err, context, 5000); }
/** Process is about to die: await this before process.exit so the email actually goes out. */
export function reportCrash(flow, err) { return post('crash', flow, err, {}, 2500); }

export function installCrashHandlers() {
  for (const evt of ['uncaughtException', 'unhandledRejection']) {
    process.on(evt, (err) => {
      console.error(evt, err);
      reportCrash(evt, err).finally(() => process.exit(1));
    });
  }
}

/** Reports any 5xx nobody reported (routes that catch and answer 500 themselves). flow = method + route pattern, message = status. */
export function serverErrorReport() {
  return (req, res, next) => {
    res.on('finish', () => {
      try {
        if (res.statusCode < 500 || res.locals?.failureReported) return;
        if (req.path === '/health' || req.path === '/health/deep') return; // probed separately
        const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : '(unmatched)';
        res.locals.failureReported = true;
        reportBackendError(`${req.method} ${route}`, new Error(`HTTP ${res.statusCode}`), { status: String(res.statusCode) });
      } catch { /* never affect a response */ }
    });
    next();
  };
}
