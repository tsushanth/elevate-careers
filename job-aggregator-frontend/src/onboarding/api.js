import { API_URL } from './constants';

const BASE = `${API_URL}/api/ai-resume`;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

// Decide the upload content type from the file, or null when unsupported.
export function fileContentType(file) {
  const name = String((file && file.name) || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (ext in FILE_TYPES) return FILE_TYPES[ext];
  const t = String((file && file.type) || '').toLowerCase();
  return Object.values(FILE_TYPES).includes(t) ? t : null;
}

export class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

// body: File/Blob or string (pasted text). Resolves { profile, resumeText, remaining }.
export async function parseResume({ token, file, text, fetchImpl = fetch }) {
  let type; let body;
  if (file) {
    type = fileContentType(file);
    if (!type) throw new ApiError('unsupported_type', 'Upload a PDF, DOCX or TXT file, or paste your resume text.', 0);
    if (file.size > MAX_FILE_BYTES) throw new ApiError('too_large', 'That file is over 5 MB. Paste your resume text instead.', 0);
    body = file;
  } else {
    type = 'text/plain; charset=utf-8';
    body = String(text || '');
  }
  let res;
  try {
    res = await fetchImpl(`${BASE}/resume/parse`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      body,
    });
  } catch {
    throw new ApiError('network', 'Could not reach SimplyApply. Check your connection, or fill the form in by hand.', 0);
  }
  const data = await readJson(res);
  if (!res.ok) {
    throw new ApiError((data && data.error) || 'parse_failed', (data && data.message) || 'We could not read that resume automatically.', res.status);
  }
  return { profile: data.profile || {}, resumeText: typeof data.resume_text === 'string' ? data.resume_text : '', remaining: data.remaining };
}

// Resolves the saved profile object, or null when none (or on failure: callers treat both as "no profile").
export async function fetchProfile({ token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${BASE}/profile/sync`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const data = await readJson(res);
    return (data && data.profile) || null;
  } catch {
    return undefined; // undefined = could not tell
  }
}

export async function saveProfile({ token, profile, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${BASE}/profile/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
  } catch {
    throw new ApiError('network', 'Could not reach SimplyApply. Your details are still on screen; try again.', 0);
  }
  if (!res.ok) throw new ApiError('save_failed', 'Could not save your profile. Try again.', res.status);
  return true;
}
