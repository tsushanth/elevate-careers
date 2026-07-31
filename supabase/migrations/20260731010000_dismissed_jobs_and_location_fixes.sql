-- "Just remove this card" was client-only (sessionStorage), so it silently
-- reappeared on any fresh fetch. This table gives it real persistence,
-- mirroring the job_applications.job_id pattern already in place.
CREATE TABLE IF NOT EXISTS dismissed_jobs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL REFERENCES job(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_dismissed_jobs_user ON dismissed_jobs (user_id);

ALTER TABLE dismissed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own dismissals" ON dismissed_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dismissals" ON dismissed_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
