const FIELDS = [
  'firstName','lastName','email','phone',
  'city','state','country','postalCode',
  'linkedin','github','portfolio',
  'educationLevel','schoolName','fieldOfStudy','graduationYear',
  'workAuth','sponsorship','salary','heardAbout',
  'background','resume',
];

// No identity/contact/location/salary/background/resume defaults — this
// file is a stale, disconnected copy predating the src/->dist/ build
// pipeline (build.js never touches it) that used to hardcode the
// founder's real identity, bio, and full resume text as the default
// profile for anyone whose local storage was empty. See src/options.js
// and src/mount.js for the same fix in the actual shipped code.
const DEFAULT = {
  firstName: '', lastName: '',
  email: '', phone: '',
  city: '', state: '', country: '', postalCode: '',
  linkedin: '',
  github: '',
  portfolio: '',
  educationLevel: '',
  schoolName: '',
  fieldOfStudy: '',
  graduationYear: '',
  workAuth: 'Yes', sponsorship: 'No',
  salary: '', heardAbout: 'LinkedIn',
  background: '',
  resume: '',
};

// ── SW bridge ─────────────────────────────────────────────────────────────────
function sw(type, payload) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, r => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r || null);
      });
    } catch (_) { resolve(null); }
  });
}

// ── Profile form ──────────────────────────────────────────────────────────────
async function loadProfile() {
  const stored = await chrome.storage.local.get('profile');
  const profile = { ...DEFAULT, ...(stored.profile || {}) };
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) el.value = profile[key] ?? '';
  }
}

async function saveProfile() {
  const profile = {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el) profile[key] = el.value.trim();
  }
  await chrome.storage.local.set({ profile });

  // Sync to API so signals can be recomputed from fresh profile data
  try {
    const res = await sw('GET_TOKEN');
    const token = res?.token;
    if (token) {
      fetch('https://elevate-careers-api.fly.dev/api/ai-resume/profile/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile }),
      }).catch(() => {});
    }
  } catch (_) {}

  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

document.getElementById('save').addEventListener('click', saveProfile);

// ── Auth state machine ────────────────────────────────────────────────────────
async function renderAuth() {
  const res = await sw('GET_TOKEN');
  const token = res && res.token;

  if (token) {
    // Signed in — show profile sections, hide onboarding
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('profile-sections').style.display = 'block';

    const stored = await chrome.storage.local.get('session');
    const email = stored.session?.user?.email || 'signed in';

    const bar = document.getElementById('auth-bar');
    bar.style.display = 'flex';

    // Show rating CTA in auth bar once user has 3+ fills and hasn't rated
    const { autofill_count = 0, rated } = await chrome.storage.local.get(['autofill_count', 'rated']);
    const ratingHtml = (!rated && autofill_count >= 3)
      ? `<a href="https://chromewebstore.google.com/detail/ocdeebjeffdjmfgmclnlphkhfdcdpdkf/reviews" target="_blank"
           id="rate-link" style="color:#6366f1;font-size:12px;font-weight:600;text-decoration:none;margin-left:12px;">⭐ Rate SimplyApply</a>`
      : '';

    bar.innerHTML = `
      <span id="auth-status" style="color:#22c55e;font-weight:600">✓ ${email}</span>
      ${ratingHtml}
      <button class="abtn secondary" id="signout-btn" style="margin-left:auto">Sign out</button>`;

    if (!rated && autofill_count >= 3) {
      document.getElementById('rate-link').onclick = () => chrome.storage.local.set({ rated: true });
    }

    document.getElementById('signout-btn').onclick = async () => {
      await sw('SIGN_OUT');
      renderAuth();
    };

    await loadProfile();
  } else {
    // Signed out — show onboarding gate, hide profile
    document.getElementById('onboarding').style.display = 'block';
    document.getElementById('auth-bar').style.display = 'none';
    document.getElementById('profile-sections').style.display = 'none';
    wireOnboarding();
  }
}

function wireOnboarding() {
  const msg = document.getElementById('ob-msg');

  async function attempt(type) {
    const email = document.getElementById('ob-email').value.trim();
    const pass  = document.getElementById('ob-pass').value;
    if (!email || !pass) { msg.textContent = 'Enter your email and a password.'; return; }
    if (pass.length < 8) { msg.textContent = 'Password must be 8+ characters.'; return; }
    msg.style.color = '#94a3b8';
    msg.textContent = type === 'SIGN_IN' ? 'Signing in…' : 'Creating account…';

    const r = await sw(type, { email, password: pass });
    if (r && r.ok) {
      if (r.needsConfirmation) {
        msg.style.color = '#22c55e';
        msg.textContent = '✓ Check your email to confirm, then come back and sign in.';
      } else {
        renderAuth();
      }
    } else {
      msg.style.color = '#ef4444';
      msg.textContent = r?.error || (type === 'SIGN_IN' ? 'Sign in failed — check your password.' : 'Sign up failed.');
    }
  }

  document.getElementById('ob-signin').onclick  = () => attempt('SIGN_IN');
  document.getElementById('ob-signup').onclick  = () => attempt('SIGN_UP');

  // Allow Enter key in password field
  document.getElementById('ob-pass').onkeydown = e => {
    if (e.key === 'Enter') attempt('SIGN_IN');
  };
}

renderAuth();
