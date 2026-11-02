// Label for a row recorded by the extension or the phone app (GET /api/ai-resume/applications).
// "Filled" is only true when the autofill actually filled something; a row recorded without any
// filled fields (e.g. the phone app's "Yes, I applied") is just "Tracked".
export function extRowBadge(app) {
  return Number(app && app.fields_filled) > 0 ? '✓ Filled' : '✓ Tracked';
}
