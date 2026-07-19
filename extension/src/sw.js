const PROXY_URL = 'https://elevate-careers-api.fly.dev';
const LEGACY_TOKEN = 'b047bb371129f92a7bd762b62a6a6572843f01ec1dda08a200527487b3356c04';
const SUPABASE_URL = 'https://owvvrljdfnhntwedepkl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk';
const SITE_URL = 'https://simplyappl.ai';

// ── Auth helpers ──────────────────────────────────────────────────────────────

// Read Supabase session from the simplyappl.ai cookie (same flow as Simplify)
async function getSessionFromCookie() {
  try {
    const cookieName = `sb-owvvrljdfnhntwedepkl-auth-token`;
    const cookie = await chrome.cookies.get({ url: SITE_URL, name: cookieName });
    if (!cookie?.value) return null;
    const parsed = JSON.parse(decodeURIComponent(cookie.value));
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (_) { return null; }
}

// Get stored session from extension storage (fallback / cached)
async function getStoredSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

// Resolve the best available auth token
async function resolveToken() {
  // 1. Try cookie from simplyappl.ai (user is signed in on the site)
  const cookieSession = await getSessionFromCookie();
  if (cookieSession?.access_token) {
    await chrome.storage.local.set({ session: cookieSession });
    return cookieSession.access_token;
  }

  // 2. Try cached session in storage
  const stored = await getStoredSession();
  if (stored?.access_token) {
    // Check if expired
    const exp = stored.expires_at;
    if (!exp || Date.now() / 1000 < exp - 60) return stored.access_token;

    // Try to refresh
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
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign up failed');
  if (data.access_token) await chrome.storage.local.set({ session: data });
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
  await chrome.storage.local.remove('session');
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

  if (msg.type === 'SIGN_IN') {
    signIn(msg.email, msg.password)
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
});

// Open options on first install
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
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
