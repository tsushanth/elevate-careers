-- Phase 1 of the skill-gap-path feature: persist the missing/matched
-- keyword signal from every job-fit check so it can be aggregated across
-- a user's whole job pool ("which skills keep showing up as missing"),
-- not just shown once and discarded per job.
CREATE TABLE IF NOT EXISTS skill_gap_signals (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_url TEXT,
  job_title TEXT,
  missing_keywords TEXT[] NOT NULL DEFAULT '{}',
  matched_keywords TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_gap_signals_user ON skill_gap_signals (user_id);
CREATE INDEX IF NOT EXISTS idx_skill_gap_signals_user_created ON skill_gap_signals (user_id, created_at);

ALTER TABLE skill_gap_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own skill gap signals" ON skill_gap_signals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skill gap signals" ON skill_gap_signals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
