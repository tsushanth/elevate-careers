import { guessPlace, placeFromSuggestion, EMPTY_PLACE } from './place';

test('timezone decides the default country', () => {
  expect(guessPlace({ timeZone: 'America/New_York', languages: ['en-US'] }).country).toBe('US');
  expect(guessPlace({ timeZone: 'America/Toronto', languages: ['en-CA'] }).country).toBe('CA');
  expect(guessPlace({ timeZone: 'Europe/London', languages: ['en-GB'] }).country).toBe('GB');
  expect(guessPlace({ timeZone: 'Asia/Kolkata', languages: ['en-IN'] }).country).toBe('IN');
  expect(guessPlace({ timeZone: 'Australia/Sydney', languages: ['en-AU'] }).country).toBe('AU');
});

test('falls back to the language region, then the United States', () => {
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en-GB'] }).country).toBe('GB');
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en'] }).country).toBe('US');
  expect(guessPlace({}).country).toBe('US');
});

test('the guess carries a label for the search box', () => {
  expect(guessPlace({ timeZone: 'Europe/London' }).label).toBe('United Kingdom');
  expect(guessPlace({}).label).toBe('United States');
});

test('placeFromSuggestion maps API fields and falls back to empty', () => {
  expect(placeFromSuggestion({ label: 'Austin, Texas, United States', country: 'US', region: 'TX', city: 'Austin' }))
    .toEqual({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin, Texas, United States' });
  expect(placeFromSuggestion(null)).toEqual(EMPTY_PLACE);
});
