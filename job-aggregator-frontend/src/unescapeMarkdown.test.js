import { unescapeMarkdown } from './unescapeMarkdown';

// Snippets copied from production job_version.description_md (active jobs).
test('linkedin (job 335044): double-escaped ampersand', () => {
  expect(unescapeMarkdown('The Policy \\\\& Safety team sits within')).toBe('The Policy & Safety team sits within');
});
test('indeed (4911): double-escaped pipe and bold markers', () => {
  expect(unescapeMarkdown('time\\\\| quality \\\\*\\\\*Skills:\\\\*\\\\* Python')).toBe('time| quality **Skills:** Python');
});
test('greenhouse: single-escaped star and URL underscore', () => {
  expect(unescapeMarkdown('over 200 hours of work\\*.</p>')).toBe('over 200 hours of work*.</p>');
  expect(unescapeMarkdown('embed/Qs-\\_Gm7-Mt0')).toBe('embed/Qs-_Gm7-Mt0');
});
test('lever (122678) and recruitee (321105)', () => {
  expect(unescapeMarkdown('surrounding cities\\***')).toBe('surrounding cities***');
  expect(unescapeMarkdown('aanvangst\\- eindinspectie')).toBe('aanvangst- eindinspectie');
});
test('keeps Windows paths, regexes in code, and never creates tags', () => {
  expect(unescapeMarkdown('Install to C:\\Users\\me\\bin and \\\\server\\share')).toBe('Install to C:\\Users\\me\\bin and \\\\server\\share');
  expect(unescapeMarkdown('use `\\d+\\.\\d` here \\.')).toBe('use `\\d+\\.\\d` here .');
  expect(unescapeMarkdown('<code>a\\.b</code> x\\.')).toBe('<code>a\\.b</code> x.');
  expect(unescapeMarkdown('\\<script>')).toBe('\\<script>');
});
test('non-strings and clean text pass through', () => {
  expect(unescapeMarkdown(null)).toBe(null);
  expect(unescapeMarkdown(undefined)).toBe(undefined);
  expect(unescapeMarkdown('plain & fine')).toBe('plain & fine');
});
