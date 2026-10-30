import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import { _setSink } from './failureReporter.js';

describe('unhandled errors are reported once, without content', () => {
  it('LLM provider rejection (status 402) -> 500 and one backend_error with the status only', async () => {
    const sent = [];
    _setSink((r) => sent.push(r));
    const claudeClient = { messages: { create: () => Promise.reject(Object.assign(new Error('credit balance too low for key sk-ant-secret'), { status: 402 })) } };
    const app = createApp({ legacyToken: 'tok', claudeClient });
    const res = await app.request('/copilot/answer', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why do you want this job? my-private-answer', jobDescription: 'jd', profile: { name: 'Private Person' } }),
    });
    _setSink(null);
    expect(res.status).toBe(500);
    expect(sent).toEqual([{ kind: 'backend_error', flow: 'POST /copilot/answer', message: 'upstream provider error 402', context: { provider_status: '402' } }]);
    const all = JSON.stringify(sent);
    for (const bad of ['sk-ant', 'private', 'Private Person', 'credit balance']) expect(all.toLowerCase().includes(bad.toLowerCase())).toBe(false);
  });
});
