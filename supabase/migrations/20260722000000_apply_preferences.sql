CREATE TABLE IF NOT EXISTS apply_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  remote      BOOLEAN NOT NULL DEFAULT false,
  location    TEXT,
  salary_min  INTEGER,
  excluded_companies TEXT[] NOT NULL DEFAULT '{}',
  daily_limit INTEGER NOT NULL DEFAULT 10,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE apply_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own preferences"
  ON apply_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Track how many auto-applies have fired today per user (used by scheduler)
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS auto_applied BOOLEAN NOT NULL DEFAULT false;
