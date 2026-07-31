import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp, DEFAULT_PROFILE } from './app.js';

const TOKEN = 'test-token-123';

function mockClaude(answer = 'Mock answer.') {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ text: answer }],
      }),
    },
  };
}

function makeApp(overrides = {}) {
  return createApp({ authToken: TOKEN, claudeClient: mockClaude(), ...overrides });
}

describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const app = makeApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('auth middleware', () => {
  it('rejects missing token', async () => {
    const app = makeApp();
    const res = await app.request('/profile');
    expect(res.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const app = makeApp();
    const res = await app.request('/profile', { headers: { Authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });

  it('accepts correct token', async () => {
    const app = makeApp();
    const res = await app.request('/profile', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });

  it('allows all when no authToken set', async () => {
    const app = createApp({ authToken: undefined, claudeClient: mockClaude() });
    const res = await app.request('/profile');
    expect(res.status).toBe(200);
  });
});

describe('GET /profile', () => {
  it('returns default profile fields', async () => {
    const app = makeApp();
    const res = await app.request('/profile', { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json();
    expect(body.firstName).toBe('Sushanth');
    expect(body.email).toBe('t.sushanth@gmail.com');
    expect(body.workAuth).toBe('Yes');
  });
});

describe('PUT /profile', () => {
  it('merges updates into profile', async () => {
    const app = makeApp();
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

    await app.request('/profile', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ city: 'Oakland', phone: '+1 555-000-0000' }),
    });

    const res = await app.request('/profile', { headers });
    const body = await res.json();
    expect(body.city).toBe('Oakland');
    expect(body.phone).toBe('+1 555-000-0000');
    expect(body.firstName).toBe('Sushanth'); // unchanged
  });

  it('rejects invalid JSON', async () => {
    const app = makeApp();
    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /copilot/answer', () => {
  it('returns answer for valid question', async () => {
    const claude = mockClaude('I am excited about this role.');
    const app = createApp({ authToken: TOKEN, claudeClient: claude });

    const res = await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why are you interested in this role?' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe('I am excited about this role.');
    expect(claude.messages.create).toHaveBeenCalledOnce();
  });

  it('includes jobDescription in prompt when provided', async () => {
    const claude = mockClaude('Great company.');
    const app = createApp({ authToken: TOKEN, claudeClient: claude });

    await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why us?', jobDescription: 'We build AI tools.' }),
    });

    const call = claude.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('We build AI tools.');
    expect(call.messages[0].content).toContain('Why us?');
  });

  it('returns 400 when question is missing', async () => {
    const app = makeApp();
    const res = await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription: 'Some job' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('question required');
  });

  it('uses haiku model', async () => {
    const claude = mockClaude('answer');
    const app = createApp({ authToken: TOKEN, claudeClient: claude });

    await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Tell me about yourself.' }),
    });

    const call = claude.messages.create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.max_tokens).toBe(300);
  });

  it('system prompt instructs Claude not to raise immigration unprompted', async () => {
    const claude = mockClaude('answer');
    const app = createApp({ authToken: TOKEN, claudeClient: claude });

    await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Tell me about yourself.' }),
    });

    const call = claude.messages.create.mock.calls[0][0];
    // Guard phrasing must be present; the profile itself must not embed H1B/visa info
    expect(call.system.toLowerCase()).toContain('never mention immigration');
    expect(call.system.toLowerCase()).not.toContain('h1b');
  });
});

describe('POST /copilot/answer/batch', () => {
  it('returns answers for all questions', async () => {
    let callCount = 0;
    const claude = {
      messages: {
        create: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({ content: [{ text: `Answer ${callCount}` }] });
        }),
      },
    };
    const app = createApp({ authToken: TOKEN, claudeClient: claude });

    const res = await app.request('/copilot/answer/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: ['Q1', 'Q2', 'Q3'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answers).toHaveLength(3);
    expect(body.answers.map(a => a.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('returns 400 for empty questions array', async () => {
    const app = makeApp();
    const res = await app.request('/copilot/answer/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('CORS headers', () => {
  it('responds to OPTIONS preflight', async () => {
    const app = makeApp();
    const res = await app.request('/profile', { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('includes CORS header on GET response', async () => {
    const app = makeApp();
    const res = await app.request('/health');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
