import { pipeline, cos_sim } from '@xenova/transformers';

// ============================================
// EMBEDDINGS MODULE
// ============================================
let embedder = null;

async function initEmbedder() {
  if (!embedder) {
    console.log('🧠 Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          console.log(`📥 Downloading: ${progress.file} - ${Math.round(progress.progress)}%`);
        }
      }
    });
    console.log('✅ Embedding model loaded!');
  }
  return embedder;
}

async function generateEmbedding(text) {
  if (!embedder) await initEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

let PROFILE_EMBEDDINGS = null;

async function initProfileEmbeddings() {
  if (PROFILE_EMBEDDINGS) return PROFILE_EMBEDDINGS;
  
  console.log('🔧 Pre-computing profile embeddings...');
  
  PROFILE_EMBEDDINGS = {
    firstName: await generateEmbedding('first name given name legal first name forename'),
    lastName: await generateEmbedding('last name surname family name legal last name'),
    email: await generateEmbedding('email address e-mail electronic mail contact email'),
    phone: await generateEmbedding('phone number telephone mobile cell number contact number'),
    linkedin: await generateEmbedding('linkedin profile linkedin url linkedin account social media'),
    github: await generateEmbedding('github profile github username github account code repository'),
    portfolio: await generateEmbedding('portfolio website personal website portfolio url web portfolio'),
    location: await generateEmbedding('city location address city name current location residence'),
    workAuth: await generateEmbedding('work authorization authorized to work work permit employment authorization legally authorized'),
    address: await generateEmbedding('street address address line home address mailing address'),
    postalCode: await generateEmbedding('postal code zip code postcode zip mail code'),
    state: await generateEmbedding('state province region territory'),
    country: await generateEmbedding('country nation')
  };
  
  console.log('✅ Profile embeddings ready!');
  return PROFILE_EMBEDDINGS;
}

async function matchFieldToProfile(fieldLabel, fieldName = '', placeholder = '') {
  const contextText = [fieldLabel, fieldName, placeholder]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  
  if (!contextText.trim()) {
    return { key: null, confidence: 'skip', score: 0, reason: 'No text to match' };
  }
  
  const profileEmbs = await initProfileEmbeddings();
  const fieldEmbedding = await generateEmbedding(contextText);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [key, profileEmb] of Object.entries(profileEmbs)) {
    const similarity = cos_sim(fieldEmbedding, profileEmb);
    
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = key;
    }
  }
  
  const CONFIDENT_THRESHOLD = 0.65;
  const SKIP_THRESHOLD = 0.40;
  
  let confidence = 'high';
  if (bestScore < SKIP_THRESHOLD) {
    confidence = 'skip';
    bestMatch = null;
  } else if (bestScore < CONFIDENT_THRESHOLD) {
    confidence = 'low';
  }
  
  return {
    key: bestMatch,
    confidence: confidence,
    score: bestScore.toFixed(3),
    reason: confidence === 'skip' ? 'No good match found' : `Matched with ${(bestScore * 100).toFixed(1)}% confidence`
  };
}

