import { loadViewed, addViewed } from './viewed';

beforeEach(() => localStorage.clear());

test('starts empty and remembers added ids', () => {
  expect(loadViewed().size).toBe(0);
  addViewed(5); addViewed('7');
  expect([...loadViewed()].sort()).toEqual([5, 7]);
});

test('keeps only the newest 500', () => {
  for (let i = 1; i <= 505; i++) addViewed(i);
  const s = loadViewed();
  expect(s.size).toBe(500);
  expect(s.has(1)).toBe(false);
  expect(s.has(505)).toBe(true);
});

test('survives corrupt storage and non-numeric ids', () => {
  localStorage.setItem('sa_viewed', '{not json');
  expect(loadViewed().size).toBe(0);
  expect(addViewed('abc').size).toBe(0);
});
