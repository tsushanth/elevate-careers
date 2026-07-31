/**
 * debug-e2e.mjs — full autofill simulation
 * Loads the Datadog Greenhouse page with the extension, then re-runs the
 * extension's field-detection + fill logic in the frame context, using the
 * real SimplyApply backend for AI answers.
 *
 * Run:  node debug-e2e.mjs
 */
import { chromium } from './playwright-worker/node_modules/playwright/index.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH  = path.resolve(__dirname, 'extension/dist');
const JOB_URL   = 'https://careers.datadoghq.com/detail/7650238/?gh_jid=7650238';
const API_URL   = 'https://elevate-careers-api.fly.dev';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const PROFILE = {
  firstName:'Sushanth', lastName:'Tiruvaipati',
  email:'t.sushanth@gmail.com', phone:'+14256284887',
  city:'San Jose', state:'California', country:'United States', postalCode:'95101',
  linkedin:'https://www.linkedin.com/in/tsushanth',
  github:'https://github.com/tsushanth',
  portfolio:'https://kreativekoala.llc',
  educationLevel:"Master's Degree", schoolName:'Carnegie Mellon University',
  fieldOfStudy:'Information Networking', graduationYear:'2011',
  workAuth:'Yes', sponsorship:'No', salary:'150000', heardAbout:'LinkedIn',
  background:`Sushanth Tiruvaipati is a software engineer with 10+ years at Google and an indie developer.`,
};

