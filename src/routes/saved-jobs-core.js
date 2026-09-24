import express from 'express';

// A user's shortlist: jobs they bookmarked (e.g. on the phone) to pick up later
// on the web app. This only records the bookmark -- it never triggers an
// application (that is /api/apply/enqueue, which starts the server-side worker).
export const SAVED_JOB_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS saved_job (
    user_id    UUID   NOT NULL,
    job_id     BIGINT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, job_id)
  )`,
  `CREATE INDEX IF NOT EXISTS saved_job_user_created_idx ON saved_job (user_id, created_at DESC)`,
];

function parseJobId(req, res) {
  const id = Number(req.params.jobId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: 'jobId must be a positive integer' });
    return null;
  }
  return id;
}

export function createSavedJobsRouter({ db, requireAuth }) {
  const router = express.Router();

  // GET /api/saved-jobs -> { jobs, count }, newest first. Same envelope and job fields
  // as GET /jobs (minus internal search/dedupe columns) plus saved_at.
  // Jobs that have since been deactivated stay listed (is_active tells the client),
  // so a shortlisted role doesn't silently vanish.
  router.get('/', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT j.id, j.company_id, j.provider, j.external_id, j.apply_url, j.title,
                j.employment_type, j.remote, j.salary_min, j.salary_max, j.salary_currency,
                j.posted_at, j.valid_through, j.description_excerpt, j.is_active,
                c.name AS company_name, c.domain AS company_domain,
                c.logo_domain AS company_logo_domain,
                array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) AS cities,
                array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) AS countries,
                s.created_at AS saved_at
           FROM saved_job s
           JOIN job j ON j.id = s.job_id
           JOIN company c ON c.id = j.company_id
           LEFT JOIN job_location jl ON jl.job_id = j.id
          WHERE s.user_id = $1
          GROUP BY j.id, c.id, s.created_at
          ORDER BY s.created_at DESC
          LIMIT 500`,
        [req.user.id]
      );
      res.json({ jobs: rows, count: rows.length });
    } catch (e) {
      console.error('[saved-jobs] list failed:', e.message);
      res.status(500).json({ error: 'Failed to load shortlist' });
    }
  });

  // PUT /api/saved-jobs/:jobId -> idempotent; saving twice is not an error.
  router.put('/:jobId', requireAuth, async (req, res) => {
    const jobId = parseJobId(req, res);
    if (jobId === null) return;
    try {
      const exists = await db.query(`SELECT 1 FROM job WHERE id = $1`, [jobId]);
      if (!exists.rowCount) return res.status(404).json({ error: 'Job not found' });
      await db.query(
        `INSERT INTO saved_job (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, jobId]
      );
      res.json({ ok: true, jobId });
    } catch (e) {
      console.error('[saved-jobs] save failed:', e.message);
      res.status(500).json({ error: 'Failed to save job' });
    }
  });

  // DELETE /api/saved-jobs/:jobId -> idempotent; removing an unsaved job is fine.
  router.delete('/:jobId', requireAuth, async (req, res) => {
    const jobId = parseJobId(req, res);
    if (jobId === null) return;
    try {
      await db.query(`DELETE FROM saved_job WHERE user_id = $1 AND job_id = $2`, [req.user.id, jobId]);
      res.json({ ok: true, jobId });
    } catch (e) {
      console.error('[saved-jobs] remove failed:', e.message);
      res.status(500).json({ error: 'Failed to remove job' });
    }
  });

  return router;
}
