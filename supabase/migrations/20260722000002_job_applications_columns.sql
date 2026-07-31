ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS filled_fields   INTEGER,
  ADD COLUMN IF NOT EXISTS skipped_fields  INTEGER,
  ADD COLUMN IF NOT EXISTS errored_fields  INTEGER,
  ADD COLUMN IF NOT EXISTS ai_fields       JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS screenshot_b64  TEXT,
  ADD COLUMN IF NOT EXISTS error           TEXT,
  ADD COLUMN IF NOT EXISTS auto_applied    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source          TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill created_at from filled_at for existing rows
UPDATE job_applications SET created_at = filled_at WHERE created_at IS NULL OR created_at = NOW();
