# Home Feed and Region Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SimplyApply home page show jobs in under 1.5 s and let visitors filter by place (country, state, city) with a LinkedIn-style typeahead.

**Architecture:** A precomputed read model (`job_feed`) holds one list-card row per job location, filled at ingest and backfilled once, with partial indexes that serve every feed query as a single index range scan. A new `/v2` API reads it with keyset paging and a Redis cache, and a new frontend feed (search bar, pills, skeleton cards) consumes it behind a flag, then becomes the default.

**Tech Stack:** Node 22 (ESM), Express, `pg`, ioredis, Postgres (Supabase), `node:test` for backend tests, React 18 with Create React App (Jest via `react-scripts test`), Fly.io.

**Spec:** `docs/superpowers/specs/2026-10-07-home-feed-region-redesign-design.md` (amended by this plan, see "Spec amendments").

## Spec amendments (made while planning, after reading the real code)

1. **Row grain.** The spec said one row per (job, country). State and city filters would then miss jobs with several cities in one country. The grain is **(job, country, region, city)**, with three flags marking one representative row per job (`is_primary`), per job and country (`is_country_primary`) and per job, country and region (`is_region_primary`) so broader views never list a job twice.
2. **Sort key.** `sort_at = COALESCE(posted_at, created_at)`, never null, so keyset paging needs no `NULLS LAST` handling.
3. **Card payload** also carries `apply_url` (so Apply works before the detail fetch returns) and `company_key` (`company.name_normalized`, for excluded-company filtering).
4. **Count** for a place-only query comes from `geo_place.job_count`; every other query uses a capped count.
5. **Geo places** are rebuilt by the API process hourly (and at start-up), not by the cron script, so the cron image does not need redeploying.

## Global Constraints

- First page of any region: server time under 300 ms at p95, cold or warm.
- Keyword search: p95 under 800 ms. If it misses, copy `tsv` into `job_feed` with a GIN index (follow-up, not assumed).
- Visitor sees real job cards within 1.5 s of page load; skeleton cards before that.
- Page size 25; keyset paging on `(sort_at, job_id)`, never `OFFSET`.
- Indexes are created `CONCURRENTLY`, off-peak. The backfill is idempotent and resumable.
- Redis errors fall through to the database and never fail the request.
- Normaliser accuracy gate: at least 95% agreement on a 300-row hand-labelled sample before the place filter is enabled.
- Unknown location is `ZZ`, never a guess. `ZZ` jobs appear only with no place selected, or with Remote on when the job is remote.
- Design tokens: ink `#1d2226`, surface `#ffffff`, canvas `#f1f4f7`, line `#d9e0e7`, action blue `#0a66c2`, signal green `#0f7552` (autofill-ready only; was #12805c, which measured 4.46:1 on the selected-card canvas, below WCAG AA). One typeface: Source Sans 3, weights 400, 600, 700, system fallback. Sentence case.
- Copy: primary action "Apply with autofill"; empty state "No jobs match. Try a wider place or turn off filters."; errors say what failed and offer Retry.
- No hardcoded job, company or remote counts anywhere on the page; the hero card is removed.
- `elevate-careers-api` auto-deploys on every push to `main` (GitHub Actions `fly-deploy.yml`). Work lands on feature branches and PRs; merging to `main` is the deploy.

## Review Focus

Most likely to bite a person using this, with the test that pins each:

1. **A job is posted while someone scrolls.** Page 2 must not repeat or skip jobs (Task 9 pagination test).
2. **Ambiguous place names:** `CA` (California vs Canada), `Georgia` (state vs country), `IN`/`DE` (US state vs country code), a bare `CA` with no other information (Task 1 fixtures).
3. **Empty and unknown input:** a place with zero jobs, an unknown country code, a garbage cursor, a typeahead query with `%` or `_` in it (Tasks 8 and 9).
4. **Redis down or slow:** requests still succeed from the database; a failed load is never cached (Task 7).
5. **Signed-in user with dismissed jobs or excluded companies** still sees them excluded in the v2 feed (Task 9). Known gap, not fixed here: title and location exclusions, and the signed-in "Recommended for you" ranking (`/jobs/personalized`), keep their old behaviour and speed; see Task 16.

---

## File Structure

Backend (repo root `src/`):

| File | Responsibility |
|---|---|
| `src/services/places.js` (new) | Pure: raw `job_location` row to `(country_code, region_code, city)`; state/province/country tables |
| `src/services/feedRows.js` (new) | Pure: job plus locations to `job_feed` rows; ATS (apply provider) detection |
| `src/services/jobFeed.js` (new) | DB: `syncJobFeedBatch`, `syncJobFeed`, `deactivateInFeed` |
| `src/services/geoPlace.js` (new) | DB: `rebuildGeoPlaces`, `suggestPlaces`, `placeCount` |
| `src/services/redis.js` (new) | Lazy ioredis client with short timeouts (fail fast) |
| `src/services/feedCache.js` (new) | Cache with stale-while-revalidate, request coalescing, fail-open |
| `src/services/feedQuery.js` (new) | Pure: params parsing, cursor codec, SQL builder |
| `src/services/feedWarmer.js` (new) | Background warming of hot first pages and hourly geo rebuild |
| `src/routes/feed-core.js` (new) | Router factory `/jobs/feed`, `/geo/suggest`, `/stats` with injected deps |
| `src/routes/feed.js` (new) | Wiring: real db, Redis, Supabase auth, warmer; exports routers |
| `src/services/normalizer.js` (modify) | Call `syncJobFeed` after create/update; `deactivateInFeed` on expiry |
| `src/api/server.js` (modify) | Mount `/v2` and `/ingest/rebuild-geo-places` |
| `supabase/migrations/20261008000000_job_feed.sql` (new) | `job_feed`, `geo_place` tables |
| `supabase/manual/20261008000100_job_feed_indexes.sql` (new) | Indexes, applied statement by statement with `CONCURRENTLY` |
| `supabase/migrations/20261009000000_admin_feed_health.sql` (new) | Admin function for feed reconciliation |
| `scripts/backfill-job-feed.js`, `scripts/feed-accuracy-sample.js`, `scripts/feed-accuracy-check.js`, `scripts/explain-feed.js` (new) | Backfill, accuracy gate, plan check |

Frontend (`job-aggregator-frontend/`):

| File | Responsibility |
|---|---|
| `src/feed/place.js` (new) | Default-place guess, saved place, place model |
| `src/feed/feedApi.js` (new) | URL building and fetchers for `/v2` |
| `src/feed/feedState.js` (new) | Pure reducer for the list state |
| `src/feed/useFeed.js` (new) | Hook: fetch, keyset "load more", stale-while-loading |
| `src/feed/PlaceTypeahead.jsx`, `SearchBar.jsx`, `FilterPills.jsx`, `JobCard.jsx`, `JobCardSkeleton.jsx`, `FeedPage.jsx` (new) | Components |
| `src/feed/feed.css` (new) | Tokens and layout |
| `src/App.jsx` (modify) | Local `renderJobDetail`, flag, mount `FeedPage`, hide hero |
| `public/index.html` (modify) | Font, inline first-page preload |
| `src/Admin.jsx` (modify) | Feed reconciliation card |

## Rollout order (matters)

1. Apply the `job_feed`/`geo_place` migration (Task 3). Nothing reads it yet.
2. Merge the ingest hook (Task 4). New and changed jobs start populating the table.
3. Run the backfill (Task 5), then the accuracy gate. Stop if under 95%.
4. Create indexes (Task 6), then `rebuildGeoPlaces`.
5. Merge the `/v2` API (Tasks 7 to 10), watch Actions, check p95 with `scripts/explain-feed.js` and a timing loop.
6. Merge the frontend behind the flag (Tasks 11 to 15), compare v1 and v2, then flip the default (Task 16).

---

### Task 1: Location normaliser

**Files:**
- Create: `src/services/places.js`
- Test: `src/services/places.test.js`

**Interfaces:**
- Consumes: `matchCountryOrRegion(token)` from `src/services/geo.js` (returns `{type:'country', value}`, `{type:'city', value, country}`, `{type:'region', value}` or `null`).
- Produces:
  - `UNKNOWN_COUNTRY = 'ZZ'`
  - `US_STATES`, `CA_PROVINCES` (code to name maps), `COUNTRY_NAME_BY_ISO` (ISO-2 to display name)
  - `normalizeLocationRow({ city, region, country }) -> { country_code, region_code: string|null, city: string|null, city_key: string }`
  - `normalizeJobLocations(rows) -> same shape[]` (deduplicated; `ZZ` only when nothing resolves; never empty)

- [ ] **Step 1: Write the failing test**

```js
// src/services/places.test.js
// Fixtures are real raw job_location values from production (2026-10-07):
// "City, ST" was stored with country repeating the state code, "London, UK"
// with country "UK", and so on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocationRow as n, normalizeJobLocations } from './places.js';

const loc = (r) => ({ country_code: r.country_code, region_code: r.region_code, city: r.city });

test('US state codes stored in the country column resolve to the US', () => {
  assert.deepEqual(loc(n({ city: 'San Francisco', region: 'CA', country: 'CA' })),
    { country_code: 'US', region_code: 'CA', city: 'San Francisco' });
  assert.deepEqual(loc(n({ city: 'Austin', region: 'TX', country: 'TX' })),
    { country_code: 'US', region_code: 'TX', city: 'Austin' });
});

test('Georgia the US state is not the country', () => {
  assert.deepEqual(loc(n({ city: 'Atlanta', region: 'Georgia', country: 'Georgia' })),
    { country_code: 'US', region_code: 'GA', city: 'Atlanta' });
});

test('Canadian province with country CA is Canada, not California', () => {
  assert.deepEqual(loc(n({ city: 'Toronto', region: 'ON', country: 'CA' })),
    { country_code: 'CA', region_code: 'ON', city: 'Toronto' });
  assert.deepEqual(loc(n({ city: 'Vancouver', region: 'BC', country: null })),
    { country_code: 'CA', region_code: 'BC', city: 'Vancouver' });
});

test('two-letter token that is also a US state code defers to a known foreign city', () => {
  assert.equal(n({ city: 'Pune', region: null, country: 'IN' }).country_code, 'IN');
  assert.equal(n({ city: 'Berlin', region: null, country: 'DE' }).country_code, 'DE');
  // Indianapolis is not in the foreign city dictionary, so IN is Indiana.
  assert.deepEqual(loc(n({ city: 'Indianapolis', region: 'IN', country: 'IN' })),
    { country_code: 'US', region_code: 'IN', city: 'Indianapolis' });
});

test('spelled-out and synonym countries', () => {
  assert.equal(n({ city: 'London', region: null, country: 'UK' }).country_code, 'GB');
  assert.equal(n({ city: 'London', region: 'UK', country: 'UK' }).country_code, 'GB');
  assert.equal(n({ city: 'Paris', region: null, country: 'France' }).country_code, 'FR');
  assert.deepEqual(loc(n({ city: 'San Francisco', region: 'California', country: 'United States' })),
    { country_code: 'US', region_code: 'CA', city: 'San Francisco' });
});

test('"Remote" and similar are not cities', () => {
  assert.deepEqual(loc(n({ city: 'Remote', region: null, country: 'United States' })),
    { country_code: 'US', region_code: null, city: null });
});

test('a city that is only in the dictionary resolves through it', () => {
  assert.equal(n({ city: 'Manchester', region: null, country: null }).country_code, 'GB');
});

test('unresolvable input is ZZ, never a guess', () => {
  assert.equal(n({ city: null, region: null, country: null }).country_code, 'ZZ');
  assert.equal(n({ city: 'Anywhere', region: null, country: null }).country_code, 'ZZ');
  assert.equal(n({ city: null, region: null, country: 'Full-time' }).country_code, 'ZZ');
  // A bare "CA" with no city or region could be California or Canada.
  assert.equal(n({ city: null, region: null, country: 'CA' }).country_code, 'ZZ');
});

test('city_key is the lower-cased city, empty when there is none', () => {
  assert.equal(n({ city: 'San Francisco', region: 'CA', country: 'CA' }).city_key, 'san francisco');
  assert.equal(n({ city: null, region: null, country: 'United States' }).city_key, '');
});

test('normalizeJobLocations dedupes, drops ZZ when something resolves, never returns empty', () => {
  const rows = [
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Remote', region: null, country: null },
  ];
  const out = normalizeJobLocations(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].country_code, 'US');
  assert.deepEqual(normalizeJobLocations([]).map(r => r.country_code), ['ZZ']);
  assert.deepEqual(normalizeJobLocations([{ city: 'Anywhere' }]).map(r => r.country_code), ['ZZ']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/places.test.js`
Expected: FAIL with `Cannot find module './places.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/places.js
// Turns the messy raw job_location values into a clean (country, region, city).
// The ingest parser stored "City, ST" with country repeating the state code,
// "London, UK" with country "UK", and so on, so country is not reliable on
// its own. Unresolvable input is ZZ ("unknown"), never a guess.
import { matchCountryOrRegion } from './geo.js';

export const UNKNOWN_COUNTRY = 'ZZ';

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const CA_PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
  ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

// geo.js canonical country display value -> ISO-3166 alpha-2.
const ISO_BY_DISPLAY = {
  Canada: 'CA', Mexico: 'MX', Brazil: 'BR', Colombia: 'CO', Argentina: 'AR', Chile: 'CL', Peru: 'PE',
  Uruguay: 'UY', Guatemala: 'GT', 'Costa Rica': 'CR', Panama: 'PA', Ecuador: 'EC', Bolivia: 'BO',
  'Dominican Republic': 'DO', Honduras: 'HN', 'El Salvador': 'SV', Nicaragua: 'NI', Paraguay: 'PY',
  India: 'IN', China: 'CN', Japan: 'JP', 'South Korea': 'KR', Singapore: 'SG', Vietnam: 'VN',
  Thailand: 'TH', Philippines: 'PH', Indonesia: 'ID', Malaysia: 'MY', Taiwan: 'TW', 'Hong Kong': 'HK',
  Pakistan: 'PK', Bangladesh: 'BD', 'Sri Lanka': 'LK', UK: 'GB', Ireland: 'IE', Germany: 'DE',
  France: 'FR', Spain: 'ES', Italy: 'IT', Netherlands: 'NL', Poland: 'PL', Portugal: 'PT',
  Sweden: 'SE', Norway: 'NO', Denmark: 'DK', Finland: 'FI', Switzerland: 'CH', Austria: 'AT',
  Belgium: 'BE', 'Czech Republic': 'CZ', Romania: 'RO', Ukraine: 'UA', Greece: 'GR', Hungary: 'HU',
  Serbia: 'RS', Croatia: 'HR', Bulgaria: 'BG', Israel: 'IL', Turkey: 'TR', UAE: 'AE',
  'Saudi Arabia': 'SA', Qatar: 'QA', Egypt: 'EG', 'South Africa': 'ZA', Nigeria: 'NG', Kenya: 'KE',
  Australia: 'AU', 'New Zealand': 'NZ', Azerbaijan: 'AZ', Kazakhstan: 'KZ', Russia: 'RU',
  Cyprus: 'CY', Moldova: 'MD', Armenia: 'AM', Belarus: 'BY', Slovakia: 'SK', Slovenia: 'SI',
  Lithuania: 'LT', Latvia: 'LV', Estonia: 'EE', Luxembourg: 'LU', Malta: 'MT', Iceland: 'IS',
  'United States': 'US',
};

export const COUNTRY_NAME_BY_ISO = Object.fromEntries(
  Object.entries(ISO_BY_DISPLAY).map(([name, iso]) => [iso, name])
);
COUNTRY_NAME_BY_ISO.GB = 'United Kingdom';
COUNTRY_NAME_BY_ISO.AE = 'United Arab Emirates';

const US_STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([c, n]) => [n.toLowerCase(), c]));
const CA_PROVINCE_BY_NAME = Object.fromEntries(Object.entries(CA_PROVINCES).map(([c, n]) => [n.toLowerCase(), c]));
const NO_CITY_RE = /^(remote|anywhere|worldwide|global|hybrid|home)$/i;
const TWO_LETTER_RE = /^[a-z]{2}$/i;

const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

function usState(t) {
  const u = t.toUpperCase();
  return US_STATES[u] ? u : (US_STATE_BY_NAME[t.toLowerCase()] || null);
}
function caProvince(t) {
  const u = t.toUpperCase();
  return CA_PROVINCES[u] ? u : (CA_PROVINCE_BY_NAME[t.toLowerCase()] || null);
}
function countryFromName(t) {
  const m = matchCountryOrRegion(t);
  return m && m.type === 'country' ? (ISO_BY_DISPLAY[m.value] || null) : null;
}
function countryFromCity(city) {
  const m = matchCountryOrRegion(city);
  return m && m.type === 'city' ? (ISO_BY_DISPLAY[m.country] || null) : null;
}
const firstMatch = (tokens, fn) => {
  for (const t of tokens) { const v = fn(t); if (v) return v; }
  return null;
};

export function normalizeLocationRow(row) {
  const rawCity = clean(row.city);
  const city = rawCity && !NO_CITY_RE.test(rawCity) ? rawCity : null;
  const regionRaw = clean(row.region);
  const countryRaw = clean(row.country);
  const tokens = [countryRaw, regionRaw].filter(Boolean);
  const cityIso = city ? countryFromCity(city) : null;

  let iso = null;
  let region = null;

  for (const t of tokens) { iso = countryFromName(t); if (iso) break; }

  if (iso === 'US') {
    region = firstMatch(tokens, usState);
  } else if (iso === 'CA') {
    region = firstMatch(tokens, caProvince);
  } else if (!iso) {
    const prov = firstMatch(tokens, caProvince);
    const state = firstMatch(tokens, usState);
    // "Pune, IN": IN is also Indiana, but Pune is a known Indian city.
    const twoLetterIsCityCountry = tokens.some(t => TWO_LETTER_RE.test(t) && t.toUpperCase() === cityIso);
    const bareCA = !city && tokens.length === 1 && tokens[0].toUpperCase() === 'CA';
    if (twoLetterIsCityCountry) {
      iso = cityIso;
    } else if (bareCA) {
      iso = null; // California or Canada: cannot tell.
    } else if (prov && (countryRaw.toUpperCase() === 'CA' || !state)) {
      iso = 'CA';
      region = prov;
    } else if (state) {
      iso = 'US';
      region = state;
    } else if (cityIso) {
      iso = cityIso;
    }
  }

  return {
    country_code: iso || UNKNOWN_COUNTRY,
    region_code: iso ? region : null,
    city,
    city_key: city ? city.toLowerCase() : '',
  };
}

export function normalizeJobLocations(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const n = normalizeLocationRow(r);
    const key = `${n.country_code}|${n.region_code || ''}|${n.city_key}`;
    if (!seen.has(key)) seen.set(key, n);
  }
  const known = [...seen.values()].filter(n => n.country_code !== UNKNOWN_COUNTRY);
  if (known.length) return known;
  return [{ country_code: UNKNOWN_COUNTRY, region_code: null, city: null, city_key: '' }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/places.test.js`
Expected: PASS (9 tests). If `Pune`, `Berlin` or `Manchester` fail, the dictionary in `geo.js` is missing that city; check with `grep -n "pune\|berlin\|manchester" src/services/geo.js` (all three are present as of 2026-10-07).

- [ ] **Step 5: Commit**

```bash
git add src/services/places.js src/services/places.test.js
git commit -m "feat(feed): location normaliser with real production fixtures"
```

---

### Task 2: Feed row builder

**Files:**
- Create: `src/services/feedRows.js`
- Test: `src/services/feedRows.test.js`

**Interfaces:**
- Consumes: `normalizeJobLocations(rows)`, `UNKNOWN_COUNTRY` from `places.js` (Task 1).
- Produces:
  - `applyProviderOf(applyUrl) -> string|null` (`'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workday' | 'bamboohr' | 'jobvite' | 'workable' | 'recruitee' | 'icims' | 'taleo' | 'successfactors' | null`)
  - `buildFeedRows(job, locations) -> FeedRow[]` where `job` has `{id, title, company_name, company_logo_domain, company_key, provider, apply_url, employment_type, remote, salary_min, salary_max, salary_currency, posted_at, created_at, is_active}` and `locations` is `{city, region, country}[]`. A `FeedRow` has exactly the `job_feed` columns: `job_id, country_code, region_code ('' when none), city_key, city, sort_at, remote, employment_type, salary_min, salary_max, salary_currency, title, company_name, company_key, company_logo_domain, provider, apply_url, apply_provider, autofill_ready, is_active, is_primary, is_country_primary, is_region_primary`.

- [ ] **Step 1: Write the failing test**

```js
// src/services/feedRows.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderOf, buildFeedRows } from './feedRows.js';

const job = (over = {}) => ({
  id: 7, title: 'Staff Engineer', company_name: 'Acme', company_logo_domain: 'acme.com', company_key: 'acme',
  provider: 'greenhouse', apply_url: 'https://boards.greenhouse.io/acme/jobs/1', employment_type: 'full_time',
  remote: false, salary_min: null, salary_max: null, salary_currency: null,
  posted_at: '2026-10-01T00:00:00Z', created_at: '2026-10-02T00:00:00Z', is_active: true, ...over,
});

test('applyProviderOf recognises supported ATS hosts and ignores others', () => {
  assert.equal(applyProviderOf('https://boards.greenhouse.io/acme/jobs/1'), 'greenhouse');
  assert.equal(applyProviderOf('https://job-boards.greenhouse.io/x'), 'greenhouse');
  assert.equal(applyProviderOf('https://jobs.lever.co/acme/abc'), 'lever');
  assert.equal(applyProviderOf('https://jobs.ashbyhq.com/acme/1'), 'ashby');
  assert.equal(applyProviderOf('https://acme.wd5.myworkdayjobs.com/en-US/x'), 'workday');
  assert.equal(applyProviderOf('https://careers.example.com/apply'), null);
  assert.equal(applyProviderOf('not a url'), null);
  assert.equal(applyProviderOf(null), null);
  // A lookalike host must not match.
  assert.equal(applyProviderOf('https://greenhouse.io.evil.example/x'), null);
});

test('one row per distinct location with the three representative flags', () => {
  const rows = buildFeedRows(job(), [
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Dallas', region: 'TX', country: 'TX' },
    { city: 'Toronto', region: 'ON', country: 'CA' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(r => r.is_primary).length, 1);
  assert.equal(rows.filter(r => r.is_country_primary).length, 2); // one US, one CA
  assert.equal(rows.filter(r => r.is_region_primary).length, 2);  // US/TX, CA/ON
  assert.deepEqual(rows.map(r => r.city_key), ['austin', 'dallas', 'toronto']);
  assert.ok(rows.every(r => r.job_id === 7 && r.region_code !== null));
});

test('sort_at falls back to created_at when posted_at is missing', () => {
  const rows = buildFeedRows(job({ posted_at: null }), [{ city: 'Austin', region: 'TX', country: 'TX' }]);
  assert.equal(new Date(rows[0].sort_at).toISOString(), '2026-10-02T00:00:00.000Z');
});

test('a job with no locations gets a single ZZ row; autofill flag follows the apply host', () => {
  const rows = buildFeedRows(job({ apply_url: 'https://careers.example.com/x' }), []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country_code, 'ZZ');
  assert.equal(rows[0].is_primary && rows[0].is_country_primary && rows[0].is_region_primary, true);
  assert.equal(rows[0].autofill_ready, false);
  assert.equal(rows[0].apply_provider, null);
  assert.equal(buildFeedRows(job(), [])[0].autofill_ready, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/feedRows.test.js`
Expected: FAIL with `Cannot find module './feedRows.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/feedRows.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/feedRows.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/feedRows.js src/services/feedRows.test.js
git commit -m "feat(feed): build job_feed rows with representative-row flags"
```

---

### Task 3: `job_feed` / `geo_place` schema and database sync

**Files:**
- Create: `supabase/migrations/20261008000000_job_feed.sql`
- Create: `src/services/jobFeed.js`
- Test: `src/services/jobFeed.test.js`

**Interfaces:**
- Consumes: `buildFeedRows` (Task 2). `db` is any object with `query(text, params) -> Promise<{rows, rowCount}>` (the app's `db` and a `pg.Pool` both qualify).
- Produces:
  - `JOB_FEED_COLUMNS: string[]` (the column list, in insert order)
  - `syncJobFeedBatch(db, jobIds: number[]) -> Promise<number>` (rows written)
  - `syncJobFeed(db, jobId) -> Promise<number>`
  - `deactivateInFeed(db, jobIds: number[]) -> Promise<void>`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20261008000000_job_feed.sql
-- Read model for the home feed. One row per (job, country, region, city) with
-- everything a list card needs, so a feed page is one index range scan.
-- Indexes are created separately (supabase/manual/20261008000100_job_feed_indexes.sql) after
-- the backfill, with CONCURRENTLY.
create table if not exists public.job_feed (
  job_id bigint not null,
  country_code text not null,
  region_code text not null default '',
  city_key text not null default '',
  city text,
  sort_at timestamptz not null,
  remote boolean not null default false,
  employment_type text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  title text not null,
  company_name text not null,
  company_key text not null default '',
  company_logo_domain text,
  provider text,
  apply_url text not null,
  apply_provider text,
  autofill_ready boolean not null default false,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  is_country_primary boolean not null default false,
  is_region_primary boolean not null default false,
  primary key (job_id, country_code, region_code, city_key)
);

create table if not exists public.geo_place (
  id bigserial primary key,
  type text not null check (type in ('country', 'state', 'city')),
  label text not null,
  name_key text not null,
  country_code text not null,
  region_code text not null default '',
  city_key text not null default '',
  job_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (type, country_code, region_code, city_key)
);
create index if not exists geo_place_name_key_idx on public.geo_place (name_key text_pattern_ops);

-- Read only by the API (postgres role, bypasses RLS). Nothing for anon.
alter table public.job_feed enable row level security;
alter table public.geo_place enable row level security;
```

- [ ] **Step 2: Write the failing integration test**

```js
// src/services/jobFeed.test.js
// Integration test against a real Postgres. Skipped unless TEST_DATABASE_URL
// is set. Never point this at production: it drops and recreates a scratch schema.
// Local database: docker run -d --name pg-feed-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16
//   TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { syncJobFeed, syncJobFeedBatch, deactivateInFeed } from './jobFeed.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS job_feed_test CASCADE');
  await admin.query('CREATE SCHEMA job_feed_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', c => c.query('SET search_path TO job_feed_test'));
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC,
      salary_max NUMERIC, salary_currency TEXT, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT REFERENCES job(id), city TEXT, region TEXT, country TEXT, remote BOOLEAN);
    INSERT INTO company (name, domain, logo_domain, name_normalized) VALUES ('Acme', 'acme.com', 'acme.com', 'acme');
  `);
  // The real migration, so the test cannot drift from production.
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8')
    .replaceAll('public.', ''));
});

after(async () => { if (pool) { await pool.query('DROP SCHEMA job_feed_test CASCADE'); await pool.end(); } });

const addJob = async (title, locs, over = {}) => {
  const { rows: [j] } = await pool.query(
    `INSERT INTO job (company_id, provider, apply_url, title, posted_at, is_active)
     VALUES (1, 'greenhouse', 'https://boards.greenhouse.io/acme/jobs/' || $1, $1, $2, $3) RETURNING id`,
    [title, over.posted_at ?? '2026-10-01T00:00:00Z', over.is_active ?? true]);
  for (const l of locs) {
    await pool.query('INSERT INTO job_location (job_id, city, region, country) VALUES ($1,$2,$3,$4)', [j.id, l.city, l.region, l.country]);
  }
  return j.id;
};
const feed = (id) => pool.query('SELECT * FROM job_feed WHERE job_id = $1 ORDER BY city_key', [id]).then(r => r.rows);

test('sync writes rows with flags and company fields', { skip }, async () => {
  const id = await addJob('A1', [{ city: 'Austin', region: 'TX', country: 'TX' }, { city: 'Dallas', region: 'TX', country: 'TX' }]);
  assert.equal(await syncJobFeed(pool, id), 2);
  const rows = await feed(id);
  assert.deepEqual(rows.map(r => r.city_key), ['austin', 'dallas']);
  assert.equal(rows.filter(r => r.is_country_primary).length, 1);
  assert.equal(rows[0].company_name, 'Acme');
  assert.equal(rows[0].company_key, 'acme');
  assert.equal(rows[0].autofill_ready, true);
});

test('re-sync after locations change removes stale rows and is idempotent', { skip }, async () => {
  const id = await addJob('A2', [{ city: 'Austin', region: 'TX', country: 'TX' }, { city: 'Toronto', region: 'ON', country: 'CA' }]);
  await syncJobFeed(pool, id);
  assert.equal((await feed(id)).length, 2);
  await pool.query('DELETE FROM job_location WHERE job_id = $1 AND city = $2', [id, 'Toronto']);
  await syncJobFeed(pool, id);
  await syncJobFeed(pool, id);
  assert.deepEqual((await feed(id)).map(r => r.city_key), ['austin']);
});

test('a job with no location rows becomes one ZZ row', { skip }, async () => {
  const id = await addJob('A3', []);
  await syncJobFeed(pool, id);
  const rows = await feed(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country_code, 'ZZ');
});

test('deactivateInFeed hides rows; a deleted job loses its rows on sync', { skip }, async () => {
  const id = await addJob('A4', [{ city: 'Austin', region: 'TX', country: 'TX' }]);
  await syncJobFeed(pool, id);
  await deactivateInFeed(pool, [id]);
  assert.equal((await feed(id))[0].is_active, false);
  await pool.query('DELETE FROM job_location WHERE job_id = $1', [id]);
  await pool.query('DELETE FROM job WHERE id = $1', [id]);
  await syncJobFeed(pool, id);
  assert.equal((await feed(id)).length, 0);
});

test('batch sync handles many jobs in one call', { skip }, async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await addJob(`B${i}`, [{ city: 'Austin', region: 'TX', country: 'TX' }]));
  assert.equal(await syncJobFeedBatch(pool, ids), 5);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/jobFeed.test.js`
Expected: FAIL with `Cannot find module './jobFeed.js'`. (Without `TEST_DATABASE_URL` the DB tests are skipped; the import error still fails the file.)

- [ ] **Step 4: Write minimal implementation**

```js
// src/services/jobFeed.js
// Keeps job_feed in step with job + job_location. One implementation for a
// single job (ingest) and for batches (backfill).
import { buildFeedRows } from './feedRows.js';

export const JOB_FEED_COLUMNS = [
  'job_id', 'country_code', 'region_code', 'city_key', 'city', 'sort_at', 'remote', 'employment_type',
  'salary_min', 'salary_max', 'salary_currency', 'title', 'company_name', 'company_key',
  'company_logo_domain', 'provider', 'apply_url', 'apply_provider', 'autofill_ready', 'is_active',
  'is_primary', 'is_country_primary', 'is_region_primary',
];

const KEY_COLUMNS = ['job_id', 'country_code', 'region_code', 'city_key'];
const RECORD_DEF = `job_id bigint, country_code text, region_code text, city_key text, city text,
  sort_at timestamptz, remote boolean, employment_type text, salary_min numeric, salary_max numeric,
  salary_currency text, title text, company_name text, company_key text, company_logo_domain text,
  provider text, apply_url text, apply_provider text, autofill_ready boolean, is_active boolean,
  is_primary boolean, is_country_primary boolean, is_region_primary boolean`;

export async function syncJobFeedBatch(db, jobIds) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return 0;

  const [{ rows: jobs }, { rows: locs }] = await Promise.all([
    db.query(
      `SELECT j.id, j.title, j.provider, j.apply_url, j.employment_type, j.remote, j.salary_min, j.salary_max,
              j.salary_currency, j.posted_at, j.created_at, j.is_active,
              c.name AS company_name, c.logo_domain AS company_logo_domain, c.name_normalized AS company_key
       FROM job j JOIN company c ON c.id = j.company_id WHERE j.id = ANY($1::bigint[])`, [ids]),
    db.query('SELECT job_id, city, region, country FROM job_location WHERE job_id = ANY($1::bigint[]) ORDER BY id', [ids]),
  ]);

  const locsByJob = new Map();
  for (const l of locs) {
    if (!locsByJob.has(l.job_id)) locsByJob.set(l.job_id, []);
    locsByJob.get(l.job_id).push(l);
  }
  const rows = jobs.flatMap(j => buildFeedRows(j, locsByJob.get(j.id) || []));

  if (rows.length) {
    const cols = JOB_FEED_COLUMNS.join(', ');
    const updates = JOB_FEED_COLUMNS.filter(c => !KEY_COLUMNS.includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ');
    // Upsert first, then delete stale rows, so readers never see a job with
    // fewer rows than it should have.
    await db.query(
      `INSERT INTO job_feed (${cols})
       SELECT ${cols} FROM jsonb_to_recordset($1::jsonb) AS r(${RECORD_DEF})
       ON CONFLICT (job_id, country_code, region_code, city_key) DO UPDATE SET ${updates}`,
      [JSON.stringify(rows)]);
  }

  // Remove rows no longer produced (changed locations) and rows of deleted jobs.
  await db.query(
    `DELETE FROM job_feed f
     WHERE f.job_id = ANY($1::bigint[])
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(job_id bigint, country_code text, region_code text, city_key text)
         WHERE r.job_id = f.job_id AND r.country_code = f.country_code
           AND r.region_code = f.region_code AND r.city_key = f.city_key)`,
    [ids, JSON.stringify(rows.map(r => ({ job_id: r.job_id, country_code: r.country_code, region_code: r.region_code, city_key: r.city_key })))]);

  return rows.length;
}

export const syncJobFeed = (db, jobId) => syncJobFeedBatch(db, [jobId]);

export async function deactivateInFeed(db, jobIds) {
  const ids = [...new Set(jobIds.map(Number))].filter(Number.isFinite);
  if (!ids.length) return;
  await db.query('UPDATE job_feed SET is_active = false WHERE job_id = ANY($1::bigint[])', [ids]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/jobFeed.test.js`
