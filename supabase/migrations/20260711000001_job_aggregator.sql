-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- companies
CREATE TABLE IF NOT EXISTS company (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- jobs
CREATE TABLE IF NOT EXISTS job (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES company(id),
  provider TEXT NOT NULL,
  external_id TEXT,
  apply_url TEXT NOT NULL,
  title TEXT NOT NULL,
  employment_type TEXT,
  remote BOOLEAN,
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency TEXT,
  posted_at TIMESTAMPTZ,
  valid_through TIMESTAMPTZ,
  description_excerpt TEXT,
  tsv TSVECTOR,
  current_version_id BIGINT,
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- job_versions
CREATE TABLE IF NOT EXISTS job_version (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES job(id),
  description_md TEXT,
  skills TEXT[],
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- locations
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
  query TEXT,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_company_id ON job(company_id);
CREATE INDEX IF NOT EXISTS idx_job_provider ON job(provider);
CREATE INDEX IF NOT EXISTS idx_job_dedupe_key ON job(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_job_posted_at ON job(posted_at);
CREATE INDEX IF NOT EXISTS idx_job_tsv ON job USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_job_location_job_id ON job_location(job_id);
CREATE INDEX IF NOT EXISTS idx_saved_search_user_id ON saved_search(user_id);
CREATE INDEX IF NOT EXISTS idx_application_user_id ON application(user_id);
CREATE INDEX IF NOT EXISTS idx_application_job_id ON application(job_id);

-- Trigger for updated_at
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
