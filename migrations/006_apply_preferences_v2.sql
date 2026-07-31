ALTER TABLE apply_preferences ADD COLUMN IF NOT EXISTS auto_apply_similar BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
