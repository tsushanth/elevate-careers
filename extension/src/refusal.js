// True when text is a model refusal / meta-comment / request for more information rather than an
// answer to a job-application question (e.g. "I notice the candidate profile provided is incomplete
// with empty fields..."). Such text must never be typed into a form, cached, or saved as a learned
// answer. KEEP IN SYNC with src/services/copilotAnswer.js (isRefusal) in the repo root (backend copy).
const MISSING_WORDS = /(incomplete|empty|missing|blank|not (been )?provided|insufficient|lack(s|ing)?|no (information|details|background|resume))/i;
const PROFILE_WORDS = /(profile|resume|candidate|background|information|details|fields?)/i;

export function isRefusal(text) {
  const t = String(text || '').trim();
  if (!t) return false; // empty is not a refusal here; callers already skip empty values
  const head = t.slice(0, 400);
  if (/^(i'?m sorry|i am sorry|i apologi[sz]e|unfortunately|as an ai\b|i cannot\b|i can'?t\b|i'?m unable\b|i am unable\b|i (do not|don'?t) have (enough|sufficient|the)\b|i (would|'d) need\b|i need (more|additional)\b)/i.test(head)) return true;
  if (/^i appreciate your (interest|question)\b/i.test(head)) return true;
  if (PROFILE_WORDS.test(head) && MISSING_WORDS.test(head) && /\b(provided|profile|candidate|resume|fields?|information)\b/i.test(head)
      && /\b(i notice|i see|appears?|seems?|it looks like|difficult|hard|unable|cannot|can'?t|would need|need more)\b/i.test(head)) return true;
  if (/\b(could|can|would) you (either |please )?(provide|share|clarify|tell me)\b/i.test(t)) return true;
  if (/\bplease (provide|share|clarify)\b/i.test(t)) return true;
  if (/\bwould need (more|additional|further) (information|details|context)\b/i.test(t)) return true;
  if (/\bmakes? it (difficult|hard|impossible) for me to\b/i.test(t)) return true;
  return false;
}

// Returns a copy of a { key: answer } map without refusal-looking answers, plus how many were dropped.
export function purgeRefusals(map) {
  const out = {};
  let removed = 0;
  for (const [k, v] of Object.entries(map || {})) {
    if (typeof v === 'string' && isRefusal(v)) { removed++; continue; }
    out[k] = v;
  }
  return { map: out, removed };
}
