// What a row from POST /api/ai-resume/applications/track stands for. Only the browser extension sends fill counts, so
// shipped builds can be told apart from the website and the phone app without a new extension release.
//   extension, 1+ field filled  -> 'submitted' (the existing "tracked application" status)
//   extension, nothing filled   -> 'attempted' (shipped builds do not send these yet; a later one may)
//   website, link opened only   -> 'opened'    (nothing says the person applied)
//   anything else               -> 'submitted', unchanged (phone "Yes, I applied", website with the extension)

/** Rows in these statuses are not applications: the job stays in the person's lists. */
export const OPEN_ONLY_STATUSES = ['opened', 'attempted'];

const COUNT_KEYS = ['fieldCount', 'filled', 'skipped', 'errors'];
const WEB_ORIGIN = /^https:\/\/((www\.)?simplyappl\.ai|elevate-careers-web\.fly\.dev)$/i;

export function classifyTrack(body = {}, origin = '') {
  if (COUNT_KEYS.some((k) => Number.isFinite(body[k]))) {
    return { source: 'extension', status: body.filled > 0 ? 'submitted' : 'attempted' };
  }
  if (body.opened === true) return { source: 'web', status: 'opened' };
  return { source: WEB_ORIGIN.test(origin) ? 'web' : 'app', status: 'submitted' };
}
