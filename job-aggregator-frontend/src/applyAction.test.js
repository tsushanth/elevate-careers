import { applyLabel, autofillUrl, trackBody } from './applyAction';

test('adds the autofill flag and keeps the rest of the link', () => {
  expect(autofillUrl('https://jobs.lever.co/acme/1?lever-source=x')).toBe('https://jobs.lever.co/acme/1?lever-source=x&sa_autofill=1');
});

test('without the extension the button never says autofill or applied', () => {
  expect(applyLabel({ ext: false })).toBe('Apply on company site');
  expect(applyLabel({ ext: false, opened: true })).toBe('Opened — open again');
  expect(applyLabel({ ext: false, feedV2: false })).toBe('Apply on company site');
});

test('with the extension the labels are as before', () => {
  expect(applyLabel({ ext: true })).toBe('Apply with autofill');
  expect(applyLabel({ ext: true, feedV2: false })).toBe('⚡ Apply');
  expect(applyLabel({ ext: true, applied: true })).toBe('✓ Applied — Apply again?');
});

test('only an opened click is flagged as opened', () => {
  expect(trackBody({ jobUrl: 'u', jobTitle: 't', company: 'c', opened: true })).toEqual({ jobUrl: 'u', jobTitle: 't', company: 'c', opened: true });
  expect(trackBody({ jobUrl: 'u', jobTitle: 't', company: 'c', opened: false })).toEqual({ jobUrl: 'u', jobTitle: 't', company: 'c' });
});
