// filler.js
// Runs INSIDE the browser page via page.evaluate(fillerFn, args).
// No Node.js imports allowed — pure browser JS.
// window.getAIAnswer(question, jobDesc) is exposed by Playwright before this runs.

export async function fillerFn({ profile, jobDescription, dryRun }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = (el, ...types) => types.forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));

  // ── Profile value resolver ────────────────────────────────────────────────
  const FIELD_MAP = [
    { re: /first\s*name/i,                                   key: 'firstName' },
    { re: /last\s*name|surname|family\s*name/i,              key: 'lastName' },
    { re: /^(full\s*name|your\s*name|name)$/i,               key: 'fullName' },
    { re: /email/i,                                          key: 'email' },
    { re: /phone|mobile|cell/i,                              key: 'phone' },
    { re: /city/i,                                           key: 'city' },
    { re: /state|province|region/i,                          key: 'state' },
    { re: /country/i,                                        key: 'country' },
    { re: /zip|postal\s*code/i,                              key: 'postalCode' },
    { re: /linkedin/i,                                       key: 'linkedin' },
    { re: /github/i,                                         key: 'github' },
    { re: /portfolio|personal\s*website|website/i,           key: 'portfolio' },
    { re: /salary|compensation|desired\s*pay/i,              key: 'salary' },
    { re: /graduation|grad\s*year/i,                         key: 'graduationYear' },
    { re: /school|university|college|institution/i,          key: 'schoolName' },
    { re: /field\s*of\s*study|major|concentration/i,         key: 'fieldOfStudy' },
    { re: /degree|education\s*level/i,                       key: 'educationLevel' },
    { re: /work\s*auth|authorized\s*to\s*work|legally\s*(eligible|authorized)/i, key: 'workAuth' },
    { re: /sponsor|visa\s*sponsor/i,                         key: 'sponsorship' },
    { re: /how\s*did\s*you\s*(hear|find|learn)/i,            key: 'heardAbout' },
  ];

  function profileVal(label) {
    const entry = FIELD_MAP.find(m => m.re.test(label));
    if (!entry) return null;
    if (entry.key === 'fullName') return `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    return profile[entry.key] || null;
  }

  // ── Label extraction ──────────────────────────────────────────────────────
  function getLabel(el) {
    // 1. <label for="id">
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    // 2. aria-label / placeholder
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.placeholder) return el.placeholder.trim();
    // 3. closest <label> ancestor
    const lblAnc = el.closest('label');
    if (lblAnc) return lblAnc.innerText.trim();
    // 4. preceding sibling or parent text node
    const parent = el.closest('[class*="field"], [class*="form"], [class*="input"], div, li');
    if (parent) {
      const lbl = parent.querySelector('label, [class*="label"], span');
      if (lbl && !lbl.contains(el)) return lbl.innerText.trim();
    }
    return el.name || '';
  }

  // ── Type a value into a text input ────────────────────────────────────────
  async function typeIn(el, value) {
    el.focus();
    el.select?.();
    // React-friendly: use native input setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) nativeInputValueSetter.call(el, value);
    else el.value = value;
    fire(el, 'input', 'change');
    await sleep(80);
  }

  // ── Fill a native <select> ─────────────────────────────────────────────────
  function fillSelect(el, value) {
    const v = value.toLowerCase();
    // Exact match first, then fuzzy
    for (const opt of el.options) {
      if (opt.text.toLowerCase() === v || opt.value.toLowerCase() === v) {
        el.value = opt.value;
        fire(el, 'change');
        return true;
      }
    }
    for (const opt of el.options) {
      if (opt.text.toLowerCase().includes(v) || v.includes(opt.text.toLowerCase())) {
        el.value = opt.value;
        fire(el, 'change');
        return true;
      }
    }
    return false;
  }

  // ── Detect if field is open-ended (needs AI) ──────────────────────────────
  function isOpenEnded(label, el) {
    if (el.tagName === 'TEXTAREA') return true;
    const openRe = /cover\s*letter|why\s*(do\s*you|are\s*you|this)|tell\s*us|describe|explain|additional|anything\s*else|message|about\s*yourself/i;
    return openRe.test(label);
  }

  // ── Yes/No normalizer ─────────────────────────────────────────────────────
  function yesNoVal(profileValue) {
    const v = String(profileValue).toLowerCase();
    if (/^y|yes|true|1/.test(v)) return 'Yes';
    if (/^n|no|false|0/.test(v)) return 'No';
    return profileValue;
  }

  // ── Main fill loop ────────────────────────────────────────────────────────
  let filled = 0, skipped = 0, errored = 0;
  const aiUsed = [];

  const inputs = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select'
  )).filter(el => {
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
  });

  for (const el of inputs) {
    try {
      const label = getLabel(el);
      if (!label) { skipped++; continue; }

      // ── SELECT ────────────────────────────────────────────────────────────
      if (el.tagName === 'SELECT') {
        const val = profileVal(label);
        if (val) {
          const normalized = /work.?auth|legally|authorized/i.test(label) || /sponsor/i.test(label)
            ? yesNoVal(val) : val;
          const ok = dryRun || fillSelect(el, normalized);
          ok ? filled++ : skipped++;
        } else {
          // Try AI for dropdowns with meaningful options
          const opts = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select...' && t !== '');
          if (opts.length > 1 && opts.length < 20) {
            const answer = await window.getAIAnswer(`${label} (choose one: ${opts.join(', ')})`, jobDescription);
            if (answer) {
              const ok = dryRun || fillSelect(el, answer);
              if (ok) { filled++; aiUsed.push(label); } else skipped++;
            } else skipped++;
          } else skipped++;
        }
        continue;
      }

      // ── TEXTAREA / OPEN-ENDED ─────────────────────────────────────────────
      if (isOpenEnded(label, el)) {
        const answer = await window.getAIAnswer(label, jobDescription);
        if (answer) {
          if (!dryRun) await typeIn(el, answer);
          filled++;
          aiUsed.push(label);
        } else skipped++;
        continue;
      }

      // ── TEXT INPUT ────────────────────────────────────────────────────────
      const val = profileVal(label);
      if (val) {
        if (!dryRun) await typeIn(el, val);
        filled++;
      } else {
        skipped++;
      }

    } catch (e) {
      errored++;
    }
  }

  // ── Radio buttons (Yes/No, work auth, etc.) ───────────────────────────────
  const radioGroups = {};
  document.querySelectorAll('input[type=radio]').forEach(el => {
    const name = el.name || el.getAttribute('aria-label') || 'unknown';
    if (!radioGroups[name]) radioGroups[name] = [];
    radioGroups[name].push(el);
  });

  for (const [, radios] of Object.entries(radioGroups)) {
    try {
      const label = getLabel(radios[0]) || radios[0].name || '';
      const val = profileVal(label);
      if (!val) { skipped++; continue; }
      const target = yesNoVal(val).toLowerCase();
      const match = radios.find(r => {
        const rl = (getLabel(r) || r.value || '').toLowerCase();
        return rl === target || rl.startsWith(target[0]);
      });
      if (match) {
        if (!dryRun) { match.checked = true; fire(match, 'change', 'click'); }
        filled++;
      } else skipped++;
    } catch { errored++; }
  }

  return {
    filled,
    skipped,
    errored,
    fieldCount: filled + skipped + errored,
    aiUsed: aiUsed.length > 0,
    aiFields: aiUsed,
  };
}
