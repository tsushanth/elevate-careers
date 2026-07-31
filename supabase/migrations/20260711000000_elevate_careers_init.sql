-- ElevateCareers user profiles for autofill extension
CREATE TABLE IF NOT EXISTS public.user_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  autofill_data JSONB DEFAULT '{}'::jsonb,
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  monthly_ai_count INTEGER DEFAULT 0,
  monthly_ai_reset_at TIMESTAMPTZ DEFAULT (date_trunc('month', now()) + interval '1 month'),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.user_profile
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON public.user_profile
  FOR ALL USING (auth.uid() = user_id);
