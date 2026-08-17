import { logger } from '../utils/logger.js';

const SITE = 'https://www.simplyappl.ai';
const HOST = 'www.simplyappl.ai';
const KEY = '68dc9b9f883d4da684268b60469b6c97';
const KEY_LOCATION = `${SITE}/${KEY}.txt`;

// Slug must match the SQL used in GET /sitemap.xml exactly
// (lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g'))) — this is
// deliberately NOT normalizer.js's companySlug(), which strips legal
// suffixes (Inc/LLC/...) for company-identity matching and would produce a
// different, non-existent URL here.
export function sitemapSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-zA-Z0-9]+/g, '-');
}

// Pings IndexNow for a scoped set of company pages that actually changed in
// this ingest run — not the full sitemap. Submitting all ~4,500 URLs on
// every ingest would drown out the signal for what genuinely changed and
// burn through the same key's standing with each engine for no reason.
export async function pingIndexNowForCompanies(companySlugs) {
  const slugs = [...new Set(companySlugs)].filter(Boolean);
  if (slugs.length === 0) return;

  const urlList = slugs.map((slug) => `${SITE}/companies/${slug}`);

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body, count: urlList.length }, 'IndexNow submission failed');
      return;
    }
    logger.info({ count: urlList.length }, 'IndexNow: pinged changed company pages');
  } catch (e) {
    logger.warn({ error: e.message, count: urlList.length }, 'IndexNow submission errored');
  }
}
