import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'landing-page.html'), 'utf8');
const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>'));
const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
const visible = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');

test('no hand-typed inventory numbers or unsupported feature claims', () => {
  expect(visible).not.toMatch(/309|11,404|37K|11,000|\b\d{2,3}K\+/);
  expect(visible).not.toMatch(/Phone Screen|Track Your Pipeline|pipeline tracker/i);
  expect(visible).not.toMatch(/employment type, salary/i);
});

const run = async (fetchImpl) => {
  document.body.innerHTML = bodyHtml;
  global.fetch = fetchImpl;
  // eslint-disable-next-line no-new-func
  new Function(script)();
  await new Promise((r) => setTimeout(r, 0));
  return document.getElementById('live-stats');
};

test('stats section is hidden until the live API answers, then shows its numbers', async () => {
  const sec = await run(jest.fn(async () => ({ ok: true, json: async () => ({ jobs: 101489, remote: 8784, companies: 7342 }) })));
  expect(global.fetch.mock.calls[0][0]).toBe('https://elevate-careers-api.fly.dev/v2/stats');
  expect(sec.hidden).toBe(false);
  expect(sec.querySelector('[data-stat="jobs"]').textContent).toBe('101,489');
  expect(sec.querySelector('[data-stat="companies"]').textContent).toBe('7,342');
  expect(sec.querySelector('[data-stat="remote"]').textContent).toBe('8,784');
});

test('stats section stays hidden when the API fails or returns nonsense', async () => {
  expect((await run(jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))).hidden).toBe(true);
  expect((await run(jest.fn(async () => ({ ok: true, json: async () => ({ jobs: 0, companies: 0 }) })))).hidden).toBe(true);
  expect((await run(jest.fn(async () => { throw new Error('offline'); }))).hidden).toBe(true);
});
