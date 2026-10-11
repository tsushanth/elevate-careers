// Shared Claude spend accounting for this service (one instance). Inert until LLM_USAGE_KEY is set.
// Counts and dollars only, never prompts or user data. See llmUsage.cjs (CommonJS copy: this package is ESM).
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';

const require = createRequire(import.meta.url);
const { createLlmUsage } = require('./llmUsage.cjs');

// `enabled` is explicit so the client's FAILURE_REPORTER_KEY fallback can never switch it on under another app's key.
export const llmUsage = createLlmUsage({
  app: 'elevate',
  enabled: !!process.env.LLM_USAGE_KEY,
  log: (m) => console.warn(`[llm-usage] ${m}`),
});

/** new Anthropic(opts) with spend accounting attached. */
export function trackedAnthropic(opts) {
  const client = new Anthropic(opts);
  llmUsage.instrument(client);
  return client;
}

/** Runs fn with a low-cardinality feature label that every Claude call inside inherits. */
export const withFeature = (name, fn) => llmUsage.withFeature(name, fn);

/** Flush pending rows, giving up after ms so a slow Worker can never hold up shutdown. */
export async function flushLlmUsage(ms = 2500) {
  let t;
  try {
    await Promise.race([llmUsage.flush(), new Promise((r) => { t = setTimeout(r, ms); })]);
  } catch { /* never block shutdown */ } finally { clearTimeout(t); }
}

/** No graceful-shutdown path exists here: flush on SIGTERM/SIGINT, then re-raise so the exit behaviour is unchanged. */
export function installShutdownFlush() {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      await flushLlmUsage();
      process.kill(process.pid, sig);
    });
  }
}
