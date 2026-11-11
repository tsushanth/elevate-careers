// Run: node --test extension/src/refusal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal, purgeRefusals } from './refusal.js';

const REAL = "I appreciate your interest, but I notice the candidate profile provided is incomplete with empty fields, which makes it difficult for me to craft an authentic, personalized response about what excites them specifically about Deepgram. To provide a genuine answer, I would need information about the candidate's background, technical interests, previous experience with AI/speech technology, and career goals. Could you either provide more complete candidate information or clarify if you'd like a general template response for a Software Engineer interested in applied AI roles?";

test('flags the refusal that was typed into a real application', () => {
  assert.equal(isRefusal(REAL), true);
  assert.equal(isRefusal("I don't have enough information from the candidate profile provided to write an authentic answer."), true);
  assert.equal(isRefusal('Could you please share the candidate\'s background?'), true);
});

test('leaves real answers and short form values alone', () => {
  assert.equal(isRefusal("I'm excited by Deepgram's real-time speech models and the Applied AI team."), false);
  assert.equal(isRefusal('San Jose, CA'), false);
  assert.equal(isRefusal('Yes'), false);
  assert.equal(isRefusal(''), false);
  assert.equal(isRefusal(undefined), false);
});

test('purgeRefusals keeps good entries and counts the removed ones', () => {
  const { map, removed } = purgeRefusals({ 'what excites you about deepgram': REAL, 'why us': 'I like small teams.', n: 3 });
  assert.equal(removed, 1);
  assert.deepEqual(Object.keys(map).sort(), ['n', 'why us']);
});
