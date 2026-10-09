// "Show all jobs equally" choice for the near-you ordering, remembered for the browser session only.
// The last place label the server reported is kept alongside, so the way back can name it after a reload.
const OFF_KEY = 'sa_near_off';
const LABEL_KEY = 'sa_near_label';

export function loadNearOff() {
  try { return sessionStorage.getItem(OFF_KEY) === '1'; } catch { return false; }
}

export function saveNearOff(off) {
  try { if (off) sessionStorage.setItem(OFF_KEY, '1'); else sessionStorage.removeItem(OFF_KEY); } catch { /* private mode */ }
}

export function loadNearLabel() {
  try { return sessionStorage.getItem(LABEL_KEY) || ''; } catch { return ''; }
}

export function saveNearLabel(label) {
  try { if (label) sessionStorage.setItem(LABEL_KEY, label); else sessionStorage.removeItem(LABEL_KEY); } catch { /* private mode */ }
}

// IANA zone of this browser, or '' when it cannot be read. Constant per browser, so it is never filter state.
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}
