const FIELDS = [
  'firstName','lastName','email','phone','pronouns',
  'city','state','country','postalCode',
  'linkedin','github','portfolio',
  'educationLevel','schoolName','fieldOfStudy','graduationYear',
  'workAuth','sponsorship','salary','heardAbout',
  'background','resume',
];

// No identity/contact/location/salary defaults — those were the founder's
// own real data, prefilled into every new user's profile form. Only
// genuinely generic, non-identifying smart-defaults belong here.
const DEFAULT = {
  firstName: '', lastName: '',
  email: '', phone: '', pronouns: '',
  city: '', state: '', country: '', postalCode: '',
  linkedin: '', github: '', portfolio: '',
  educationLevel: '',
  schoolName: '', fieldOfStudy: '', graduationYear: '',
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
async function loadProfile(token) {
  const stored = await chrome.storage.local.get('profile');
  let serverProfile = null;

  // Always prefer the server copy when signed in — it's the source of
  // truth (saveProfile below pushes every save there). A local-only cache
  // check here meant a profile fixed/edited directly in the database (or
  // on another device) would never reach this browser, since the browser
  // already had *some* local profile cached from before.
  if (token) {
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

// ── Skill gap path (Phase 1: aggregated missing-skill signal) ────────────────
async function loadGapPath() {
  const status = document.getElementById('gap-path-status');
  const results = document.getElementById('gap-path-results');
  status.textContent = 'Loading…';
  results.innerHTML = '';
  try {
    const res = await sw('GET_TOKEN');
    const token = res?.token;
    if (!token) throw new Error('Not signed in');
    const r = await fetch('https://elevate-careers-api.fly.dev/api/ai-resume/skills/gap-path', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || data?.error || `API ${r.status}`);

    status.textContent = `Based on ${data.totalJobsSeen} job(s) seen`;
    if (!data.skills?.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12.5px;color:#475569;';
      empty.textContent = data.totalJobsSeen > 0 ? 'No recurring gaps yet.' : 'Browse a few job postings with the extension active to build this up.';
      results.appendChild(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:0;padding-left:18px;';
    for (const s of data.skills) {
      const li = document.createElement('li');
      li.style.cssText = 'margin-bottom:8px;font-size:12.5px;color:#334155;';
      const pct = Number.isFinite(s.missingInPct) ? ` — missing in ${s.missingInPct}% of jobs seen` : '';
      const skillLine = document.createElement('div');
      skillLine.textContent = `${s.skill}${pct}`;
      li.appendChild(skillLine);
      if (s.certifications?.length) {
        const certLine = document.createElement('div');
        certLine.style.cssText = 'margin-top:2px;font-size:11.5px;color:#6366f1;';
        certLine.textContent = 'Certifications: ';
        s.certifications.forEach((c, i) => {
          if (i > 0) certLine.appendChild(document.createTextNode(' · '));
          const a = document.createElement('a');
          a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = `${c.name} (${c.provider})`;
          a.style.color = '#6366f1';
          certLine.appendChild(a);
        });
        li.appendChild(certLine);
      }
      ul.appendChild(li);
    }
    results.appendChild(ul);
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  }
}
document.getElementById('refresh-gap-path').addEventListener('click', loadGapPath);

document.getElementById('clear-cache').addEventListener('click', async () => {
  await chrome.storage.local.remove(['answerCache', 'learnedAnswers']);
  const toast = document.getElementById('clear-cache-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
});

// ── Resume audit (job-independent formatting/quality check) ───────────────────
document.getElementById('audit-resume').addEventListener('click', async () => {
  const btn = document.getElementById('audit-resume');
  const status = document.getElementById('audit-status');
  const results = document.getElementById('audit-results');
  const resumeText = document.getElementById('resume').value.trim();

  if (!resumeText) {
    status.textContent = 'Add resume text first.';
    return;
  }

  btn.disabled = true;
  status.textContent = 'Checking…';
  results.style.display = 'none';

  try {
    const res = await sw('GET_TOKEN');
    const token = res?.token;
    if (!token) throw new Error('Not signed in');

    const r = await fetch('https://elevate-careers-api.fly.dev/api/ai-resume/resume/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profile: { resume: resumeText } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || data?.error || `API ${r.status}`);

    status.textContent = '';
    results.innerHTML = '';
    if (Number.isFinite(data.overallScore)) {
      const scoreDiv = document.createElement('div');
      scoreDiv.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:8px;';
      scoreDiv.textContent = `Overall score: ${data.overallScore}/100`;
      results.appendChild(scoreDiv);
    }
    const findings = data.findings || [];
    if (findings.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:12.5px;color:#475569;';
      empty.textContent = 'No issues found.';
      results.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:0;padding-left:18px;';
      for (const f of findings) {
        const li = document.createElement('li');
        li.style.cssText = `margin-bottom:6px;color:${f.severity === 'warn' ? '#b45309' : '#475569'};font-size:12.5px;`;
        li.textContent = `${f.severity === 'warn' ? '⚠' : 'ℹ'} ${f.text}`;
        ul.appendChild(li);
      }
      results.appendChild(ul);
    }
    results.style.display = 'block';
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
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
    loadGapPath();
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
