// Records the two different things that used to be written to job_applications as if they were one:
//   'opened'  the web Apply button was clicked (nothing has been filled yet)
//   'filled'  the extension reported a fill attempt with real counts ('fill_empty' when it filled 0 fields)
// A fill report is merged into the matching recent 'opened' row, so one application = one row and
// "fields_filled = 0" means "the extension filled nothing", not "the user only clicked a button".
// The self-report ("Did it submit?") then moves the row to 'submitted' or 'failed'.
// Nothing here stores new personal data; the columns already existed.

export const OPEN_WINDOW_MS = 24 * 3600 * 1000;

// Same normalisation as resolveJobIdForUrl: drop the query string and trailing slashes.
export function normUrl(u) {
  if (typeof u !== 'string') return '';
  return u.split('#')[0].split('?')[0].replace(/\/+$/, '');
}

const toInt = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

// Old web builds and old extensions send no `stage`: an explicit numeric fieldCount means a fill report.
export function stageOf(body) {
  if (body && (body.stage === 'opened' || body.stage === 'filled')) return body.stage;
  return body && typeof body.fieldCount === 'number' ? 'filled' : 'opened';
}

export function fillStatus(filled) {
  return toInt(filled) > 0 ? 'filled' : 'fill_empty';
}

async function findRecentOpened({ sb, userId, jobId, jobUrl, now }) {
  const cutoff = new Date(now() - OPEN_WINDOW_MS).toISOString();
  const { data, error } = await sb.from('job_applications')
    .select('id, job_id, job_url')
    .eq('user_id', userId)
    .eq('status', 'opened')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data)) return null;
  const url = normUrl(jobUrl);
  return data.find((r) => (jobId && Number(r.job_id) === Number(jobId)) || (url && normUrl(r.job_url) === url)) || null;
}

// Returns { id, merged } and throws on a database error (the route turns that into a 500).
export async function recordApplication({ sb, resolveJobId, userId, body, now = Date.now }) {
  const stage = stageOf(body);
  const jobId = await resolveJobId(body.jobUrl);
  const existing = await findRecentOpened({ sb, userId, jobId, jobUrl: body.jobUrl, now });

  if (stage === 'opened') {
    if (existing) return { id: existing.id, merged: true }; // a second click on the same job is not a second application
    const { data, error } = await sb.from('job_applications').insert({
      user_id: userId, job_url: body.jobUrl, job_title: body.jobTitle || null, company: body.company || null,
      job_id: jobId, field_count: 0, ai_used: false, fields_filled: 0, fields_skipped: 0, fields_errored: 0,
      status: 'opened', source: 'web_click',
    }).select('id').single();
    if (error) throw error;
    return { id: data.id, merged: false };
  }

  const counts = {
    field_count: toInt(body.fieldCount), ai_used: !!body.aiUsed,
    fields_filled: toInt(body.filled), fields_skipped: toInt(body.skipped), fields_errored: toInt(body.errors),
    status: fillStatus(body.filled), filled_at: new Date(now()).toISOString(),
  };
  if (existing) {
    const { error } = await sb.from('job_applications').update(counts).eq('id', existing.id).eq('user_id', userId);
    if (error) throw error;
    return { id: existing.id, merged: true };
  }
  const { data, error } = await sb.from('job_applications').insert({
    user_id: userId, job_url: body.jobUrl, job_title: body.jobTitle || null, company: body.company || null,
    job_id: jobId, ...counts,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id, merged: false };
}

// Self-report outcome. Keeps writing the existing boolean and now also the status that never changed before.
export async function reportOutcome({ sb, userId, id, submitted, now = Date.now }) {
  const { error } = await sb.from('job_applications')
    .update({ submitted, submitted_at: new Date(now()).toISOString(), status: submitted ? 'submitted' : 'failed' })
    .eq('id', id).eq('user_id', userId);
  if (error) throw error;
}
