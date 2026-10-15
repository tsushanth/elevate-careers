import { parseResume, fetchProfile, saveProfile, fileContentType, ApiError } from './api';

const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('fileContentType by extension then mime', () => {
  expect(fileContentType({ name: 'CV.PDF' })).toBe('application/pdf');
  expect(fileContentType({ name: 'cv.docx' })).toMatch(/wordprocessingml/);
  expect(fileContentType({ name: 'cv.txt' })).toBe('text/plain');
  expect(fileContentType({ name: 'cv', type: 'application/pdf' })).toBe('application/pdf');
  expect(fileContentType({ name: 'cv.png', type: 'image/png' })).toBeNull();
});

test('parseResume sends raw file with bearer token', async () => {
  const f = jest.fn().mockResolvedValue(resp(200, { profile: { firstName: 'A' }, resume_text: 't', remaining: 4 }));
  const file = { name: 'a.pdf', size: 10 };
  const r = await parseResume({ token: 'tok', file, fetchImpl: f });
  expect(r).toEqual({ profile: { firstName: 'A' }, resumeText: 't', remaining: 4 });
  const [url, init] = f.mock.calls[0];
  expect(url).toMatch(/\/api\/ai-resume\/resume\/parse$/);
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(init.headers['Content-Type']).toBe('application/pdf');
  expect(init.body).toBe(file);
});

test('parseResume pasted text uses text/plain', async () => {
  const f = jest.fn().mockResolvedValue(resp(200, { profile: {} }));
  await parseResume({ token: 't', text: 'hello', fetchImpl: f });
  expect(f.mock.calls[0][1].headers['Content-Type']).toMatch(/^text\/plain/);
  expect(f.mock.calls[0][1].body).toBe('hello');
});

test('parseResume rejects big/unsupported files before any request', async () => {
  const f = jest.fn();
  await expect(parseResume({ token: 't', file: { name: 'a.pdf', size: 6 * 1024 * 1024 }, fetchImpl: f })).rejects.toMatchObject({ code: 'too_large' });
  await expect(parseResume({ token: 't', file: { name: 'a.exe', size: 1 }, fetchImpl: f })).rejects.toMatchObject({ code: 'unsupported_type' });
  expect(f).not.toHaveBeenCalled();
});

test('parseResume maps server and network errors', async () => {
  await expect(parseResume({ token: 't', text: 'x', fetchImpl: async () => resp(429, { error: 'rate_limited', message: 'limit' }) }))
    .rejects.toMatchObject({ code: 'rate_limited', status: 429, message: 'limit' });
  await expect(parseResume({ token: 't', text: 'x', fetchImpl: async () => { throw new Error('x'); } }))
    .rejects.toBeInstanceOf(ApiError);
});

test('fetchProfile: profile, null, or undefined when unknown', async () => {
  expect(await fetchProfile({ token: 't', fetchImpl: async () => resp(200, { profile: { a: 1 } }) })).toEqual({ a: 1 });
  expect(await fetchProfile({ token: 't', fetchImpl: async () => resp(200, { profile: null }) })).toBeNull();
  expect(await fetchProfile({ token: 't', fetchImpl: async () => resp(500, {}) })).toBeUndefined();
  expect(await fetchProfile({ token: 't', fetchImpl: async () => { throw new Error('x'); } })).toBeUndefined();
});

test('saveProfile posts {profile} and throws on failure', async () => {
  const f = jest.fn().mockResolvedValue(resp(200, { ok: true }));
  await saveProfile({ token: 't', profile: { firstName: 'A' }, fetchImpl: f });
  expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ profile: { firstName: 'A' } });
  await expect(saveProfile({ token: 't', profile: {}, fetchImpl: async () => resp(500, {}) })).rejects.toMatchObject({ code: 'save_failed' });
});
