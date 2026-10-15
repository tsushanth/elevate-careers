import fs from 'fs';
import path from 'path';
import { FIELDS, hasSavedProfile, toForm, buildSavePayload, cleanParsed, previewRows, SAMPLE_PROFILE, PARSED_FIELDS } from './profileFields';

test('FIELDS match the extension options.js FIELDS exactly', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../extension/src/options.js'), 'utf8');
  const list = src.match(/const FIELDS = \[([\s\S]*?)\];/)[1];
  const ext = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  expect(FIELDS).toEqual(ext);
});

test('hasSavedProfile ignores bare defaults', () => {
  expect(hasSavedProfile(null)).toBe(false);
  expect(hasSavedProfile({ workAuth: 'Yes', sponsorship: 'No' })).toBe(false);
  expect(hasSavedProfile({ firstName: 'A' })).toBe(true);
  expect(hasSavedProfile({ resume: 'text' })).toBe(true);
});

test('toForm fills email from the account and extension defaults', () => {
  const f = toForm(null, { email: 'a@b.co' });
  expect(f.email).toBe('a@b.co');
  expect(f.workAuth).toBe('Yes');
  expect(f.sponsorship).toBe('No');
});

test('buildSavePayload keeps fields the wizard does not show and honours keepResume', () => {
  const existing = { salary: '150000', pronouns: 'they/them', heardAbout: 'Friend', resume: 'old' };
  const p = buildSavePayload(existing, { firstName: ' Jane ', resume: 'new text' }, { keepResume: true });
  expect(p).toMatchObject({ salary: '150000', pronouns: 'they/them', heardAbout: 'Friend', firstName: 'Jane', resume: 'new text' });
  expect(buildSavePayload(existing, { resume: 'x' }, { keepResume: false }).resume).toBe('');
  expect(buildSavePayload(existing, { firstName: 'J' }).resume).toBe('old');
});

test('cleanParsed whitelists and validates education level', () => {
  const c = cleanParsed({ firstName: ' A ', educationLevel: 'Wizard', evil: 1 });
  expect(Object.keys(c).sort()).toEqual([...PARSED_FIELDS].sort());
  expect(c.firstName).toBe('A');
  expect(c.educationLevel).toBe('');
});

test('previewRows drops empty values; sample profile is fictional', () => {
  expect(previewRows({ firstName: 'A', lastName: '' }).map((r) => r.id)).toEqual(['firstName']);
  expect(previewRows(SAMPLE_PROFILE)).toHaveLength(8);
  expect(SAMPLE_PROFILE.email).toMatch(/@example\.com$/);
});
