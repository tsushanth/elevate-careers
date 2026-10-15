// Pure timeline for the autofill demo, so it can be tested without timers or a DOM.
// One loop = LOOP_MS (about 20 s):
//   0 - 3.0 s   resume is shown
//   3.0 - 4.5 s the Autofill button is pressed
//   4.5 s ...   fields fill in one after another
//   ...         all filled, success line holds
//   last 1 s    fade out, then the loop restarts
// The real extension fills a form in about a second; the demo is deliberately slowed down
// so a first-time visitor can follow it.

export const LOOP_MS = 20000;
export const RESUME_MS = 3000;
export const CLICK_MS = 1500;
export const FADE_MS = 1000;

export function frameAt(t, n) {
  const time = ((t % LOOP_MS) + LOOP_MS) % LOOP_MS;
  const fillStart = RESUME_MS + CLICK_MS;
  const fillEnd = LOOP_MS - FADE_MS - 2500; // leave 2.5 s to read the finished form
  const per = n > 0 ? (fillEnd - fillStart) / n : 1;
  let phase = 'resume';
  let filled = 0;
  let typing = -1;
  let typingProgress = 0;
  if (time >= LOOP_MS - FADE_MS) { phase = 'fade'; filled = n; }
  else if (time >= fillEnd) { phase = 'done'; filled = n; }
  else if (time >= fillStart) {
    phase = 'filling';
    const idx = Math.min(n - 1, Math.floor((time - fillStart) / per));
    const into = (time - fillStart - idx * per) / per;
    // First ~60% of each slot types the value; the rest holds it before the next field.
    typingProgress = Math.min(1, into / 0.6);
    filled = idx + (typingProgress >= 1 ? 1 : 0);
    typing = typingProgress >= 1 ? -1 : idx;
  } else if (time >= RESUME_MS) phase = 'click';
  return { phase, filled, typing, typingProgress, time };
}

// What text a field currently shows.
export function visibleValue(value, rowIndex, frame) {
  if (rowIndex < frame.filled) return value;
  if (rowIndex === frame.typing) return value.slice(0, Math.ceil(value.length * frame.typingProgress));
  return '';
}
