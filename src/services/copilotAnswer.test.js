import test from 'node:test';
import assert from 'node:assert/strict';
import { compactProfile, isRefusal, hasSubstance, answerQuestion, AnswerUnavailableError } from './copilotAnswer.js';

// The reply that was typed into a real application field on 2026-11-11.
const REAL_REFUSAL = "I appreciate your interest, but I notice the candidate profile provided is incomplete with empty fields, which makes it difficult for me to craft an authentic, personalized response about what excites them specifically about Deepgram. To provide a genuine answer, I would need information about the candidate's background, technical interests, previous experience with";

test('isRefusal flags the real refusal and common variants', () => {
  assert.equal(isRefusal(REAL_REFUSAL), true);
  assert.equal(isRefusal("I'm sorry, but I don't have enough information to answer."), true);
  assert.equal(isRefusal('Could you please provide your resume so I can write this?'), true);
  assert.equal(isRefusal('Unfortunately the profile is missing details.'), true);
  assert.equal(isRefusal('As an AI, I cannot speak for the candidate.'), true);
  assert.equal(isRefusal(''), true);
});

test('isRefusal leaves genuine answers alone', () => {
  assert.equal(isRefusal("I'm excited by Deepgram's focus on real-time speech recognition at scale. My background building ML pipelines in Python maps directly to the Applied AI work."), false);
  assert.equal(isRefusal("I notice that Deepgram ships fast and talks openly about latency; that engineering culture is what draws me to the team."), false);
  assert.equal(isRefusal("Streaming audio at scale makes it difficult to hide latency, which is exactly the kind of problem I want to work on."), false);
  assert.equal(isRefusal('I appreciate how openly Deepgram documents its models, and I want to build on that.'), false);
});

test('compactProfile drops blanks, trims and caps', () => {
  const out = compactProfile({ firstName: ' Sam ', lastName: '', phone: null, skills: [], tags: ['a', ''], resume: 'x'.repeat(9000), extra: {}, n: 0 });
  assert.deepEqual(Object.keys(out).sort(), ['firstName', 'n', 'resume', 'tags']);
  assert.equal(out.firstName, 'Sam');
  assert.deepEqual(out.tags, ['a']);
  assert.equal(out.resume.length, 6000);
  assert.deepEqual(compactProfile(null), {});
});

test('hasSubstance needs real resume/background text', () => {
  assert.equal(hasSubstance({ firstName: 'Sam' }), false);
  assert.equal(hasSubstance({ resume: 'Senior engineer, ten years building speech and ML systems in Python.' }), true);
});

function fakeClient(replies) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(args) {
        calls.push(args);
        const text = replies[Math.min(calls.length - 1, replies.length - 1)];
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}
const PROFILE = { firstName: 'Sam', lastName: '', resume: 'Senior ML engineer with ten years of Python and speech recognition experience.' };

test('answerQuestion sends only non-empty profile fields and returns a good answer', async () => {
  const c = fakeClient(['I love Deepgram because of its real-time speech models.']);
  const a = await answerQuestion(c, { question: 'What excites you about Deepgram?', jobDescription: 'Applied AI', profile: PROFILE });
  assert.equal(a, 'I love Deepgram because of its real-time speech models.');
  assert.equal(c.calls.length, 1);
  const sent = c.calls[0].messages[0].content;
  assert.ok(!sent.includes('lastName'));
  assert.ok(sent.includes('firstName'));
  assert.match(c.calls[0].system, /Never say the profile is incomplete/);
});

test('answerQuestion retries once after a refusal and uses the second reply', async () => {
  const c = fakeClient([REAL_REFUSAL, 'The real-time speech focus and the Applied AI team are what draw me to Deepgram.']);
  const a = await answerQuestion(c, { question: 'What excites you about Deepgram?', profile: PROFILE });
  assert.match(a, /real-time speech/);
  assert.equal(c.calls.length, 2);
  assert.equal(c.calls[1].messages.length, 3);
});

test('answerQuestion throws instead of returning a refusal twice', async () => {
  const c = fakeClient([REAL_REFUSAL]);
  await assert.rejects(answerQuestion(c, { question: 'Why us?', profile: PROFILE }), e => e instanceof AnswerUnavailableError && e.code === 'answer_unavailable');
  assert.equal(c.calls.length, 2);
});

test('answerQuestion refuses up front when the profile has nothing to write from (no model call)', async () => {
  const c = fakeClient(['x']);
  await assert.rejects(answerQuestion(c, { question: 'Why us?', profile: { firstName: 'Sam', background: '', resume: '' } }), e => e.code === 'profile_incomplete');
  assert.equal(c.calls.length, 0);
});

test('learned answers alone are enough to attempt an answer', async () => {
  const c = fakeClient(['Because the work matters to me.']);
  const a = await answerQuestion(c, { question: 'Why us?', profile: {}, learnedAnswers: { 'Why this company?': 'I like small teams.' } });
  assert.equal(a, 'Because the work matters to me.');
});
