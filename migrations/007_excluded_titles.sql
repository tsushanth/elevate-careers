-- Lets a user dismiss a job title from "Recommended for you" entirely
-- (as opposed to excluded_companies, which blocks a whole company).
ALTER TABLE apply_preferences ADD COLUMN IF NOT EXISTS excluded_titles TEXT[] NOT NULL DEFAULT '{}';
