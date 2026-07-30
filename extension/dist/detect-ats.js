// detect-ats.js — runs on every HTTPS page, detects ATS-backed job application
// pages hosted on custom company domains (e.g. careers.withwaymo.com), then
// injects mount.js via scripting API so autofill works without the page being
// in our static content_scripts allow-list.
//
// Detection signals (any one is sufficient):
//   1. URL param  gh_jid / gh_src  → Greenhouse
//   2. URL param  lever-origin      → Lever
//   3. DOM: <iframe src="*greenhouse.io*"> or <iframe src="*jobs.lever.co*">
//   4. Page URL path contains /jobs/ + company careers subdomain pattern

(function () {
  // Don't run on ATS native domains (already handled by manifest content_scripts)
  const h = location.hostname;
  if (/greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workday\.com|myworkdayjobs\.com|bamboohr\.com|jobvite\.com|workable\.com|recruitee\.com|icims\.com|taleo\.net|successfactors\.com/.test(h)) return;
  // Don't run on our own site
  if (/simplyappl\.ai/.test(h)) return;

  const url = location.href;
  const params = new URLSearchParams(location.search);

  function isAtsJobPage() {
    // Greenhouse: gh_jid query param
    if (params.get('gh_jid')) return true;
    // Lever: lever-origin param
    if (params.get('lever-origin')) return true;
    // Ashby
    if (params.get('ashby_jid')) return true;
    // Kula: careers.kula.ai/ORG/JOB_ID/apply
    if (/kula\.ai\/.+\/apply/.test(url)) return true;
    // Generic: URL path ends with /apply or /apply/
    if (/\/apply\/?$/.test(location.pathname)) return true;
    // Check for embedded ATS iframes in the DOM
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src || iframe.getAttribute('data-src') || '';
      if (/greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com/.test(src)) return true;
    }
    // Check for common job application form signals
    const hasJobForm = document.querySelector('form input[name*="first"], form input[name*="email"], form input[placeholder*="First name"], form input[placeholder*="Email"]');
    if (hasJobForm && /job|career|position|role/i.test(document.title + location.href)) return true;
    return false;
  }

  function tryInject() {
    if (!isAtsJobPage()) return;
    // Send message to service worker to inject mount.js into this tab + all frames
    try {
      chrome.runtime.sendMessage({ type: 'INJECT_MOUNT', tabId: null });
    } catch (_) {}
  }

  // Try immediately, then again after DOM settles (SPAs load content late)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
  setTimeout(tryInject, 2000);
})();