// ============================================
// MAIN EXTENSION CODE
// ============================================
(async () => {
  if (window.__autofillMounted) return;
  window.__autofillMounted = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  const host = document.createElement('div');
  host.id = '__autofill_widget_host';
  host.style.position = 'fixed';
  host.style.inset = 'auto 20px 20px auto';
  host.style.zIndex = 2147483647;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .wrap{ position:relative; }
      .btn{ all:initial; width:56px;height:56px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;
            background:#fff;border:1px solid #e5e7eb;box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:pointer;font:16px system-ui; }
      .btn:hover{ box-shadow:0 10px 36px rgba(0,0,0,.22); }
      .panel{ position:fixed; right:20px; bottom:90px; width:380px; max-height:70vh; overflow:auto; background:#fff; border:1px solid #e5e7eb;
              border-radius:14px; box-shadow:0 12px 44px rgba(0,0,0,.22); display:none; }
      .panel.open{ display:block; }
      .hdr{ display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #f1f5f9; }
      .lst{ list-style:none; margin:0; padding:8px 12px; }
      .row{ display:flex; gap:8px; align-items:flex-start; padding:6px 0; border-bottom:1px dashed #f1f5f9; }
      .row:last-child{ border-bottom:none; }
      .st{ width:10px; height:10px; border-radius:50%; margin-top:4px; }
      .s-pending{ background:#e5e7eb; } .s-filling{ background:#fbbf24; } .s-done{ background:#22c55e; }
      .s-skip{ background:#94a3b8; } .s-error{ background:#ef4444; }
      .footer{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #f1f5f9; }
      .smallbtn{ padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px; background:#fafafa; cursor:pointer; font:12px system-ui; }
      mark{ background:#fef3c7; }
      .live{ position:absolute; left:-9999px; top:auto; width:1px; height:1px; overflow:hidden; }
      .badge{ padding:2px 6px; border-radius:4px; font-size:10px; font-weight:600; margin-left:4px; }
      .badge-high{ background:#22c55e; color:white; }
      .badge-low{ background:#fbbf24; color:black; }
    </style>
    <div class="wrap">
      <button class="btn" id="toggle">⚡</button>
      <div class="panel" id="panel">
        <div class="hdr">
          <strong style="font:14px system-ui">Autofill</strong>
          <span id="summary" style="margin-left:auto;font:13px system-ui">Ready</span>
        </div>
        <ul class="lst" id="list"></ul>
        <div class="footer">
          <button class="smallbtn" id="dry">Dry-run</button>
          <button class="smallbtn" id="run">Fill</button>
          <button class="smallbtn" id="pause">Pause</button>
          <button class="smallbtn" id="settings">Settings</button>
        </div>
      </div>
      <div class="live" aria-live="polite" id="live"></div>
    </div>
  `;

  const ui = {
    panel: shadow.getElementById('panel'),
    toggleBtn: shadow.getElementById('toggle'),
    runBtn: shadow.getElementById('run'),
    dryBtn: shadow.getElementById('dry'),
    pauseBtn: shadow.getElementById('pause'),
    settingsBtn: shadow.getElementById('settings'),
    list: shadow.getElementById('list'),
    summary: shadow.getElementById('summary'),
    live: shadow.getElementById('live'),
    
    setSummary(text) {
      this.summary.textContent = text;
      this.live.textContent = text;
    },
    
    addRow(field) {
      const row = document.createElement('li');
      row.className = 'row';
      
      let confidenceBadge = '';
      if (field.confidence === 'high') {
        confidenceBadge = '<span class="badge badge-high">HIGH</span>';
      } else if (field.confidence === 'low') {
        confidenceBadge = '<span class="badge badge-low">LOW</span>';
      }
      
      row.innerHTML = `
        <div class="st s-pending" data-st></div>
        <div class="p" style="flex:1;">
          <div><mark>${(field.label || '').replace(/\s+/g, ' ').slice(0, 100) || '(Unlabeled)'}</mark> ${confidenceBadge}</div>
          <div style="font:11px system-ui;color:#64748b">
            ${field.key || 'unknown'} · <span data-msg>pending</span>${field.score ? ` · ${field.score}` : ''}
          </div>
        </div>`;
      
      this.list.appendChild(row);
      field._row = row;
    },
    
    setRow(field, status, message) {
      const statusDot = field._row.querySelector('[data-st]');
      const msgSpan = field._row.querySelector('[data-msg]');
      statusDot.className = `st s-${status}`;
      msgSpan.textContent = message;
    }
  };

  ui.toggleBtn.addEventListener('click', () => ui.panel.classList.toggle('open'));
  ui.settingsBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));

  function extractLabel(el) {
    const labelEl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) return labelEl.textContent.trim();
    
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();
    
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    
    return el.placeholder || el.name || el.id || '';
  }

  async function buildInventory(doc = document) {
    ui.setSummary('🧠 Initializing AI model...');
    
    await initEmbedder();
    
    ui.setSummary('🔍 Scanning form fields...');
    
    const fields = [...doc.querySelectorAll('input, select, textarea')]
      .filter(el => el.offsetParent && !el.disabled);
    
    const inventory = [];
    
    for (let i = 0; i < fields.length; i++) {
      const el = fields[i];
      
      const label = extractLabel(el);
      const name = el.name || '';
      const placeholder = el.placeholder || '';
      
      const match = await matchFieldToProfile(label, name, placeholder);
      
      const type = (el.type || el.tagName).toLowerCase();
      
      inventory.push({
        ix: i,
        el: el,
        label: label || '(Unlabeled field)',
        key: match.key,
        confidence: match.confidence,
        score: match.score,
        type: type,
        status: 'pending',
        matchReason: match.reason
      });
      
      if (i % 5 === 0) {
        ui.setSummary(`🔍 Scanning... ${i + 1}/${fields.length} fields`);
      }
    }
    
    ui.setSummary(`✅ Found ${inventory.length} fields`);
    return inventory;
  }

  const typeIn = async (el, value, delayMs = 8) => {
    el.focus();
    el.value = '';
    fire(el, 'input');
    
    for (const char of String(value)) {
      el.value += char;
      fire(el, 'input');
      await sleep(delayMs);
    }
    
    fire(el, 'change');
    el.blur();
    fire(el, 'blur');
  };

  async function fillField(field, profile) {
    const { el, type, key } = field;
    
    if (!key || !(key in profile)) {
      throw new Error('no data');
    }
    
    const value = profile[key];
    
    if (type === 'select-one' || el.tagName === 'SELECT') {
      const options = [...el.options];
      const match = options.find(opt => opt.textContent.trim().toLowerCase() === String(value).toLowerCase()) ||
                    options.find(opt => String(value).toLowerCase().includes(opt.value.toLowerCase()));
      
      if (match) {
        el.value = match.value;
        fire(el, 'change');
        return;
      }
      throw new Error('no matching option');
    }
    
    if (type === 'checkbox' || type === 'radio') {
      const shouldCheck = !!value && String(value).toLowerCase() !== 'no';
      if (el.checked !== shouldCheck) {
        el.click();
      }
      return;
    }
    
    if (type === 'file') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      throw new Error('needs user file selection');
    }
    
    await typeIn(el, value);
  }

  function validate(field, profile) {
    const { el, type, key } = field;
    const expectedValue = String(profile[key] ?? '').trim();
    
    if (!expectedValue) return false;
    
    if (type === 'select-one' || el.tagName === 'SELECT') {
      const selectedText = el.selectedOptions[0]?.textContent?.trim() || '';
      return selectedText.toLowerCase().includes(expectedValue.toLowerCase());
    }
    
    if (type === 'checkbox' || type === 'radio') {
      const shouldCheck = !!expectedValue && expectedValue.toLowerCase() !== 'no';
      return el.checked === shouldCheck;
    }
    
    return String(el.value || '').trim() === expectedValue;
  }

  async function runAutofill({ profile, dryRun = false, delay = 120 }) {
    const inventory = await buildInventory();
    
    ui.list.innerHTML = '';
    inventory.forEach(field => ui.addRow(field));
    
    ui.setSummary(`Found ${inventory.length} fields. ${dryRun ? 'Dry-run.' : 'Starting…'}`);
    
    let filled = 0, skipped = 0, errors = 0;
    let paused = false;
    
    ui.pauseBtn.textContent = 'Pause';
    ui.pauseBtn.onclick = () => {
      paused = !paused;
      ui.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    };
    
    for (const field of inventory) {
      while (paused) await sleep(150);
      
      field.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.el.style.outline = '2px solid #f59e0b';
      ui.setRow(field, 'filling', 'filling…');
      
      try {
        if (dryRun || !field.key || field.confidence === 'skip') {
          ui.setRow(field, 'skip', field.key ? 'dry-run' : 'unknown field');
          skipped++;
        } else {
          await fillField(field, profile);
          await sleep(delay);
          
          const isValid = validate(field, profile);
          if (!isValid) throw new Error('validation failed');
          
          ui.setRow(field, 'done', 'filled');
          filled++;
        }
      } catch (err) {
        ui.setRow(field, 'error', err.message || 'error');
        errors++;
      } finally {
        field.el.style.outline = '';
      }
      
      ui.setSummary(`Filled: ${filled} · Skipped: ${skipped} · Errors: ${errors}`);
    }
    
    ui.setSummary(`Done — Filled ${filled}, Skipped ${skipped}, Errors ${errors}`);
  }

  ui.dryBtn.addEventListener('click', async () => {
    const { profile } = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
    runAutofill({ profile, dryRun: true });
  });

  ui.runBtn.addEventListener('click', async () => {
    const { profile } = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
    runAutofill({ profile, dryRun: false, delay: 120 });
  });

  // Route change detection
  const wrap = fnName => {
    const original = history[fnName];
    history[fnName] = function() {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  };
  
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
})();