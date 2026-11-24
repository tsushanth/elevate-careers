// Decides the final job_applications status for a finished browser run.
// A live run that filled no field did not apply to anything (login wall, no form on the page, landing page),
// so it must not be recorded as 'submitted' (the UI shows that as "Applied").
export function applyOutcome({ dryRun, filled, fieldCount }) {
  if (dryRun) return { status: 'preview', error: null };
  if (!filled) {
    return {
      status: 'failed',
      error: fieldCount ? 'Form fields found but none could be filled' : 'No form fields found on the page',
    };
  }
  return { status: 'submitted', error: null };
}
