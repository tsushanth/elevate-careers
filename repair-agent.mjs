#!/usr/bin/env node
// repair-agent.mjs — interactive CLI for reviewing and approving ATS field-fill rules.
//
// Usage:
//   node repair-agent.mjs                  # review all unresolved failures
//   node repair-agent.mjs --domain=ashbyhq.com
//
// Required env (add to .env or export directly):
//   ANTHROPIC_API_KEY   — Anthropic key for generating rule candidates
//   REPAIR_ADMIN_SECRET — must match the Fly secret of the same name
//
// Optional:
//   REPAIR_API=https://... — override the API base (default: Fly prod)

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const API_BASE = process.env.REPAIR_API || 'https://elevate-careers-api.fly.dev';
const ADMIN_SECRET = process.env.REPAIR_ADMIN_SECRET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!ADMIN_SECRET) {
  console.error('❌  REPAIR_ADMIN_SECRET not set. Add it to .env or export it.');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error('❌  ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

const domain = process.argv.find(a => a.startsWith('--domain='))?.split('=')[1];
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const rl = readline.createInterface({ input, output });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function adminFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}/api/repair${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${ADMIN_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// ── Rule proposal via Claude ──────────────────────────────────────────────────

const RULE_TOOL = {
  name: 'propose_rule',
  description: 'Propose a JSON rule to fix a failing ATS form field',
  input_schema: {
    type: 'object',
    required: ['id', 'reasoning', 'match', 'fix', 'confidence'],
    properties: {
      id: {
        type: 'string',
        description: 'Kebab-case rule id, e.g. "ashby-textarea-execcommand" or "lever-skills-skip"',
      },
      reasoning: {
        type: 'string',
        description: 'One sentence explaining why this fix should work',
      },
      match: {
        type: 'object',
        description: 'Criteria that must ALL match for this rule to apply',
        properties: {
          domain:       { type: 'string', description: 'Glob like "*.ashbyhq.com"' },
          urlPattern:   { type: 'string', description: 'Substring of the full URL' },
          fieldType:    { type: 'string', enum: ['text','textarea','select','combobox','checkbox','radio','file'] },
          labelPattern: { type: 'string', description: 'Case-insensitive substring of the field label' },
          selector:     { type: 'string', description: 'CSS selector that must exist near the field' },
        },
      },
      fix: {
        type: 'object',
        required: ['fillMethod'],
        properties: {
          fillMethod: {
            type: 'string',
            enum: ['execCommand', 'nativeSet', 'reactClick', 'skip'],
            description: [
              'execCommand — document.execCommand("insertText"), works for React controlled inputs',
              'nativeSet   — Object.getOwnPropertyDescriptor setter + change event, plain DOM',
              'reactClick  — mousedown+mouseup+click sequence, for React Select comboboxes',
              'skip        — mark field REVIEW so the user can fill it manually',
            ].join(' | '),
          },
          selectorOverride: { type: 'string', description: 'CSS selector to target instead of the detected element' },
          waitMs:           { type: 'number', description: 'ms to wait after clicking before typing' },
        },
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: '"high" = very confident this will fix it; "low" = unsure, may need manual verification',
      },
    },
  },
};

async function proposeRule(failure) {
  const { domain: dom, label, field_type, outer_html, fail_reason, fill_tried, count } = failure;

  const userMsg = [
    `Domain: ${dom}`,
    `Field label: "${label}"`,
    `Field type: ${field_type || 'unknown'}`,
    `Failure reason: ${fail_reason || 'unknown'}`,
    `Fill method tried: ${fill_tried || 'unknown'}`,
    `Times failed: ${count}`,
    '',
    'Relevant HTML:',
    '```html',
    (outer_html || '(no HTML captured)').slice(0, 2000),
    '```',
  ].join('\n');

  const systemMsg = [
    'You are an expert in Chrome MV3 extension form automation, specializing in how React, Angular, and plain-DOM job application forms handle programmatic input.',
    '',
    'A user tried to autofill a job application field and it failed. Based on the HTML and failure context, propose the best rule to fix it.',
    '',
    'Key fill method guidance:',
    '- React controlled inputs (look for React fiber props like __reactFiber or data-reactroot, or class names from a React component library) need execCommand, not nativeSet.',
    '- Plain HTML inputs (no React) respond well to nativeSet.',
    '- React Select / custom comboboxes (class names containing "select__", "__control", "__menu") need reactClick then typing.',
    '- If the field is genuinely optional, complex (file upload, signature), or not fillable by any text method, use skip.',
    '',
    'Rule matching guidance:',
    '- Be as specific as needed but no more. If the failure is ATS-wide (all Ashby textareas), use domain + fieldType.',
    '- If only one label is affected (e.g. a custom "Security clearance?" field), add labelPattern.',
    '- Avoid selector-based matches unless the HTML makes domain+fieldType+label insufficient.',
  ].join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 800,
    system: systemMsg,
    tools: [RULE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_rule' },
    messages: [{ role: 'user', content: userMsg }],
  });

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  return toolUse?.input ?? null;
}

// ── Interactive review loop ───────────────────────────────────────────────────

async function reviewFailure(failure, idx, total) {
  const { domain: dom, label, field_type, fail_reason, fill_tried, count, last_seen } = failure;

  console.log('\n' + '─'.repeat(70));
  console.log(`[${idx + 1}/${total}] ${dom} — "${label}" (${field_type ?? '?'})`);
  console.log(`  failed: ${count}×  |  last: ${new Date(last_seen).toLocaleDateString()}  |  tried: ${fill_tried ?? '?'}  |  reason: ${fail_reason ?? '?'}`);

  process.stdout.write('  Asking Claude for a rule candidate… ');
  let rule;
  try {
    rule = await proposeRule(failure);
  } catch (e) {
    console.log('FAILED');
    console.error('  Error from Anthropic:', e.message);
    return;
  }

  if (!rule) {
    console.log('no rule proposed — skipping');
    return;
  }
  console.log('done\n');

  console.log('  Proposed rule:');
  console.log('  ' + JSON.stringify({ match: rule.match, fix: rule.fix }, null, 2).replace(/\n/g, '\n  '));
  console.log(`\n  Reasoning: ${rule.reasoning}`);
  console.log(`  Confidence: ${rule.confidence}`);
  console.log(`  Rule ID: ${rule.id}`);

  const answer = await rl.question('\n  [a]pprove  [s]kip  [e]dit JSON  > ');
  const choice = answer.trim().toLowerCase()[0];

  if (choice === 's' || choice === '') {
    console.log('  → skipped');
    return;
  }

  let finalRule = rule;

  if (choice === 'e') {
    const rawEdit = await rl.question(
      '  Paste edited rule JSON (match + fix fields, no outer wrapper):\n  > ',
    );
    try {
      const parsed = JSON.parse(rawEdit.trim());
      finalRule = { ...rule, ...parsed };
    } catch {
      console.log('  ⚠ Invalid JSON — skipping this entry');
      return;
    }
  }

  // Bump version if rule already exists (we detect this at the server; send version = 1 for new)
  const payload = {
    id: finalRule.id,
    version: 1,
    match: finalRule.match,
    fix: finalRule.fix,
    note: finalRule.reasoning,
  };

  try {
    await adminFetch('/admin/rules', { method: 'POST', body: JSON.stringify(payload) });
    await adminFetch('/admin/resolve', {
      method: 'POST',
      body: JSON.stringify({ domain: dom, label }),
    });
    console.log(`  ✓ Rule "${finalRule.id}" saved and ${dom}/"${label}" marked resolved`);
  } catch (e) {
    console.error('  ❌ Failed to save rule:', e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSimplyApply Repair Agent`);
  console.log(`API: ${API_BASE}`);
  if (domain) console.log(`Filter: domain=${domain}`);

  let failures;
  try {
    const url = domain ? `/admin/queue?domain=${encodeURIComponent(domain)}` : '/admin/queue';
    failures = await adminFetch(url);
  } catch (e) {
    console.error('❌  Could not fetch repair queue:', e.message);
    process.exit(1);
  }

  if (!failures.length) {
    console.log('\n✅  No unresolved failures in the queue.');
    rl.close();
    return;
  }

  console.log(`\nFound ${failures.length} unresolved failure(s).\n`);

  for (let i = 0; i < failures.length; i++) {
    await reviewFailure(failures[i], i, failures.length);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('Done. Rules are live within 6 hours (next extension alarm cycle).');
  console.log('To force-refresh now: chrome.storage.local.remove("remoteRules") in the extension console.\n');
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