Expected: PASS (5 tests). `pg` returns `bigint` ids as strings, which is why both functions coerce ids with `Number` before filtering.

- [ ] **Step 6: Apply the migration to production and commit**

Apply the migration SQL (the file above) to the Supabase project with the MCP `apply_migration` tool (name `job_feed`). It only creates two new empty tables.

```bash
git add supabase/migrations/20261008000000_job_feed.sql src/services/jobFeed.js src/services/jobFeed.test.js
git commit -m "feat(feed): job_feed and geo_place tables, row sync"
```

---

### Task 4: Hook ingest into the feed

**Files:**
- Modify: `src/services/normalizer.js` (the `processJob` create and update branches, and the expiry `UPDATE` in `processJobs`)
- Test: `src/services/normalizer-feed.test.js`

**Interfaces:**
- Consumes: `syncJobFeed(db, jobId)`, `deactivateInFeed(db, jobIds)` (Task 3).
- Produces: after this task, every ingested job create or update leaves matching `job_feed` rows, and an expired job is `is_active = false` in `job_feed`.

- [ ] **Step 1: Write the failing test**

The test drives `NormalizerService.processJobs` against the scratch schema by pointing `DATABASE_URL` at it before importing the app's `db`.

```js
// src/services/normalizer-feed.test.js
// Skipped unless TEST_DATABASE_URL is set. Never point at production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, normalizer;

before(async () => {
  if (skip) return;
  // IndexNow pings and Clearbit logo lookups use global fetch: keep the test offline.
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS normalizer_feed_test CASCADE');
  await admin.query('CREATE SCHEMA normalizer_feed_test');
  await admin.end();
  // Every connection the app's db pool opens lands in the scratch schema.
  const scratch = new URL(url);
  scratch.searchParams.set('options', '-c search_path=normalizer_feed_test');
  process.env.DATABASE_URL = scratch.toString();
  pool = new pg.Pool({ connectionString: scratch.toString(), max: 2 });
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT UNIQUE, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE discovered_company (id BIGSERIAL PRIMARY KEY, provider TEXT, org TEXT, name TEXT, last_ingested_at TIMESTAMPTZ);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT, external_id TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC, salary_max NUMERIC,
      salary_currency TEXT, posted_at TIMESTAMPTZ, valid_through TIMESTAMPTZ, description_excerpt TEXT, tsv TSVECTOR,
      current_version_id BIGINT, dedupe_key TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_version (id BIGSERIAL PRIMARY KEY, job_id BIGINT, description_md TEXT);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT, city TEXT, region TEXT, country TEXT, remote BOOLEAN);
  `);
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  normalizer = (await import('./normalizer.js')).default;
});

after(async () => { if (pool) { await pool.query('DROP SCHEMA normalizer_feed_test CASCADE'); await pool.end(); } });

const raw = (id, over = {}) => ({
  provider: 'greenhouse', external_id: String(id), company_domain: 'acme.greenhouse.io',
  title: `Engineer ${id}`, apply_url: `https://boards.greenhouse.io/acme/jobs/${id}`, description: '<p>Build things</p>',
  location: 'Austin, TX', remote: false, posted_at: '2026-10-01T00:00:00Z', ...over,
});

test('ingesting a new job creates job_feed rows', { skip }, async () => {
  await normalizer.processJobs([raw(1), raw(2)], 'greenhouse', 'acme');
  const { rows } = await pool.query('SELECT * FROM job_feed ORDER BY job_id');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.country_code === 'US' && r.region_code === 'TX' && r.is_active));
});

