import { db } from '../db/index.js';
import { createClient } from '@supabase/supabase-js';
import { createSavedJobsRouter, SAVED_JOB_SCHEMA_SQL } from './saved-jobs-core.js';

// Idempotent, run at process start like the other route files.
SAVED_JOB_SCHEMA_SQL.reduce((p, sql) => p.then(() => db.query(sql)), Promise.resolve())
  .catch(e => console.error('[saved-jobs migration]', e.message));

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
  return _supabase;
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { data: { user }, error } = await getSupabase().auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Auth check failed' });
  }
}

// Anonymous count only: no user id, no job id, no visit id (the phone app has none).
// Needs the surface column from 20261014000000_funnel_events.sql; until that is applied
// the insert fails and is ignored.
const onSaved = () => db.query(`INSERT INTO analytics_events (event_name, surface) VALUES ('save_job', 'app')`);

export default createSavedJobsRouter({ db, requireAuth, onSaved });
