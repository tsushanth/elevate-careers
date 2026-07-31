/**
 * E2E tests against the live Fly.io deployment.
 * Run with: AUTH_TOKEN=<token> npm run test:e2e
 */
import { describe, it, expect } from 'vitest';

const BASE = 'https://elevate-autofill-api.fly.dev';
const TOKEN = process.env.AUTH_TOKEN || 'b047bb371129f92a7bd762b62a6a6572843f01ec1dda08a200527487b3356c04';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(opts.headers || {}),
    },
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe('E2E: live Fly deployment', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await api('/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('CORS headers present on /health', async () => {
    const { headers } = await api('/health');
    expect(headers.get('access-control-allow-origin')).toBe('*');
  });

  it('GET /profile returns Sushanth profile', async () => {
    const { status, body } = await api('/profile');
    expect(status).toBe(200);
    expect(body.firstName).toBe('Sushanth');
    expect(body.email).toBe('t.sushanth@gmail.com');
    expect(body.workAuth).toBe('Yes');
  });

  it('rejects bad auth token with 401', async () => {
    const res = await fetch(`${BASE}/profile`, {
      headers: { Authorization: 'Bearer bad-token' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /copilot/answer returns a non-empty string', async () => {
    const { status, body } = await api('/copilot/answer', {
      method: 'POST',
      body: JSON.stringify({ question: 'What is your greatest technical strength?' }),
    });
    expect(status).toBe(200);
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(10);
  }, 20000);

  it('POST /copilot/answer with job description returns contextual answer', async () => {
    const { status, body } = await api('/copilot/answer', {
      method: 'POST',
      body: JSON.stringify({
        question: 'Why do you want to join us?',
        jobDescription: 'We are building AI-powered developer tools in TypeScript.',
      }),
    });
    expect(status).toBe(200);
    expect(body.answer.length).toBeGreaterThan(10);
  }, 20000);

  it('POST /copilot/answer/batch returns answers for all questions', async () => {
    const { status, body } = await api('/copilot/answer/batch', {
      method: 'POST',
      body: JSON.stringify({
        questions: [
          'Tell me about yourself.',
          'What is your preferred tech stack?',
        ],
      }),
    });
    expect(status).toBe(200);
    expect(body.answers).toHaveLength(2);
    expect(body.answers[0].question).toBe('Tell me about yourself.');
    expect(body.answers[0].answer.length).toBeGreaterThan(10);
  }, 30000);

  it('OPTIONS preflight returns CORS headers', async () => {
    const res = await fetch(`${BASE}/profile`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://jobs.lever.co',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/);
  });
});
