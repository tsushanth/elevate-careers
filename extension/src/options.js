const FIELDS = [
  'firstName','lastName','email','phone',
  'city','state','country','postalCode',
  'linkedin','github','portfolio',
  'educationLevel','schoolName','fieldOfStudy','graduationYear',
  'workAuth','sponsorship','salary','heardAbout',
  'background','resume',
];

const DEFAULT = {
  firstName: 'Sushanth', lastName: 'Tiruvaipati',
  email: 't.sushanth@gmail.com', phone: '+1 425-628-4887',
  city: 'Milpitas', state: 'California', country: 'United States', postalCode: '95035',
  linkedin: 'https://www.linkedin.com/in/tsushanth/', github: 'https://github.com/tsushanth', portfolio: '',
  educationLevel: "Bachelor's Degree",
  schoolName: '', fieldOfStudy: 'Computer Science', graduationYear: '',
  workAuth: 'Yes', sponsorship: 'No',
  salary: '150000', heardAbout: 'LinkedIn',
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
async function loadProfile(token) {
  const stored = await chrome.storage.local.get('profile');
  let serverProfile = null;

  // Pull from server if we have a token and no local profile yet
  if (token && !stored.profile) {
    try {
      const r = await fetch('https://elevate-careers-api.fly.dev/api/ai-resume/profile/sync', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.profile) {
          serverProfile = data.profile;
          await chrome.storage.local.set({ profile: serverProfile });
        }
      }
    } catch (_) {}
  }

  const profile = { ...DEFAULT, ...(serverProfile || stored.profile || {}) };
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

document.getElementById('clear-cache').addEventListener('click', async () => {
  await chrome.storage.local.remove(['answerCache', 'learnedAnswers']);
  const toast = document.getElementById('clear-cache-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
});

// ── PDF upload handlers ───────────────────────────────────────────────────────
async function handlePdfUpload(inputId, storageKey, labelId) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      label.textContent = '⚠ Must be a PDF file';
      label.style.color = '#ef4444';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      label.textContent = '⚠ File too large (max 5 MB)';
      label.style.color = '#ef4444';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      await chrome.storage.local.set({ [storageKey]: reader.result });
      label.textContent = `✓ ${file.name}`;
      label.style.color = '#22c55e';
    };
    reader.readAsDataURL(file);
  });

  // Show current file name if already uploaded
  const stored = await chrome.storage.local.get(storageKey);
  if (stored[storageKey]) {
    label.textContent = '✓ PDF uploaded';
    label.style.color = '#22c55e';
  }
}

handlePdfUpload('resume-pdf-input',       'resumePdfDataUrl',      'resume-pdf-label');
handlePdfUpload('cover-letter-pdf-input', 'coverLetterPdfDataUrl', 'cover-letter-pdf-label');

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

    await loadProfile(token);
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
