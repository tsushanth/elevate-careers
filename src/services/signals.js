import { createClient } from '@supabase/supabase-js';

let _sb = null;
function getSB() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, realtime: { enabled: false },
  });
  return _sb;
}

// Specific enough to not match non-engineering roles
const SKILL_RE = /\b(typescript|javascript|python|golang|rust|java|swift|kotlin|react|nextjs|nodejs|aws|gcp|azure|kubernetes|postgres|postgresql|redis|graphql|tensorflow|pytorch|llm|ios|android|distributed|devops|ci\/cd|docker|terraform)\b/gi;
const STOP_WORDS = new Set(['engineer','senior','staff','principal','lead','junior','manager','director','head','the','and','for','with','our','that','this','have','from','they','will','been','were']);

export async function recomputeSignals(userId) {
  const sb = getSB();

  const [{ data: apps }, { data: profile }] = await Promise.all([
    sb.from('job_applications').select('job_title').eq('user_id', userId).order('filled_at', { ascending: false }).limit(30),
    sb.from('user_profile').select('autofill_data').eq('user_id', userId).single(),
  ]);

  const titles = (apps || []).map(a => a.job_title).filter(Boolean);
  const background = profile?.autofill_data?.background || '';
  const resume = profile?.autofill_data?.resume || '';

  const preferredTitles = [...new Set(titles)].slice(0, 10);

  const skillsFromText = (background + ' ' + resume).match(SKILL_RE) || [];
  const titleNouns = titles.join(' ').split(/\W+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const keywords = [...new Set([...skillsFromText.map(s => s.toLowerCase()), ...titleNouns])].slice(0, 15);

  const { error } = await sb.from('user_signals').upsert({
    user_id: userId,
    keywords,
    preferred_titles: preferredTitles,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) throw error;
  return { keywords, preferredTitles };
}
