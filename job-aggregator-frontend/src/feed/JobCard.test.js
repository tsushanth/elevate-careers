import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobCard from './JobCard';
import JobCardSkeleton from './JobCardSkeleton';

const card = (over = {}) => ({
  id: 1, title: 'Staff Engineer', company_name: 'Acme', company_logo_domain: 'acme.com', city: 'Austin',
  region_code: 'TX', country_code: 'US', country: 'United States', remote: false, autofill_ready: true,
  apply_provider: 'greenhouse', salary_min: 150000, salary_max: 190000, salary_currency: 'USD',
  posted_at: new Date(Date.now() - 2 * 86400000).toISOString(), employment_type: 'full_time', ...over,
});

test('card shows title, company, place, age and the autofill mark', () => {
  const html = renderToStaticMarkup(<JobCard job={card()} selected={false} onSelect={() => {}} />);
  expect(html).toContain('Staff Engineer');
  expect(html).toContain('Acme');
  expect(html).toContain('Austin, TX');
  expect(html).toContain('2d ago');
  expect(html).toContain('Autofill');
});

test('no autofill mark when the job is not on a supported ATS', () => {
  const html = renderToStaticMarkup(<JobCard job={card({ autofill_ready: false, apply_provider: null })} selected={false} onSelect={() => {}} />);
  expect(html).not.toContain('Autofill');
});

test('remote jobs say Remote; a job with no place says nothing misleading', () => {
  expect(renderToStaticMarkup(<JobCard job={card({ remote: true })} selected={false} onSelect={() => {}} />)).toContain('Remote');
  const none = renderToStaticMarkup(<JobCard job={card({ city: null, region_code: '', country: null, country_code: 'ZZ' })} selected={false} onSelect={() => {}} />);
  expect(none).toContain('Location not specified');
});

test('selected card is marked for assistive tech', () => {
  expect(renderToStaticMarkup(<JobCard job={card()} selected onSelect={() => {}} />)).toContain('aria-current="true"');
});

test('skeleton renders placeholder cards without text content', () => {
  const html = renderToStaticMarkup(<JobCardSkeleton />);
  expect(html).toContain('feed-skeleton');
  expect(html).toContain('aria-hidden="true"');
});

test('no age text when posted_at is missing or the 1970 epoch fallback', () => {
  const epoch = renderToStaticMarkup(<JobCard job={card({ posted_at: '1970-01-01T00:00:00.000Z' })} selected={false} onSelect={() => {}} />);
  expect(epoch).not.toMatch(/\d+d ago/);
  expect(epoch).not.toContain('Today');
  const missing = renderToStaticMarkup(<JobCard job={card({ posted_at: null })} selected={false} onSelect={() => {}} />);
  expect(missing).not.toMatch(/\d+d ago/);
});
