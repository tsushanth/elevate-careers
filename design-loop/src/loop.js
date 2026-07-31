import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, appendFile, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { capture, VIEWPORTS } from './browser.js';
import { judgePage } from './judge.js';
import { patchGap } from './patch.js';
import { build, hashBuild, deploy, revertLastCommit, FRONTEND_DIR } from './deploy.js';

const exec = promisify(execFile);
const REPO_DIR = FRONTEND_DIR.replace('/job-aggregator-frontend', '');
const RUNS_DIR = new URL('../runs', import.meta.url).pathname;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const MAX_ITERATIONS = Number(args.iterations ?? 20);
const NO_DEPLOY = Boolean(args['no-deploy']);

const PAGES = [
  { label: 'home', ourUrl: 'https://www.simplyappl.ai/', refUrl: 'https://www.linkedin.com/', sourceHint: 'job-aggregator-frontend/src/App.jsx' },
];

const PER_GAP_STAGNATION = 3; // consecutive near-zero-delta attempts before marking a gap exhausted
const PER_GAP_DELTA_THRESHOLD = 1; // "near-zero" means delta <= this
const GLOBAL_WINDOW = 5; // rolling window of last N iterations for the global stall check
const GLOBAL_STALL_SUM = 2; // if sum of deltas over the window <= this, stop early
const REGRESSION_THRESHOLD = 3; // points below best-known score that triggers auto-revert
const NOOP_RETRY_CAP = 2;

