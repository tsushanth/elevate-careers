const PROXY_URL = 'https://elevate-careers-api.fly.dev';
const SUPABASE_URL = 'https://owvvrljdfnhntwedepkl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk';
const SITE_URL = 'https://simplyappl.ai';

// ── Auth helpers ──────────────────────────────────────────────────────────────

// The website's session, pushed by detect.js (access token only, never the
// refresh token — see detect.js). Valid until the access token expires; once it
// does we re-read from an open simplyappl.ai tab, else fall back to our own session.
async function getValidWebSession() {
  let { webSession } = await chrome.storage.local.get('webSession');
  if (!isFresh(webSession)) webSession = await readWebSessionFromOpenTab();
  return isFresh(webSession) ? webSession : null;
}

function isFresh(s) {
  if (!s?.access_token) return false;
  const exp = jwtExp(s.access_token);
  return !exp || Date.now() / 1000 < exp - 60;
}

async function readWebSessionFromOpenTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://simplyappl.ai/*', 'https://www.simplyappl.ai/*'] });
    for (const tab of tabs) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: key => {
          try { const s = JSON.parse(localStorage.getItem(key)); return s?.access_token ? { access_token: s.access_token, email: s.user?.email || null } : null; }
          catch (_) { return null; }
        },
        args: ['sb-owvvrljdfnhntwedepkl-auth-token'],
      });
      if (isFresh(result)) {
        await chrome.storage.local.set({ webSession: result });
        return result;
      }
    }
  } catch (_) {}
  return null;
}

// Get stored session from extension storage (fallback / cached)
async function getStoredSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

// Resolve the best available auth token
// Decode JWT expiry without a library — reads the exp claim directly
function jwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp || 0;
  } catch (_) { return 0; }
}

async function resolveToken() {
  // 1. Reuse the website's session if the user is signed in there.
  const web = await getValidWebSession();
  if (web) return web.access_token;

  // 2. Try cached session in storage
  const stored = await getStoredSession();
  if (stored?.access_token) {
    // Use JWT exp directly — don't rely on expires_at being present
    const exp = jwtExp(stored.access_token);
    if (!exp || Date.now() / 1000 < exp - 60) return stored.access_token;

    // Token expired — try to refresh
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: stored.refresh_token }),
      });
      if (res.ok) {
        const data = await res.json();
        await chrome.storage.local.set({ session: data });
        return data.access_token;
      }
    } catch (_) {}
    // Refresh failed — clear stale session so user is prompted to sign in
    await chrome.storage.local.remove('session');
  }

  // 3. No session — return null (extension will prompt sign-in)
  return null;
}

// Sign in with email + password via Supabase
async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
  await chrome.storage.local.set({ session: data });
  return data;
}

// Sign up with email + password
async function signUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { signup_via: 'extension' } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign up failed');
  if (data.access_token) await chrome.storage.local.set({ session: data });
  return data;
}

// Sign in with Google via Supabase OAuth (PKCE) in a browser auth popup.
// Requires the "identity" permission, and chrome.identity.getRedirectURL()
// to be in Supabase's allowed redirect URLs.
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signInWithGoogle() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  ));
  const redirectTo = chrome.identity.getRedirectURL();
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?` + new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
    prompt: 'select_account',
  });

  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!finalUrl) throw new Error('Google sign-in was cancelled');
  const u = new URL(finalUrl);
  const err = u.searchParams.get('error_description') || u.searchParams.get('error');
  if (err) throw new Error(err);
  const code = u.searchParams.get('code');
  if (!code) throw new Error('Google sign-in returned no code');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Google sign-in failed');
  await chrome.storage.local.set({ session: data });
  return data;
}

// Sign out
async function signOut() {
  const token = await resolveToken();
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    }).catch(() => {});
  }
  await chrome.storage.local.remove(['session', 'webSession']);
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === 'GET_AUTH') {
    resolveToken().then(token => {
      if (!token) { sendResponse({ signedIn: false }); return; }
      const { session } = chrome.storage.local.get('session');
      sendResponse({ signedIn: true, token });
    });
    // Re-read from storage async
    chrome.storage.local.get('session').then(({ session }) => {
      resolveToken().then(token => sendResponse({ signedIn: !!token, token, email: session?.user?.email }));
    });
    return true;
  }

  if (msg.type === 'WEB_SESSION') {
    if (msg.session?.access_token) chrome.storage.local.set({ webSession: msg.session });
    else chrome.storage.local.remove('webSession');
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_EMAIL') {
    chrome.storage.local.get(['session', 'webSession']).then(({ session, webSession }) =>
      sendResponse({ email: webSession?.email || session?.user?.email || null }));
    return true;
  }

  if (msg.type === 'SIGN_IN') {
    signIn(msg.email, msg.password)
      .then(data => sendResponse({ ok: true, email: data.user?.email }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SIGN_IN_GOOGLE') {
    signInWithGoogle()
      .then(data => sendResponse({ ok: true, email: data.user?.email }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SIGN_UP') {
    signUp(msg.email, msg.password)
      .then(data => sendResponse({ ok: true, needsConfirmation: !data.access_token }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SIGN_OUT') {
    signOut().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_TOKEN') {
    resolveToken().then(token => sendResponse({ token }));
    return true;
  }

  if (msg.type === 'GET_PROFILE') {
    chrome.storage.local.get('profile', ({ profile }) => sendResponse({ profile }));
    return true;
  }

  if (msg.type === 'SET_PROFILE') {
    chrome.storage.local.set({ profile: msg.profile }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'OPEN_OPTIONS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return false;
  }

  if (msg.type === 'OPEN_SIGNIN') {
    chrome.tabs.create({ url: `${SITE_URL}/login` });
    return false;
  }

  if (msg.type === 'REINJECT') {
    const tabId = _sender.tab?.id;
    if (tabId) chrome.scripting.executeScript({ target: { tabId }, files: ['mount.js'] }).catch(() => {});
    return false;
  }

  if (msg.type === 'INJECT_MOUNT') {
    // Called by detect-ats.js when it identifies a job page on a custom company domain.
    // Set the force-inject flag first so mount.js bypasses the JOB_HOSTS guard.
    const tabId = _sender.tab?.id;
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => { window.__simplyApplyForceInject = true; },
      }).then(() =>
        chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['mount.js'] })
      ).catch(() => {});
    }
    return false;
  }
});

// Fetch remote rules and cache them — runs on install, update, and every 6 hours
async function refreshRemoteRules() {
  try {
    const res = await fetch('https://elevate-careers-api.fly.dev/api/repair/rules', { cache: 'no-store' });
    if (!res.ok) return;
    const rules = await res.json();
    if (Array.isArray(rules)) await chrome.storage.local.set({ remoteRules: rules });
  } catch (_) {}
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  refreshRemoteRules();
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});

// Refresh rules every 6 hours via alarm
chrome.alarms.create('refreshRules', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'refreshRules') refreshRemoteRules();
});

// Manual inject via toolbar click — reset guard first so re-injection always works
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => { window.__simplyApplyRunning = false; },
  }).finally(() => {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['mount.js'] }).catch(() => {});
  });
});
