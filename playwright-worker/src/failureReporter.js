/**
 * Sends backend failures to the central app-failure-reporter Worker (dedupes per fingerprint per hour, emails).
 * Fire-and-forget: never throws, never blocks. Silent unless NODE_ENV=production, and always when FAILURE_REPORTER_DISABLED=1.
 * Never pass user content (ids, emails, resume text, job text) as message or context. Messages must be STABLE per
 * failure class (the Worker fingerprints on them): put variable detail in context, never in the message.
 * NEEDS a reporter key for app "elevatecareers" (APP_KEYS in the Worker + `fly secrets set FAILURE_REPORTER_KEY=...`
 * on elevate-careers-api, elevate-careers-worker and elevate-playwright-worker). Until then reports are 401'd and dropped.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const KEY = () => process.env.FAILURE_REPORTER_KEY || 'elevatecareers';
const VERSION = process.env.FLY_IMAGE_REF || process.env.npm_package_version || 'unknown';
const isDisabled = () =>
  process.env.FAILURE_REPORTER_DISABLED === '1' || process.env.NODE_ENV !== 'production'
  // Test runners (node --test, vitest, jest) never post; FAILURE_REPORTER_FORCE=1 overrides, for the reporter's own tests.
  || !!((process.env.VITEST || process.env.JEST_WORKER_ID || process.env.NODE_TEST_CONTEXT) && process.env.FAILURE_REPORTER_FORCE !== '1');

async function post(kind, flow, err, context, timeoutMs) {
  if (isDisabled()) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': KEY() },
      body: JSON.stringify({
        kind, platform: 'backend', version: VERSION, flow,
        message: e.message || e.name, stack: e.stack || '', context,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** A handled 5xx. Pass the ROUTE PATTERN (req.route.path) rather than the raw URL so ids never leak. */
export function reportBackendError(method, path, err, statusCode) {
  if (statusCode < 500) return;
  void post('backend_error', `${method} ${path}`, err, { status: String(statusCode) }, 5000);
}

/** A background job / queue / cron failed. `message` is a stable string per class. */
export function reportFailure(flow, message, context = {}) {
  void post('failure', flow, new Error(message), context, 5000);
}

/** Process is about to die: await before process.exit so the email goes out. */
export function reportCrash(flow, err) {
  return post('crash', flow, err, {}, 2500);
}

/**
 * Provider-wide failures (credit exhausted, bad key, rate limit) become ONE stable alert per provider+class,
 * regardless of which call site hit it. Returns the class or null if the error is not provider-wide.
 */
export function classifyProviderError(err) {
  const status = err?.status ?? err?.response?.status;
  const text = String(err?.message || '').toLowerCase();
  if (/credit balance|billing|insufficient[_ ]quota|quota exceeded|payment required/.test(text) || status === 402) return 'credit_or_quota_exhausted';
  if (status === 401 || status === 403 || /invalid x-api-key|invalid api key|authentication/.test(text)) return 'auth_rejected';
  if (status === 429 && /quota|limit/.test(text)) return 'rate_or_quota_limited';
  return null;
}

export function reportProviderError(provider, err) {
  const cls = classifyProviderError(err);
  if (!cls) return null;
  reportFailure(`provider:${provider}`, `${provider} provider failure: ${cls}`, { provider, class: cls, status: String(err?.status ?? '') });
  return cls;
}

/** Wrap an Anthropic client so every messages.create failure that is provider-wide raises the single alert. */
export function instrumentAnthropic(client, provider = 'anthropic') {
  const orig = client.messages.create.bind(client.messages);
  client.messages.create = async (...args) => {
    try { return await orig(...args); }
    catch (err) { reportProviderError(provider, err); throw err; }
  };
  return client;
}
