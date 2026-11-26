// Job ids are bigints. Anything else on /jobs/:id (/jobs/feed without /v2, a stale link) is a plain not-found; passed to
// the database it fails with "invalid input syntax for type bigint" and answers 500.
export function requireJobId(req, res, next) {
  if (!/^\d{1,18}$/.test(req.params.id)) return res.status(404).json({ error: 'Job not found' });
  next();
}
