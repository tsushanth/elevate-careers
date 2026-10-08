# Manual SQL

These files are NOT migrations. Run them by hand, one statement at a time, outside a
transaction (CREATE INDEX CONCURRENTLY cannot run inside one, so `supabase db push` and
`apply_migration` would abort on them), off-peak, AFTER the backfill. Run nothing else
between statements. Then run `ANALYZE public.job_feed;` and rebuild geo_place.

Later files: 20261008000200_job_updated_at_index.sql is a single statement (idx_job_active_updated_at, used by the feed reconcile job); run it on its own. Check it is valid with: select indisvalid from pg_index where indexrelid = 'public.idx_job_active_updated_at'::regclass;
