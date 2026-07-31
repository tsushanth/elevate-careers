/**
 * debug-combobox.mjs — v4 (end-to-end flow test)
 * Opens each combobox using reactClick, collects options, asks a mock "AI"
 * (just picks the first option), fuzzy-matches, and clicks it.
 */
import { chromium } from './playwright-worker/node_modules/playwright/index.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, 'extension/dist');
const JOB_URL = 'https://careers.datadoghq.com/detail/7650238/?gh_jid=7650238';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const context = await chromium.launchPersistentContext('', {
    headless: false, channel: 'chrome',
    args: [`--load-extension=${EXT_PATH}`, `--disable-extensions-except=${EXT_PATH}`],
  });
  const page = await context.newPage();
  await page.goto(JOB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // Wait for the iframe to load, then find it
  await sleep(2000);
  let ghFrame = page.frames().find(f => f.url().includes('greenhouse.io'));
  if (!ghFrame) {
    // Try waiting for the iframe element itself
    const iframeEl = await page.waitForSelector('#grnhse_iframe', { timeout: 10000 });
    ghFrame = await iframeEl.contentFrame();
  }
  if (!ghFrame) { console.error('❌ Greenhouse iframe not found'); await context.close(); return; }
  console.log('✅ iframe:', ghFrame.url().split('?')[0]);
  await ghFrame.waitForSelector('input[role="combobox"]', { timeout: 15000 });

  const results = await ghFrame.evaluate(async () => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function reactClick(el) {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    }

    function visibleOptions() {
      return [...document.querySelectorAll('[role="option"]')]
        .filter(o => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(o => ({ text: o.textContent.trim(), el: o }))
        .filter(o => o.text);
    }

    function fuzzyPick(opts, hint) {
      const h = hint.toLowerCase().trim();
      return (
        opts.find(o => o.text.toLowerCase() === h) ||
        opts.find(o => o.text.toLowerCase().startsWith(h)) ||
        opts.find(o => o.text.toLowerCase().includes(h)) ||
        opts.find(o => h.includes(o.text.toLowerCase()) && o.text.length > 1) ||
        (h === 'yes' && opts.find(o => /^yes/i.test(o.text))) ||
        null
      );
    }

    const comboboxes = [...document.querySelectorAll('input[role="combobox"]')];
    const log = [];

    for (const el of comboboxes) {
      const labelId = el.getAttribute('aria-labelledby');
      const labelEl = labelId ? document.getElementById(labelId) : null;
      const label = labelEl ? labelEl.textContent.trim() : el.id;

      const control = el.closest('[class*="control"]') || el.parentElement?.parentElement;
      if (control && control !== el) reactClick(control); else reactClick(el);
      await sleep(400);

      const opts = visibleOptions();

      // Simulate AI answer
      const mockAnswers = {
        country: 'United States',
        question_63818699: 'Yes, no restriction.',
        question_63818700: 'New York',
        question_63818701: 'LinkedIn',
        default: 'Yes',
      };
      const hint = mockAnswers[el.id] || mockAnswers.default;
      const pick = fuzzyPick(opts, hint);

      log.push({
        label: label.slice(0, 70),
        id: el.id,
        optCount: opts.length,
        hint,
        pickText: pick ? pick.text : null,
      });

      if (pick) {
        pick.el.click();
        await sleep(200);
      } else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(200);
      }
    }

    return log;
  });

  for (const r of results) {
    const status = r.pickText ? '✅' : (r.optCount > 0 ? '⚠️ no match' : '❌ no opts');
    console.log(`${status} "${r.label.slice(0, 60)}"`);
    console.log(`   id=${r.id}  opts=${r.optCount}  hint="${r.hint}"  picked="${r.pickText || 'none'}"`);
  }

  await sleep(5000);
  await context.close();
})();
