import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordsToTsQuery } from './keywordTsQuery.js';

test('multi-word phrase becomes an adjacency query, not bare space-separated words', () => {
  assert.equal(keywordsToTsQuery(['Software Engineer']), 'Software <-> Engineer');
});

test('phrases are OR-ed and de-duplicated', () => {
  assert.equal(keywordsToTsQuery(['data analyst', 'react', 'react']), 'data <-> analyst | react');
});

test('tsquery metacharacters are stripped', () => {
  assert.equal(keywordsToTsQuery(["C++", "front-end", "a&b", "o'brien", "(x):*", "!foo"]), 'C | frontend | ab | obrien | x | foo');
});

test('commas split words inside a phrase', () => {
  assert.equal(keywordsToTsQuery(['python, django']), 'python <-> django');
});

test('empty, junk, null and non-string entries are dropped', () => {
  assert.equal(keywordsToTsQuery(['', '   ', '...', null, undefined, 42, '|&']), '');
  assert.equal(keywordsToTsQuery(null), '');
  assert.equal(keywordsToTsQuery(undefined), '');
});