async function main() {
  await mkdir(RUNS_DIR, { recursive: true });
  const logPath = path.join(RUNS_DIR, 'log.jsonl');
  const backlogPath = new URL('../feature-backlog.json', import.meta.url).pathname;

  const gapMemory = {}; // id -> { attempts, deltas: [], status }
  const backlog = await loadJson(backlogPath, []);
  let bestScore = null;
  const scoreHistory = [];

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const iterDir = path.join(RUNS_DIR, String(iter));
    await mkdir(iterDir, { recursive: true });
    console.log(`\n=== iteration ${iter}/${MAX_ITERATIONS} ===`);

    // 1. capture (desktop viewport only for the tight loop; mobile can be added per-page)
    const page = PAGES[0];
    const ourShot = await capture(page.ourUrl, 'desktop', path.join(iterDir, 'ours.png'));
    const refShot = await capture(page.refUrl, 'desktop', path.join(iterDir, 'ref.png'));

    if (!ourShot || !refShot) {
      console.error('capture failed for this iteration, skipping (consider wiring cached reference fallback)');
      await log(logPath, { iter, outcome: 'capture-failed' });
      continue;
    }

    // 2. judge
    const excludeIds = Object.entries(gapMemory)
      .filter(([, m]) => m.status === 'exhausted' || m.status === 'did-not-land')
      .map(([id]) => id);
    const judgment = await judgePage({
      pageLabel: page.label,
      ourShot,
      refShot,
      sourceHint: page.sourceHint,
      excludeGapIds: excludeIds,
    });

    for (const f of judgment.missing_features || []) {
      if (!backlog.some((b) => b.name === f.name)) backlog.push(f);
    }
    await writeFile(backlogPath, JSON.stringify(backlog, null, 2));

    const scoreBefore = judgment.score;
    if (bestScore === null) bestScore = scoreBefore;

    // 3. select highest-priority non-exhausted gap
    const candidates = (judgment.gaps || [])
      .filter((g) => (gapMemory[g.id]?.status ?? 'open') === 'open')
      .sort((a, b) => b.priority - a.priority);
    const gap = candidates[0];

    if (!gap) {
      console.log('no open gaps left to attempt; stopping.');
      await log(logPath, { iter, outcome: 'no-gaps', score: scoreBefore });
      break;
    }

    gapMemory[gap.id] ??= { attempts: 0, deltas: [], status: 'open' };
    gapMemory[gap.id].attempts++;

    // 4. patch
    const preBuildHash = await tryHash();
    let patchResult;
    try {
      patchResult = await patchGap(gap);
    } catch (err) {
      console.error(`patch failed: ${err.message}`);
      await exec('git', ['checkout', '--', '.'], { cwd: REPO_DIR }).catch(() => {});
      await log(logPath, { iter, gap: gap.id, outcome: 'patch-error', error: err.message });
      continue;
    }

    // 5. build gate
    const buildResult = await build();
    if (!buildResult.ok) {
      console.error('build failed, reverting patch');
      await exec('git', ['checkout', '--', '.'], { cwd: REPO_DIR }).catch(() => {});
      gapMemory[gap.id].status = 'build-failed';
      await log(logPath, { iter, gap: gap.id, outcome: 'build-failed', error: buildResult.error });
      continue;
    }

    // 6. no-op check
    const postBuildHash = await tryHash();
    if (preBuildHash && postBuildHash && preBuildHash === postBuildHash) {
      console.log(`gap ${gap.id}: patch built but produced identical output (no-op)`);
      if (gapMemory[gap.id].attempts >= NOOP_RETRY_CAP) {
        gapMemory[gap.id].status = 'did-not-land';
      }
      await exec('git', ['checkout', '--', '.'], { cwd: REPO_DIR }).catch(() => {});
      await log(logPath, { iter, gap: gap.id, outcome: 'no-op', attempts: gapMemory[gap.id].attempts });
      continue;
    }

    // commit the patch
    await exec('git', ['add', '-A', 'job-aggregator-frontend'], { cwd: REPO_DIR });
    await exec('git', ['commit', '-m', `design-loop: ${gap.id} — ${patchResult.summary}`], { cwd: REPO_DIR });

    if (NO_DEPLOY) {
      console.log('--no-deploy set, stopping after first successful patch for inspection.');
      await log(logPath, { iter, gap: gap.id, outcome: 'dry-run-patched', summary: patchResult.summary });
      break;
    }

    // 7. deploy
    let deployResult;
    try {
      deployResult = await deploy();
    } catch (err) {
      console.error(`deploy failed: ${err.message}, reverting`);
      await revertLastCommit().catch((e) => console.error('revert also failed:', e.message));
      gapMemory[gap.id].status = 'deploy-failed';
      await log(logPath, { iter, gap: gap.id, outcome: 'deploy-failed', error: err.message });
      continue;
    }

    // 8. re-capture + re-score
    const ourShotAfter = await capture(page.ourUrl, 'desktop', path.join(iterDir, 'ours-after.png'));
    const judgmentAfter = ourShotAfter
      ? await judgePage({ pageLabel: page.label, ourShot: ourShotAfter, refShot, sourceHint: page.sourceHint, excludeGapIds: excludeIds })
      : null;
    const scoreAfter = judgmentAfter?.score ?? scoreBefore;
    const delta = scoreAfter - scoreBefore;
    gapMemory[gap.id].deltas.push(delta);
    scoreHistory.push(delta);

    // 9. regression guard
    if (scoreAfter < bestScore - REGRESSION_THRESHOLD) {
      console.warn(`regression detected (score ${scoreAfter} vs best ${bestScore}), reverting`);
      await revertLastCommit();
      gapMemory[gap.id].status = 'regressed';
      await log(logPath, { iter, gap: gap.id, outcome: 'regressed', scoreBefore, scoreAfter, delta, deployMs: deployResult.ms });
      continue;
    }
    bestScore = Math.max(bestScore, scoreAfter);

    // 10a. per-gap stagnation
    const recentDeltas = gapMemory[gap.id].deltas.slice(-PER_GAP_STAGNATION);
    if (recentDeltas.length >= PER_GAP_STAGNATION && recentDeltas.every((d) => d <= PER_GAP_DELTA_THRESHOLD)) {
      gapMemory[gap.id].status = 'exhausted';
      console.log(`gap ${gap.id} exhausted after ${PER_GAP_STAGNATION} near-zero attempts`);
    } else {
      gapMemory[gap.id].status = 'open'; // still improving or too early to judge, may be re-selected if still top priority next round
    }

    await log(logPath, {
      iter, gap: gap.id, outcome: 'deployed', summary: patchResult.summary,
      scoreBefore, scoreAfter, delta, deployMs: deployResult.ms,
    });

    // 10b. global stall check
    const window = scoreHistory.slice(-GLOBAL_WINDOW);
    if (window.length >= GLOBAL_WINDOW && window.reduce((a, b) => a + b, 0) <= GLOBAL_STALL_SUM) {
      console.log(`plateaued: last ${GLOBAL_WINDOW} iterations summed to <= ${GLOBAL_STALL_SUM} points, stopping early.`);
      await log(logPath, { iter, outcome: 'plateaued' });
      break;
    }
  }

  console.log(`\ndone. see ${logPath} and ${backlogPath}`);
}

async function tryHash() {
  try { return await hashBuild(); } catch { return null; }
}

async function log(logPath, entry) {
  await appendFile(logPath, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}

async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

main().catch((err) => { console.error(err); process.exit(1); });
