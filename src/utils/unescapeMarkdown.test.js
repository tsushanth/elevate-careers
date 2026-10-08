import test from 'node:test';
import assert from 'node:assert/strict';
import { unescapeMarkdown } from './unescapeMarkdown.js';

// Snippets copied from production job_version.description_md (active jobs).
test('linkedin (job 335044): double-escaped ampersand', () => {
  assert.equal(unescapeMarkdown('The Policy \\\\& Safety team sits within'), 'The Policy & Safety team sits within');
});
test('indeed (4911): double-escaped pipe and bold markers', () => {
  assert.equal(unescapeMarkdown('time\\\\| quality \\\\*\\\\*Skills:\\\\*\\\\* Python'), 'time| quality **Skills:** Python');
});
test('greenhouse: single-escaped star and URL underscore', () => {
  assert.equal(unescapeMarkdown('over 200 hours of work\\*.</p>'), 'over 200 hours of work*.</p>');
  assert.equal(unescapeMarkdown('embed/Qs-\\_Gm7-Mt0'), 'embed/Qs-_Gm7-Mt0');
});
test('lever (122678) and recruitee (321105)', () => {
  assert.equal(unescapeMarkdown('surrounding cities\\***'), 'surrounding cities***');
  assert.equal(unescapeMarkdown('aanvangst\\- eindinspectie'), 'aanvangst- eindinspectie');
});
test('keeps Windows paths, regexes in code, and never creates tags', () => {
  assert.equal(unescapeMarkdown('Install to C:\\Users\\me\\bin and \\\\server\\share'), 'Install to C:\\Users\\me\\bin and \\\\server\\share');
  assert.equal(unescapeMarkdown('use `\\d+\\.\\d` here \\.'), 'use `\\d+\\.\\d` here .');
  assert.equal(unescapeMarkdown('<code>a\\.b</code> x\\.'), '<code>a\\.b</code> x.');
  assert.equal(unescapeMarkdown('\\<script>'), '\\<script>');
});
test('non-strings and clean text pass through', () => {
  assert.equal(unescapeMarkdown(null), null);
  assert.equal(unescapeMarkdown(undefined), undefined);
  assert.equal(unescapeMarkdown('plain & fine'), 'plain & fine');
});
