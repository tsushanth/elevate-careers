// Detects ATS provider and org slug from the current job page URL
// and reports it back to the SimplyApply API for company discovery.
// Runs silently on all supported ATS domains — no UI, no user action needed.

(function () {
  const url = location.href;
  let provider = null;
  let org = null;

  // boards.greenhouse.io/SLUG or job-boards.greenhouse.io/SLUG
  const ghMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-zA-Z0-9_-]+)/);
  if (ghMatch) { provider = 'greenhouse'; org = ghMatch[1]; }

  // jobs.lever.co/SLUG
  const levMatch = url.match(/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/);
  if (levMatch) { provider = 'lever'; org = levMatch[1]; }

  // jobs.ashbyhq.com/SLUG
  const ashMatch = url.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/);
  if (ashMatch) { provider = 'ashby'; org = ashMatch[1]; }

  // careers.smartrecruiters.com/SLUG
  const srMatch = url.match(/careers\.smartrecruiters\.com\/([a-zA-Z0-9_-]+)/);
  if (srMatch) { provider = 'smartrecruiters'; org = srMatch[1]; }

  if (!provider || !org) return;

  // Fire and forget — best effort, no retry
  fetch('https://elevate-careers-api.fly.dev/ingest/report-org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, org }),
  }).catch(() => {});
})();
