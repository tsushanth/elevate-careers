// Runs on simplyappl.ai — signals to the web app that the extension is installed,
// and shares the web app's signed-in session with the extension.
window.__simplyApplyInstalled = true;

// supabase-js keeps the session in localStorage under sb-<project-ref>-auth-token.
const SESSION_KEY = 'sb-owvvrljdfnhntwedepkl-auth-token';

function readWebSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.access_token ? s : null;
  } catch (_) { return null; }
}

let lastSent = '';
function pushSession() {
  const s = readWebSession();
  // Only the access token is shared. The refresh token stays with the web app:
  // Supabase rotates refresh tokens, so two clients refreshing the same one
  // would sign the website out.
  const payload = s
    ? { access_token: s.access_token, email: s.user?.email || null }
    : null;
  const key = payload ? payload.access_token : '';
  if (key === lastSent) return;
  lastSent = key;
  try { chrome.runtime.sendMessage({ type: 'WEB_SESSION', session: payload }); } catch (_) {}
}

pushSession();
window.addEventListener('storage', e => { if (e.key === SESSION_KEY) pushSession(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) pushSession(); });
setInterval(pushSession, 5000); // same-tab logins fire no storage event
