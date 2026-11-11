import { descriptionToSafeHtml } from './descriptionHtml';

test('entity-escaped Greenhouse HTML renders as markup, not text', () => {
  const raw = '&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Veeam is the &lt;strong&gt;Data&lt;/strong&gt; company&lt;/p&gt;&lt;/div&gt;';
  const out = descriptionToSafeHtml(raw);
  expect(out).toContain('<strong>Data</strong>');
  expect(out).not.toContain('&lt;');
  expect(out).not.toContain('class=&quot;');
});

test('nested escaped attribute (&amp;quot;) ends up as a valid attribute value, not visible text', () => {
  const raw = '&lt;span data-ccp-props=&quot;{&amp;quot;a&amp;quot;:1}&quot;&gt;Hi&lt;/span&gt;';
  const out = descriptionToSafeHtml(raw);
  expect(out).toContain('Hi');
  expect(out).not.toContain('&amp;quot;');
  expect(document.createElement('div').appendChild(Object.assign(document.createElement('div'), { innerHTML: out })).textContent).toBe('Hi');
});

test('real HTML is left as HTML (not decoded twice)', () => {
  expect(descriptionToSafeHtml('<p>Fish &amp; chips</p>')).toBe('<p>Fish &amp; chips</p>');
});

test('plain text with an ampersand entity is untouched', () => {
  expect(descriptionToSafeHtml('R&amp;D team')).toBe('R&amp;D team');
});

test('scripts and event handlers are stripped, in both real and escaped form', () => {
  expect(descriptionToSafeHtml('<p onclick="x()">a</p><script>alert(1)</script>')).toBe('<p>a</p>');
  const out = descriptionToSafeHtml('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;p&gt;ok&lt;/p&gt;');
  expect(out).not.toMatch(/onerror/i);
  expect(out).toContain('<p>ok</p>');
});

test('non-strings and empty give empty string', () => {
  expect(descriptionToSafeHtml(null)).toBe('');
  expect(descriptionToSafeHtml(undefined)).toBe('');
  expect(descriptionToSafeHtml('')).toBe('');
});
