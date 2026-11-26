// Label for a row recorded by the extension or the phone app (GET /api/ai-resume/applications).
// "Filled" is only true when the autofill actually filled something; a row recorded without any
// filled fields (e.g. the phone app's "Yes, I applied") is just "Tracked".
// "Opened" is a link opened from the website: nothing says an application was filled or sent.
export function extRowBadge(app) {
  if (app && app.status === 'opened') return 'Opened';
  return Number(app && app.fields_filled) > 0 ? '✓ Filled' : '✓ Tracked';
}
