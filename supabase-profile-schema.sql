-- supabase-profile-schema-corrected.sql
-- User profile and resume management schema with pgvector

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- For uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- For fuzzy text matching
CREATE EXTENSION IF NOT EXISTS "vector";         -- For semantic search with embeddings

-- ============================================================================
-- TABLES
-- ============================================================================

-- User Profile Table
CREATE TABLE IF NOT EXISTS public.user_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Basic Info
    full_name TEXT,
    email TEXT,
    phone TEXT,
    location_city TEXT,
    location_country TEXT,
    linkedin_url TEXT,
    portfolio_url TEXT,
    github_url TEXT,
    
    -- Professional Info
    headline TEXT, -- e.g., "Senior Software Engineer"
    summary TEXT,
    years_of_experience INTEGER,
    
    -- Preferences
    desired_roles TEXT[], -- Array of role titles
    desired_locations TEXT[],
    remote_preference TEXT CHECK (remote_preference IN ('remote_only', 'hybrid', 'onsite', 'flexible')),
    desired_employment_types TEXT[], -- ['full_time', 'contract', etc.]
    desired_salary_min INTEGER,
    desired_salary_max INTEGER,
    desired_salary_currency TEXT DEFAULT 'USD',
    
    -- Skills (extracted from resume + LinkedIn)
    skills TEXT[],
    skill_embeddings VECTOR(384), -- For semantic matching (sentence transformers)
    
    -- Work Authorization
    work_authorization TEXT[], -- ['us_citizen', 'green_card', 'h1b', 'opt', etc.]
    requires_sponsorship BOOLEAN DEFAULT false,
    
    -- Application Autofill Data
    autofill_data JSONB DEFAULT '{}'::JSONB,
    
    -- Metadata
    profile_completeness INTEGER DEFAULT 0, -- 0-100 score
    profile_source TEXT, -- 'resume', 'linkedin', 'manual'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- Work Experience
