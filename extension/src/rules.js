// rules.js — SimplyApply self-healing rule engine
// Pure functions only: no DOM, no chrome APIs, no side effects.
// Fully testable in Node.js without a browser.

/**
 * Find the first rule that matches a given field context.
 * Rules are evaluated in order; first match wins.
 *
 * @param {Array}  rules     - merged static + remote rules array
 * @param {Object} context   - { domain, url, fieldType, label, el? }
 * @returns rule object or null
 */
export function findRule(rules, { domain, url, fieldType, label, el }) {
  for (const rule of rules) {
    if (matchesRule(rule.match, { domain, url, fieldType, label, el })) return rule;
  }
  return null;
}

function matchesRule(match, { domain, url, fieldType, label, el }) {
  if (!match || typeof match !== 'object') return false;
  if (match.domain      && !globMatch(match.domain, domain))                         return false;
  if (match.urlPattern  && !url.includes(match.urlPattern))                          return false;
  if (match.fieldType   && fieldType !== match.fieldType)                             return false;
  if (match.labelPattern && !label.toLowerCase().includes(match.labelPattern.toLowerCase())) return false;
  if (match.selector    && el && !el.closest('body,form')?.querySelector(match.selector))    return false;
  return true;
}

// Supports * wildcard only (e.g. "*.ashbyhq.com")
function globMatch(pattern, str) {
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  );
  return re.test(str);
}

/**
 * Merge static (shipped) rules with remote (fetched) rules.
 * Remote rules with the same id as a static rule replace it if version is higher.
 * New remote ids are appended.
 *
 * @param {Array} staticRules
 * @param {Array} remoteRules
 * @returns merged array
 */
export function mergeRules(staticRules, remoteRules) {
  const map = new Map((staticRules || []).map(r => [r.id, r]));
  for (const rule of (remoteRules || [])) {
    const existing = map.get(rule.id);
    if (!existing || rule.version > existing.version) {
      map.set(rule.id, rule);
    }
  }
  return [...map.values()];
}
