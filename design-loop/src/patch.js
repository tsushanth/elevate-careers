import { runClaude } from './claude.js';

const FRONTEND_DIR = new URL('../../job-aggregator-frontend', import.meta.url).pathname;

// Lets Claude Code itself Read + Edit the implicated file, scoped to a single gap.
// We don't hand-roll diff application — Claude's own Edit tool does it, and we
// verify the result via `git diff` in the caller.
export async function patchGap(gap) {
  const prompt = `You are making ONE small, scoped frontend change to a React (CRA) app, plain CSS (no Tailwind/MUI), flat src/ directory.

Gap to fix (id: ${gap.id}, area: ${gap.area}):
${gap.description}

Likely file: ${gap.file_hint}

Rules:
- Edit ONLY the file(s) actually needed for this specific gap. Do not refactor, rename, or touch unrelated code.
- Match existing conventions (plain CSS classnames, existing component patterns).
- Do not run npm/build/git commands yourself — just make the edit(s).
- After editing, respond with ONLY this JSON (no prose):
{"files_changed": ["<relative path from job-aggregator-frontend/>"], "summary": "<one sentence>"}`;

  const res = await runClaude(prompt, {
    cwd: FRONTEND_DIR,
    allowedTools: ['Read', 'Edit', 'Grep', 'Glob'],
    permissionMode: 'acceptEdits',
  });

  const text = res.result ?? res;
  const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
  if (!match) throw new Error(`patch: could not parse JSON from response: ${JSON.stringify(text).slice(0, 500)}`);
  return JSON.parse(match[0]);
}
