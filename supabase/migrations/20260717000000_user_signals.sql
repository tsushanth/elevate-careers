CREATE TABLE IF NOT EXISTS public.user_signals (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  keywords       TEXT[]    DEFAULT '{}',
  preferred_titles TEXT[]  DEFAULT '{}',
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own signals" ON public.user_signals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can write signals" ON public.user_signals
  FOR ALL USING (true);
