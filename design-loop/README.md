# design-loop

Iteratively nudges simplyappl.ai's UI toward LinkedIn's, one small scoped change per cycle: screenshot both → Claude judges the gap → Claude patches one file → build → deploy → re-screenshot → re-score → repeat.

Runs on branch `design-loop/auto` only — never pushes to `main`, so the existing `fly-deploy.yml` (push-to-main → deploys the API, not this frontend) never fires from this.

## Setup
```
cd design-loop && npm install && npx playwright install chromium
```
Requires: local `claude` CLI logged in (OAuth) — no `ANTHROPIC_API_KEY` needed, it's stripped from the subprocess env on purpose. Requires `flyctl auth login` for deploys.

## Run
```
node src/loop.js --no-deploy --iterations=1   # dry run: capture, judge, patch — no build/deploy/commit review yet
node src/loop.js --iterations=3               # small real run with deploys
node src/loop.js --iterations=20              # full run (default cap)
```

## Guardrails
- Build must pass (`npm run build`) before any deploy attempt.
- No-op detection: if a patch builds but produces byte-identical static output, it's marked `did-not-land` (not scored as "no improvement") and retried once with a different approach before being abandoned.
- Per-gap stagnation: 3 consecutive near-zero-delta attempts on the same gap → marked `exhausted`, never re-selected.
- Global stagnation: if the last 5 iterations summed to ≤2 points of improvement, the loop stops early rather than burning the rest of the iteration budget.
- Regression guard: if a deploy scores >3 points below the best-known score, it's auto-reverted and redeployed immediately.
- Missing *features* (not styling) go to `feature-backlog.json` for manual review — the loop never auto-builds backend/data-model changes.

## Output
- `runs/<n>/*.png` — screenshots per iteration
- `runs/log.jsonl` — one line per iteration: gap attempted, landed?, score delta, outcome
- `feature-backlog.json` — accumulated missing-feature suggestions