test('a job missing from the next fetch is deactivated in the feed too', { skip }, async () => {
  await normalizer.processJobs([raw(1)], 'greenhouse', 'acme'); // job 2 is gone
  const { rows } = await pool.query('SELECT external_id, f.is_active FROM job j JOIN job_feed f ON f.job_id = j.id ORDER BY external_id');
  assert.deepEqual(rows.map(r => [r.external_id, r.is_active]), [['1', true], ['2', false]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/normalizer-feed.test.js`
Expected: FAIL: first test finds 0 rows in `job_feed` (the hook does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/services/normalizer.js`:

1. Add the import next to the other imports at the top of the file:

```js
import { syncJobFeed, deactivateInFeed } from './jobFeed.js';
```

2. In `processJob`, after the update branch and after the create branch, sync the feed. Replace

```js
        await this.updateJob(existing, rawJob, company.id, descriptionMd, descriptionExcerpt);
        await this.createJobVersion(existing.id, descriptionMd);
        changed = true;
      }
    } else {
      // Create new job
      const jobId = await this.createJob(rawJob, company.id, dedupeKey, descriptionMd, descriptionExcerpt);
      await this.createJobVersion(jobId, descriptionMd);
      await this.createJobLocations(jobId, rawJob);
      changed = true;
    }
```

with

```js
        await this.updateJob(existing, rawJob, company.id, descriptionMd, descriptionExcerpt);
        await this.createJobVersion(existing.id, descriptionMd);
        await this.syncFeed(existing.id);
        changed = true;
      }
    } else {
      // Create new job
      const jobId = await this.createJob(rawJob, company.id, dedupeKey, descriptionMd, descriptionExcerpt);
      await this.createJobVersion(jobId, descriptionMd);
      await this.createJobLocations(jobId, rawJob);
      await this.syncFeed(jobId);
      changed = true;
    }
```

3. Add this method to `NormalizerService` (next to `createJobLocations`). A feed failure must never fail ingest:

```js
  // The feed is a derived read model: log and carry on if it fails, the
  // backfill/reconciliation will repair it.
  async syncFeed(jobId) {
    try {
      await syncJobFeed(db, Number(jobId));
    } catch (error) {
      logger.warn({ error: error.message, jobId }, 'job_feed sync failed');
    }
  }
```

4. In `processJobs`, change the expiry query to return ids and deactivate in the feed. Replace

```js
          RETURNING c.name
        `, [`%${org}%`, provider, [...liveIds]]);
        results.expired = expired.rowCount;
```

with

```js
          RETURNING j.id, c.name
        `, [`%${org}%`, provider, [...liveIds]]);
        results.expired = expired.rowCount;
        await deactivateInFeed(db, expired.rows.map(r => Number(r.id))).catch(e =>
          logger.warn({ error: e.message }, 'job_feed deactivate failed'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/normalizer-feed.test.js`
Expected: PASS (2 tests). Then run the whole suite: `node --test` and confirm nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add src/services/normalizer.js src/services/normalizer-feed.test.js
git commit -m "feat(feed): keep job_feed in sync during ingest"
```

---

### Task 5: Backfill and the accuracy gate

**Files:**
- Create: `scripts/backfill-job-feed.js`, `scripts/feed-accuracy-sample.js`, `scripts/feed-accuracy-check.js`
- Test: `scripts/feed-accuracy-check.test.js`

**Interfaces:**
- Consumes: `syncJobFeedBatch(db, ids)` (Task 3), `normalizeLocationRow` (Task 1), `db` from `src/db/index.js` (needs `DATABASE_URL`).
- Produces:
  - `node scripts/backfill-job-feed.js [--from=ID] [--batch=500] [--sleep=100]` (resumable: prints the last id processed; rerun with `--from`)
  - `node scripts/feed-accuracy-sample.js > sample.csv` (300 rows to hand-label)
  - `node scripts/feed-accuracy-check.js sample.csv` (exit code 1 when agreement < 95%)
  - exported `agreement(rows) -> { total, matched, pct }` from `feed-accuracy-check.js`

- [ ] **Step 1: Write the failing test for the pure scoring function**

```js
// scripts/feed-accuracy-check.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreement, parseCsv } from './feed-accuracy-check.js';

test('parseCsv reads quoted fields and ignores blank lines', () => {
  const rows = parseCsv('city,region,country,label_country,label_region\n"San Francisco, CA",CA,CA,US,CA\n\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'San Francisco, CA');
  assert.equal(rows[0].label_country, 'US');
});

test('agreement scores country and region against the hand labels', () => {
  const rows = [
    { city: 'Austin', region: 'TX', country: 'TX', label_country: 'US', label_region: 'TX' },   // match
    { city: 'London', region: '', country: 'UK', label_country: 'GB', label_region: '' },        // match
    { city: 'Pune', region: '', country: 'IN', label_country: 'IN', label_region: '' },          // match
    { city: 'Springfield', region: '', country: '', label_country: 'US', label_region: 'IL' },   // ZZ vs US: miss
  ];
  const r = agreement(rows);
  assert.equal(r.total, 4);
  assert.equal(r.matched, 3);
  assert.equal(r.pct, 75);
});

test('a row labelled ZZ matches when the normaliser also says ZZ', () => {
  const r = agreement([{ city: '', region: '', country: 'Full-time', label_country: 'ZZ', label_region: '' }]);
  assert.equal(r.pct, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/feed-accuracy-check.test.js`
Expected: FAIL with `Cannot find module './feed-accuracy-check.js'`

- [ ] **Step 3: Write the implementations**

```js
// scripts/feed-accuracy-check.js
// Usage: node scripts/feed-accuracy-check.js sample.csv
// sample.csv columns: city,region,country,label_country,label_region
// label_* are filled in by hand. Exits 1 when agreement is below 95%.
import fs from 'node:fs';
import { normalizeLocationRow } from '../src/services/places.js';

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const [head, ...rest] = lines;
  const cols = split(head).map(c => c.trim());
  return rest.map(l => Object.fromEntries(split(l).map((v, i) => [cols[i], v.trim()])));
}

export function agreement(rows) {
  let matched = 0;
  for (const r of rows) {
    const n = normalizeLocationRow({ city: r.city, region: r.region, country: r.country });
    const okCountry = n.country_code === r.label_country;
    const okRegion = (n.region_code || '') === (r.label_region || '');
    if (okCountry && okRegion) matched++;
  }
  const total = rows.length;
  return { total, matched, pct: total ? Math.round((matched / total) * 1000) / 10 : 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = parseCsv(fs.readFileSync(process.argv[2], 'utf8')).filter(r => r.label_country);
  const r = agreement(rows);
  console.log(`${r.matched}/${r.total} agree (${r.pct}%)`);
  process.exit(r.pct >= 95 ? 0 : 1);
}
```

```js
// scripts/feed-accuracy-sample.js
// Prints ~300 rows to label by hand: proportional to the 20 most common raw
// country values among active jobs, plus 60 from the long tail.
import { db } from '../src/db/index.js';

const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const top = await db.query(`
  SELECT jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
  WHERE j.is_active GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`);
const topValues = top.rows.map(r => r.country);

const rows = [];
for (const country of topValues) {
  const { rows: part } = await db.query(
    `SELECT jl.city, jl.region, jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
     WHERE j.is_active AND jl.country IS NOT DISTINCT FROM $1 ORDER BY random() LIMIT 12`, [country]);
  rows.push(...part);
}
const { rows: tail } = await db.query(
  `SELECT jl.city, jl.region, jl.country FROM job_location jl JOIN job j ON j.id = jl.job_id
   WHERE j.is_active AND (jl.country IS NULL OR jl.country <> ALL($1::text[])) ORDER BY random() LIMIT 60`, [topValues.filter(Boolean)]);
rows.push(...tail);

console.log('city,region,country,label_country,label_region');
for (const r of rows) console.log([q(r.city), q(r.region), q(r.country), '', ''].join(','));
await db.close();
```

```js
// scripts/backfill-job-feed.js
// Idempotent and resumable. Run while ingestion is idle or accept some contention.
//   node scripts/backfill-job-feed.js [--from=0] [--batch=500] [--sleep=100]
import { db } from '../src/db/index.js';
import { syncJobFeedBatch } from '../src/services/jobFeed.js';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
let from = arg('from', 0);
const batch = arg('batch', 500);
const sleepMs = arg('sleep', 100);

let written = 0;
for (;;) {
  const { rows } = await db.query(
    'SELECT id::int AS id FROM job WHERE id > $1 ORDER BY id LIMIT $2', [from, batch]);
  if (!rows.length) break;
  written += await syncJobFeedBatch(db, rows.map(r => r.id));
  from = rows[rows.length - 1].id;
  console.log(`last id ${from}, rows written so far ${written}`);
  await new Promise(r => setTimeout(r, sleepMs));
}
console.log(`done. rows written: ${written}`);
await db.close();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/feed-accuracy-check.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the backfill and the gate against production (after Task 4 is deployed)**

```bash
# DATABASE_URL: use the production value (never print it)
node scripts/backfill-job-feed.js --batch=500 --sleep=100      # about 230 batches; safe to stop and resume with --from=<last id>
node scripts/feed-accuracy-sample.js > /tmp/feed-sample.csv    # then fill label_country / label_region by hand (ISO-2; ZZ for unknown)
node scripts/feed-accuracy-check.js /tmp/feed-sample.csv       # exits 1 under 95%
```

Expected: the check prints `N/300 agree (xx.x%)` with at least 95%. If it is lower, add the failing raw values as fixtures to `places.test.js`, fix `places.js`, re-run Task 1 tests and the backfill (it is idempotent). Do not proceed to Task 6 until the gate passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-job-feed.js scripts/feed-accuracy-sample.js scripts/feed-accuracy-check.js scripts/feed-accuracy-check.test.js
git commit -m "feat(feed): backfill script and normaliser accuracy gate"
```

---

### Task 6: Indexes, geo places, and the plan check

**Files:**
- Create: `supabase/manual/20261008000100_job_feed_indexes.sql`
- Create: `src/services/geoPlace.js`, `src/services/geoPlace.test.js`

**Interfaces:**
- Consumes: `COUNTRY_NAME_BY_ISO`, `US_STATES`, `CA_PROVINCES` (Task 1).
- Produces:
  - `rebuildGeoPlaces(db) -> Promise<{countries, states, cities}>`
  - `suggestPlaces(db, q, limit = 8) -> Promise<Place[]>` where `Place = { type, label, country, region, city, count }` (`country` ISO-2, `region` code or `''`, `city` display name or `''`)
  - `placeCount(db, { country, region, city }) -> Promise<number|null>`

- [ ] **Step 1: Write the index file**

```sql
-- supabase/manual/20261008000100_job_feed_indexes.sql
-- Run each statement on its own (CREATE INDEX CONCURRENTLY cannot run in a
-- transaction), off-peak, AFTER the backfill. Safe to re-run.
create index concurrently if not exists idx_feed_primary
  on public.job_feed (sort_at desc, job_id desc) where is_active and is_primary;
create index concurrently if not exists idx_feed_primary_remote
  on public.job_feed (sort_at desc, job_id desc) where is_active and is_primary and remote;
create index concurrently if not exists idx_feed_country
  on public.job_feed (country_code, sort_at desc, job_id desc) where is_active and is_country_primary;
create index concurrently if not exists idx_feed_region
  on public.job_feed (country_code, region_code, sort_at desc, job_id desc) where is_active and is_region_primary;
create index concurrently if not exists idx_feed_city
  on public.job_feed (country_code, region_code, city_key, sort_at desc, job_id desc) where is_active;
```

- [ ] **Step 2: Write the failing integration test for the geo places**

```js
// src/services/geoPlace.test.js
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { rebuildGeoPlaces, suggestPlaces, placeCount } from './geoPlace.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS geo_place_test CASCADE');
  await admin.query('CREATE SCHEMA geo_place_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', c => c.query('SET search_path TO geo_place_test'));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  const ins = (id, cc, rc, city) => pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url,is_active,is_primary,is_country_primary,is_region_primary)
     VALUES ($1,$2,$3,$4,$5,now(),'t','c','https://x',true,$6,$7,$8)`,
    [id, cc, rc, (city || '').toLowerCase(), city, true, true, true]);
  // 4 jobs in Austin TX, 3 in Dallas TX, 3 in Toronto ON, 1 unknown, 3 in Berlin
  for (let i = 1; i <= 4; i++) await ins(i, 'US', 'TX', 'Austin');
  for (let i = 5; i <= 7; i++) await ins(i, 'US', 'TX', 'Dallas');
  for (let i = 8; i <= 10; i++) await ins(i, 'CA', 'ON', 'Toronto');
  await ins(11, 'ZZ', '', null);
  for (let i = 12; i <= 14; i++) await ins(i, 'DE', '', 'Berlin');
  await rebuildGeoPlaces(pool);
});

after(async () => { if (pool) { await pool.query('DROP SCHEMA geo_place_test CASCADE'); await pool.end(); } });

test('rebuild creates countries, states and cities with counts; ZZ is not a place', { skip }, async () => {
  const { rows } = await pool.query('SELECT type, label, job_count FROM geo_place ORDER BY type, label');
  const by = Object.fromEntries(rows.map(r => [`${r.type}:${r.label}`, r.job_count]));
  assert.equal(by['country:United States'], 7);
  assert.equal(by['country:Germany'], 3);
  assert.equal(by['state:Texas, United States'], 7);
  assert.equal(by['city:Austin, Texas, United States'], 4);
  assert.equal(by['city:Berlin, Germany'], 3);
  assert.ok(!rows.some(r => r.label.includes('ZZ') || r.label === 'Unknown'));
});

test('suggest is prefix-ranked by job count and escapes LIKE wildcards', { skip }, async () => {
  const us = await suggestPlaces(pool, 'uni');
  assert.deepEqual(us.map(p => p.label), ['United States']);
  const t = await suggestPlaces(pool, 'T');
  assert.equal(t[0].label, 'Texas, United States');       // 7 jobs beats Toronto's 3
  assert.deepEqual(await suggestPlaces(pool, '%'), []);   // wildcard is literal, matches nothing
  assert.deepEqual(await suggestPlaces(pool, '_'), []);
  assert.deepEqual(await suggestPlaces(pool, ''), []);
});

test('placeCount returns the precomputed count or null', { skip }, async () => {
  assert.equal(await placeCount(pool, { country: 'US', region: '', city: '' }), 7);
  assert.equal(await placeCount(pool, { country: 'US', region: 'TX', city: '' }), 7);
  assert.equal(await placeCount(pool, { country: 'US', region: 'TX', city: 'austin' }), 4);
  assert.equal(await placeCount(pool, { country: 'FR', region: '', city: '' }), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/geoPlace.test.js`
Expected: FAIL with `Cannot find module './geoPlace.js'`

- [ ] **Step 4: Write minimal implementation**

```js
// src/services/geoPlace.js
// The selectable places for the typeahead, rebuilt from job_feed counts.
import { COUNTRY_NAME_BY_ISO, US_STATES, CA_PROVINCES, UNKNOWN_COUNTRY } from './places.js';

const MIN_CITY_JOBS = 3;

const stateName = (cc, rc) => (cc === 'US' ? US_STATES[rc] : cc === 'CA' ? CA_PROVINCES[rc] : null);

export async function rebuildGeoPlaces(db) {
  const startedAt = new Date().toISOString();
  const places = [];

  const countries = await db.query(
    `SELECT country_code, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND country_code <> $1 GROUP BY 1`, [UNKNOWN_COUNTRY]);
  for (const r of countries.rows) {
    const name = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!name) continue;
    places.push({ type: 'country', label: name, name_key: name.toLowerCase(), country_code: r.country_code, region_code: '', city_key: '', job_count: r.n });
  }

  const states = await db.query(
    `SELECT country_code, region_code, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND region_code <> '' GROUP BY 1, 2`);
  for (const r of states.rows) {
    const name = stateName(r.country_code, r.region_code);
    const cname = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!name || !cname) continue;
    places.push({ type: 'state', label: `${name}, ${cname}`, name_key: name.toLowerCase(), country_code: r.country_code, region_code: r.region_code, city_key: '', job_count: r.n });
  }

  const cities = await db.query(
    `SELECT country_code, region_code, city_key, min(city) AS city, count(DISTINCT job_id)::int AS n FROM job_feed
     WHERE is_active AND city_key <> '' AND country_code <> $1
     GROUP BY 1, 2, 3 HAVING count(DISTINCT job_id) >= $2`, [UNKNOWN_COUNTRY, MIN_CITY_JOBS]);
  for (const r of cities.rows) {
    const cname = COUNTRY_NAME_BY_ISO[r.country_code];
    if (!cname) continue;
    const sname = r.region_code ? stateName(r.country_code, r.region_code) : null;
    places.push({ type: 'city', label: [r.city, sname, cname].filter(Boolean).join(', '), name_key: r.city.toLowerCase(), country_code: r.country_code, region_code: r.region_code, city_key: r.city_key, job_count: r.n });
  }

  if (places.length) {
    await db.query(
      `INSERT INTO geo_place (type, label, name_key, country_code, region_code, city_key, job_count, updated_at)
       SELECT type, label, name_key, country_code, region_code, city_key, job_count, now()
       FROM jsonb_to_recordset($1::jsonb) AS r(type text, label text, name_key text, country_code text, region_code text, city_key text, job_count int)
       ON CONFLICT (type, country_code, region_code, city_key)
       DO UPDATE SET label = EXCLUDED.label, name_key = EXCLUDED.name_key, job_count = EXCLUDED.job_count, updated_at = now()`,
      [JSON.stringify(places)]);
  }
  await db.query('DELETE FROM geo_place WHERE updated_at < $1', [startedAt]);
  return { countries: countries.rowCount, states: states.rowCount, cities: cities.rowCount };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, c => '\\' + c);

export async function suggestPlaces(db, q, limit = 8) {
  const term = String(q || '').trim().toLowerCase().slice(0, 60);
  if (!term) return [];
  const { rows } = await db.query(
    `SELECT type, label, country_code, region_code, city_key, job_count,
            CASE WHEN type = 'city' THEN split_part(label, ',', 1) ELSE '' END AS city
     FROM geo_place WHERE name_key LIKE $1 || '%' ESCAPE '\\'
     ORDER BY job_count DESC, label LIMIT $2`, [escapeLike(term), limit]);
  return rows.map(r => ({ type: r.type, label: r.label, country: r.country_code, region: r.region_code, city: r.city, count: r.job_count }));
}

export async function placeCount(db, { country, region = '', city = '' }) {
  const type = city ? 'city' : region ? 'state' : 'country';
  const { rows } = await db.query(
    `SELECT job_count FROM geo_place WHERE type = $1 AND country_code = $2 AND region_code = $3 AND city_key = $4`,
    [type, country, region, city.toLowerCase()]);
  return rows[0] ? rows[0].job_count : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/services/geoPlace.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Create indexes in production, then rebuild places, then commit**

In the Supabase SQL editor or via MCP `execute_sql`, run each `create index concurrently` statement from the index file one at a time, off-peak. Then, from a Node REPL or script with `DATABASE_URL` set: `node -e "import('./src/services/geoPlace.js').then(async m => { const { db } = await import('./src/db/index.js'); console.log(await m.rebuildGeoPlaces(db)); await db.close(); })"`.

Check the indexes exist: `select indexname from pg_indexes where tablename = 'job_feed'` must list all five plus the primary key.

```bash
git add supabase/manual/20261008000100_job_feed_indexes.sql src/services/geoPlace.js src/services/geoPlace.test.js
git commit -m "feat(feed): job_feed indexes and geo_place typeahead source"
```

---

### Task 7: Redis client and feed cache

**Files:**
- Create: `src/services/redis.js`, `src/services/feedCache.js`
- Test: `src/services/feedCache.test.js`

**Interfaces:**
- Consumes: `config.redis` (`host`, `port`, `password`, `tls`) from `src/config/index.js`.
- Produces:
  - `getRedis() -> Redis|null` (null when Redis is not configured)
  - `createFeedCache({ redis, ttlMs = 60000, staleMs = 300000, now = Date.now, prefix = 'feed:v2:' }) -> { getOrLoad(key, loader) -> Promise<{ value, status: 'HIT'|'STALE'|'MISS' }>, refresh(key, loader) -> Promise<value> }`

- [ ] **Step 1: Write the failing test**

```js
// src/services/feedCache.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedCache } from './feedCache.js';

// Minimal in-memory stand-in for ioredis (get / set with PX).
const fakeRedis = () => {
  const store = new Map();
  return { store, async get(k) { return store.get(k) ?? null; }, async set(k, v) { store.set(k, v); return 'OK'; } };
};
const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms) => { t += ms; } }; };

test('miss loads and stores; second call is a HIT without calling the loader', async () => {
  const c = clock(); const cache = createFeedCache({ redis: fakeRedis(), now: c.now });
  let calls = 0;
  const loader = async () => { calls++; return { jobs: [1] }; };
  assert.equal((await cache.getOrLoad('k', loader)).status, 'MISS');
  const hit = await cache.getOrLoad('k', loader);
  assert.equal(hit.status, 'HIT');
  assert.deepEqual(hit.value, { jobs: [1] });
  assert.equal(calls, 1);
});

test('stale entry is served immediately and refreshed in the background', async () => {
  const c = clock(); const cache = createFeedCache({ redis: fakeRedis(), now: c.now, ttlMs: 1000, staleMs: 10_000 });
  let n = 0;
  const loader = async () => ({ n: ++n });
  await cache.getOrLoad('k', loader);
  c.advance(2000);
  const stale = await cache.getOrLoad('k', loader);
  assert.equal(stale.status, 'STALE');
  assert.deepEqual(stale.value, { n: 1 });
  await new Promise(r => setImmediate(r));
  assert.deepEqual((await cache.getOrLoad('k', loader)).value, { n: 2 });
});

test('concurrent misses share one load', async () => {
  const cache = createFeedCache({ redis: fakeRedis() });
  let calls = 0;
  const loader = () => new Promise(r => { calls++; setTimeout(() => r({ ok: true }), 20); });
  await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
  assert.equal(calls, 1);
});

test('a failing loader is not cached and the error reaches the caller', async () => {
  const redis = fakeRedis(); const cache = createFeedCache({ redis });
  await assert.rejects(cache.getOrLoad('k', async () => { throw new Error('db down'); }), /db down/);
  assert.equal(redis.store.size, 0);
  assert.equal((await cache.getOrLoad('k', async () => ({ ok: 1 }))).status, 'MISS');
});

test('redis errors fail open: the request still gets data from the loader', async () => {
  const broken = { async get() { throw new Error('ECONNRESET'); }, async set() { throw new Error('ECONNRESET'); } };
  const cache = createFeedCache({ redis: broken });
  const r = await cache.getOrLoad('k', async () => ({ ok: 1 }));
  assert.deepEqual(r.value, { ok: 1 });
  assert.equal(r.status, 'MISS');
});

test('no redis configured: still works (and still coalesces)', async () => {
  const cache = createFeedCache({ redis: null });
  assert.deepEqual((await cache.getOrLoad('k', async () => ({ ok: 1 }))).value, { ok: 1 });
});

test('a corrupt cached value is treated as a miss', async () => {
  const redis = fakeRedis(); redis.store.set('feed:v2:k', '{not json');
  const cache = createFeedCache({ redis });
  assert.equal((await cache.getOrLoad('k', async () => ({ ok: 1 }))).status, 'MISS');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/feedCache.test.js`
Expected: FAIL with `Cannot find module './feedCache.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/redis.js
// Dedicated client for the feed cache. Fails fast (short timeouts, no offline
// queue) so a slow Redis can never hold up a feed request.
import Redis from 'ioredis';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

let client;

export function getRedis() {
  if (client !== undefined) return client;
  if (!config.redis.host || config.redis.host === 'localhost') { client = null; return client; }
  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    tls: config.redis.tls,
    connectTimeout: 1000,
    commandTimeout: 250,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', (e) => logger.warn({ error: e.message }, 'feed cache redis error'));
  return client;
}
```

```js
// src/services/feedCache.js
// Stale-while-revalidate cache with request coalescing. Every Redis call is
// wrapped: on any error we behave as if the cache were empty.
export function createFeedCache({ redis, ttlMs = 60_000, staleMs = 300_000, now = Date.now, prefix = 'feed:v2:' }) {
  const inflight = new Map();

  async function read(key) {
    if (!redis) return null;
    try {
      const raw = await redis.get(prefix + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.t === 'number' ? parsed : null;
    } catch { return null; }
  }

  async function write(key, value) {
    if (!redis) return;
    try { await redis.set(prefix + key, JSON.stringify({ t: now(), v: value }), 'PX', ttlMs + staleMs); } catch { /* fail open */ }
  }

  function load(key, loader) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { const v = await loader(); await write(key, v); return v; })()
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return {
    async getOrLoad(key, loader) {
      const hit = await read(key);
      if (hit) {
        if (now() - hit.t <= ttlMs) return { value: hit.v, status: 'HIT' };
        load(key, loader).catch(() => {}); // refresh in the background
        return { value: hit.v, status: 'STALE' };
      }
      return { value: await load(key, loader), status: 'MISS' };
    },
    refresh: (key, loader) => load(key, loader),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/feedCache.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/redis.js src/services/feedCache.js src/services/feedCache.test.js
git commit -m "feat(feed): fail-open stale-while-revalidate cache"
```

---

### Task 8: Feed query builder and plan check

**Files:**
- Create: `src/services/feedQuery.js`, `scripts/explain-feed.js`
- Test: `src/services/feedQuery.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `parseFeedParams(query) -> { ok: true, params } | { ok: false, error }` where `params = { country, region, city, remote, q, type, days, limit, cursor, hasPlace, plain }` (`country` upper-case ISO-2 or `''`; `cursor` is `{ sortAt, jobId }` or `null`; `plain` is true when only a place is set, with no q/type/days/remote)
  - `encodeCursor(sortAt, jobId) -> string`, `decodeCursor(s) -> { sortAt, jobId }` (throws `Error('invalid cursor')`)
  - `buildFeedQuery(params, { dismissed = [], excludedCompanies = [] } = {}) -> { text, values }` (selects `limit + 1` rows)
  - `buildCountQuery(params, exclusions) -> { text, values }` (capped at 1,001)
  - `feedCacheKey(params) -> string`
  - `FEED_LIMIT_DEFAULT = 25`, `COUNT_CAP = 1000`

- [ ] **Step 1: Write the failing test**

```js
// src/services/feedQuery.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedParams, encodeCursor, decodeCursor, buildFeedQuery, buildCountQuery, feedCacheKey } from './feedQuery.js';

const ok = (q) => { const r = parseFeedParams(q); assert.equal(r.ok, true, JSON.stringify(r)); return r.params; };

test('defaults: worldwide, 25 per page, no cursor', () => {
  const p = ok({});
  assert.equal(p.limit, 25);
  assert.equal(p.cursor, null);
  assert.equal(p.hasPlace, false);
  assert.equal(p.plain, false);
});

test('place-only query is "plain"; any other filter is not', () => {
  assert.equal(ok({ country: 'us' }).plain, true);
  assert.equal(ok({ country: 'us' }).country, 'US');
  assert.equal(ok({ country: 'US', remote: 'true' }).plain, false);
  assert.equal(ok({ country: 'US', q: 'engineer' }).plain, false);
});

test('invalid input is rejected, not guessed', () => {
  assert.equal(parseFeedParams({ country: 'USA' }).ok, false);
  assert.equal(parseFeedParams({ country: 'US', region: 'tx!!' }).ok, false);
  assert.equal(parseFeedParams({ cursor: 'garbage' }).ok, false);
  assert.equal(parseFeedParams({ days: 'abc' }).ok, false);
});

test('limit is clamped to 1..50', () => {
  assert.equal(ok({ limit: '500' }).limit, 50);
  assert.equal(ok({ limit: '0' }).limit, 1);
});

test('cursor round-trips and rejects garbage', () => {
  const c = encodeCursor('2026-10-01T00:00:00.000Z', 42);
  assert.deepEqual(decodeCursor(c), { sortAt: '2026-10-01T00:00:00.000Z', jobId: 42 });
  assert.throws(() => decodeCursor('###'), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from('[1]').toString('base64url')), /invalid cursor/);
});

test('worldwide uses the is_primary rows; country uses is_country_primary; state uses is_region_primary', () => {
  assert.match(buildFeedQuery(ok({})).text, /f\.is_primary/);
  assert.match(buildFeedQuery(ok({ country: 'US' })).text, /f\.is_country_primary/);
  assert.match(buildFeedQuery(ok({ country: 'US', region: 'TX' })).text, /f\.is_region_primary/);
  const city = buildFeedQuery(ok({ country: 'US', region: 'TX', city: 'Austin' }));
  assert.match(city.text, /f\.city_key = \$/);
  assert.ok(city.values.includes('austin'));
  assert.doesNotMatch(city.text, /is_country_primary|is_region_primary/);
});

test('every filter is a bound parameter, never interpolated', () => {
  const evil = buildFeedQuery(ok({ q: "x'; DROP TABLE job;--", city: "o'brien", country: 'US', type: 'full_time' }));
  assert.doesNotMatch(evil.text, /DROP TABLE/);
  assert.doesNotMatch(evil.text, /o'brien/);
  assert.ok(evil.values.includes("x'; DROP TABLE job;--"));
});

test('ordering and keyset condition match the index (sort_at desc, job_id desc)', () => {
  const p = ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42) });
  const { text, values } = buildFeedQuery(p);
  assert.match(text, /ORDER BY f\.sort_at DESC, f\.job_id DESC/);
  assert.match(text, /\(f\.sort_at, f\.job_id\) < \(\$\d+::timestamptz, \$\d+::bigint\)/);
  assert.ok(values.includes('2026-10-01T00:00:00.000Z') && values.includes(42));
  assert.equal(values[values.length - 1], 26); // limit + 1 to detect a next page
});

test('exclusions become bound array parameters', () => {
  const { text, values } = buildFeedQuery(ok({}), { dismissed: [1, 2], excludedCompanies: ['acme'] });
  assert.match(text, /f\.job_id <> ALL\(\$\d+::bigint\[\]\)/);
  assert.match(text, /f\.company_key <> ALL\(\$\d+::text\[\]\)/);
  assert.ok(values.some(v => Array.isArray(v) && v[0] === 1));
});

test('count query is capped and has no ordering, cursor or limit+1', () => {
  const { text } = buildCountQuery(ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42) }));
  assert.match(text, /LIMIT 1001/);
  assert.doesNotMatch(text, /ORDER BY|sort_at, f\.job_id\) </);
});

test('cache key ignores parameter order and differs by filter', () => {
  assert.equal(feedCacheKey(ok({ country: 'US', remote: 'true' })), feedCacheKey(ok({ remote: 'true', country: 'US' })));
  assert.notEqual(feedCacheKey(ok({ country: 'US' })), feedCacheKey(ok({ country: 'GB' })));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/feedQuery.test.js`
Expected: FAIL with `Cannot find module './feedQuery.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/feedQuery.js
// Pure: query-string parsing, the keyset cursor and the SQL builder for the
// v2 feed. Every user-supplied value is a bound parameter.
export const FEED_LIMIT_DEFAULT = 25;
export const COUNT_CAP = 1000;

export function encodeCursor(sortAt, jobId) {
  return Buffer.from(JSON.stringify([sortAt, jobId])).toString('base64url');
}

export function decodeCursor(s) {
  try {
    const [sortAt, jobId] = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    if (typeof sortAt !== 'string' || Number.isNaN(Date.parse(sortAt)) || !Number.isInteger(jobId)) throw new Error('bad');
    return { sortAt, jobId };
  } catch { throw new Error('invalid cursor'); }
}

const REGION_RE = /^[A-Za-z0-9]{1,3}$/;
const TYPE_RE = /^[a-z_]{1,30}$/;

export function parseFeedParams(query) {
  const country = String(query.country || '').toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'invalid country' };
  const region = String(query.region || '').toUpperCase();
  if (region && !REGION_RE.test(region)) return { ok: false, error: 'invalid region' };
  const city = String(query.city || '').trim().slice(0, 80);
  const q = String(query.q || '').trim().slice(0, 100);
  const type = String(query.type || '');
  if (type && !TYPE_RE.test(type)) return { ok: false, error: 'invalid type' };
  let days = null;
  if (query.days !== undefined && query.days !== '') {
    days = Number(query.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: 'invalid days' };
  }
  const remote = query.remote === 'true' || query.remote === '1';
  const requested = parseInt(query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : FEED_LIMIT_DEFAULT;
  let cursor = null;
  if (query.cursor) {
    try { cursor = decodeCursor(query.cursor); } catch { return { ok: false, error: 'invalid cursor' }; }
  }
  if ((region || city) && !country) return { ok: false, error: 'region and city need a country' };
  const hasPlace = !!country;
  return {
    ok: true,
    params: { country, region, city, remote, q, type, days, limit, cursor, hasPlace,
      plain: hasPlace && !remote && !q && !type && days === null },
  };
}

function buildWhere(p, { dismissed = [], excludedCompanies = [] }, { withCursor }) {
  const values = [];
  const add = (v) => { values.push(v); return `$${values.length}`; };
  const where = ['f.is_active'];

  if (p.country) {
    where.push(`f.country_code = ${add(p.country)}`);
    if (p.city) {
      where.push(`f.city_key = ${add(p.city.toLowerCase())}`);
      if (p.region) where.push(`f.region_code = ${add(p.region)}`);
    } else if (p.region) {
      where.push(`f.region_code = ${add(p.region)}`, 'f.is_region_primary');
    } else {
      where.push('f.is_country_primary');
    }
  } else {
    where.push('f.is_primary');
  }
  if (p.remote) where.push('f.remote');
  if (p.type) where.push(`f.employment_type = ${add(p.type)}`);
  if (p.days !== null) where.push(`f.sort_at >= now() - make_interval(days => ${add(p.days)}::int)`);
  if (p.q) where.push(`f.job_id IN (SELECT id FROM job WHERE tsv @@ plainto_tsquery('english', ${add(p.q)}))`);
  if (dismissed.length) where.push(`f.job_id <> ALL(${add(dismissed)}::bigint[])`);
  if (excludedCompanies.length) where.push(`f.company_key <> ALL(${add(excludedCompanies)}::text[])`);
  if (withCursor && p.cursor) {
    where.push(`(f.sort_at, f.job_id) < (${add(p.cursor.sortAt)}::timestamptz, ${add(p.cursor.jobId)}::bigint)`);
  }
  return { where: where.join(' AND '), values, add };
}

export function buildFeedQuery(p, exclusions = {}) {
  const { where, values, add } = buildWhere(p, exclusions, { withCursor: true });
  const text = `
    SELECT f.job_id AS id, f.title, f.company_name, f.company_logo_domain, f.provider, f.apply_provider,
           f.autofill_ready, f.apply_url, f.city, f.region_code, f.country_code, f.remote, f.employment_type,
           f.salary_min, f.salary_max, f.salary_currency, f.sort_at AS posted_at
    FROM job_feed f
    WHERE ${where}
    ORDER BY f.sort_at DESC, f.job_id DESC
    LIMIT ${add(p.limit + 1)}`;
  return { text, values };
}

export function buildCountQuery(p, exclusions = {}) {
  const { where, values } = buildWhere(p, exclusions, { withCursor: false });
  return {
    text: `SELECT count(*)::int AS n FROM (SELECT 1 FROM job_feed f WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`,
    values,
  };
}

export function feedCacheKey(p) {
  const { cursor, ...rest } = p;
  const norm = Object.keys(rest).sort().reduce((o, k) => { o[k] = rest[k]; return o; }, {});
  return JSON.stringify([norm, cursor ? [cursor.sortAt, cursor.jobId] : null]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/feedQuery.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Write the production plan check**

```js
// scripts/explain-feed.js
// Verifies the feed queries use the partial indexes on job_feed (no seq scan
// of job_feed) and prints timings. Read only. Needs DATABASE_URL.
//   node scripts/explain-feed.js
import { db } from '../src/db/index.js';
import { parseFeedParams, buildFeedQuery } from '../src/services/feedQuery.js';

const scenarios = {
  worldwide: {},
  'worldwide remote': { remote: 'true' },
  country: { country: 'US' },
  'country remote': { country: 'US', remote: 'true' },
  state: { country: 'US', region: 'TX' },
  city: { country: 'US', region: 'TX', city: 'Austin' },
  keyword: { q: 'engineer' },
  'keyword + country': { country: 'US', q: 'engineer' },
};

let failed = false;
for (const [name, query] of Object.entries(scenarios)) {
  const parsed = parseFeedParams(query);
  const { text, values } = buildFeedQuery(parsed.params);
  const t0 = Date.now();
  const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${text}`, values);
  const plan = rows.map(r => r['QUERY PLAN']).join('\n');
  const seq = /Seq Scan on job_feed/.test(plan);
  const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
  console.log(`${seq ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${exec} ms  (wall ${Date.now() - t0} ms)`);
  if (seq) { failed = true; console.log(plan); }
}
await db.close();
process.exit(failed ? 1 : 0);
```

Run (after Task 6 indexes exist): `node scripts/explain-feed.js`. Expected: every scenario prints `ok` with execution time well under 300 ms (keyword scenarios under 800 ms). A `FAIL` means a query is not served by an index; fix the index or the builder before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/services/feedQuery.js src/services/feedQuery.test.js scripts/explain-feed.js
git commit -m "feat(feed): keyset query builder with bound parameters"
```

---

### Task 9: `/v2` router

**Files:**
- Create: `src/routes/feed-core.js`
- Test: `src/routes/feed-core.test.js`

**Interfaces:**
- Consumes: `parseFeedParams`, `buildFeedQuery`, `buildCountQuery`, `feedCacheKey`, `encodeCursor`, `COUNT_CAP` (Task 8); `suggestPlaces`, `placeCount` (Task 6); `createFeedCache` shape (Task 7); `COUNTRY_NAME_BY_ISO` (Task 1).
- Produces: `createFeedRouter({ db, cache, getExclusions }) -> express.Router`, where `getExclusions(req) -> Promise<{ userId, dismissed: number[], excludedCompanies: string[] } | null>`.
  - `GET /jobs/feed` returns `{ jobs: Card[], nextCursor: string|null, count: number|null, countIsCapped: boolean }`
  - `GET /geo/suggest?q=` returns `{ places: Place[] }`
  - `GET /stats` returns `{ jobs: number, companies: number, remote: number }`
  - `Card = { id, title, company_name, company_logo_domain, provider, apply_provider, autofill_ready, apply_url, city, region_code, country_code, country, remote, employment_type, salary_min, salary_max, salary_currency, posted_at }`

- [ ] **Step 1: Write the failing test**

```js
// src/routes/feed-core.test.js
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { rebuildGeoPlaces } from '../services/geoPlace.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, exclusions = null;

const get = async (path, headers = {}) => {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_core_test CASCADE');
  await admin.query('CREATE SCHEMA feed_core_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3 });
  pool.on('connect', c => c.query('SET search_path TO feed_core_test'));
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));

  // 60 US jobs (30 in Austin, 30 in Dallas), 5 remote, 10 UK, 3 unknown.
  // Newest first by id; the unknown-location jobs are the newest of all (minutes: 0).
  const add = async (id, cc, rc, city, over = {}) => {
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, over.title || 'Software Engineer']);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,
         autofill_ready,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,$2,$3,$4,$5, now() - ($10::int * interval '1 minute'), $6, $7, $8, $9, 'https://boards.greenhouse.io/x/' || $1::text, true, true, true, true)`,
      [id, cc, rc, (city || '').toLowerCase(), city, over.remote || false, over.title || 'Software Engineer', over.company || 'Acme', over.key || 'acme', over.minutes ?? id]);
  };
  for (let i = 1; i <= 30; i++) await add(i, 'US', 'TX', 'Austin', { remote: i <= 5 });
  for (let i = 31; i <= 60; i++) await add(i, 'US', 'TX', 'Dallas', { company: 'Globex', key: 'globex' });
  for (let i = 61; i <= 70; i++) await add(i, 'GB', '', 'London', { title: 'Designer' });
  for (let i = 71; i <= 73; i++) await add(i, 'ZZ', '', null, { minutes: 0 });
  await rebuildGeoPlaces(pool);

  const app = express();
  app.use('/v2', createFeedRouter({
    db: pool,
    cache: createFeedCache({ redis: null }),
    getExclusions: async () => exclusions,
  }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA feed_core_test CASCADE'); await pool.end(); } });

test('country feed: 25 per page, newest first, country name included', { skip }, async () => {
  const r = await get('/jobs/feed?country=US');
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs.length, 25);
  assert.equal(r.body.jobs[0].id, 1);
  assert.equal(r.body.jobs[0].country, 'United States');
  assert.ok(r.body.nextCursor);
  assert.equal(r.body.count, 60);          // from geo_place for a place-only query
  assert.equal(r.body.countIsCapped, false);
});

test('keyset pagination: no duplicates or gaps, even when a newer job arrives between pages', { skip }, async () => {
  const p1 = await get('/jobs/feed?country=US&limit=10');
  // A brand new job is ingested after the first page was served.
  await pool.query('INSERT INTO job (id, tsv) VALUES (999, to_tsvector(\'english\', \'new\'))');
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url,is_primary,is_country_primary,is_region_primary)
                    VALUES (999,'US','TX','austin','Austin', now() + interval '1 hour','New','Acme','https://x',true,true,true)`);
  const p2 = await get(`/jobs/feed?country=US&limit=10&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
  const ids = [...p1.body.jobs, ...p2.body.jobs].map(j => j.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(!ids.includes(999));
  await pool.query('DELETE FROM job_feed WHERE job_id = 999');
  await pool.query('DELETE FROM job WHERE id = 999');
});

test('last page has no cursor', { skip }, async () => {
  const r = await get('/jobs/feed?country=GB&limit=25');
  assert.equal(r.body.jobs.length, 10);
  assert.equal(r.body.nextCursor, null);
});

test('state and city filters; remote toggle; unknown jobs only appear worldwide', { skip }, async () => {
  assert.equal((await get('/jobs/feed?country=US&region=TX&city=dallas&limit=50')).body.jobs.length, 30);
  const remote = await get('/jobs/feed?country=US&remote=true');
  assert.equal(remote.body.jobs.length, 5);
  assert.equal(remote.body.countIsCapped, false);
  const worldwide = await get('/jobs/feed?limit=50');
  assert.ok(worldwide.body.jobs.some(j => j.country_code === 'ZZ'));
  const us = await get('/jobs/feed?country=US&limit=50');
  assert.ok(!us.body.jobs.some(j => j.country_code === 'ZZ'));
});

test('keyword filter', { skip }, async () => {
  const r = await get('/jobs/feed?q=designer&limit=50');
  assert.equal(r.body.jobs.length, 10);
});

test('empty and invalid input', { skip }, async () => {
  const empty = await get('/jobs/feed?country=FR');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.jobs, []);
  assert.equal(empty.body.nextCursor, null);
  assert.equal((await get('/jobs/feed?country=USA')).status, 400);
  assert.equal((await get('/jobs/feed?cursor=garbage')).status, 400);
});

test('signed-in exclusions apply and bypass the shared cache', { skip }, async () => {
  const anon = await get('/jobs/feed?country=US&limit=3');
  assert.deepEqual(anon.body.jobs.map(j => j.id), [1, 2, 3]);
  exclusions = { userId: 'u1', dismissed: [1], excludedCompanies: [] };
  const mine = await get('/jobs/feed?country=US&limit=3', { authorization: 'Bearer x' });
  assert.deepEqual(mine.body.jobs.map(j => j.id), [2, 3, 4]);
  exclusions = { userId: 'u1', dismissed: [], excludedCompanies: ['acme'] };
  const noAcme = await get('/jobs/feed?country=US&limit=3', { authorization: 'Bearer x' });
  assert.deepEqual(noAcme.body.jobs.map(j => j.id), [31, 32, 33]);
  exclusions = null;
  const again = await get('/jobs/feed?country=US&limit=3');
  assert.deepEqual(again.body.jobs.map(j => j.id), [1, 2, 3]);
});

test('suggest and stats', { skip }, async () => {
  const s = await get('/geo/suggest?q=uni');
  assert.deepEqual(s.body.places.map(p => p.label), ['United States', 'United Kingdom']);
  assert.deepEqual((await get('/geo/suggest?q=%25')).body.places, []);
  const st = await get('/stats');
  assert.equal(st.body.jobs, 73);
  assert.equal(st.body.remote, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/routes/feed-core.test.js`
Expected: FAIL with `Cannot find module './feed-core.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/routes/feed-core.js
import express from 'express';
import { parseFeedParams, buildFeedQuery, buildCountQuery, feedCacheKey, encodeCursor, COUNT_CAP } from '../services/feedQuery.js';
import { suggestPlaces, placeCount } from '../services/geoPlace.js';
import { COUNTRY_NAME_BY_ISO } from '../services/places.js';

const STATS_TTL_MS = 10 * 60_000;

// pg returns bigint and numeric columns as strings; the API contract uses numbers.
const num = (v) => (v == null ? null : Number(v));
function toCard(row) {
  return {
    ...row,
    id: Number(row.id),
    salary_min: num(row.salary_min),
    salary_max: num(row.salary_max),
    country: COUNTRY_NAME_BY_ISO[row.country_code] || null,
  };
}

export function createFeedRouter({ db, cache, getExclusions }) {
  const router = express.Router();

  // The page itself (rows, next cursor, count). Reused by the warmer.
  async function loadPage(params, exclusions = {}) {
    const q = buildFeedQuery(params, exclusions);
    const { rows } = await db.query(q.text, q.values);
    const hasMore = rows.length > params.limit;
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(new Date(last.posted_at).toISOString(), Number(last.id)) : null;

    let count = null;
    let countIsCapped = false;
    if (!params.cursor) {
      const exact = params.plain && !(exclusions.dismissed?.length || exclusions.excludedCompanies?.length)
        ? await placeCount(db, params) : null;
      if (exact !== null) {
        count = exact;
      } else {
        const c = buildCountQuery(params, exclusions);
        const n = (await db.query(c.text, c.values)).rows[0].n;
        countIsCapped = n > COUNT_CAP;
        count = countIsCapped ? COUNT_CAP : n;
      }
    }
    return { jobs: page.map(toCard), nextCursor, count, countIsCapped };
  }
  router.loadPage = loadPage;

  router.get('/jobs/feed', async (req, res) => {
    const parsed = parseFeedParams(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      const exclusions = req.headers.authorization ? await getExclusions(req) : null;
      if (exclusions && (exclusions.dismissed.length || exclusions.excludedCompanies.length)) {
        // Per-user results are never shared through the cache.
        res.set('X-Cache', 'BYPASS');
        return res.json(await loadPage(parsed.params, exclusions));
      }
      const { value, status } = await cache.getOrLoad(feedCacheKey(parsed.params), () => loadPage(parsed.params));
      res.set('X-Cache', status);
      return res.json(value);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load jobs' });
    }
  });

  router.get('/geo/suggest', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ places: await suggestPlaces(db, req.query.q) });
    } catch {
      res.status(500).json({ error: 'Failed to load places' });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const { value } = await cache.getOrLoad('stats', async () => {
        const { rows: [r] } = await db.query(
          `SELECT count(*) FILTER (WHERE is_primary)::int AS jobs,
                  count(*) FILTER (WHERE is_primary AND remote)::int AS remote,
                  count(DISTINCT company_key) FILTER (WHERE is_primary)::int AS companies
           FROM job_feed WHERE is_active`);
        return r;
      });
      res.set('Cache-Control', `public, max-age=${STATS_TTL_MS / 1000}`);
      res.json(value);
    } catch {
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  return router;
}
```

Note on the stats cache: `createFeedCache` is configured with a 60 s TTL in `feed.js` (Task 10); the 10-minute `Cache-Control` above lets browsers and CDNs absorb most stats traffic.

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres node --test src/routes/feed-core.test.js`
Expected: PASS (8 tests). If the pagination test returns a duplicate of id 999, the keyset condition is wrong (compare `(sort_at, job_id)` direction with the `ORDER BY`).

- [ ] **Step 5: Commit**

```bash
git add src/routes/feed-core.js src/routes/feed-core.test.js
git commit -m "feat(feed): /v2 feed, suggest and stats router"
```

---

### Task 10: Wire the API (routes, warmer, rebuild endpoint)

**Files:**
- Create: `src/routes/feed.js`, `src/services/feedWarmer.js`
- Modify: `src/api/server.js` (mount the routers, near line 90)
- Test: `src/services/feedWarmer.test.js`

**Interfaces:**
- Consumes: `createFeedRouter` and its `router.loadPage` (Task 9); `createFeedCache` (Task 7); `getRedis` (Task 7); `rebuildGeoPlaces` (Task 6); `parseFeedParams`, `feedCacheKey` (Task 8); `normalizeCompanyName` from `src/services/normalizer.js`.
- Produces:
  - `startFeedWarmer({ db, cache, loadPage, rebuildPlaces, intervalMs = 60000, placeIntervalMs = 3600000, logger }) -> { stop() }`
  - `hotFeedQueries(db) -> Promise<object[]>` (the query-string objects to warm: worldwide plus the top eight countries)
  - `src/routes/feed.js` default export: the `/v2` router. Named export `ingestRouter`: `POST /rebuild-geo-places` (secret in body).

- [ ] **Step 1: Write the failing warmer test**

```js
// src/services/feedWarmer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotFeedQueries, startFeedWarmer } from './feedWarmer.js';

const fakeDb = (countries) => ({ async query() { return { rows: countries.map(c => ({ country_code: c })) }; } });

test('hot queries are worldwide plus the top countries', async () => {
  const q = await hotFeedQueries(fakeDb(['US', 'GB', 'CA']));
  assert.deepEqual(q, [{}, { country: 'US' }, { country: 'GB' }, { country: 'CA' }]);
});

test('warmer refreshes each hot query on start and swallows failures', async () => {
  const seen = []; const warnings = [];
  const w = startFeedWarmer({
    db: fakeDb(['US', 'GB']),
    cache: { refresh: async (key, loader) => { seen.push(key); if (key.includes('"GB"')) throw new Error('boom'); return loader(); } },
    loadPage: async () => ({ jobs: [] }),
    rebuildPlaces: async () => { seen.push('places'); },
    intervalMs: 3_600_000, placeIntervalMs: 3_600_000,
    logger: { warn: (...a) => warnings.push(a), info() {} },
  });
  await new Promise(r => setTimeout(r, 30));
  w.stop();
  assert.equal(seen.filter(k => k.startsWith('[')).length, 3);   // worldwide, US, GB
  assert.ok(seen.includes('places'));
  assert.equal(warnings.length, 1);                              // GB failure logged, not thrown
});

test('stop() prevents further ticks', async () => {
  let ticks = 0;
  const w = startFeedWarmer({
    db: fakeDb([]), cache: { refresh: async () => { ticks++; } }, loadPage: async () => ({}),
    rebuildPlaces: async () => {}, intervalMs: 10, placeIntervalMs: 3_600_000,
    logger: { warn() {}, info() {} },
  });
  await new Promise(r => setTimeout(r, 35));
  w.stop();
  const after = ticks;
  await new Promise(r => setTimeout(r, 40));
  assert.equal(ticks, after);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/feedWarmer.test.js`
Expected: FAIL with `Cannot find module './feedWarmer.js'`

- [ ] **Step 3: Write the warmer**

```js
// src/services/feedWarmer.js
// Keeps the hot first pages fresh so no visitor pays a cold query, and
// rebuilds the typeahead places hourly. Sequential on purpose (no DB spike).
import { parseFeedParams, feedCacheKey } from './feedQuery.js';

const TOP_COUNTRIES = 8;

export async function hotFeedQueries(db) {
  const { rows } = await db.query(
    `SELECT country_code FROM geo_place WHERE type = 'country' ORDER BY job_count DESC LIMIT $1`, [TOP_COUNTRIES]);
  return [{}, ...rows.map(r => ({ country: r.country_code }))];
}

export function startFeedWarmer({ db, cache, loadPage, rebuildPlaces, intervalMs = 60_000, placeIntervalMs = 3_600_000, logger }) {
  let stopped = false;

  async function warmOnce() {
    let queries;
    try { queries = await hotFeedQueries(db); } catch (e) { logger.warn({ error: e.message }, 'feed warmer: could not list hot queries'); return; }
    for (const q of queries) {
      if (stopped) return;
      const parsed = parseFeedParams(q);
      if (!parsed.ok) continue;
      try { await cache.refresh(feedCacheKey(parsed.params), () => loadPage(parsed.params)); }
      catch (e) { logger.warn({ error: e.message, query: q }, 'feed warmer: refresh failed'); }
    }
  }

  async function rebuild() {
    if (stopped) return;
    try { await rebuildPlaces(); } catch (e) { logger.warn({ error: e.message }, 'geo places rebuild failed'); }
  }

  // Places first (so hot queries know the top countries), then warm.
  rebuild().then(warmOnce);
  const warmTimer = setInterval(warmOnce, intervalMs);
  const placeTimer = setInterval(rebuild, placeIntervalMs);
  warmTimer.unref?.();
  placeTimer.unref?.();

  return { stop() { stopped = true; clearInterval(warmTimer); clearInterval(placeTimer); } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/feedWarmer.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the wiring**

```js
// src/routes/feed.js
// Wiring for the /v2 feed: real db, Redis cache, Supabase auth, warmer.
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { getRedis } from '../services/redis.js';
import { createFeedCache } from '../services/feedCache.js';
import { createFeedRouter } from './feed-core.js';
import { rebuildGeoPlaces } from '../services/geoPlace.js';
import { startFeedWarmer } from '../services/feedWarmer.js';
import { normalizeCompanyName } from '../services/normalizer.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
  return _supabase;
}

// Optional auth, like /jobs: a bad or missing token just means no exclusions.
async function getExclusions(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return null;
    const [{ data: pref }, { data: dismissedRows }] = await Promise.all([
      sb.from('apply_preferences').select('excluded_companies').eq('user_id', user.id).single(),
      sb.from('dismissed_jobs').select('job_id').eq('user_id', user.id),
    ]);
    return {
      userId: user.id,
      dismissed: (dismissedRows || []).map(r => Number(r.job_id)).filter(Number.isFinite),
      excludedCompanies: (pref?.excluded_companies || []).map(normalizeCompanyName),
    };
  } catch (e) {
    logger.warn({ error: e.message }, 'v2 feed: exclusions lookup failed, continuing unfiltered');
    return null;
  }
}

const cache = createFeedCache({ redis: getRedis(), ttlMs: 60_000, staleMs: 300_000 });
const router = createFeedRouter({ db, cache, getExclusions });

// FEED_WARMER=off is the kill switch.
if (process.env.FEED_WARMER !== 'off') {
  startFeedWarmer({
    db, cache, loadPage: router.loadPage, rebuildPlaces: () => rebuildGeoPlaces(db), logger,
  });
}

export const ingestRouter = express.Router();
ingestRouter.post('/rebuild-geo-places', async (req, res) => {
  if (req.body?.secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try { res.json({ ok: true, ...(await rebuildGeoPlaces(db)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
```

In `src/api/server.js`, immediately after the existing line `app.use('/api/public', publicFunnelRoutes);` (about line 90), add:

```js
import feedRoutes, { ingestRouter as feedIngestRoutes } from '../routes/feed.js';
app.use('/v2', feedRoutes);
app.use('/ingest', feedIngestRoutes);
```

(The `import` can sit with the other mid-file imports at lines 74 to 89, which is the existing pattern.)

- [ ] **Step 6: Verify the wiring loads and the whole suite passes**

Run: `node --check src/routes/feed.js src/api/server.js && node --test`
Expected: no syntax errors; all tests pass (DB tests skip without `TEST_DATABASE_URL`).

Then smoke-test the server locally against the real database only for read paths (`DATABASE_URL` and `REDIS_*` set): `PORT=8099 node src/index.js &` then `curl -s "localhost:8099/v2/jobs/feed?country=US&limit=3" | head -c 600` and `curl -s localhost:8099/v2/stats`. Stop the server afterwards. Expected: three cards and real counts.

- [ ] **Step 7: Commit**

```bash
git add src/routes/feed.js src/services/feedWarmer.js src/services/feedWarmer.test.js src/api/server.js
git commit -m "feat(feed): wire /v2 routes, cache warmer and geo rebuild endpoint"
```

---

### Task 11: Frontend place model and API client

**Files:**
- Create: `job-aggregator-frontend/src/feed/place.js`, `feedApi.js`
- Test: `job-aggregator-frontend/src/feed/place.test.js`, `feedApi.test.js`

**Interfaces:**
- Consumes: the `/v2` endpoints (Task 9).
- Produces:
  - `place.js`: `guessPlace({ timeZone, languages }) -> Place`; `loadSavedPlace() -> Place|null`; `savePlace(place)`; `EMPTY_PLACE = { country: '', region: '', city: '', label: '' }`; `placeFromSuggestion(s) -> Place`. `Place = { country: string, region: string, city: string, label: string }`.
  - `feedApi.js`: `feedUrl(base, state) -> string`; `fetchFeed(base, state, { signal, token }) -> Promise<{jobs, nextCursor, count, countIsCapped}>`; `fetchSuggest(base, q, { signal }) -> Promise<Place[]>`; `fetchStats(base) -> Promise<{jobs, remote, companies}>`. `state = { place, q, remote, type, days, cursor }`.

- [ ] **Step 1: Write the failing tests**

```js
// job-aggregator-frontend/src/feed/place.test.js
import { guessPlace, placeFromSuggestion, EMPTY_PLACE } from './place';

test('timezone decides the default country', () => {
  expect(guessPlace({ timeZone: 'America/New_York', languages: ['en-US'] }).country).toBe('US');
  expect(guessPlace({ timeZone: 'America/Toronto', languages: ['en-CA'] }).country).toBe('CA');
  expect(guessPlace({ timeZone: 'Europe/London', languages: ['en-GB'] }).country).toBe('GB');
  expect(guessPlace({ timeZone: 'Asia/Kolkata', languages: ['en-IN'] }).country).toBe('IN');
  expect(guessPlace({ timeZone: 'Australia/Sydney', languages: ['en-AU'] }).country).toBe('AU');
});

test('falls back to the language region, then the United States', () => {
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en-GB'] }).country).toBe('GB');
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en'] }).country).toBe('US');
  expect(guessPlace({}).country).toBe('US');
});

test('the guess carries a label for the search box', () => {
  expect(guessPlace({ timeZone: 'Europe/London' }).label).toBe('United Kingdom');
  expect(guessPlace({}).label).toBe('United States');
});

test('placeFromSuggestion maps API fields and falls back to empty', () => {
  expect(placeFromSuggestion({ label: 'Austin, Texas, United States', country: 'US', region: 'TX', city: 'Austin' }))
    .toEqual({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin, Texas, United States' });
  expect(placeFromSuggestion(null)).toEqual(EMPTY_PLACE);
});
```

```js
// job-aggregator-frontend/src/feed/feedApi.test.js
import { feedUrl, fetchFeed, fetchSuggest } from './feedApi';

const base = 'https://api.example.com';

test('feedUrl includes only the filters that are set', () => {
  const u = new URL(feedUrl(base, { place: { country: 'US', region: 'TX', city: '', label: 'x' }, q: '', remote: true, type: '', days: '', cursor: '' }));
  expect(u.pathname).toBe('/v2/jobs/feed');
  expect(u.searchParams.get('country')).toBe('US');
  expect(u.searchParams.get('region')).toBe('TX');
  expect(u.searchParams.get('remote')).toBe('true');
  expect(u.searchParams.has('city')).toBe(false);
  expect(u.searchParams.has('q')).toBe(false);
  expect(u.searchParams.has('cursor')).toBe(false);
});

test('feedUrl carries the cursor and encodes the keyword', () => {
  const u = new URL(feedUrl(base, { place: { country: '', region: '', city: '', label: '' }, q: 'staff engineer', cursor: 'abc_-' }));
  expect(u.searchParams.get('q')).toBe('staff engineer');
  expect(u.searchParams.get('cursor')).toBe('abc_-');
  expect(u.searchParams.has('country')).toBe(false);
});

test('fetchFeed sends the token and throws on an error status', async () => {
  const calls = [];
  global.fetch = jest.fn(async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => ({ jobs: [], nextCursor: null, count: 0, countIsCapped: false }) }; });
  await fetchFeed(base, { place: { country: 'US' } }, { token: 't1' });
  expect(calls[0][1].headers.Authorization).toBe('Bearer t1');
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await expect(fetchFeed(base, { place: {} })).rejects.toThrow(/500/);
});

test('fetchSuggest returns [] for blank input without calling the network', async () => {
  global.fetch = jest.fn();
  expect(await fetchSuggest(base, '   ')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: FAIL with `Cannot find module './place'` and `'./feedApi'`

- [ ] **Step 3: Write minimal implementation**

```js
// job-aggregator-frontend/src/feed/place.js
export const EMPTY_PLACE = { country: '', region: '', city: '', label: '' };

const NAMES = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', IN: 'India', AU: 'Australia',
  NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain', NL: 'Netherlands', SG: 'Singapore',
  JP: 'Japan', AE: 'United Arab Emirates', BR: 'Brazil', MX: 'Mexico',
};

const CANADA_ZONES = ['Toronto', 'Vancouver', 'Edmonton', 'Winnipeg', 'Halifax', 'St_Johns', 'Regina', 'Montreal'];
const TZ_EXACT = {
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Dubai': 'AE', 'Pacific/Auckland': 'NZ',
  'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX',
};

function countryFromTimeZone(tz) {
  if (!tz) return null;
  if (TZ_EXACT[tz]) return TZ_EXACT[tz];
  if (tz.startsWith('Australia/')) return 'AU';
  if (tz.startsWith('America/')) return CANADA_ZONES.some(z => tz.endsWith('/' + z)) ? 'CA' : 'US';
  return null;
}

function countryFromLanguages(languages) {
  for (const l of languages || []) {
    const m = /^[a-z]{2,3}-([A-Za-z]{2})$/.exec(l);
    if (m && NAMES[m[1].toUpperCase()]) return m[1].toUpperCase();
  }
  return null;
}

export function guessPlace({ timeZone, languages } = {}) {
  const country = countryFromTimeZone(timeZone) || countryFromLanguages(languages) || 'US';
  return { country, region: '', city: '', label: NAMES[country] || country };
}

export function placeFromSuggestion(s) {
  if (!s) return EMPTY_PLACE;
  return { country: s.country || '', region: s.region || '', city: s.city || '', label: s.label || '' };
}

const KEY = 'sa_place';

export function loadSavedPlace() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    return p && typeof p.country === 'string' ? { ...EMPTY_PLACE, ...p } : null;
  } catch { return null; }
}

export function savePlace(place) {
  try { localStorage.setItem(KEY, JSON.stringify(place)); } catch { /* private mode */ }
}
```

```js
// job-aggregator-frontend/src/feed/feedApi.js
export function feedUrl(base, state) {
  const p = new URLSearchParams();
  const place = state.place || {};
  if (place.country) p.set('country', place.country);
  if (place.region) p.set('region', place.region);
  if (place.city) p.set('city', place.city);
  if (state.q) p.set('q', state.q);
  if (state.remote) p.set('remote', 'true');
  if (state.type) p.set('type', state.type);
  if (state.days) p.set('days', String(state.days));
  if (state.cursor) p.set('cursor', state.cursor);
  const qs = p.toString();
  return `${base}/v2/jobs/feed${qs ? `?${qs}` : ''}`;
}

export async function fetchFeed(base, state, { signal, token } = {}) {
  const res = await fetch(feedUrl(base, state), {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
  return res.json();
}

export async function fetchSuggest(base, q, { signal } = {}) {
  const term = (q || '').trim();
  if (!term) return [];
  const res = await fetch(`${base}/v2/geo/suggest?q=${encodeURIComponent(term)}`, { signal });
  if (!res.ok) return [];
  return (await res.json()).places || [];
}

export async function fetchStats(base) {
  const res = await fetch(`${base}/v2/stats`);
  if (!res.ok) throw new Error(`Stats request failed (${res.status})`);
  return res.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add job-aggregator-frontend/src/feed/place.js job-aggregator-frontend/src/feed/place.test.js job-aggregator-frontend/src/feed/feedApi.js job-aggregator-frontend/src/feed/feedApi.test.js
git commit -m "feat(feed-ui): place model and v2 API client"
```

---

### Task 12: List state and `useFeed`

**Files:**
- Create: `job-aggregator-frontend/src/feed/feedState.js`, `useFeed.js`
- Test: `job-aggregator-frontend/src/feed/feedState.test.js`

**Interfaces:**
- Consumes: `fetchFeed` (Task 11).
- Produces:
  - `feedState.js`: `initialFeedState`, `feedReducer(state, action)` with actions `{type:'start', append:boolean}`, `{type:'success', append:boolean, data}`, `{type:'error', message}`. State: `{ jobs, nextCursor, count, countIsCapped, loading, loadingMore, error, loaded }`.
  - `useFeed.js`: `useFeed({ apiBase, filters, token }) -> { ...state, loadMore(), retry() }` where `filters = { place, q, remote, type, days }`.

- [ ] **Step 1: Write the failing test**

```js
// job-aggregator-frontend/src/feed/feedState.test.js
import { feedReducer, initialFeedState } from './feedState';

const job = (id) => ({ id, title: `t${id}` });
const page = (ids, next = null, count = 99) => ({ jobs: ids.map(job), nextCursor: next, count, countIsCapped: false });

test('first load: loading with no jobs, then success replaces', () => {
  let s = feedReducer(initialFeedState, { type: 'start', append: false });
  expect(s.loading).toBe(true);
  expect(s.jobs).toEqual([]);
  s = feedReducer(s, { type: 'success', append: false, data: page([1, 2], 'c1') });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2]);
  expect(s.nextCursor).toBe('c1');
  expect(s.loading).toBe(false);
  expect(s.loaded).toBe(true);
});

test('a refresh keeps the previous list visible until new data arrives', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1, 2]) });
  s = feedReducer(s, { type: 'start', append: false });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2]);   // not blanked
  expect(s.loading).toBe(true);
  s = feedReducer(s, { type: 'success', append: false, data: page([9]) });
  expect(s.jobs.map(j => j.id)).toEqual([9]);
});

test('load more appends and never duplicates an id', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1, 2], 'c1') });
  s = feedReducer(s, { type: 'start', append: true });
  expect(s.loadingMore).toBe(true);
  expect(s.loading).toBe(false);
  s = feedReducer(s, { type: 'success', append: true, data: page([2, 3], null) });
  expect(s.jobs.map(j => j.id)).toEqual([1, 2, 3]);
  expect(s.nextCursor).toBeNull();
  expect(s.loadingMore).toBe(false);
});

