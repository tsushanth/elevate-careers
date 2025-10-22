import { test } from 'node:test';
import assert from 'node:assert';

test('dedupe key generation', () => {
  const crypto = import('crypto');
  
  const job = {
    company_domain: 'test.com',
    provider: 'greenhouse',
    external_id: '123',
  };
  
  const keyString = `${job.company_domain}:${job.provider}:${job.external_id}`;
  const dedupeKey = crypto.createHash('sha1').update(keyString).digest('hex');
  
  assert.strictEqual(typeof dedupeKey, 'string');
  assert.strictEqual(dedupeKey.length, 40);
});

test('location parsing', () => {
  const locationString = 'San Francisco, CA, USA';
  const parts = locationString.split(',').map(s => s.trim());
  
  const location = {
    city: parts[0] || null,
    region: parts[1] || null,
    country: parts[2] || parts[1] || null,
  };
  
  assert.strictEqual(location.city, 'San Francisco');
  assert.strictEqual(location.region, 'CA');
  assert.strictEqual(location.country, 'USA');
});

test('excerpt creation', () => {
  const text = 'A'.repeat(1000);
  const maxLength = 500;
  
  const excerpt = text.length > maxLength 
    ? text.substring(0, maxLength) + '...'
    : text;
  
  assert.strictEqual(excerpt.length, 503); // 500 + '...'
  assert.ok(excerpt.endsWith('...'));
});