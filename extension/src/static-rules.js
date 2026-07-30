// static-rules.js — ships in the extension binary.
// Updated each Monday alongside the Chrome Web Store submission.
// Add new rules here when a repair-agent.mjs run produces an approved fix.

export default [
  // ── Ashby ─────────────────────────────────────────────────────────────────
  // Ashby uses React controlled inputs; nativeSet + fire('input') is ignored.
  // execCommand('insertText') is treated as real user input by React.
  {
    id: 'ashby-textarea-execcommand',
    version: 1,
    match: { domain: '*.ashbyhq.com', fieldType: 'textarea' },
    fix:   { fillMethod: 'execCommand' },
  },
  {
    id: 'ashby-text-execcommand',
    version: 1,
    match: { domain: '*.ashbyhq.com', fieldType: 'text' },
    fix:   { fillMethod: 'execCommand' },
  },
];
