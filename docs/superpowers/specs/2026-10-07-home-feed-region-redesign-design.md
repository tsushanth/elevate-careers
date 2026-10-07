# Home feed: fast first page and LinkedIn-style region search

Status: draft for review (2026-10-07)

## Intent

SimplyApply's home page should show jobs immediately and let a visitor narrow
them by location the way LinkedIn does. Today the first page of jobs can take
about 30 seconds, and the only location control is a free-text box that does a
slow substring match over messy data.

Success criteria (measured, not assumed):

1. Server time for the first page of any region is under 300 ms at p95, cold or warm.
2. A visitor sees real job cards within 1.5 s of page load on broadband, with skeleton cards before that.
3. A visitor can choose a place (country, state or city) from a typeahead, and the result set is correct for that place.
4. The home page makes no claim the data does not support (no hardcoded job or company counts).

Out of scope: personalised ranking, salary or experience filters, map view, saved searches, changes to the extension or the admin page.

## Findings that shape the design

Measured on 2026-10-07:

- `GET /jobs?limit=20` took 32.7 s on a cold call and 0.17 s on repeats. The repeats are served by a 60-second in-process cache in the API, so any visitor after the cache expires waits for the full query.
- The query joins `job`, `company` and `job_location`, groups, sorts by `posted_at` and only then applies `LIMIT`. `job` has about 308k rows (about 107k active) and has no index that serves the sort.
- `job_location` is unreliable for filtering. About 32k rows have no country. The `country` column holds a mix of countries, US state codes and state names (`United States`, `CA`, `TX`, `NY`, `California`, `UK`, `United Kingdom`). A bare `CA` is far more likely California than Canada, so naive matching would mislabel jobs.
- The home page is a client-rendered app. It does not start the feed request until the JS bundle has loaded and run, and a hero card pushes the first job below the fold.
- The hero hardcodes "309K+ jobs, 11,404 companies, 37K+ remote". The database has about 107k active jobs.
- The authenticated Supabase role has an 8 s statement timeout, so any query that scans `job` is unsafe to call from the browser.

The slowness and the region filter share one cause: location lives in a messy, unindexed side table, and the feed query pays for it on every request. The design fixes both with a precomputed read model.

## Design

### 1. Read model: `job_feed`

One row per (job, country, region, city), holding everything a list card needs, so the feed query is a single index range scan with no joins or aggregation. Three flags mark one representative row per job (`is_primary`), per job and country (`is_country_primary`) and per job, country and region (`is_region_primary`), so broader views never list a job twice. A row per city is needed because a state or city filter would otherwise miss jobs that list several cities in one country.

Columns (names indicative):

