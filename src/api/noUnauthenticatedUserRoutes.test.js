import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// server.js starts listeners and workers on import, so this guards the route table at the source level.
const dir = path.dirname(fileURLToPath(import.meta.url));
const server = readFileSync(path.join(dir, 'server.js'), 'utf8');
const aiResume = readFileSync(path.join(dir, '..', 'routes', 'ai-resume.js'), 'utf8');

const registrations = (src) => [...src.matchAll(/\bapp\.(get|post|put|patch|delete|all|use)\(\s*['"`]([^'"`]+)['"`]/g)].map(m => `${m[1].toUpperCase()} ${m[2]}`);

test('server.js no longer registers the unauthenticated /applications and /saved-searches routes', () => {
  const bad = registrations(server).filter(r => /\s\/(applications|saved-searches)\b/.test(r));
  assert.deepEqual(bad, []);
});

test('the authenticated tracker routes clients actually use are still there', () => {
  assert.match(aiResume, /router\.post\('\/applications\/track', requireAuth/);
  assert.match(aiResume, /router\.get\('\/applications', requireAuth/);
  assert.match(aiResume, /router\.patch\('\/applications\/:id\/report', requireAuth/);
});

test('the route-table scanner would catch a re-added route (self-check)', () => {
  assert.deepEqual(registrations(`app.get('/applications/:user_id', async () => {})`), ['GET /applications/:user_id']);
});