test('append keeps the original count (later pages carry no count)', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1], 'c1', 500) });
  s = feedReducer(s, { type: 'success', append: true, data: { jobs: [job(2)], nextCursor: null, count: null, countIsCapped: false } });
  expect(s.count).toBe(500);
});

test('error keeps existing jobs and records the message', () => {
  let s = feedReducer(initialFeedState, { type: 'success', append: false, data: page([1]) });
  s = feedReducer(s, { type: 'start', append: false });
  s = feedReducer(s, { type: 'error', message: 'Feed request failed (500)' });
  expect(s.jobs.map(j => j.id)).toEqual([1]);
  expect(s.error).toBe('Feed request failed (500)');
  expect(s.loading).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed/feedState`
Expected: FAIL with `Cannot find module './feedState'`

- [ ] **Step 3: Write minimal implementation**

```js
// job-aggregator-frontend/src/feed/feedState.js
export const initialFeedState = {
  jobs: [], nextCursor: null, count: null, countIsCapped: false,
  loading: false, loadingMore: false, error: '', loaded: false,
};

export function feedReducer(state, action) {
  switch (action.type) {
    case 'start':
      return action.append
        ? { ...state, loadingMore: true, error: '' }
        : { ...state, loading: true, error: '' };
    case 'success': {
      const { data, append } = action;
      if (!append) {
        return { ...state, jobs: data.jobs, nextCursor: data.nextCursor, count: data.count, countIsCapped: data.countIsCapped,
          loading: false, loadingMore: false, error: '', loaded: true };
      }
      const seen = new Set(state.jobs.map(j => j.id));
      const fresh = data.jobs.filter(j => !seen.has(j.id));
      return { ...state, jobs: [...state.jobs, ...fresh], nextCursor: data.nextCursor,
        count: data.count ?? state.count, countIsCapped: data.count == null ? state.countIsCapped : data.countIsCapped,
        loading: false, loadingMore: false, error: '', loaded: true };
    }
    case 'error':
      return { ...state, loading: false, loadingMore: false, error: action.message, loaded: true };
    default:
      return state;
  }
}
```

```js
// job-aggregator-frontend/src/feed/useFeed.js
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { feedReducer, initialFeedState } from './feedState';
import { fetchFeed } from './feedApi';

// `preload` (optional) is the in-flight first-page request started by the
// inline script in index.html; it is only used for the very first load.
export function useFeed({ apiBase, filters, token, preload }) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const seq = useRef(0);
  const abort = useRef(null);
  const nextCursorRef = useRef(null);
  const usedPreload = useRef(false);
  // Captured at mount only. The inline script clears window.__feedPreload
  // after one use, so a later render passes a different value; that must not
  // change `run` and trigger a second fetch.
  const preloadRef = useRef(preload);
  nextCursorRef.current = state.nextCursor;

  const run = useCallback(async (append, cursor) => {
    const mySeq = ++seq.current;
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    dispatch({ type: 'start', append });
    try {
      let data;
      if (!append && !usedPreload.current && preloadRef.current) {
        usedPreload.current = true;
        try { data = await preloadRef.current(filters); } catch { data = undefined; }
      }
      if (!data) data = await fetchFeed(apiBase, { ...filters, cursor }, { signal: abort.current.signal, token });
      if (mySeq !== seq.current) return;   // a newer request superseded this one
      dispatch({ type: 'success', append, data });
    } catch (e) {
      if (e.name === 'AbortError' || mySeq !== seq.current) return;
      dispatch({ type: 'error', message: e.message });
    }
  }, [apiBase, filters, token]);

  // Refetch from the top whenever the filters or the signed-in token change.
  useEffect(() => { run(false, ''); return () => abort.current?.abort(); }, [run]);

  const loadMore = useCallback(() => { if (nextCursorRef.current) run(true, nextCursorRef.current); }, [run]);
  const retry = useCallback(() => run(false, ''), [run]);
  return { ...state, loadMore, retry };
}
```

The `filters` object passed in must be memoised by the caller (`useMemo`), otherwise it refetches on every render. `FeedPage` (Task 13) does this.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: PASS (all `src/feed` tests, 13 total)

- [ ] **Step 5: Commit**

```bash
git add job-aggregator-frontend/src/feed/feedState.js job-aggregator-frontend/src/feed/feedState.test.js job-aggregator-frontend/src/feed/useFeed.js
git commit -m "feat(feed-ui): list state reducer and useFeed hook"
```

---

### Task 13: Components, styles and font

**Files:**
- Create: `job-aggregator-frontend/src/feed/JobCard.jsx`, `JobCardSkeleton.jsx`, `PlaceTypeahead.jsx`, `SearchBar.jsx`, `FilterPills.jsx`, `FeedPage.jsx`, `feed.css`
- Modify: `job-aggregator-frontend/public/index.html` (font only; the preload script is Task 15)
- Test: `job-aggregator-frontend/src/feed/JobCard.test.js`

**Interfaces:**
- Consumes: `useFeed` (Task 12); `fetchSuggest`, `fetchStats` (Task 11); `guessPlace`, `loadSavedPlace`, `savePlace`, `placeFromSuggestion`, `EMPTY_PLACE` (Task 11).
- Produces:
  - `JobCard({ job, selected, onSelect })`; `JobCardSkeleton()`
  - `PlaceTypeahead({ apiBase, place, onChange })`; `SearchBar({ apiBase, q, place, onSearch(q, place) })`; `FilterPills({ filters, onChange })`
  - `FeedPage({ apiBase, session, selectedJob, onSelectJob, detail, extensionUrl })`, where `detail` is a React node (the existing job detail pane) rendered in the right column. `onSelectJob(card)` receives the card mapped to the shape the existing detail pane expects (`cities`, `countries`, `company_domain` added).

- [ ] **Step 1: Write the failing component test (server render, no extra libraries)**

```js
// job-aggregator-frontend/src/feed/JobCard.test.js
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobCard from './JobCard';
import JobCardSkeleton from './JobCardSkeleton';

const card = (over = {}) => ({
  id: 1, title: 'Staff Engineer', company_name: 'Acme', company_logo_domain: 'acme.com', city: 'Austin',
  region_code: 'TX', country_code: 'US', country: 'United States', remote: false, autofill_ready: true,
  apply_provider: 'greenhouse', salary_min: 150000, salary_max: 190000, salary_currency: 'USD',
  posted_at: new Date(Date.now() - 2 * 86400000).toISOString(), employment_type: 'full_time', ...over,
});

test('card shows title, company, place, age and the autofill mark', () => {
  const html = renderToStaticMarkup(<JobCard job={card()} selected={false} onSelect={() => {}} />);
  expect(html).toContain('Staff Engineer');
  expect(html).toContain('Acme');
  expect(html).toContain('Austin, TX');
  expect(html).toContain('2d ago');
  expect(html).toContain('Autofill');
});

test('no autofill mark when the job is not on a supported ATS', () => {
  const html = renderToStaticMarkup(<JobCard job={card({ autofill_ready: false, apply_provider: null })} selected={false} onSelect={() => {}} />);
  expect(html).not.toContain('Autofill');
});

test('remote jobs say Remote; a job with no place says nothing misleading', () => {
  expect(renderToStaticMarkup(<JobCard job={card({ remote: true })} selected={false} onSelect={() => {}} />)).toContain('Remote');
  const none = renderToStaticMarkup(<JobCard job={card({ city: null, region_code: '', country: null, country_code: 'ZZ' })} selected={false} onSelect={() => {}} />);
  expect(none).toContain('Location not specified');
});

test('selected card is marked for assistive tech', () => {
  expect(renderToStaticMarkup(<JobCard job={card()} selected onSelect={() => {}} />)).toContain('aria-current="true"');
});

test('skeleton renders placeholder cards without text content', () => {
  const html = renderToStaticMarkup(<JobCardSkeleton />);
  expect(html).toContain('feed-skeleton');
  expect(html).toContain('aria-hidden="true"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed/JobCard`
Expected: FAIL with `Cannot find module './JobCard'`

- [ ] **Step 3: Write the components**

```jsx
// job-aggregator-frontend/src/feed/JobCard.jsx
import React from 'react';

function age(iso) {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));
  return d === 0 ? 'Today' : `${d}d ago`;
}

function place(job) {
  const bits = [job.city, job.region_code, job.city ? null : job.country].filter(Boolean);
  return bits.length ? bits.join(', ') : '';
}

function salary(job) {
  if (!job.salary_min && !job.salary_max) return '';
  const k = (n) => `${Math.round(n / 1000)}k`;
  const cur = job.salary_currency && job.salary_currency !== 'USD' ? ` ${job.salary_currency}` : '';
  return job.salary_min && job.salary_max ? `$${k(job.salary_min)}–${k(job.salary_max)}${cur}` : `$${k(job.salary_min || job.salary_max)}${cur}`;
}

export default function JobCard({ job, selected, onSelect }) {
  const where = place(job);
  const pay = salary(job);
  return (
    <button type="button" className={`feed-card${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined} onClick={() => onSelect(job)}>
      <span className="feed-card-title">{job.title}</span>
      <span className="feed-card-company">{job.company_name}</span>
      <span className="feed-card-meta">
        {where || (job.remote ? '' : 'Location not specified')}
        {job.remote && <span className="feed-chip">Remote</span>}
        {pay && <span className="feed-card-pay">{pay}</span>}
      </span>
      <span className="feed-card-foot">
        {job.autofill_ready && <span className="feed-autofill" title="The extension can autofill this application">Autofill</span>}
        <span className="feed-card-age">{job.posted_at ? age(job.posted_at) : ''}</span>
      </span>
    </button>
  );
}
```

```jsx
// job-aggregator-frontend/src/feed/JobCardSkeleton.jsx
import React from 'react';

export default function JobCardSkeleton({ count = 8 }) {
  return (
    <div className="feed-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="feed-card feed-card-skel" key={i}>
          <span className="skel skel-title" /><span className="skel skel-line" /><span className="skel skel-line short" />
        </div>
      ))}
    </div>
  );
}
```

```jsx
// job-aggregator-frontend/src/feed/PlaceTypeahead.jsx
import React, { useEffect, useRef, useState } from 'react';
import { fetchSuggest } from './feedApi';
import { placeFromSuggestion, EMPTY_PLACE } from './place';