- `job_id`, `country_code` (ISO-2, or `ZZ` when unknown), `region_code` (state or province, empty string when none), `city_key` (lower-case city, empty string when none), `city`
- `sort_at` (`posted_at`, or the job's `created_at` when it has none, so the sort key is never null), `remote`, `employment_type`, `salary_min`, `salary_max`, `salary_currency`
- card fields copied from `job` and `company`: `title`, `company_name`, `company_key` (the normalised company name, for excluded-company filtering), `company_logo_domain`, `provider`, `apply_url` (so Apply works before the detail request returns), `apply_provider` (greenhouse, lever, ashby and so on)
- `autofill_ready` (true when the apply link is on an ATS the extension supports)
- `is_active`

Indexes (created `CONCURRENTLY`, off-peak):

- `(sort_at DESC, job_id DESC) WHERE is_active AND is_primary` for the worldwide view
- `(sort_at DESC, job_id DESC) WHERE is_active AND is_primary AND remote` for worldwide Remote
- `(country_code, sort_at DESC, job_id DESC) WHERE is_active AND is_country_primary`
- `(country_code, region_code, sort_at DESC, job_id DESC) WHERE is_active AND is_region_primary`
- `(country_code, region_code, city_key, sort_at DESC, job_id DESC) WHERE is_active`

Jobs with several locations get one row per distinct (country, region, city). A job with no resolvable country gets one row with `country_code = 'ZZ'`.

Maintenance:

- The ingest path writes the `job_feed` rows in the same transaction as the `job` upsert, and sets `is_active = false` when a job is deactivated.
- A one-time backfill populates existing jobs in batches. It runs while ingestion is also writing, so it must be idempotent and resumable.
- A reconciliation query (daily) reports jobs with no `job_feed` row and rows whose job is inactive. The admin page can show both counts.

### 2. Location normalisation

Reuse `src/services/geo.js` (`resolveLocationToken` and its dictionaries). Add a normaliser that turns a `job_location` row into `(country_code, region_code, city)` with these rules:

- If the `country` field holds a US state code or name, the country is `US` and the value is the region. `CA` in the country column means California unless the region or city says Canada. This rule needs fixtures drawn from real rows.
- Free-text country names and synonyms (`UK`, `United Kingdom`, `England`) map to one ISO code.
- Anything that cannot be resolved becomes `ZZ`, never a guess.

Acceptance check for the backfill: sample 300 rows across the top 20 raw values, compare against a hand label, and require at least 95% agreement before the filter is switched on.

### 3. Places for the typeahead: `geo_place`

A small table of selectable places (`label`, `name_key` for prefix matching, `type` = country, state or city, `country_code`, `region_code`, `city_key`, `job_count`), rebuilt from `job_feed` counts by the API process at start-up and then hourly. Cities appear only with at least three active jobs. Only places with at least one active job are included.

Matching, following LinkedIn:

- selecting a country returns jobs in any city or state of that country, plus jobs tagged only with the country;
- selecting a state returns that state's jobs;
- selecting a city returns jobs in that city;
- Remote is a separate toggle, not a place. Remote jobs with a known country also appear under that country when Remote is off.

Jobs with no known country (`ZZ`) appear only when no place is selected, or when Remote is on and they are marked remote.

### 4. API

New endpoints, leaving existing ones untouched until cut-over:

- `GET /v2/jobs/feed?country=&region=&city=&remote=&q=&type=&days=&cursor=&limit=25`
  - returns `{ jobs, nextCursor, count, countIsCapped }`;
  - keyset pagination on `(posted_at, job_id)` replaces `OFFSET`;
  - `count` is the precomputed `geo_place.job_count` when only a place is set, otherwise a capped count (up to 1,000, shown as "1,000+");
  - an optional bearer token applies the user's dismissed jobs and exclusions in SQL, as `/jobs` does today.
- `GET /v2/geo/suggest?q=` reads `geo_place`, prefix-matched and ranked by `job_count`.
- `GET /v2/stats` returns real totals (active jobs, companies, remote roles), cached for 10 minutes. The home page uses it instead of hardcoded numbers.

Keyword search keeps using the existing `tsv` index. Target: p95 under 800 ms. If it misses that, copy `tsv` into `job_feed` with a composite GIN index as a follow-up. This is an explicit decision point, not an assumed pass.

Caching: replace the in-process 60 s cache with Redis (the `elevate-redis` Fly app already exists), keyed on normalised parameters, for anonymous requests. Entries are served stale-while-revalidate, and a background warmer refreshes the first page of the top countries after ingestion and every minute, so no visitor pays a cold query.

### 5. Frontend

Header and layout follow LinkedIn: sticky top bar, no hero.

```
┌──────────────────────────────────────────────────────────────┐
│ SimplyApply  [ keywords ][ place ▾ typeahead ][Search]  Sign in │
├──────────────────────────────────────────────────────────────┤
│ (Remote) (Date posted ▾) (Job type ▾) (Company ▾)    Clear all │
├───────────────────────┬──────────────────────────────────────┤
│ N jobs in <place>     │ title · company                      │
│ job cards, autofill   │ place · posted · pay                 │
│ mark on supported ATS │ [Apply with autofill] [Save]         │
│ skeletons while       │ description                          │
│ loading               │                                      │
└───────────────────────┴──────────────────────────────────────┘
Mobile: sticky search, pills scroll sideways, detail opens as a full-screen sheet.
```

- Tokens: ink `#1d2226`, surface `#ffffff`, canvas `#f1f4f7`, line `#d9e0e7`, action blue `#0a66c2`, signal green `#12805c` used only for "autofill-ready". One typeface, Source Sans 3 (weights 400, 600, 700) with a system fallback. Sentence case.
- The memorable element is the autofill-ready mark on cards and the "Apply with autofill" primary action. Everything else stays quiet.
- Default place: the user's saved preference if signed in, else the last choice (localStorage), else a guess from the browser timezone and locale, else United States. Cloudflare's trace endpoint is not available on `www`, so no server-side geo lookup is used.
- Loading: an inline script in `index.html` starts the first-page request for the likely default place immediately, so it overlaps the JS download and the app consumes the in-flight request. Skeleton cards show until data arrives; a background refresh never blanks a visible list.
- Hero card, its gradient and hardcoded stats are removed. A single line of real counts from `/v2/stats` may sit under the search bar.
- Copy: "Apply with autofill", "No jobs match. Try a wider place or turn off filters." Errors say what failed and offer Retry.

### 6. Rollout

1. Create `job_feed`, `geo_place` and indexes. Backfill. Run the 300-row accuracy check.
2. Ship the `/v2` endpoints and ingest changes. Existing endpoints stay.
3. Ship the new frontend behind `?feed=v2`, then compare v1 and v2 result sets for the same filters.
4. Make v2 the default. Keep v1 for one release, then remove it.

Prerequisite decision: `elevate-careers-api` auto-deploys on every push to `main`, and local `main` is 185 commits ahead of GitHub. API changes must not ride out with those commits by accident. Either those commits are reviewed and pushed first, or the API is deployed manually from a clean worktree for this work. This must be settled before step 2.

### 7. Risks

- Backfill and live ingestion both write `job`. Mitigation: batched, idempotent backfill, run while ingestion is idle or throttled, and watch statement times.
- The Supabase project is shared with Replitor. New tables and indexes are additive and namespaced, but index builds consume shared resources. Build concurrently, off-peak.
- Normalisation errors mislabel jobs. Mitigation: conservative `ZZ` fallback and the 95% accuracy gate.
- Redis is a new dependency on the hot path. Mitigation: on a Redis error the API falls through to the database, never fails the request.
- A capped count is less precise than LinkedIn's. Accepted for speed.

## Testing

- Unit tests for the location normaliser using fixtures taken from real raw values (including `CA`, `TX`, `UK`, state names, empty).
- Database checks that the feed query plans use the intended index (no sequential scan of `job`) for: worldwide, country, country plus region, remote, and keyword.
- API contract tests for pagination (no duplicates or gaps across pages when new jobs arrive), auth exclusions and the empty result.
- A latency check against production-sized data for the p95 targets above.
- A browser smoke test of the home page: skeleton appears, jobs render, place typeahead filters, Remote toggle, mobile sheet.
- Parity check: for a sample of filters, v1 and v2 return the same top jobs apart from deliberate differences (unlocated jobs, inactive jobs).

## Open decisions

1. Whether unlocated jobs (`ZZ`) should be reviewed and cleaned over time (a later job) rather than only hidden from place searches.
2. Whether keyword search needs `tsv` copied into `job_feed` (decided by the measured p95).
3. How to resolve the `main` auto-deploy prerequisite (push the 185 commits, or deploy manually).
