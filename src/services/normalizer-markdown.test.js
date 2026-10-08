import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused:unused@127.0.0.1:1/unused';
const { default: normalizer } = await import('./normalizer.js');

test('markdown input from jobspy (no HTML tags) is not re-escaped by turndown', () => {
  const md = 'The Policy \\& Safety team. **Skills:** Python';
  assert.equal(normalizer.htmlToMarkdown(md), md);
});

test('real HTML still goes through turndown', () => {
  assert.equal(normalizer.htmlToMarkdown('<p>Hello <strong>world</strong></p>'), 'Hello **world**');
});
