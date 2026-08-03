-- Skill Check: a SimplyApply-internal skill verification, distinct from a
-- real industry certification (CKA, AWS, etc.) — deliberately not called
-- "certification" anywhere in the product to avoid a candidate implying
-- parity with a proctored industry exam on their resume.
--
-- Question bank is generated ONCE per skill (not per user) and reused —
-- same reasoning as skill_certifications_catalog: consistent, reviewable
-- content rather than a fresh AI generation (and fresh answer key) on every
-- attempt. Grading is deterministic (stored correct answer index compared
-- server-side), not AI-judged, since these are multiple-choice.
CREATE TABLE IF NOT EXISTS skill_checks (
  skill_slug TEXT PRIMARY KEY,
  skill_display TEXT NOT NULL,
  questions JSONB NOT NULL, -- [{question, options: [4 strings], correctIndex}]
  passing_score INT NOT NULL DEFAULT 4,
  total_questions INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_skill_checks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL REFERENCES skill_checks(skill_slug),
  score INT NOT NULL,
  total INT NOT NULL,
  passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_skill_checks_user ON user_skill_checks (user_id);
CREATE INDEX IF NOT EXISTS idx_user_skill_checks_user_passed ON user_skill_checks (user_id, skill_slug) WHERE passed = true;

ALTER TABLE user_skill_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own skill check attempts" ON user_skill_checks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skill check attempts" ON user_skill_checks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
