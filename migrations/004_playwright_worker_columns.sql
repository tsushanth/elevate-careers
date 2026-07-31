-- Adds playwright worker result columns to job_applications.
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS filled_fields   int,
  ADD COLUMN IF NOT EXISTS skipped_fields  int,
  ADD COLUMN IF NOT EXISTS errored_fields  int,
  ADD COLUMN IF NOT EXISTS field_count     int,
  ADD COLUMN IF NOT EXISTS ai_used         boolean,
  ADD COLUMN IF NOT EXISTS ai_fields       jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS screenshot_b64  text,
  ADD COLUMN IF NOT EXISTS error           text;
