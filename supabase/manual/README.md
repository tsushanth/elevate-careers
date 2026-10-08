# Manual SQL

These files are NOT migrations. Run them by hand, one statement at a time, outside a
transaction (CREATE INDEX CONCURRENTLY cannot run inside one, so `supabase db push` and
`apply_migration` would abort on them), off-peak, AFTER the backfill. Run nothing else
between statements. Then run `ANALYZE public.job_feed;` and rebuild geo_place.

Later files: 20261008000200_job_updated_at_index.sql is a single statement (idx_job_active_updated_at, used by the feed reconcile job); run it on its own. Check it is valid with: select indisvalid from pg_index where indexrelid = 'public.idx_job_active_updated_at'::regclass;

## Company diversity ordering (feed_at) - rollout, in this order

Every step is reversible; `FEED_ORDER` unset or `sort_at` is always the safe state.

1. (a) Apply `supabase/migrations/20261011000000_job_feed_company_rank.sql` (adds nullable `company_rank`, `feed_at`, and the functions `feed_rank_step()`, `feed_rank_cap()`, `feed_penalty()`, `recompute_company_rank(text[])`). Metadata only, no rewrite.
2. (a2) Run `20261011000100_job_feed_company_index.sql` (idx_feed_company, CONCURRENTLY).
3. (b) Deploy the API. It writes `feed_at` on every sync/deactivate/reconcile but still orders by `sort_at` (FEED_ORDER unset).
4. (c) Run `20261011000200_recompute_company_rank_all.sql` (one UPDATE; `set statement_timeout = '300s';` first if needed), then `ANALYZE public.job_feed;`. Check: `select count(*) from job_feed where is_active and feed_at is null;` should be ~0 (new rows in flight are fine).
5. (d) Run each statement of `20261011000300_job_feed_feedat_indexes.sql` on its own, then `ANALYZE public.job_feed;`. Check all valid: `select indexrelid::regclass, indisvalid from pg_index where indrelid = 'public.job_feed'::regclass;`. Verify with `FEED_ORDER=feed_at node scripts/explain-feed.js` (no FAIL lines).
6. (e) `fly secrets set FEED_ORDER=feed_at -a <api app>` (restarts machines). Clients holding a `sort_at` cursor get HTTP 409 `{restart:true}` once and must reload from page 1.
   Rollback: `fly secrets unset FEED_ORDER -a <api app>`; `feed_at` columns/indexes can stay.