export default function PlaceTypeahead({ apiBase, place, onChange }) {
  const [text, setText] = useState(place.label || '');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  useEffect(() => { setText(place.label || ''); }, [place.label]);

  useEffect(() => {
    const term = text.trim();
    if (!open || !term || term === place.label) { setOptions([]); return undefined; }
    const mySeq = ++seq.current;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchSuggest(apiBase, term, { signal: ctl.signal })
        .then(list => { if (mySeq === seq.current) { setOptions(list); setActive(-1); } })
        .catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, open, apiBase, place.label]);

  const choose = (opt) => { onChange(placeFromSuggestion(opt)); setText(opt.label); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="feed-place">
      <input
        type="text" role="combobox" aria-expanded={open && options.length > 0} aria-controls="feed-place-list"
        aria-autocomplete="list" aria-label="Location" placeholder="City, state or country"
        value={text} autoComplete="off"
        onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value) onChange(EMPTY_PLACE); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul id="feed-place-list" role="listbox" className="feed-place-list">
          {options.map((o, i) => (
            <li key={`${o.type}-${o.label}`} role="option" aria-selected={i === active}
              className={i === active ? 'is-active' : ''} onMouseDown={() => choose(o)}>
              <span>{o.label}</span><span className="feed-place-count">{o.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```jsx
// job-aggregator-frontend/src/feed/SearchBar.jsx
import React, { useState } from 'react';
import PlaceTypeahead from './PlaceTypeahead';

export default function SearchBar({ apiBase, q, place, onSearch }) {
  const [text, setText] = useState(q);
  const [pendingPlace, setPendingPlace] = useState(place);
  React.useEffect(() => { setPendingPlace(place); }, [place]);
  return (
    <form className="feed-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(text.trim(), pendingPlace); }}>
      <input type="search" aria-label="Job title, skill or company" placeholder="Title, skill or company"
        value={text} onChange={(e) => setText(e.target.value)} />
      <PlaceTypeahead apiBase={apiBase} place={pendingPlace} onChange={(p) => { setPendingPlace(p); onSearch(text.trim(), p); }} />
      <button type="submit" className="feed-search-btn">Search</button>
    </form>
  );
}
```

```jsx
// job-aggregator-frontend/src/feed/FilterPills.jsx
import React from 'react';

const TYPES = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract']];
const DAYS = [['1', 'Past 24 hours'], ['7', 'Past week'], ['30', 'Past month']];

export default function FilterPills({ filters, onChange }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const any = filters.remote || filters.type || filters.days;
  return (
    <div className="feed-pills" role="group" aria-label="Filters">
      <button type="button" className={`feed-pill${filters.remote ? ' on' : ''}`} aria-pressed={!!filters.remote}
        onClick={() => set({ remote: !filters.remote })}>Remote</button>
      <select className={`feed-pill${filters.days ? ' on' : ''}`} aria-label="Date posted" value={filters.days || ''}
        onChange={(e) => set({ days: e.target.value })}>
        <option value="">Date posted</option>
        {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select className={`feed-pill${filters.type ? ' on' : ''}`} aria-label="Job type" value={filters.type || ''}
        onChange={(e) => set({ type: e.target.value })}>
        <option value="">Job type</option>
        {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {any && <button type="button" className="feed-clear" onClick={() => set({ remote: false, type: '', days: '' })}>Clear all</button>}
    </div>
  );
}
```

```jsx
// job-aggregator-frontend/src/feed/FeedPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './feed.css';
import { useFeed } from './useFeed';
import { fetchStats } from './feedApi';
import { EMPTY_PLACE, guessPlace, loadSavedPlace, savePlace } from './place';
import SearchBar from './SearchBar';
import FilterPills from './FilterPills';
import JobCard from './JobCard';
import JobCardSkeleton from './JobCardSkeleton';

// The existing detail pane expects these shapes.
const toDetailJob = (card) => ({
  ...card,
  cities: card.city ? [card.city] : [],
  countries: card.country ? [card.country] : [],
});

export default function FeedPage({ apiBase, session, selectedJob, onSelectJob, detail, extensionUrl, preload }) {
  const initial = useMemo(() => {
    const saved = loadSavedPlace();
    if (saved) return { place: saved, source: 'saved' };
    return { place: guessPlace({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, languages: navigator.languages }), source: 'guess' };
  }, []);
  const [place, setPlace] = useState(initial.place);
  const [placeSource, setPlaceSource] = useState(initial.source);
  const [q, setQ] = useState('');
  const [pills, setPills] = useState({ remote: false, type: '', days: '' });
  const [stats, setStats] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);   // mobile: the detail pane as a full-screen sheet

  const filters = useMemo(() => ({ place, q, ...pills }), [place, q, pills]);
  const token = session?.access_token;
  const feed = useFeed({ apiBase, filters, token, preload });

  useEffect(() => { fetchStats(apiBase).then(setStats).catch(() => {}); }, [apiBase]);

  // A guessed (not chosen) place with no jobs widens to everywhere.
  useEffect(() => {
    if (feed.loaded && !feed.loading && placeSource === 'guess' && feed.jobs.length === 0 && !feed.error && place.country) {
      setPlace(EMPTY_PLACE);
    }
  }, [feed.loaded, feed.loading, feed.jobs.length, feed.error, placeSource, place.country]);

  // Select the first job once, so the detail pane is never empty on desktop.
  useEffect(() => {
    if (!selectedJob && feed.jobs.length > 0) onSelectJob(toDetailJob(feed.jobs[0]));
  }, [feed.jobs, selectedJob, onSelectJob]);

  const onSearch = useCallback((nextQ, nextPlace) => {
    setQ(nextQ);
    if (nextPlace.label !== place.label) { setPlace(nextPlace); setPlaceSource('user'); savePlace(nextPlace); }
  }, [place.label]);

  const choose = useCallback((job) => { onSelectJob(toDetailJob(job)); setSheetOpen(true); }, [onSelectJob]);

  const where = place.label || 'everywhere';
  const heading = feed.count == null ? 'Jobs' : `${feed.count.toLocaleString()}${feed.countIsCapped ? '+' : ''} jobs in ${where}`;

  return (
    <div className="feed-page">
      <div className="feed-top">
        <SearchBar apiBase={apiBase} q={q} place={place} onSearch={onSearch} />
        <FilterPills filters={pills} onChange={setPills} />
        {stats && (
          <p className="feed-stats">{stats.jobs.toLocaleString()} open jobs from {stats.companies.toLocaleString()} companies. <a href={extensionUrl} target="_blank" rel="noopener noreferrer">Add the Chrome extension</a> to autofill applications.</p>
        )}
      </div>
      <div className="feed-body">
        <section className="feed-list" aria-label="Job results" aria-busy={feed.loading}>
          <h2 className="feed-heading">{heading}</h2>
          {feed.error && (
            <div className="feed-error" role="alert">
              Couldn't load jobs. <button type="button" onClick={feed.retry}>Retry</button>
            </div>
          )}
          {!feed.loaded && <JobCardSkeleton />}
          {feed.loaded && feed.jobs.length === 0 && !feed.error && (
            <p className="feed-empty">No jobs match. Try a wider place or turn off filters.</p>
          )}
          <div className={feed.loading ? 'feed-stale' : ''}>
            {feed.jobs.map(job => (
              <JobCard key={job.id} job={job} selected={selectedJob?.id === job.id} onSelect={choose} />
            ))}
          </div>
          {feed.nextCursor && (
            <button type="button" className="feed-more" disabled={feed.loadingMore} onClick={feed.loadMore}>
              {feed.loadingMore ? 'Loading…' : 'Show more jobs'}
            </button>
          )}
        </section>
        <section className={`feed-detail${sheetOpen ? ' is-open' : ''}`} aria-label="Job details">
          <button type="button" className="feed-back" onClick={() => setSheetOpen(false)}>Back to jobs</button>
          {detail}
        </section>
      </div>
    </div>
  );
}
```

```css
/* job-aggregator-frontend/src/feed/feed.css */
.feed-page {
  --ink: #1d2226; --surface: #ffffff; --canvas: #f1f4f7; --line: #d9e0e7;
  --blue: #0a66c2; --green: #0f7552; --muted: #5e6b78;
  font-family: 'Source Sans 3', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--ink); background: var(--canvas); min-height: 100vh;
}
@media (prefers-color-scheme: dark) {
  .feed-page { --ink: #e6e9ec; --surface: #1b1f24; --canvas: #12161a; --line: #2b323a; --blue: #58a6ff; --green: #3fb98a; --muted: #9aa6b2; }
}
.feed-top { position: sticky; top: 0; z-index: 5; background: var(--surface); border-bottom: 1px solid var(--line); padding: 10px 16px; }
.feed-search { display: flex; gap: 8px; max-width: 1100px; margin: 0 auto; }
.feed-search input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; }
.feed-search-btn { padding: 9px 18px; border: 0; border-radius: 6px; background: var(--blue); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.feed-place { position: relative; flex: 1; display: flex; }
.feed-place input { width: 100%; }
.feed-place-list { position: absolute; top: 100%; left: 0; right: 0; margin: 4px 0 0; padding: 4px 0; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.12); z-index: 10; }
.feed-place-list li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; cursor: pointer; }
.feed-place-list li.is-active, .feed-place-list li:hover { background: var(--canvas); }
.feed-place-count { color: var(--muted); font-size: 13px; }
.feed-pills { display: flex; gap: 8px; max-width: 1100px; margin: 8px auto 0; overflow-x: auto; }
.feed-pill { padding: 5px 12px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap; }
.feed-pill.on { background: var(--blue); border-color: var(--blue); color: #fff; }
.feed-clear { border: 0; background: none; color: var(--blue); font: inherit; font-size: 14px; cursor: pointer; }
.feed-stats { max-width: 1100px; margin: 8px auto 0; font-size: 13px; color: var(--muted); }
.feed-stats a { color: var(--blue); }
.feed-body { display: grid; grid-template-columns: minmax(300px, 420px) 1fr; gap: 16px; max-width: 1100px; margin: 16px auto; padding: 0 16px; align-items: start; }
.feed-list { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.feed-heading { font-size: 15px; font-weight: 600; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.feed-card { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; padding: 12px 14px; background: var(--surface); color: var(--ink); border: 0; border-bottom: 1px solid var(--line); font: inherit; cursor: pointer; }
.feed-card.is-selected { box-shadow: inset 3px 0 0 var(--blue); background: var(--canvas); }
.feed-card-title { font-size: 16px; font-weight: 600; color: var(--blue); }
.feed-card-company, .feed-card-meta, .feed-card-age { font-size: 14px; color: var(--muted); }
.feed-card-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.feed-card-pay { color: var(--ink); }
.feed-chip { padding: 0 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; color: var(--ink); }
.feed-card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
.feed-autofill { font-size: 12px; font-weight: 600; color: var(--green); }
.feed-autofill::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--green); }
.feed-more { display: block; width: calc(100% - 28px); margin: 12px 14px; padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
.feed-empty, .feed-error { padding: 24px 14px; color: var(--muted); }
.feed-error button { color: var(--blue); background: none; border: 0; font: inherit; cursor: pointer; text-decoration: underline; }
.feed-stale { opacity: .55; transition: opacity .15s; }
.feed-detail { min-width: 0; }
.skel { display: block; border-radius: 4px; background: linear-gradient(90deg, var(--line), var(--canvas), var(--line)); background-size: 200% 100%; animation: feed-shimmer 1.2s linear infinite; }
.skel-title { height: 16px; width: 70%; } .skel-line { height: 12px; width: 50%; } .skel-line.short { width: 30%; }
@keyframes feed-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } .feed-stale { transition: none; } }
@media (max-width: 800px) {
  .feed-search { flex-wrap: wrap; } .feed-search input[type=search] { flex-basis: 100%; }
  .feed-body { grid-template-columns: 1fr; margin: 0; padding: 0; } .feed-list { border-radius: 0; border-left: 0; border-right: 0; }
  .feed-detail { display: none; }
  .feed-detail.is-open { display: block; position: fixed; inset: 0; z-index: 20; overflow: auto; background: var(--canvas); padding: 0 0 24px; }
  .feed-back { display: block; position: sticky; top: 0; width: 100%; padding: 12px 16px; border: 0; border-bottom: 1px solid var(--line); background: var(--surface); color: var(--blue); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
}
.feed-back { display: none; }
.feed-page :focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
```

On screens narrower than 800 px the detail pane becomes a full-screen sheet: tapping a card opens it, and "Back to jobs" closes it. The first job is still auto-selected on load, but that does not open the sheet.

Add the font to `job-aggregator-frontend/public/index.html`, inside `<head>` before `<title>`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: PASS (all `src/feed` tests, 18 total)

- [ ] **Step 5: Build to verify the components compile**

Run: `cd job-aggregator-frontend && CI=false npm run build 2>&1 | grep -E "Compiled|Failed|Module not found|feed/"`
Expected: `Compiled` with no errors mentioning `src/feed`.

- [ ] **Step 6: Commit**

```bash
git add job-aggregator-frontend/src/feed job-aggregator-frontend/public/index.html
git commit -m "feat(feed-ui): search bar, place typeahead, cards, skeleton and styles"
```

---

### Task 14: Mount the feed in `App.jsx` behind a flag

**Files:**
- Modify: `job-aggregator-frontend/src/App.jsx`
- Create: `job-aggregator-frontend/src/feed/flag.js`
- Test: `job-aggregator-frontend/src/feed/flag.test.js`

**Interfaces:**
- Consumes: `FeedPage` (Task 13).
- Produces: `isFeedV2Enabled(search, storage, defaultOn) -> boolean` in `flag.js`; `App.jsx` renders `FeedPage` for the jobs tab when the flag is on, and keeps the old UI otherwise.

- [ ] **Step 1: Write the failing flag test**

```js
// job-aggregator-frontend/src/feed/flag.test.js
import { isFeedV2Enabled } from './flag';

const store = (initial = {}) => {
  const m = { ...initial };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
};

test('?feed=v2 turns it on and remembers; ?feed=v1 turns it off and remembers', () => {
  const s = store();
  expect(isFeedV2Enabled('?feed=v2', s, false)).toBe(true);
  expect(isFeedV2Enabled('', s, false)).toBe(true);        // remembered
  expect(isFeedV2Enabled('?feed=v1', s, true)).toBe(false);
  expect(isFeedV2Enabled('', s, true)).toBe(false);        // remembered
});

test('with nothing set, the default applies', () => {
  expect(isFeedV2Enabled('', store(), false)).toBe(false);
  expect(isFeedV2Enabled('', store(), true)).toBe(true);
});

test('broken storage does not throw', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  expect(isFeedV2Enabled('?feed=v2', bad, false)).toBe(true);
  expect(isFeedV2Enabled('', bad, true)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed/flag`
Expected: FAIL with `Cannot find module './flag'`

- [ ] **Step 3: Write the flag and make the mechanical `App.jsx` edit**

```js
// job-aggregator-frontend/src/feed/flag.js
// The default flips to true at cutover (Task 16).
export const FEED_V2_DEFAULT = false;

export function isFeedV2Enabled(search, storage, defaultOn = FEED_V2_DEFAULT) {
  const param = new URLSearchParams(search).get('feed');
  try {
    if (param === 'v2' || param === 'v1') { storage.setItem('sa_feed', param); }
    const v = param || storage.getItem('sa_feed');
    if (v === 'v2') return true;
    if (v === 'v1') return false;
  } catch {
    if (param === 'v2') return true;
    if (param === 'v1') return false;
  }
  return defaultOn;
}
```

Apply this scripted transformation to `job-aggregator-frontend/src/App.jsx`. It moves the existing detail-pane JSX into a local function (no logic change), adds the flag, hides the hero, and mounts `FeedPage`. It aborts if any anchor is missing, so it cannot half-apply.

```bash
cd job-aggregator-frontend/src && python3 -I - <<'EOF'
import re, sys
s = open('App.jsx').read()

def must(cond, msg):
    if not cond: sys.exit('ABORT: ' + msg)

# 1. imports
anchor = "import './App.css';\n"
must(anchor in s, 'App.css import anchor')
s = s.replace(anchor, anchor + "import FeedPage from './feed/FeedPage';\nimport { isFeedV2Enabled } from './feed/flag';\n", 1)

# 2. move the detail JSX into renderJobDetail
start_marker = "        {/* Job Detail */}\n        {selectedJob && (\n"
end_marker = "\n        )}\n      </div>\n      </>}"
must(start_marker in s and end_marker in s, 'detail block markers')
a = s.index(start_marker)
b = s.index(end_marker, a)
detail_jsx = s[a + len(start_marker):b]           # the <div className="job-detail"> ... </div>
s = s[:a] + "        {renderJobDetail()}" + s[b + len("\n        )}"):]

ret = '  return (\n    <div className="app">'
must(ret in s, 'return anchor')
fn = "  const renderJobDetail = () => selectedJob && (\n" + detail_jsx + "\n  );\n\n"
s = s.replace(ret, fn + "  const feedV2 = React.useMemo(() => isFeedV2Enabled(window.location.search, window.localStorage), []);\n\n" + ret, 1)

# 3. old jobs UI only when the flag is off; hero only when the flag is off
old_open = "{activeTab === 'jobs' && <>"
must(old_open in s, 'jobs tab open')
s = s.replace(old_open, "{activeTab === 'jobs' && !feedV2 && <>", 1)
hero = "{!session && (\n        <div className=\"hero-card\">"
must(hero in s, 'hero anchor')
s = s.replace(hero, "{!feedV2 && !session && (\n        <div className=\"hero-card\">", 1)

# 4. mount FeedPage right after the old jobs block
close = "      </div>\n      </>}\n"
must(close in s, 'jobs block close')
mount = close + """      {activeTab === 'jobs' && feedV2 && (
        <FeedPage
          apiBase={API_URL}
          session={session}
          selectedJob={selectedJob}
          onSelectJob={selectJob}
          detail={renderJobDetail()}
          extensionUrl={EXTENSION_URL}
          preload={window.__feedPreload}
        />
      )}
"""
s = s.replace(close, mount, 1)
open('App.jsx', 'w').write(s)
print('ok')
EOF
```

Then check that nothing else references removed structure and that the old UI still works with the flag off:

Run: `cd job-aggregator-frontend && CI=false npm run build 2>&1 | grep -E "Compiled|Failed|Error|App.jsx"`
Expected: `Compiled` (existing lint warnings only). If the script printed `ABORT: ...`, the file changed since this plan was written: re-read `App.jsx` near the named anchor and adjust the marker text, do not edit by hand.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: PASS (all `src/feed` tests, 21 total)

- [ ] **Step 5: Manual check (both flags)**

```bash
cd job-aggregator-frontend && npm start
```
Open `http://localhost:3000/?feed=v1`: the page looks exactly as before (hero, old search, old list, detail pane). Open `http://localhost:3000/?feed=v2`: sticky search bar, filter pills, skeleton cards, then job cards; the first job's detail appears on the right; typing "aus" in Location offers "Austin, Texas, United States"; choosing it reloads the list; the Remote pill filters; "Show more jobs" appends without repeats. Narrow the browser below 800 px: tapping a card opens the job as a full-screen sheet and "Back to jobs" closes it. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add job-aggregator-frontend/src/App.jsx job-aggregator-frontend/src/feed/flag.js job-aggregator-frontend/src/feed/flag.test.js
git commit -m "feat(feed-ui): mount the new feed behind ?feed=v2"
```

---

### Task 15: First-page preload

**Files:**
- Modify: `job-aggregator-frontend/public/index.html`
- Test: `job-aggregator-frontend/src/feed/preloadScript.test.js` (extracts the shipped inline script from `index.html` and runs it with fakes, so the test exercises the real code)

**Interfaces:**
- Consumes: `/v2/jobs/feed` (Task 9); `useFeed({ preload })` (Task 12, which already reads the preload once at mount and falls back to a normal request when it returns `undefined` or rejects).
- Produces: `window.__feedPreload(filters) -> Promise<data>|undefined`. The inline script starts the request for the likely first place immediately. It returns the in-flight request once, and only when `filters` is the same unfiltered place (no keyword, Remote, type or date), otherwise `undefined`.

- [ ] **Step 1: Write the failing test**

```js
// job-aggregator-frontend/src/feed/preloadScript.test.js
import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('__feedPreload'));

function run({ search = '', tz = 'America/New_York', langs = ['en-US'], store = {}, v2Default = false, failFetch = false } = {}) {
  const calls = [];
  const win = { __FEED_V2_DEFAULT: v2Default };
  const fake = {
    location: { pathname: '/', search },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    navigator: { languages: langs },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) },
    fetch: (url) => {
      calls.push(url);
      return failFetch ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true, json: async () => ({ jobs: [] }) });
    },
  };
  new Function('window', 'location', 'localStorage', 'navigator', 'Intl', 'fetch', code)(
    win, fake.location, fake.localStorage, fake.navigator, fake.Intl, fake.fetch);
  return { win, calls };
}

