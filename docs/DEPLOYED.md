# Deployed releases

The API (`elevate-careers-api`) deploys on every push to main (`.github/workflows/fly-deploy.yml`); end a commit subject with `[skip ci]` to avoid that. The worker (`elevate-careers-worker`) is deployed by hand with `flyctl deploy -c worker-fly.toml --remote-only` from a clean checkout of main.

## 2026-11-26: repair queue redaction and limits (PRs #62, #63, main 63cbcee): API v257
- API v255 -> v256 (image deployment-01M8BAKQNCM55NQZCTC8B216J9, #62) -> v257 (image deployment-01M8BATRNKH8SRFSHH7GYZF4V0, #63), both by GitHub Actions on merge. The worker stays on v7 (b2f168c): it loads neither `server.js` nor the repair routes.
- `POST /api/repair/queue` redacts typed values before storing, stays signed-out, takes at most 64 KB and 120 reports a minute per caller (600 overall). `GET /api/repair/admin/queue` redacts on the way out.
- Database (shared Supabase project), run by SQL on 2026-11-26: `supabase/migrations/20261126000000_repair_queue_redaction.sql`. New function `simplyapply_redact_fail_reason` (no public, anon or authenticated execute) and the admin overview uses it. The only change to the previous overview definition is that one column; its grants are unchanged. No row was changed.
- Verified: changed files on the API match main; health, rules and job endpoints 200; one made-up report stored redacted and then removed; 64 KB limit 413, unreadable body 400, limiter 429. Not verified: the admin queue and admin overview through a signed-in admin (no `REPAIR_ADMIN_SECRET` is set; the overview was checked by its definition and the same query).
- Rollback: `flyctl deploy -a elevate-careers-api --image registry.fly.io/elevate-careers-api:deployment-01M8AS33N6S16K3AK4MZ9X8MCX` and revert #63 and #62 on main. Database: run the function statement of `20261014000100_admin_overview_funnel.sql` again, then `drop function public.simplyapply_redact_fail_reason(text);`.

## 2026-11-26: job id guard and single pool close (PR #60, main b2f168c)
- API v254 -> v255, image deployment-01M8AS33N6S16K3AK4MZ9X8MCX (GitHub Actions run 45739075659). Worker v6 -> v7, image deployment-01M8AS4YRRQ9JVTMEX9FNTEEG3, from a clean detached worktree of origin/main b2f168c, with the ingest queue at 0 active and no apply in flight. No secret touched; auto-apply stays paused.
- Fixes: `GET /jobs/:id` answered 500 for a non-numeric id (2026-11-25 18:14 UTC, a `curl` to `/jobs/feed` without `/v2`); a deploy raised "unhandled promise rejection" because SIGINT and SIGTERM both closed the database pool (2026-11-25 20:43 UTC).
- Worker monitor (#59, worker v6): all three checks run on the worker with no report (checked 2026-11-26, 0.5 s).
- Verified: `/health`, `/health/deep`, `/jobs?limit=1`, `/jobs/<id>`, `/v2/jobs/feed` 200; `/jobs/feed` and `/jobs/undefined` 404; changed files on both apps match main. Not verified: a shutdown that receives both signals on the new code (it happens only on some deploys).
- Rollback: `flyctl deploy -a elevate-careers-api --image registry.fly.io/elevate-careers-api:deployment-01M8A745VCD44KEHEQFFT153QC` and `flyctl deploy -a elevate-careers-worker -c worker-fly.toml --image registry.fly.io/elevate-careers-worker:deployment-01M8A75BJ7JPKNEZ3QWJEXT820`, then revert #60 on main (otherwise the next push redeploys it).
