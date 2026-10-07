# Manual SQL

These files are NOT migrations. Run them by hand, one statement at a time, outside a
transaction (CREATE INDEX CONCURRENTLY cannot run inside one, so `supabase db push` and
`apply_migration` would abort on them), off-peak, AFTER the backfill. Run nothing else
between statements. Then run `ANALYZE public.job_feed;` and rebuild geo_place.