const US = { place: { country: 'US', region: '', city: '' }, q: '', remote: false, type: '', days: '' };

test('the script exists in index.html', () => { expect(code).toBeTruthy(); });

test('does nothing unless v2 is on', () => {
  const r = run({});
  expect(r.calls).toEqual([]);
  expect(r.win.__feedPreload).toBeUndefined();
});

test('?feed=v2 preloads the place guessed from the timezone', () => {
  expect(run({ search: '?feed=v2' }).calls[0]).toMatch(/\/v2\/jobs\/feed\?country=US$/);
  expect(run({ search: '?feed=v2', tz: 'America/Toronto' }).calls[0]).toMatch(/country=CA$/);
  expect(run({ search: '?feed=v2', tz: 'Europe/London' }).calls[0]).toMatch(/country=GB$/);
  expect(run({ search: '?feed=v2', tz: 'Etc/UTC', langs: ['en-GB'] }).calls[0]).toMatch(/country=GB$/);
  expect(run({ search: '?feed=v2', tz: 'Etc/UTC', langs: ['en'] }).calls[0]).toMatch(/country=US$/);
});

test('a saved place wins over the guess, including region and city', () => {
  const store = { sa_place: JSON.stringify({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin' }) };
  expect(run({ search: '?feed=v2', tz: 'Europe/London', store }).calls[0]).toMatch(/country=US&region=TX&city=Austin$/);
  const worldwide = { sa_place: JSON.stringify({ country: '', region: '', city: '', label: '' }) };
  expect(run({ search: '?feed=v2', store: worldwide }).calls[0]).toMatch(/\/v2\/jobs\/feed$/);
});

test('mode precedence: ?feed param beats storage; v1 turns it off even when v2 is the default', () => {
  expect(run({ v2Default: true }).calls.length).toBe(1);
  expect(run({ v2Default: true, search: '?feed=v1' }).calls).toEqual([]);
  expect(run({ v2Default: true, store: { sa_feed: 'v1' } }).calls).toEqual([]);
  expect(run({ search: '?feed=v2', store: { sa_feed: 'v1' } }).calls.length).toBe(1);
});

test('hands over the request once, and only for the matching unfiltered place', async () => {
  const { win } = run({ search: '?feed=v2' });
  expect(win.__feedPreload({ ...US, q: 'engineer' })).toBeUndefined();     // filtered: not consumed
  expect(win.__feedPreload({ ...US, remote: true })).toBeUndefined();
  expect(win.__feedPreload({ ...US, place: { country: 'GB', region: '', city: '' } })).toBeUndefined();
  const pending = win.__feedPreload(US);
  expect(typeof pending.then).toBe('function');
  expect(await pending).toEqual({ jobs: [] });
  expect(win.__feedPreload).toBeUndefined();                                // one use only
});

test('a failed preload request does not throw at page load', async () => {
  const { win } = run({ search: '?feed=v2', failFetch: true });
  await expect(win.__feedPreload(US)).rejects.toThrow('offline');          // the hook catches this and falls back
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed/preloadScript`
Expected: FAIL: `expect(code).toBeTruthy()` fails (the script is not in `index.html` yet).

- [ ] **Step 3: Add the inline script**

Add to `job-aggregator-frontend/public/index.html`, inside `<head>`, after the font links:

```html
    <script>
      // Start the first page of jobs before the JS bundle has loaded. The app
      // picks this request up (see src/feed/useFeed.js); if its place or filters
      // differ, the app simply makes its own request. Mirrors guessPlace() in
      // src/feed/place.js; keep the two in step (tests cover both).
      (function () {
        try {
          if (location.pathname !== '/') return;
          var param = /[?&]feed=(v1|v2)/.exec(location.search);
          var mode = param ? param[1] : localStorage.getItem('sa_feed');
          if (mode === 'v1') return;
          if (mode !== 'v2' && !window.__FEED_V2_DEFAULT) return;

          var saved = null;
          try { saved = JSON.parse(localStorage.getItem('sa_place') || 'null'); } catch (e) {}
          var country, region = '', city = '';
          if (saved && typeof saved.country === 'string') {
            country = saved.country; region = saved.region || ''; city = saved.city || '';
          } else {
            var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
            var exact = { 'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR',
              'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
              'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Asia/Dubai': 'AE', 'Pacific/Auckland': 'NZ',
              'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX' };
            var canada = /\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal)$/;
            country = exact[tz] || (tz.indexOf('Australia/') === 0 ? 'AU'
              : tz.indexOf('America/') === 0 ? (canada.test(tz) ? 'CA' : 'US') : null);
            var known = ['US','CA','GB','IE','IN','AU','NZ','DE','FR','ES','NL','SG','JP','AE','BR','MX'];
            var langs = navigator.languages || [];
            for (var i = 0; i < langs.length && !country; i++) {
              var m = /^[a-z]{2,3}-([A-Za-z]{2})$/.exec(langs[i]);
              if (m && known.indexOf(m[1].toUpperCase()) >= 0) country = m[1].toUpperCase();
            }
            country = country || 'US';
          }

          var qs = [];
          if (country) qs.push('country=' + encodeURIComponent(country));
          if (region) qs.push('region=' + encodeURIComponent(region));
          if (city) qs.push('city=' + encodeURIComponent(city));
          var url = 'https://elevate-careers-api.fly.dev/v2/jobs/feed' + (qs.length ? '?' + qs.join('&') : '');
          var key = country + '|' + region + '|' + city;
          var pending = fetch(url).then(function (r) { if (!r.ok) throw new Error('preload ' + r.status); return r.json(); });
          pending.catch(function () {});   // never an unhandled rejection; the app falls back
          window.__feedPreload = function (filters) {
            var p = filters.place || {};
            var k = (p.country || '') + '|' + (p.region || '') + '|' + (p.city || '');
            if (k !== key || filters.q || filters.remote || filters.type || filters.days) return undefined;
            window.__feedPreload = undefined;   // one use only
            return pending;
          };
        } catch (e) { /* preload is an optimisation only */ }
      })();
    </script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false src/feed`
Expected: PASS (all `src/feed` tests).

- [ ] **Step 5: Measure the effect**

Run the production build and serve it: `cd job-aggregator-frontend && CI=false npm run build && npx --yes serve -s build -l 5000`, then open `http://localhost:5000/?feed=v2` in Chrome with the Network tab open. Expected: the `/v2/jobs/feed` request starts before `main.*.js` finishes downloading, and cards render with only one `jobs/feed` request in the Network tab. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add job-aggregator-frontend/public/index.html job-aggregator-frontend/src/feed/preloadScript.test.js
git commit -m "feat(feed-ui): start the first page request before the bundle loads"
```

---

### Task 16: Release, parity check and cutover

**Files:**
- Modify: `job-aggregator-frontend/src/feed/flag.js` (default to `true`)
- Modify: `job-aggregator-frontend/public/index.html` (set `window.__FEED_V2_DEFAULT = true;` before the preload script)
- Create: `supabase/migrations/20261009000000_admin_feed_health.sql`
- Modify: `job-aggregator-frontend/src/Admin.jsx`
- Create: `scripts/feed-parity.js`

**Interfaces:**
- Consumes: everything above.
- Produces: v2 as the default home feed; admin reconciliation counts; a parity script.

- [ ] **Step 1: Write the admin reconciliation function**

```sql
-- supabase/migrations/20261009000000_admin_feed_health.sql
-- Admin-only: how in sync is job_feed with job? Same access rule as simplyapply_admin_overview.
create or replace function public.simplyapply_admin_feed_health()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
      and lower(u.email) in (select lower(email) from public.simplyapply_admins)
      and (u.raw_app_meta_data->'providers') ? 'google'
  ) into v_ok;
  if not coalesce(v_ok, false) then raise exception 'not found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'feed_rows', (select reltuples::bigint from pg_class where oid = 'public.job_feed'::regclass),
    'active_jobs_missing_from_feed', (
      select count(*) from (select id from job where is_active order by id desc limit 50000) j
      where not exists (select 1 from job_feed f where f.job_id = j.id)),
    'unknown_location_jobs', (select count(distinct job_id) from job_feed where is_active and country_code = 'ZZ'),
    'inactive_job_active_in_feed', (
      select count(*) from (select job_id from job_feed where is_active limit 200000) f
      join job j on j.id = f.job_id where not j.is_active),
    'places', (select count(*) from geo_place)
  );
end;
$$;
revoke all on function public.simplyapply_admin_feed_health() from public, anon;
grant execute on function public.simplyapply_admin_feed_health() to authenticated;
```

Apply it with the MCP `apply_migration` tool. Then in `job-aggregator-frontend/src/Admin.jsx`, load it next to the overview and show it. After the line `setData(d); setState('ok');` add:

```js
    supabase.rpc('simplyapply_admin_feed_health').then(({ data: fh }) => setFeedHealth(fh || null));
```

declare `const [feedHealth, setFeedHealth] = useState(null);` beside the other `useState` calls, and add this section before the closing `</div></div>` of the page:

```jsx
      {feedHealth && (
        <>
          <h2>Home feed read model</h2>
          <div className="adm-grid">
            <Card n={feedHealth.feed_rows} l="job_feed rows (approx.)" />
            <Card n={feedHealth.active_jobs_missing_from_feed} l="Active jobs missing from feed (newest 50k)" />
            <Card n={feedHealth.inactive_job_active_in_feed} l="Inactive jobs still live in feed" />
            <Card n={feedHealth.unknown_location_jobs} l="Jobs with unknown location" />
            <Card n={feedHealth.places} l="Typeahead places" />
          </div>
        </>
      )}
```

- [ ] **Step 2: Write the parity script**

```js
// scripts/feed-parity.js
// Compares the old /jobs response with the new /v2/jobs/feed for the same
// filters. Differences are expected only for unlocated jobs and inactive jobs;
// this prints the overlap so a human can judge. Read only.
//   node scripts/feed-parity.js [apiBase]
const base = process.argv[2] || 'https://elevate-careers-api.fly.dev';

const cases = [
  { name: 'US', old: 'location=United%20States', neu: 'country=US' },
  { name: 'US remote', old: 'location=United%20States&remote=true', neu: 'country=US&remote=true' },
  { name: 'UK', old: 'location=UK', neu: 'country=GB' },
  { name: 'engineer in US', old: 'location=United%20States&keyword=engineer', neu: 'country=US&q=engineer' },
];

for (const c of cases) {
  const t0 = Date.now();
  const o = await (await fetch(`${base}/jobs?limit=50&${c.old}`)).json();
  const tOld = Date.now() - t0;
  const t1 = Date.now();
  const n = await (await fetch(`${base}/v2/jobs/feed?limit=25&${c.neu}`)).json();
  const tNew = Date.now() - t1;
  const oldIds = new Set((o.jobs || []).slice(0, 25).map(j => String(j.id)));
  const overlap = n.jobs.filter(j => oldIds.has(String(j.id))).length;
  console.log(`${c.name.padEnd(16)} old ${String(tOld).padStart(5)} ms  new ${String(tNew).padStart(5)} ms  top-25 overlap ${overlap}/${n.jobs.length}`);
}
```

- [ ] **Step 3: Run the parity check and the plan check (before cutover)**

Run: `node scripts/explain-feed.js && node scripts/feed-parity.js`
Expected: every scenario `ok`; new latency is a small fraction of old; top-25 overlap is high for place queries (the old substring match catches slightly different jobs, so 100% is not expected). If a place query returns far fewer jobs than the old one, investigate before cutover: that is a normalisation gap, fix it in `places.js` (new fixture first) and re-run the backfill.

- [ ] **Step 4: Measure latency against the success criteria**

Run, from a machine with a normal connection:

```bash
for u in "v2/jobs/feed?country=US" "v2/jobs/feed" "v2/jobs/feed?country=GB&remote=true" "v2/jobs/feed?country=US&q=engineer"; do
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -w "%{time_total}\n" "https://elevate-careers-api.fly.dev/$u"; done | sort -n | awk -v u="$u" '{a[NR]=$1} END {printf "%-40s median %.3fs  max %.3fs\n", u, a[int(NR/2)+1], a[NR]}'
done
```

Expected: every median and max under 0.3 s, except the keyword case under 0.8 s. If the keyword case misses 0.8 s, do the follow-up named in Global Constraints (copy `tsv` into `job_feed` with a GIN index) before cutover, or ship cutover with keyword search still on the old endpoint.

- [ ] **Step 5: Cut over the default**

In `job-aggregator-frontend/src/feed/flag.js` change `export const FEED_V2_DEFAULT = false;` to `true`. In `job-aggregator-frontend/public/index.html`, add `<script>window.__FEED_V2_DEFAULT = true;</script>` immediately before the preload script. Update the test in `flag.test.js` that asserts the default (`'with nothing set, the default applies'` already passes both values explicitly, so it needs no change).

Run: `cd job-aggregator-frontend && CI=true npx react-scripts test --watchAll=false && CI=false npm run build 2>&1 | grep -E "Compiled|Failed"`
Expected: all tests pass; `Compiled`.

- [ ] **Step 6: Known gap check and note**

The signed-in "Recommended for you" feed (`/jobs/personalized`) is not part of this plan. With v2 on, signed-in users see the v2 feed (with their dismissed jobs and excluded companies applied). Measure whether personalized is also slow, with a real token in `$TOKEN`: `curl -s -o /dev/null -w "%{time_total}s\n" -H "Authorization: Bearer $TOKEN" "https://elevate-careers-api.fly.dev/jobs/personalized?limit=20"`. Record the number in the PR description; if it is over a second, open a follow-up to move personalised ranking onto `job_feed`.

- [ ] **Step 7: Open the PRs and deploy in the rollout order**

1. PR 1 (data layer): Tasks 1 to 6. After merge and the Actions deploy, run Task 5 Step 5 (backfill and gate) and Task 6 Step 6 (indexes and places) in production.
2. PR 2 (API): Tasks 7 to 10. Merge; watch `gh run list --workflow=fly-deploy.yml --limit 3`; then run `node scripts/explain-feed.js`.
3. PR 3 (frontend): Tasks 11 to 15, behind `?feed=v2`. Deploy the frontend manually from a clean checkout of the merged commit: `cd job-aggregator-frontend && flyctl deploy -a elevate-careers-web --remote-only` (the frontend has no CI deploy). Compare v1 and v2 by eye on desktop and a phone.
4. PR 4 (cutover): Task 16. Deploy the frontend the same way.

```bash
git add supabase/migrations/20261009000000_admin_feed_health.sql job-aggregator-frontend/src/Admin.jsx job-aggregator-frontend/src/feed/flag.js job-aggregator-frontend/public/index.html scripts/feed-parity.js
git commit -m "feat(feed): admin feed health, parity script and v2 as default"
```

---

## Self-review notes

- **Spec coverage:** read model and indexes (Tasks 3, 6), normalisation with the 95% gate (Tasks 1, 5), `geo_place` and matching rules (Tasks 6, 8, 9), `/v2` endpoints with keyset paging, capped and precomputed counts, exclusions (Tasks 8, 9), Redis cache with stale-while-revalidate and the background warmer (Tasks 7, 10), frontend layout, tokens, copy, skeletons, default place guess, preload (Tasks 11 to 15), hero and hardcoded stats removed (Task 14, flag off; Task 16, flag on), rollout and the main-auto-deploy prerequisite (rollout order, Task 16), reconciliation on the admin page (Task 16), tests listed in the spec (each task).
- **Spec deviations** are listed at the top and need the spec updated to match (done alongside this plan).
- **Known gaps, stated rather than hidden:** title and location exclusions and personalised ranking are not in v2 (Review Focus 5, Task 16 Step 6); `tsv` copy for keyword speed is conditional on measurement.
