import { runClaude } from './claude.js';

// Asks Claude (via its own Read tool, so it can view the PNGs directly) to
// compare our screenshot against the LinkedIn reference and score the gap.
// `excludeGapIds` are gaps already marked exhausted/did-not-land so the judge
// doesn't keep re-suggesting dead ends.
export async function judgePage({ pageLabel, ourShot, refShot, sourceHint, excludeGapIds = [] }) {
  const prompt = `Compare two screenshots of a job-search web app: our site ("${pageLabel}") vs a LinkedIn reference page.

Our screenshot: ${ourShot}
LinkedIn reference screenshot: ${refShot}
${sourceHint ? `Relevant source file for this page: ${sourceHint}` : ''}

Read both images. Score visual/UX closeness to LinkedIn's design language (typography, spacing, color, card/nav layout, information density) from 0-100.

Do NOT re-suggest any of these already-attempted gap ids: ${excludeGapIds.join(', ') || '(none)'}

Respond with ONLY this JSON (no prose, no markdown fence):
{
  "score": <0-100 integer>,
  "gaps": [
    {"id": "<short-kebab-slug>", "area": "<css|layout|copy|component>", "file_hint": "<likely file under job-aggregator-frontend/src>", "description": "<concrete, scoped fix>", "priority": <1-5, 5 highest>}
  ],
  "missing_features": [
    {"name": "<short name>", "description": "<what LinkedIn has that we structurally lack>"}
  ]
}`;

  const res = await runClaude(prompt, {
    cwd: process.cwd(),
    allowedTools: ['Read'],
    permissionMode: 'default',
  });

  const text = res.result ?? res;
  const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null;
  if (!match) throw new Error(`judge: could not parse JSON from response: ${JSON.stringify(text).slice(0, 500)}`);
  return JSON.parse(match[0]);
}
