// reporter.js — fire-and-forget failure reporting for the self-healing pipeline.
// Sends failed field context to /api/repair/queue so the repair agent can
// generate rule candidates. Never throws, never blocks the fill run.

const REPAIR_URL = 'https://elevate-careers-api.fly.dev/api/repair/queue';
// Remote rules endpoint — consumed by sw.js, not this module
export const RULES_URL = 'https://elevate-careers-api.fly.dev/api/repair/rules';

/**
 * Report a field that the extension failed to fill.
 *
 * @param {Object} field      - { el, label, type }
 * @param {string} failReason - error message or short description ('no-value', 'no-match', etc.)
 * @param {string} fillTried  - which fill method was attempted ('execCommand', 'nativeSet', etc.)
 */
export function reportFailure(field, failReason, fillTried = 'unknown') {
  // Only report fields with a real label — unlabeled fields give the LLM nothing to work with
  if (!field.label || field.label === '(Unlabeled)') return;

  const domain = location.hostname;
  // Trim outerHTML to 3000 chars — enough DOM context for the LLM, not the whole page
  const outerHTML = (() => {
    try { return (field.el?.outerHTML || '').slice(0, 3000); } catch { return ''; }
  })();

  // Fire-and-forget — we don't await, we don't care about the response
  fetch(REPAIR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      label:     field.label,
      fieldType: field.type,
      outerHTML,
      failReason,
      fillTried,
    }),
    keepalive: true, // survives page unload
  }).catch(() => {});
}
