ALTER TABLE apply_preferences
  ADD COLUMN IF NOT EXISTS excluded_locations TEXT[] NOT NULL DEFAULT '{}';