(async () => {
  console.log('Launching Chrome with extension...');
  const context = await chromium.launchPersistentContext('', {
    headless: false, channel: 'chrome',
    args: [`--load-extension=${EXT_PATH}`, `--disable-extensions-except=${EXT_PATH}`],
  });

  const page = await context.newPage();
  await page.goto(JOB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);

  let ghFrame = page.frames().find(f => f.url().includes('greenhouse.io'));
  if (!ghFrame) {
    const iframeEl = await page.waitForSelector('#grnhse_iframe', { timeout: 10000 });
    ghFrame = await iframeEl.contentFrame();
  }
  if (!ghFrame) { console.error('❌ iframe not found'); await context.close(); return; }
  console.log('✅ iframe:', ghFrame.url().split('?')[0], '\n');

  await ghFrame.waitForSelector('input, select, textarea', { timeout: 15000 });
  await sleep(1000);

  // ── Run the full detection + fill logic inside the frame ──────────────────
  const fieldReport = await ghFrame.evaluate(async (args) => {
    const { profile, API_URL } = args;

    // ── helpers (mirrors mount.js) ──────────────────────────────────────────
    const SKIP_EEOC = /gender|lgbtq|race|ethnic|hispanic|latino|veteran|disability|pronouns|sexual|transgender/i;
    const AGREE_RE  = /i agree|i consent|i acknowledge|i certify|terms|privacy policy|by (checking|selecting|clicking)/i;
    const RESUME_RE = /\bresume\b/i;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function cleanText(t) {
      return (t||'').replace(/\s+/g,' ').replace(/^Q\.\s*/i,'').replace(/\s*Required\b.*$/i,'').replace(/[*:]+$/,'').trim();
    }

    function extractLabel(el) {
      if (el.id) { const lbl = document.querySelector(`label[for="${el.id}"]`); if (lbl) return cleanText(lbl.textContent); }
      const al = el.getAttribute('aria-label'); if (al?.trim()) return cleanText(al);
      const alb = el.getAttribute('aria-labelledby');
      if (alb) { const t = alb.split(' ').map(id=>document.getElementById(id)?.textContent).filter(Boolean).join(' '); if (t.trim()) return cleanText(t); }
      let node = el.parentElement;
      for (let d=0;d<8&&node;d++,node=node.parentElement) {
        if (node.querySelectorAll('input:not([type=hidden]),select,textarea').length>1) break;
        for (const lbl of node.querySelectorAll('label')) { if (!lbl.contains(el)){const t=cleanText(lbl.textContent);if(t&&t.length<200)return t;} }
      }
      return cleanText(el.placeholder||el.name||el.id||'');
    }

    const KEYWORD_RULES = [
      { re: /visa sponsorship|require.*sponsor|h-?1b/i,                     key: 'sponsorship' },
      { re: /authori[sz]ed to work|work auth|legally authoris|eligible to work/i, key: 'workAuth' },
      { re: /\bphone\b|\bmobile\b|telephone/i,                              key: 'phone' },
      { re: /\bcountry\b/i,                                                 key: 'country' },
      { re: /\bstate\b|\bprovince\b/i,                                      key: 'state' },
      { re: /\bcity\b/i,                                                    key: 'city' },
      { re: /zip|postal code/i,                                             key: 'postalCode' },
      { re: /linkedin/i,                                                    key: 'linkedin' },
      { re: /github/i,                                                      key: 'github' },
      { re: /website|portfolio/i,                                           key: 'portfolio' },
      { re: /first name|given name/i,                                       key: 'firstName' },
      { re: /last name|surname/i,                                           key: 'lastName' },
      { re: /\bemail\b/i,                                                   key: 'email' },
      { re: /education level|highest.*degree/i,                             key: 'educationLevel' },
      { re: /school name|university|college/i,                              key: 'schoolName' },
      { re: /salary|compensation|pay expectation/i,                         key: 'salary' },
      { re: /how.*hear|how.*find|referral source/i,                         key: 'heardAbout' },
    ];
    function matchKey(label) { const t=label.toLowerCase(); for(const{re,key}of KEYWORD_RULES){if(re.test(t))return key;} return null; }

    function reactClick(el) {
      const opts={bubbles:true,cancelable:true,view:window};
      el.dispatchEvent(new MouseEvent('mousedown',{...opts,button:0,buttons:1}));
      el.dispatchEvent(new MouseEvent('mouseup',opts));
      el.dispatchEvent(new MouseEvent('click',opts));
    }

    function visibleOptions() {
      return [...document.querySelectorAll('[role="option"]')]
        .filter(o=>{const r=o.getBoundingClientRect();return r.width>0&&r.height>0;})
        .map(o=>({text:o.textContent.trim(),el:o})).filter(o=>o.text);
    }

    function fuzzyPickOption(opts, hint) {
      const h = String(hint).toLowerCase().trim();
      return (
        opts.find(o=>o.text.toLowerCase()===h) ||
        opts.find(o=>o.text.toLowerCase().startsWith(h)) ||
        opts.find(o=>o.text.toLowerCase().includes(h)) ||
        opts.find(o=>h.includes(o.text.toLowerCase())&&o.text.length>1) ||
        (/^yes/i.test(h) && opts.find(o=>/^yes\b/i.test(o.text))) ||
        (/^no/i.test(h)  && (opts.find(o=>/^no\b/i.test(o.text)&&!/sponsor/i.test(o.text))||opts.find(o=>/^no\b/i.test(o.text)))) ||
        null
      );
    }

    async function openAndCollect(el) {
      const ctrl = el.closest('[class*="control"]')||el.parentElement?.parentElement;
      if (ctrl&&ctrl!==el) reactClick(ctrl); else reactClick(el);
      await sleep(450);
      return visibleOptions();
    }

    async function apiCall(endpoint, body) {
      const r = await fetch(API_URL + endpoint, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({...body, profile}),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }

    // ── Scan fields ────────────────────────────────────────────────────────
    const FIELD_SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=search]),select,textarea';
    const fields = [];

    for (const el of document.querySelectorAll(FIELD_SEL)) {
      if (el.disabled||el.readOnly) continue;
      if (/\bsearch\b/i.test(el.className)||/\bsearch\b/i.test(el.id)) continue;
      if (el.closest('nav,header,[role=search]')) continue;
      if (el.type==='file') { fields.push({el,label:'Resume',key:'resume',type:'file'}); continue; }
      const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue;

      const label = extractLabel(el);
      const key = matchKey(label)||matchKey(el.name||'')||matchKey(el.placeholder||'');
      let type = (el.type||el.tagName).toLowerCase();
      if ((type==='text'||type==='search')&&el.tagName==='INPUT') {
        if (el.getAttribute('role')==='combobox'||el.getAttribute('aria-autocomplete')||el.getAttribute('aria-haspopup')) type='combobox';
        else if (el.getAttribute('list')) type='datalist';
      }
      fields.push({el,label:label||'(Unlabeled)',key,type,id:el.id});
    }

    // ── Fill each field ────────────────────────────────────────────────────
    const report = [];

    for (const field of fields) {
      const {el,label,key,type,id} = field;
      el.scrollIntoView({behavior:'smooth',block:'center'});
      await sleep(200);

      const row = {label:label.slice(0,70), id:id||'', type, key:key||'', status:'', detail:''};

      try {
        // Skip EEOC
        if (SKIP_EEOC.test(label)||(key&&SKIP_EEOC.test(key))) {
          row.status='SKIP'; row.detail='EEOC'; report.push(row); continue;
        }

        // File (resume)
        if (type==='file') {
          row.status='SKIP'; row.detail='file — manual'; report.push(row); continue;
        }

        // Agreement checkbox (certify / privacy)
        if (AGREE_RE.test(label)||(type==='checkbox'&&/agree|consent/i.test(label))) {
          if (type==='checkbox'||type==='radio') {
            if (!el.checked) el.click();
            row.status='DONE'; row.detail='✓ agreed';
          } else if (type==='combobox') {
            const opts = await openAndCollect(el);
            const pick = fuzzyPickOption(opts,'Yes');
            if (pick) { pick.el.click(); await sleep(150); row.status='DONE'; row.detail=`agreed → "${pick.text}"`; }
            else { row.status='FAIL'; row.detail=`no Yes option, got: ${opts.map(o=>o.text).join(' | ')}`; }
          }
          report.push(row); continue;
        }

        // Native select
        if (type==='select-one'||el.tagName==='SELECT') {
          const opts=[...el.options].map(o=>({text:o.textContent.trim(),el:o})).filter(o=>o.text);
          if (key&&profile[key]!=null) {
            const pick=fuzzyPickOption(opts,profile[key]);
            if(pick){el.value=pick.el.value;el.dispatchEvent(new Event('change',{bubbles:true}));row.status='DONE';row.detail=`key=${key} → "${pick.text}"`;}
            else{row.status='FAIL';row.detail=`no match for "${profile[key]}" in [${opts.map(o=>o.text).join(',')}]`;}
          } else {
            row.status='SKIP'; row.detail='select — no key, skipped';
          }
          report.push(row); continue;
        }

        // Combobox (React Select)
        if (type==='combobox') {
          const isMulti = id?.endsWith('[]');

          // Multi-select: skip (user fills once, cached for next time)
          if (isMulti) {
            row.status='REVIEW'; row.detail='multi-select — fill once manually';
            report.push(row); continue;
          }

          // Has a profile key
          if (key && profile[key]!=null) {
            const opts = await openAndCollect(el);
            const pick = fuzzyPickOption(opts, profile[key]);
            if (pick) {
              pick.el.click(); await sleep(150);
              row.status='DONE'; row.detail=`key=${key} "${profile[key]}" → "${pick.text}"`;
            } else {
              // Close and report
              el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
              await sleep(100);
              row.status='FAIL'; row.detail=`key=${key} no match for "${profile[key]}" opts=[${opts.map(o=>o.text).join('|')}]`;
            }
            report.push(row); continue;
          }

          // No key — ask AI
          if (label&&label!=='(Unlabeled)') {
            const opts = await openAndCollect(el);
            const optTexts = opts.map(o=>o.text);
            const suffix = optTexts.length ? ` (choose best from: ${optTexts.join(', ')})` : '';
            let answer;
            try {
              const res = await apiCall('/copilot/answer', {question: label+suffix, jobDescription:''});
              answer = res.answer;
            } catch(e) { answer = null; }

            if (answer && opts.length>0) {
              const pick=fuzzyPickOption(opts,answer);
              if(pick){pick.el.click();await sleep(150);row.status='DONE';row.detail=`AI "${answer}" → "${pick.text}"`;}
              else{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));row.status='FAIL';row.detail=`AI "${answer}" no match in [${optTexts.join('|')}]`;}
            } else if (answer && opts.length===0) {
              row.status='FAIL'; row.detail=`AI "${answer}" but dropdown didn't open`;
            } else {
              row.status='FAIL'; row.detail='AI call failed';
            }
          } else {
            row.status='SKIP'; row.detail='no label';
          }
          report.push(row); continue;
        }

        // Plain text / textarea
        if ((type==='text'||type==='textarea'||type==='email'||type==='tel'||type==='url'||type==='number') && key && profile[key]!=null) {
          el.focus();
          el.value=String(profile[key]);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          row.status='DONE'; row.detail=`${key} = "${String(profile[key]).slice(0,40)}"`;
          report.push(row); continue;
        }

        row.status='SKIP'; row.detail=`type=${type} key=${key||'none'} — not handled`;
        report.push(row);

      } catch(e) {
        row.status='ERR'; row.detail=e.message;
        report.push(row);
      }

      await sleep(150);
    }

    return report;

  }, { profile: PROFILE, API_URL });

  // ── Print report ──────────────────────────────────────────────────────────
  const icons = { DONE:'✅', SKIP:'⬜', FAIL:'❌', ERR:'💥', REVIEW:'⚠️' };
  let done=0, fail=0, skip=0, review=0;

  console.log('─'.repeat(80));
  for (const r of fieldReport) {
    const icon = icons[r.status]||'?';
    if (r.status==='DONE') done++;
    else if (r.status==='FAIL'||r.status==='ERR') fail++;
    else if (r.status==='REVIEW') review++;
    else skip++;
    console.log(`${icon} [${r.type.padEnd(10)}] "${r.label.slice(0,55).padEnd(55)}" ${r.detail}`);
  }
  console.log('─'.repeat(80));
  console.log(`\n  DONE: ${done}  FAIL/ERR: ${fail}  REVIEW: ${review}  SKIP: ${skip}  TOTAL: ${fieldReport.length}\n`);

  if (fail > 0) {
    console.log('Failures to fix:');
    fieldReport.filter(r=>r.status==='FAIL'||r.status==='ERR').forEach(r=>{
      console.log(`  ❌ [${r.type}] "${r.label}" — ${r.detail}`);
    });
  }

  console.log('\nKeeping browser open for visual inspection. Ctrl+C to exit.');
  await sleep(60000);
  await context.close();
})();