CREATE TABLE IF NOT EXISTS public.work_experience (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    location TEXT,
    start_date DATE NOT NULL,
    end_date DATE, -- NULL if current
    is_current BOOLEAN DEFAULT false,
    
    description TEXT,
    achievements TEXT[],
    skills_used TEXT[],
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Education
CREATE TABLE IF NOT EXISTS public.education (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    institution TEXT NOT NULL,
    degree TEXT, -- "Bachelor's", "Master's", etc.
    field_of_study TEXT,
    start_date DATE,
    end_date DATE,
    gpa DECIMAL(3,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resume Storage
CREATE TABLE IF NOT EXISTS public.resume (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- File Storage
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL, -- Path in Supabase Storage
    file_size INTEGER,
    file_type TEXT, -- 'pdf', 'docx', etc.
    
    -- Parsed Content
    raw_text TEXT,
    parsed_data JSONB, -- Structured data extracted from resume
    
    -- Versions
    version INTEGER DEFAULT 1,
    is_primary BOOLEAN DEFAULT true,
    
    -- Metadata
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    parsed_at TIMESTAMPTZ,
    parsing_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    
    CONSTRAINT unique_primary_resume UNIQUE(user_id, is_primary) 
        WHERE is_primary = true
);

-- Job Match Scores (Pre-computed for performance)
CREATE TABLE IF NOT EXISTS public.job_match_score (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES public.job(id) ON DELETE CASCADE,
    
    -- Match Scores (0-100)
    overall_score DECIMAL(5,2) NOT NULL,
    skills_score DECIMAL(5,2),
    experience_score DECIMAL(5,2),
    location_score DECIMAL(5,2),
    salary_score DECIMAL(5,2),
    
    -- Match Reasons
    matching_skills TEXT[],
    missing_skills TEXT[],
    match_reasons JSONB,
    
    -- Computed at
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, job_id)
);

-- Application Autofill Templates
CREATE TABLE IF NOT EXISTS public.autofill_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    field_name TEXT NOT NULL, -- 'phone', 'address', 'visa_status', etc.
    field_value TEXT,
    field_type TEXT, -- 'text', 'select', 'date', 'boolean'
    
    -- For common questions
    question_pattern TEXT, -- Regex pattern to match questions
    answer TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved Jobs
CREATE TABLE IF NOT EXISTS public.saved_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES public.job(id) ON DELETE CASCADE,
    
    notes TEXT,
    status TEXT DEFAULT 'saved', -- 'saved', 'applied', 'interviewing', 'rejected', 'accepted'
    
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    
    UNIQUE(user_id, job_id)
);

-- Application Tracking
CREATE TABLE IF NOT EXISTS public.job_application (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES public.job(id) ON DELETE CASCADE,
    
    status TEXT DEFAULT 'applied', -- 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'
    
    -- Application Details
    applied_via TEXT, -- 'app', 'company_website', 'linkedin', etc.
    cover_letter TEXT,
    resume_version_id UUID REFERENCES public.resume(id),
    
    -- Timeline
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    interview_dates TIMESTAMPTZ[],
    offer_date TIMESTAMPTZ,
    decision_date TIMESTAMPTZ,
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, job_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Work Experience
CREATE INDEX IF NOT EXISTS idx_work_experience_user ON public.work_experience(user_id);
CREATE INDEX IF NOT EXISTS idx_work_experience_dates ON public.work_experience(start_date DESC, end_date DESC);

-- Education
CREATE INDEX IF NOT EXISTS idx_education_user ON public.education(user_id);

-- Resume
CREATE INDEX IF NOT EXISTS idx_resume_user ON public.resume(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_primary ON public.resume(user_id, is_primary) WHERE is_primary = true;

-- Job Match Scores
CREATE INDEX IF NOT EXISTS idx_job_match_user ON public.job_match_score(user_id, overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_job_match_job ON public.job_match_score(job_id, overall_score DESC);

-- Autofill Templates
CREATE INDEX IF NOT EXISTS idx_autofill_user ON public.autofill_template(user_id);

-- Saved Jobs
CREATE INDEX IF NOT EXISTS idx_saved_job_user ON public.saved_job(user_id, saved_at DESC);

-- Job Applications
CREATE INDEX IF NOT EXISTS idx_job_application_user ON public.job_application(user_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_application_status ON public.job_application(user_id, status);

-- Vector Similarity Search (pgvector IVFFlat index)
-- Adjust 'lists' parameter based on your data size:
-- - Small datasets (<10k): lists = 100
-- - Medium datasets (10k-1M): lists = 1000
-- - Large datasets (>1M): lists = 2000
CREATE INDEX IF NOT EXISTS idx_user_profile_skill_embeddings 
    ON public.user_profile 
    USING ivfflat (skill_embeddings vector_cosine_ops) 
    WITH (lists = 100);

-- GIN indexes for array searches (skills, desired roles, locations)
CREATE INDEX IF NOT EXISTS idx_user_profile_skills_gin 
    ON public.user_profile USING gin(skills);

CREATE INDEX IF NOT EXISTS idx_user_profile_desired_roles_gin 
    ON public.user_profile USING gin(desired_roles);

CREATE INDEX IF NOT EXISTS idx_user_profile_desired_locations_gin 
    ON public.user_profile USING gin(desired_locations);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- Trigger for user_profile
DROP TRIGGER IF EXISTS trg_user_profile_updated_at ON public.user_profile;
CREATE TRIGGER trg_user_profile_updated_at
    BEFORE UPDATE ON public.user_profile
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger for work_experience
DROP TRIGGER IF EXISTS trg_work_experience_updated_at ON public.work_experience;
CREATE TRIGGER trg_work_experience_updated_at
    BEFORE UPDATE ON public.work_experience
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger for autofill_template
DROP TRIGGER IF EXISTS trg_autofill_template_updated_at ON public.autofill_template;
CREATE TRIGGER trg_autofill_template_updated_at
    BEFORE UPDATE ON public.autofill_template
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger for job_application
DROP TRIGGER IF EXISTS trg_job_application_updated_at ON public.job_application;
CREATE TRIGGER trg_job_application_updated_at
    BEFORE UPDATE ON public.job_application
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Calculate profile completeness score
CREATE OR REPLACE FUNCTION public.calculate_profile_completeness(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    score INTEGER := 0;
    profile public.user_profile%ROWTYPE;
BEGIN
    SELECT * INTO profile FROM public.user_profile WHERE user_id = p_user_id;
    
    IF profile.full_name IS NOT NULL AND profile.full_name != '' THEN score := score + 10; END IF;
    IF profile.email IS NOT NULL THEN score := score + 10; END IF;
    IF profile.phone IS NOT NULL THEN score := score + 5; END IF;
    IF profile.location_city IS NOT NULL THEN score := score + 5; END IF;
    IF profile.headline IS NOT NULL THEN score := score + 10; END IF;
    IF profile.summary IS NOT NULL AND LENGTH(profile.summary) > 50 THEN score := score + 15; END IF;
    IF array_length(profile.skills, 1) >= 5 THEN score := score + 15; END IF;
    IF profile.years_of_experience IS NOT NULL THEN score := score + 5; END IF;
    IF array_length(profile.desired_roles, 1) >= 1 THEN score := score + 10; END IF;
    
    -- Check if has work experience
    IF EXISTS (SELECT 1 FROM public.work_experience WHERE user_id = p_user_id LIMIT 1) THEN
        score := score + 10;
    END IF;
    
    -- Check if has resume
    IF EXISTS (SELECT 1 FROM public.resume WHERE user_id = p_user_id AND is_primary = true LIMIT 1) THEN
        score := score + 5;
    END IF;
    
    RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update completeness
CREATE OR REPLACE FUNCTION public.update_profile_completeness()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.user_profile 
    SET profile_completeness = public.calculate_profile_completeness(NEW.user_id),
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_profile_completeness ON public.user_profile;
CREATE TRIGGER trigger_update_profile_completeness
    AFTER INSERT OR UPDATE ON public.user_profile
    FOR EACH ROW
    EXECUTE FUNCTION public.update_profile_completeness();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_match_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autofill_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only access their own data

-- User Profile Policies
CREATE POLICY "Users can view own profile"
    ON public.user_profile FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
    ON public.user_profile FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
    ON public.user_profile FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
    ON public.user_profile FOR DELETE
    USING (auth.uid() = user_id);

-- Work Experience Policies
CREATE POLICY "Users can manage own work_experience"
    ON public.work_experience FOR ALL
    USING (auth.uid() = user_id);

-- Education Policies
CREATE POLICY "Users can manage own education"
    ON public.education FOR ALL
    USING (auth.uid() = user_id);

-- Resume Policies
CREATE POLICY "Users can manage own resume"
    ON public.resume FOR ALL
    USING (auth.uid() = user_id);

-- Job Match Score Policies
CREATE POLICY "Users can view own job matches"
    ON public.job_match_score FOR SELECT
    USING (auth.uid() = user_id);

-- System can insert/update matches (for background jobs)
CREATE POLICY "System can manage job matches"
    ON public.job_match_score FOR ALL
    USING (true); -- Adjust this based on your service role setup

-- Autofill Template Policies
CREATE POLICY "Users can manage own autofill templates"
    ON public.autofill_template FOR ALL
    USING (auth.uid() = user_id);

-- Saved Job Policies
CREATE POLICY "Users can manage own saved jobs"
    ON public.saved_job FOR ALL
    USING (auth.uid() = user_id);

-- Job Application Policies
CREATE POLICY "Users can manage own applications"
    ON public.job_application FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================================
-- STORAGE SETUP
-- ============================================================================

-- Create storage bucket for resumes (if not exists)
-- Note: This needs to be run separately in Supabase Dashboard or via API

-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'resumes',
--   'resumes',
--   false,
--   10485760, -- 10MB
--   ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- Storage Policies (run after bucket is created)
-- CREATE POLICY "Users can upload own resume"
--     ON storage.objects FOR INSERT
--     WITH CHECK (
--         bucket_id = 'resumes' AND 
--         auth.uid()::text = (storage.foldername(name))[1]
--     );

-- CREATE POLICY "Users can view own resume"
--     ON storage.objects FOR SELECT
--     USING (
--         bucket_id = 'resumes' AND 
--         auth.uid()::text = (storage.foldername(name))[1]
--     );

-- CREATE POLICY "Users can update own resume"
--     ON storage.objects FOR UPDATE
--     USING (
--         bucket_id = 'resumes' AND 
--         auth.uid()::text = (storage.foldername(name))[1]
--     );

-- CREATE POLICY "Users can delete own resume"
--     ON storage.objects FOR DELETE
--     USING (
--         bucket_id = 'resumes' AND 
--         auth.uid()::text = (storage.foldername(name))[1]
--     );

-- ============================================================================
-- HELPER QUERIES
-- ============================================================================

-- Query to find similar profiles based on skill embeddings
-- SELECT 
--     id, 
--     full_name, 
--     skills,
--     1 - (skill_embeddings <=> '[your_embedding_vector]'::vector) AS similarity
-- FROM public.user_profile
-- WHERE skill_embeddings IS NOT NULL
-- ORDER BY skill_embeddings <=> '[your_embedding_vector]'::vector
-- LIMIT 10;

-- Query to get top job matches for a user
-- SELECT 
--     jms.*,
--     j.title,
--     j.company_name,
--     j.location_city,
--     j.remote
-- FROM public.job_match_score jms
-- JOIN public.job j ON jms.job_id = j.id
-- WHERE jms.user_id = 'user-uuid-here'
-- ORDER BY jms.overall_score DESC
-- LIMIT 50;

-- Query to check profile completeness
-- SELECT 
--     user_id,
--     full_name,
--     profile_completeness,
--     public.calculate_profile_completeness(user_id) as recalculated_score
-- FROM public.user_profile;

-- ============================================================================
-- COMPLETE! 🎉
-- ============================================================================
-- Schema is ready for:
-- ✅ Resume upload & parsing
-- ✅ Profile management
-- ✅ Job matching with vector similarity
-- ✅ Application tracking
-- ✅ Autofill data storage
-- ✅ Row-level security
-- ============================================================================