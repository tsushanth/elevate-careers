# Home feed rollout runbook

Branch: `feat/home-feed-v2`. Spec and plan: `docs/superpowers/specs|plans/2026-10-07-home-feed-region-redesign*`.

Nothing in this branch has touched production. Every step below that changes production is run by a person, in this order. Stop at any gate that fails.

## Facts that shape the order

- `elevate-careers-api` auto-deploys to Fly on every push to `main` (`.github/workflows/fly-deploy.yml`).
- The API **image also builds and serves a copy of the frontend** (root `Dockerfile` stage 1 runs `npm run build` in `job-aggregator-frontend/`; `src/api/server.js` serves it). So merging the cutover commit to `main` flips the copy served at `elevate-careers-api.fly.dev` to the new feed at once.
- `www.simplyappl.ai` is the separate Fly app `elevate-careers-web` (nginx), deployed by hand with `flyctl deploy -a elevate-careers-web --remote-only` from `job-aggregator-frontend/`. Confirm this before step 8.
- The new tables are read only by the API's Postgres role (RLS enabled, no policies). Confirm the API's `DATABASE_URL` role owns the tables or bypasses RLS (it does for the existing tables).
- The cutover is its own commit (`feat(feed-ui): make the new feed the default (cutover)`), last on the branch. Keep it out of the first PR.

## Gates before anything is merged

0. `fly secrets list -a elevate-careers-api` shows `REDIS_HOST` (and `REDIS_PASSWORD`/`REDIS_TLS` if used). Without `REDIS_HOST` the feed has no cache and the warmer is pure database load. `getRedis()` remembers "no Redis" until the process restarts, so restart the API after adding the secrets.
1. Decide the product question in the final review: v2 has no per-card dismiss menu, no show-applied toggle, no "Recommended for you" feed and no numbered pagination. Dismissed jobs and excluded companies are still honoured. State this in the release note.

## Order

1. **Apply the schema.** Apply `supabase/migrations/20261008000000_job_feed.sql` (transactional; `supabase db push` or the MCP `apply_migration`). Two empty tables; nothing reads them yet.
2. **PR 1: data layer + API + feed UI behind the flag (without the cutover commit).** Push the branch up to the commit before the cutover. Merge. The API deploys; watch `flyctl logs -a elevate-careers-api` for `job_feed sync failed` and, until `geo_place` has rows, one warmer warning a minute (expected, harmless). The old site is unaffected: the old endpoints are untouched.
3. **Backfill.** From a machine with the production `DATABASE_URL`: `node scripts/backfill-job-feed.js --batch=500 --sleep=100` (active jobs only; resumable: on failure rerun with the printed `--from=`). Run off-peak.
4. **Accuracy gate.** `node scripts/feed-accuracy-sample.js > sample.csv`, label `label_country` / `label_region` by hand (ISO-2, `ZZ` for unknown), `node scripts/feed-accuracy-check.js sample.csv` must print at least 95%. If not, add the failing raw values as fixtures to `src/services/places.test.js`, fix `places.js`, and rerun the backfill (idempotent).
5. **Indexes, by hand.** Run each statement of `supabase/manual/20261008000100_job_feed_indexes.sql` on its own (they are `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction), off-peak, then `ANALYZE public.job_feed;`. Do not put this file in `supabase/migrations`.
6. **Places.** `POST /ingest/rebuild-geo-places` with the `INGEST_SECRET` in the JSON body (or restart the API; the warmer rebuilds at start-up and hourly).
7. **Performance gate.** `node scripts/explain-feed.js` (every scenario `ok`, no `Seq Scan on job_feed`), then the timing loop in the plan's Task 16 Step 4: first page p95 under 300 ms for worldwide, country, state, city, remote; keyword under 800 ms. Check `X-Cache: HIT` on repeat requests. If keyword misses 800 ms, copy `tsv` into `job_feed` with a GIN index before the cutover (a follow-up in the plan).
8. **Frontend, default still off.** Deploy `elevate-careers-web` from a clean checkout of the PR 1 commit. Verify on production: `?feed=v2` (place typeahead, Remote, state, city, "Show more jobs", mobile sheet, a signed-in user with a dismissed job) and `?feed=v1` (old UI). Run `node scripts/feed-parity.js`.
9. **Admin card.** Apply `supabase/migrations/20261009000000_admin_feed_health.sql`; add the Admin.jsx section (patch in `.superpowers/.../task-16-report.md` history) once `feat/google-signin` (the admin page) has merged.
10. **PR 2: the cutover commit.** Merge it only after steps 3 to 8 passed. It flips the default in `flag.js` and `public/index.html` together (a test fails if they disagree). Then redeploy `elevate-careers-web`. Keep the previous build; `?feed=v1` is the per-user escape hatch and a redeploy of the previous build is the global one (there is no runtime kill switch for the default).
11. **After the cutover.** Schedule a re-sync of recently updated jobs (`syncJobFeedBatch`) and alert on the admin card's "active jobs missing from feed"; watch it for a week; remove the old UI one release later.

## Known follow-ups (not blockers)

- In-process L1 cache in front of Redis; log background refresh failures; throttle ioredis retry warnings.
- Mobile sheet: move focus into the sheet, `role="dialog"`, Escape to close.
- Typeahead matches only the start of place names ("NY", "UK" return nothing).
- Search button: add `onMouseDown={e => e.preventDefault()}` so clicking it more than ~120 ms after the input blurs does not discard the typed city (Enter is robust).
- `inactive_job_active_in_feed` in the admin function samples 200k rows unordered.
