import { normalizeJobLocations } from './places.js';

// Host suffix -> provider key. Mirrors the sites the extension autofills
// (extension/src/manifest.json host permissions).
const ATS_HOSTS = [
  ['greenhouse.io', 'greenhouse'], ['lever.co', 'lever'], ['ashbyhq.com', 'ashby'],
  ['smartrecruiters.com', 'smartrecruiters'], ['myworkdayjobs.com', 'workday'], ['workday.com', 'workday'],
  ['bamboohr.com', 'bamboohr'], ['jobvite.com', 'jobvite'], ['workable.com', 'workable'],
  ['recruitee.com', 'recruitee'], ['icims.com', 'icims'], ['taleo.net', 'taleo'],
  ['successfactors.com', 'successfactors'],
];

export function applyProviderOf(applyUrl) {
  let host;
  try { host = new URL(applyUrl).hostname.toLowerCase(); } catch { return null; }
  for (const [suffix, key] of ATS_HOSTS) {
    if (host === suffix || host.endsWith('.' + suffix)) return key;
  }
  return null;
}

export function buildFeedRows(job, locations) {
  const places = normalizeJobLocations(locations);
  const applyProvider = applyProviderOf(job.apply_url);
  const seenCountry = new Set();
  const seenRegion = new Set();

  return places.map((p, i) => {
    const regionCode = p.region_code || '';
    const countryKey = p.country_code;
    const regionKey = `${p.country_code}|${regionCode}`;
    const row = {
      job_id: job.id,
      country_code: p.country_code,
      region_code: regionCode,
      city_key: p.city_key,
      city: p.city,
      sort_at: job.posted_at || job.created_at,
      remote: !!job.remote,
      employment_type: job.employment_type || null,
      salary_min: job.salary_min ?? null,
      salary_max: job.salary_max ?? null,
      salary_currency: job.salary_currency || null,
      title: job.title,
      company_name: job.company_name,
      company_key: job.company_key || '',
      company_logo_domain: job.company_logo_domain || null,
      provider: job.provider || null,
      apply_url: job.apply_url,
      apply_provider: applyProvider,
      autofill_ready: applyProvider !== null,
      is_active: job.is_active !== false,
      is_primary: i === 0,
      is_country_primary: !seenCountry.has(countryKey),
      is_region_primary: !seenRegion.has(regionKey),
    };
    seenCountry.add(countryKey);
    seenRegion.add(regionKey);
    return row;
  });
}
