# Deployed releases

The API (`elevate-careers-api`) deploys on every push to main (`.github/workflows/fly-deploy.yml`); end a commit subject with `[skip ci]` to avoid that. The worker (`elevate-careers-worker`) is deployed by hand with `flyctl deploy -c worker-fly.toml --remote-only` from a clean checkout of main.

## 2026-11-26: job id guard and single pool close (PR #60, main b2f168c)
- API v254 -> v255, image deployment-01M8AS33N6S16K3AK4MZ9X8MCX (GitHub Actions run 45739075659). Worker v6 -> v7, image deployment-01M8AS4YRRQ9JVTMEX9FNTEEG3, from a clean detached worktree of origin/main b2f168c, with the ingest queue at 0 active and no apply in flight. No secret touched; auto-apply stays paused.
- Fixes: `GET /jobs/:id` answered 500 for a non-numeric id (2026-11-25 18:14 UTC, a `curl` to `/jobs/feed` without `/v2`); a deploy raised "unhandled promise rejection" because SIGINT and SIGTERM both closed the database pool (2026-11-25 20:43 UTC).
- Worker monitor (#59, worker v6): all three checks run on the worker with no report (checked 2026-11-26, 0.5 s).
- Verified: `/health`, `/health/deep`, `/jobs?limit=1`, `/jobs/<id>`, `/v2/jobs/feed` 200; `/jobs/feed` and `/jobs/undefined` 404; changed files on both apps match main. Not verified: a shutdown that receives both signals on the new code (it happens only on some deploys).
- Rollback: `flyctl deploy -a elevate-careers-api --image registry.fly.io/elevate-careers-api:deployment-01M8A745VCD44KEHEQFFT153QC` and `flyctl deploy -a elevate-careers-worker -c worker-fly.toml --image registry.fly.io/elevate-careers-worker:deployment-01M8A75BJ7JPKNEZ3QWJEXT820`, then revert #60 on main (otherwise the next push redeploys it).
