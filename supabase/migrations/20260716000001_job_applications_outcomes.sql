ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS fields_filled  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fields_skipped INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fields_errored INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted      BOOLEAN,
  ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMPTZ;

-- Allow users to update their own rows (for self-report)
CREATE POLICY "Users can update own applications" ON public.job_applications
  FOR UPDATE USING (auth.uid() = user_id);
