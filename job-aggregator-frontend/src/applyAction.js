// What the apply buttons say and open. The website can only see the extension when it marks the page (see
// onboarding/extension.js), and it never knows whether an application was sent, so without that mark a click is
// "Opened", not "Applied".

/** The employer's page with the flag that makes an installed extension fill the form on load. */
export function autofillUrl(applyUrl) {
  const url = new URL(applyUrl);
  url.searchParams.set('sa_autofill', '1');
  return url.toString();
}

export function applyLabel({ ext, applied = false, opened = false, feedV2 = true }) {
  if (applied) return '✓ Applied — Apply again?';
  if (!ext) return opened ? 'Opened — open again' : 'Apply on company site';
  return feedV2 ? 'Apply with autofill' : '⚡ Apply';
}

/** Body for POST /api/ai-resume/applications/track. `opened: true` keeps the job in the lists. */
export function trackBody({ jobUrl, jobTitle, company, opened }) {
  return { jobUrl, jobTitle, company, ...(opened ? { opened: true } : {}) };
}
