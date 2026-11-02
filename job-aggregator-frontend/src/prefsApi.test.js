import { mergePreferences, savePreferences } from './prefsApi';

const stored = {
  keywords: ['backend'], remote: false, location: 'Austin', salary_min: 90000,
  excluded_companies: ['Acme'], excluded_titles: ['Intern'], excluded_locations: ['Texas'],
  require_visa_sponsor: true, daily_limit: 7, enabled: false, auto_apply_similar: false,
};
const edited = { keywords: ['frontend'], remote: true, location: 'Remote', salary_min: '120000', daily_limit: '12', auto_apply_similar: false };

test('merge keeps the stored exclusions and visa flag the form cannot see', () => {
  const m = mergePreferences(stored, edited);
  expect(m.excluded_companies).toEqual(['Acme']);
  expect(m.excluded_titles).toEqual(['Intern']);
  expect(m.excluded_locations).toEqual(['Texas']);
  expect(m.require_visa_sponsor).toBe(true);
});

test('merge applies what the form edited, with numbers parsed', () => {
  const m = mergePreferences(stored, edited);
  expect(m).toMatchObject({ keywords: ['frontend'], remote: true, location: 'Remote', salary_min: 120000, daily_limit: 12, auto_apply_similar: false });
});

test('merge never forces enabled on', () => {
  expect(mergePreferences({ ...stored, enabled: false }, edited).enabled).toBe(false);
  expect(mergePreferences({ ...stored, enabled: true }, edited).enabled).toBe(true);
  expect(mergePreferences(null, edited).enabled).toBe(false);
});

test('merge turns enabled on only when the user switches auto-apply on', () => {
  expect(mergePreferences({ ...stored, enabled: false }, { ...edited, auto_apply_similar: true }).enabled).toBe(true);
});

test('merge clears salary and keeps defaults when the fields are blank; never sends excluded_companies: [] blindly', () => {
  const m = mergePreferences({}, { ...edited, salary_min: '', daily_limit: '' });
  expect(m.salary_min).toBeNull();
  expect(m.daily_limit).toBe(10);
  expect('excluded_companies' in m).toBe(false);
});

const resp = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('savePreferences reads first, then posts the merged row', async () => {
  const calls = [];
  const f = jest.fn(async (url, opts = {}) => { calls.push([opts.method || 'GET', url, opts]); return opts.method === 'POST' ? resp({ ok: true }) : resp(stored); });
  await savePreferences('https://api.example.com', 'tok', edited, f);
  expect(calls.map(c => c[0])).toEqual(['GET', 'POST']);
  expect(calls[0][1]).toBe('https://api.example.com/api/preferences');
  expect(calls[0][2].headers.Authorization).toBe('Bearer tok');
  const body = JSON.parse(calls[1][2].body);
  expect(body.excluded_companies).toEqual(['Acme']);
  expect(body.excluded_titles).toEqual(['Intern']);
  expect(body.excluded_locations).toEqual(['Texas']);
  expect(body.require_visa_sponsor).toBe(true);
  expect(body.enabled).toBe(false);
  expect(body.keywords).toEqual(['frontend']);
});

test('savePreferences sends nothing when the read fails', async () => {
  const f = jest.fn(async () => resp({}, false, 500));
  await expect(savePreferences('https://api.example.com', 'tok', edited, f)).rejects.toThrow(/nothing was changed/);
  expect(f).toHaveBeenCalledTimes(1);
});

test('savePreferences reports a failed save', async () => {
  const f = jest.fn(async (url, opts = {}) => (opts.method === 'POST' ? resp({}, false, 400) : resp(stored)));
  await expect(savePreferences('https://api.example.com', 'tok', edited, f)).rejects.toThrow(/400/);
});
