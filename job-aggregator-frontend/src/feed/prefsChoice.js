// "Show all jobs" choice, remembered for the browser session only (a new session starts with the saved preferences again).
const KEY = 'sa_prefs_off';

export function loadPrefsOff() {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function savePrefsOff(off) {
  try { if (off) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}
