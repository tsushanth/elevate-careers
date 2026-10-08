import { expandPlaceQuery } from './placeAliases';

test.each([
  ['NY', ['New York']],
  ['ny', ['New York']],
  ['TX', ['Texas']],
  ['ON', ['Ontario']],
  ['BC', ['British Columbia']],
  ['DC', ['District of Columbia']],
  ['UK', ['United Kingdom']],
  ['U.K.', ['United Kingdom']],
  ['GB', ['United Kingdom']],
  ['USA', ['United States']],
  ['U.S.', ['United States']],
  ['U.S.A.', ['United States']],
  ['US', ['United States']],
  ['UAE', ['United Arab Emirates']],
  [' uae ', ['United Arab Emirates']],
])('%s expands to %j', (input, expected) => {
  expect(expandPlaceQuery(input)).toEqual(expected);
});

test('codes shared by a state and a country offer every reading', () => {
  expect(expandPlaceQuery('CA')).toEqual(['California', 'Canada']);
  expect(expandPlaceQuery('IN')).toEqual(['Indiana', 'India']);
  expect(expandPlaceQuery('DE')).toEqual(['Delaware', 'Germany']);
  expect(expandPlaceQuery('NL')).toEqual(['Newfoundland and Labrador', 'Netherlands']);
});

test('names, longer text and non-codes pass through trimmed and unchanged', () => {
  expect(expandPlaceQuery('Austin')).toEqual(['Austin']);
  expect(expandPlaceQuery('  Texas ')).toEqual(['Texas']);
  expect(expandPlaceQuery('Austin, TX')).toEqual(['Austin, TX']);
  expect(expandPlaceQuery('ZZ')).toEqual(['ZZ']);
  expect(expandPlaceQuery('NYC')).toEqual(['NYC']);
  expect(expandPlaceQuery('')).toEqual(['']);
  expect(expandPlaceQuery(null)).toEqual(['']);
});
