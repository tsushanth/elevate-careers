CREATE TABLE IF NOT EXISTS public.job_applications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_url      TEXT NOT NULL,
  job_title    TEXT,
  company      TEXT,
  filled_at    TIMESTAMPTZ DEFAULT now(),
  field_count  INTEGER DEFAULT 0,
  ai_used      BOOLEAN DEFAULT false
);

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own applications" ON public.job_applications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications" ON public.job_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_job_applications_user_filled ON public.job_applications(user_id, filled_at DESC);
