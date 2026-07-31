import { spawn } from 'child_process';

// Spawns the local `claude` CLI in headless print mode, using OAuth/subscription
// credentials from ~/.claude/.credentials.json. Strips ANTHROPIC_API_KEY /
// ANTHROPIC_AUTH_TOKEN from the subprocess env so the CLI never falls back to
// billing the API key instead of the subscription (see claude-cli-env-leak memory).
export function runClaude(prompt, { cwd, allowedTools, permissionMode = 'default', timeoutMs = 5 * 60_000 } = {}) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...env } = process.env;

  const args = ['-p', prompt, '--output-format', 'json'];
  if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
  if (permissionMode) args.push('--permission-mode', permissionMode);

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 2000)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ result: stdout });
      }
    });
  });
}
