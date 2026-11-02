// Saving job preferences from the Applications tab.
//
// POST /api/preferences owns many more fields than this form edits (excluded
// companies / titles / locations, the visa-sponsorship flag, the enabled switch),
// and the phone app writes them. This form therefore re-reads the stored row first
// and sends it back with only its own fields changed. If the read fails nothing is
// sent: a blind save would reset whatever the form could not see.

const EDITED = ['keywords', 'remote', 'location', 'salary_min', 'daily_limit', 'auto_apply_similar'];
const KEPT = ['excluded_companies', 'excluded_titles', 'excluded_locations', 'require_visa_sponsor'];

export function mergePreferences(stored, edited) {
  const s = stored || {};
  const merged = {};
  for (const k of KEPT) if (s[k] !== undefined && s[k] !== null) merged[k] = s[k];
  for (const k of EDITED) if (edited[k] !== undefined) merged[k] = edited[k];
  merged.salary_min = edited.salary_min ? parseInt(edited.salary_min, 10) || null : null;
  merged.daily_limit = parseInt(edited.daily_limit, 10) || 10;
  merged.location = edited.location || '';
  // "Auto-apply similar" only does anything while `enabled` is on, so turning it on
  // here switches enabled on; saving anything else never changes enabled.
  merged.enabled = !!s.enabled || !!edited.auto_apply_similar;
  return merged;
}

export async function savePreferences(apiUrl, token, edited, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${token}` };
  const got = await fetchImpl(`${apiUrl}/api/preferences`, { headers });
  if (!got.ok) throw new Error(`Could not read your saved preferences (${got.status}); nothing was changed.`);
  const stored = await got.json();
  const res = await fetchImpl(`${apiUrl}/api/preferences`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(mergePreferences(stored, edited)),
  });
  if (!res.ok) throw new Error(`Saving preferences failed (${res.status}).`);
}
