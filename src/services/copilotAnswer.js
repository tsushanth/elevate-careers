// Open-ended application answers for the extension (POST /api/ai-resume/copilot/answer).
//
// Why this file exists: the route used to send JSON.stringify(profile) (about 22 keys, most of
// them empty strings) with a prompt that never said what to do when the data was thin. The model
// replied with a complaint ("the candidate profile provided is incomplete with empty fields...")
// and the extension typed that complaint into a real application field. So: send only the
// fields that have a value, tell the model to always answer, and never return text that is
// really a refusal or a request for more information. An unusable reply becomes an error and
// the field stays empty.

export class AnswerUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnswerUnavailableError';
    this.code = code;
  }
}

const MAX_FIELD_CHARS = 6000;
const MAX_PROFILE_CHARS = 12000;

export const ANSWER_SYSTEM_PROMPT = `You are filling out a job application on behalf of the candidate. Write the answer to the one question you are given, in first person, in 2-4 sentences, as the candidate would type it into the form.
Rules:
- Output only the answer text. No preamble, no quotes, no notes, no commentary about the profile or the question.
- Always give an answer. Never say the profile is incomplete, never mention missing or empty fields, never ask for more information or clarification, never refuse.
- Use the candidate's profile and resume where they help. Use the job description to make the answer specific to the company and role.
- If the profile is thin, still write a sincere, specific answer grounded in the job description and whatever the profile does say.
- Never invent employers, job titles, dates, degrees or credentials that are not in the profile or resume.`;

export const RETRY_NUDGE = `That reply was not an answer to the question. Write only the answer the candidate would type into the form: 2-4 sentences, first person, grounded in the job description and whatever the profile contains. Do not mention the profile, missing information, or what you need. Do not ask questions.`;

// Drop empty values so the model sees what the candidate has, not 20 blank keys.
export function compactProfile(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const out = {};
  let used = 0;
  for (const [key, raw] of Object.entries(profile)) {
    let value = raw;
    if (value == null) continue;
    if (typeof value === 'string') {
      value = value.trim();
      if (!value) continue;
      if (value.length > MAX_FIELD_CHARS) value = value.slice(0, MAX_FIELD_CHARS);
    } else if (Array.isArray(value)) {
      value = value.filter(v => v != null && String(v).trim() !== '');
      if (value.length === 0) continue;
    } else if (typeof value === 'object') {
      if (Object.keys(value).length === 0) continue;
    }
    const size = JSON.stringify(value).length + key.length;
    if (used + size > MAX_PROFILE_CHARS) continue;
    used += size;
    out[key] = value;
  }
  return out;
}

export function hasSubstance(compact) {
  const text = [compact.resume, compact.background, compact.summary, compact.experience]
    .filter(v => typeof v === 'string' || Array.isArray(v)).map(v => String(v)).join(' ');
  return text.trim().length >= 40;
}

const MISSING_WORDS = /(incomplete|empty|missing|blank|not (been )?provided|insufficient|lack(s|ing)?|no (information|details|background|resume))/i;
const PROFILE_WORDS = /(profile|resume|candidate|background|information|details|fields?)/i;

// True when the reply is a refusal / meta-comment / request for info rather than an answer.
export function isRefusal(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const head = t.slice(0, 400);
  if (/^(i'?m sorry|i am sorry|i apologi[sz]e|unfortunately|as an ai\b|i cannot\b|i can'?t\b|i'?m unable\b|i am unable\b|i (do not|don'?t) have (enough|sufficient|the)\b|i (would|'d) need\b|i need (more|additional)\b)/i.test(head)) return true;
  if (/^i appreciate your (interest|question)\b/i.test(head)) return true;
  if (PROFILE_WORDS.test(head) && MISSING_WORDS.test(head) && /\b(provided|profile|candidate|resume|fields?|information)\b/i.test(head)
      && /\b(i notice|i see|appears?|seems?|it looks like|difficult|hard|unable|cannot|can'?t|would need|need more)\b/i.test(head)) return true;
  if (/\b(could|can|would) you (please )?(provide|share|clarify|tell me)\b/i.test(t)) return true;
  if (/\bplease (provide|share|clarify)\b/i.test(t)) return true;
  if (/\bwould need (more|additional|further) (information|details|context)\b/i.test(t)) return true;
  if (/\bmakes? it (difficult|hard|impossible) for me to\b/i.test(t)) return true;
  return false;
}

function buildUserContent({ question, jobDescription, learnedAnswers, compact }) {
  // Old extension versions saved refusals as "learned" answers; never feed those back to the model.
  const usable = Object.entries(learnedAnswers || {}).filter(([, a]) => typeof a === 'string' && a.trim() && !isRefusal(a));
  const learned = usable.length > 0
    ? `\n\nThe candidate's previous answers on other applications (their known preferences):\n${usable.map(([q, a]) => `- ${q}: ${a}`).join('\n')}`
    : '';
  return `Candidate profile:\n${JSON.stringify(compact)}\n\nJob description context:\n${String(jobDescription || '').slice(0, 800)}${learned}\n\nQuestion: ${question}`;
}

export async function answerQuestion(client, { question, jobDescription, profile, learnedAnswers }) {
  const compact = compactProfile(profile);
  const hasLearned = Object.values(learnedAnswers || {}).some(a => typeof a === 'string' && a.trim() && !isRefusal(a));
  if (!hasSubstance(compact) && !hasLearned) {
    throw new AnswerUnavailableError(
      'profile_incomplete',
      'Add your resume or a short background in the extension settings so answers can be written from it.',
    );
  }

  const userContent = buildUserContent({ question, jobDescription, learnedAnswers, compact });
  const call = async messages => {
    const completion = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: ANSWER_SYSTEM_PROMPT,
      messages,
    });
    return (completion.content?.[0]?.text || '').trim();
  };

  const first = await call([{ role: 'user', content: userContent }]);
  if (!isRefusal(first)) return first;

  const second = await call([
    { role: 'user', content: userContent },
    { role: 'assistant', content: first },
    { role: 'user', content: RETRY_NUDGE },
  ]);
  if (!isRefusal(second)) return second;

  throw new AnswerUnavailableError('answer_unavailable', 'Could not write an answer for this question. Type it in yourself.');
}
