import { db } from './index.js';
import { logger } from '../utils/logger.js';

const schema = `
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- companies
CREATE TABLE IF NOT EXISTS company (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- jobs (current snapshot + pointer to versioning)
CREATE TABLE IF NOT EXISTS job (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES company(id),
  provider TEXT NOT NULL,             -- greenhouse, lever, jsonld, etc.
  external_id TEXT,                   -- provider job id, nullable
  apply_url TEXT NOT NULL,
  title TEXT NOT NULL,
  employment_type TEXT,               -- full_time, contract...
  remote BOOLEAN,
  salary_min NUMERIC, 
  salary_max NUMERIC, 
  salary_currency TEXT,
  posted_at TIMESTAMPTZ, 
  valid_through TIMESTAMPTZ,
  description_excerpt TEXT,
  tsv TSVECTOR,                       -- search index
  current_version_id BIGINT,
  dedupe_key TEXT UNIQUE,             -- idempotency
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- job_versions (full description, diffs over time)
CREATE TABLE IF NOT EXISTS job_version (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES job(id),
  description_md TEXT,
  skills TEXT[],                      -- extracted tokens/skills
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- locations (1..n per job)
CREATE TABLE IF NOT EXISTS job_location (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES job(id),
  city TEXT, 
  region TEXT, 
  country TEXT, 
  remote BOOLEAN
);

-- saved searches
CREATE TABLE IF NOT EXISTS saved_search (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  query TEXT,                         -- JSON of filters
  frequency TEXT CHECK (frequency IN ('instant','daily','weekly')),
  last_run TIMESTAMPTZ
);

-- tracker
CREATE TABLE IF NOT EXISTS application (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  job_id BIGINT REFERENCES job(id),
  status TEXT CHECK (status IN ('saved','applied','phone_screen','interview','offer','rejected')) DEFAULT 'saved',
  resume_variant TEXT,
  notes TEXT,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_job_company_id ON job(company_id);
CREATE INDEX IF NOT EXISTS idx_job_provider ON job(provider);
CREATE INDEX IF NOT EXISTS idx_job_dedupe_key ON job(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_job_posted_at ON job(posted_at);
CREATE INDEX IF NOT EXISTS idx_job_tsv ON job USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_job_location_job_id ON job_location(job_id);
CREATE INDEX IF NOT EXISTS idx_saved_search_user_id ON saved_search(user_id);
CREATE INDEX IF NOT EXISTS idx_application_user_id ON application(user_id);
CREATE INDEX IF NOT EXISTS idx_application_job_id ON application(job_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_job_updated_at ON job;
CREATE TRIGGER update_job_updated_at BEFORE UPDATE ON job
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_application_updated_at ON application;
CREATE TRIGGER update_application_updated_at BEFORE UPDATE ON application
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

async function migrate() {
  try {
    logger.info('Starting database migration...');
    await db.query(schema);
    logger.info('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Database migration failed');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}

export { migrate };