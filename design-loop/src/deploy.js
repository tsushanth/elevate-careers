import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

const exec = promisify(execFile);
const FRONTEND_DIR = new URL('../../job-aggregator-frontend', import.meta.url).pathname;

export async function build() {
  try {
    await exec('npm', ['run', 'build'], { cwd: FRONTEND_DIR, maxBuffer: 20 * 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString().slice(0, 3000) || err.message };
  }
}

// Hashes all built static assets to detect a build that produced identical
// output to before the patch (dead CSS rule, wrong selector, tree-shaken out).
export async function hashBuild() {
  const staticDir = path.join(FRONTEND_DIR, 'build', 'static');
  const hash = createHash('sha256');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else hash.update(await readFile(full));
    }
  }
  await walk(staticDir);
  return hash.digest('hex');
}

export async function deploy() {
  const start = Date.now();
  await exec('flyctl', ['deploy', '--remote-only', '--config', 'fly.toml'], {
    cwd: FRONTEND_DIR,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 6 * 60_000,
  });
  return { ms: Date.now() - start };
}

export async function revertLastCommit() {
  await exec('git', ['revert', '--no-edit', 'HEAD'], { cwd: FRONTEND_DIR.replace('/job-aggregator-frontend', '') });
  await build();
  return deploy();
}

export { FRONTEND_DIR };
