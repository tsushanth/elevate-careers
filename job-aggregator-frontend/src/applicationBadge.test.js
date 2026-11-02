import { extRowBadge } from './applicationBadge';

test('Filled only when the autofill filled at least one field', () => {
  expect(extRowBadge({ fields_filled: 12 })).toBe('✓ Filled');
  expect(extRowBadge({ fields_filled: '3' })).toBe('✓ Filled');
});

test('rows with no filled fields (phone "Yes, I applied") are Tracked, not Filled', () => {
  expect(extRowBadge({ fields_filled: 0 })).toBe('✓ Tracked');
  expect(extRowBadge({ fields_filled: null })).toBe('✓ Tracked');
  expect(extRowBadge({})).toBe('✓ Tracked');
  expect(extRowBadge(undefined)).toBe('✓ Tracked');
});
