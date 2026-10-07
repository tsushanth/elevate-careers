import { guessPlace, placeFromSuggestion, EMPTY_PLACE, loadSavedPlace, savePlace } from './place';

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

test('expanded Canadian timezone zones', () => {
  expect(guessPlace({ timeZone: 'America/Calgary' }).country).toBe('CA');
  expect(guessPlace({ timeZone: 'America/Ottawa' }).country).toBe('CA');
  expect(guessPlace({ timeZone: 'America/Moncton' }).country).toBe('CA');
});

test('Mexican timezone zones map to MX', () => {
  expect(guessPlace({ timeZone: 'America/Tijuana' }).country).toBe('MX');
  expect(guessPlace({ timeZone: 'America/Monterrey' }).country).toBe('MX');
  expect(guessPlace({ timeZone: 'America/Merida' }).country).toBe('MX');
  expect(guessPlace({ timeZone: 'America/Cancun' }).country).toBe('MX');
});

test('unknown America zones default to US', () => {
  expect(guessPlace({ timeZone: 'America/Phoenix' }).country).toBe('US');
  expect(guessPlace({ timeZone: 'America/Argentina/Buenos_Aires' }).country).toBe('US');
});

test('language tags with script and extension subtags resolve correctly', () => {
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en-US-u-ca-gregory'] }).country).toBe('US');
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['zh-Hans-CN'] }).country).toBe('US');
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en-GB-oxendict'] }).country).toBe('GB');
  expect(guessPlace({ timeZone: 'Etc/UTC', languages: ['en-Latn-GB'] }).country).toBe('GB');
});

test('loadSavedPlace validates and coerces stored data', () => {
  // Test: valid round-trip
  savePlace({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin' });
  expect(loadSavedPlace()).toEqual({ country: 'US', region: 'TX', city: 'Austin', label: 'Austin' });

  // Test: corrupt JSON returns null
  const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce('not json');
  expect(loadSavedPlace()).toBeNull();
  getItemSpy.mockRestore();

  // Test: array returns null
  jest.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce('[]');
  expect(loadSavedPlace()).toBeNull();

  // Test: non-string country returns null
  jest.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce('{"country":5}');
  expect(loadSavedPlace()).toBeNull();

  // Test: getItem throws returns null
  jest.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => { throw new Error('blocked'); });
  expect(loadSavedPlace()).toBeNull();

  // Test: setItem throws does not throw
  jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('blocked'); });
  expect(() => savePlace({ country: 'GB' })).not.toThrow();

  jest.restoreAllMocks();
});
