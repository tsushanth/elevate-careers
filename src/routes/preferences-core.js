// POST /api/preferences used to be a full upsert: every field a client left out was
// reset to its default. The web app sent a subset of the fields, so pressing Save
// there wiped exclusions and the visa flag the user had set in the Android app.
// Now a field that is absent from the body keeps its stored value; a field that is
// present (including null / [] / false) is written as given.

const STRING_LISTS = ['keywords', 'excluded_companies', 'excluded_titles', 'excluded_locations'];
const BOOLEANS = ['remote', 'enabled', 'auto_apply_similar', 'require_visa_sponsor'];

// Values for a brand-new row when the client omits a field (same defaults as before).
const NEW_ROW_DEFAULTS = {
  keywords: [], remote: false, location: null, salary_min: null,
  excluded_companies: [], excluded_titles: [], excluded_locations: [],
  daily_limit: 10, enabled: false, auto_apply_similar: false, require_visa_sponsor: false,
};

// Column order is fixed here, never taken from the request, so the dynamic SQL below
// only ever contains these names.
const COLUMNS = ['keywords', 'remote', 'location', 'salary_min', 'excluded_companies', 'excluded_titles',
  'excluded_locations', 'daily_limit', 'enabled', 'auto_apply_similar', 'require_visa_sponsor'];

const has = (body, k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;

// body -> { values: { column: value } (only the fields the client sent) } or { error }.
export function parsePreferences(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object' };
  const values = {};
  for (const k of STRING_LISTS) {
    if (!has(body, k)) continue;
    if (!Array.isArray(body[k]) || body[k].some(x => typeof x !== 'string')) return { error: `${k} must be an array of strings` };
    values[k] = body[k];
  }
  for (const k of BOOLEANS) {
    if (!has(body, k)) continue;
    if (typeof body[k] !== 'boolean') return { error: `${k} must be true or false` };
    values[k] = body[k];
  }
  if (has(body, 'location')) {
    if (body.location !== null && typeof body.location !== 'string') return { error: 'location must be a string or null' };
    values.location = body.location || null;
  }
  if (has(body, 'salary_min')) {
    const v = body.salary_min;
    if (v === null || v === '' || v === 0) values.salary_min = null;
    else {
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (!Number.isFinite(n) || n < 0 || n > 2147483647) return { error: 'salary_min must be a non-negative number or null' };
      values.salary_min = Math.trunc(n) || null;
    }
  }
  if (has(body, 'daily_limit')) {
    const n = typeof body.daily_limit === 'string' && body.daily_limit.trim() !== '' ? Number(body.daily_limit) : body.daily_limit;
    if (!Number.isInteger(n) || n < 0 || n > 2147483647) return { error: 'daily_limit must be a non-negative integer' };
    values.daily_limit = n;
  }
  return { values };
}

// -> { sql, params }. Insert uses the sent value or the old default; the conflict branch only touches sent fields.
export function buildPreferencesUpsert(userId, values) {
  const params = [userId];
  const insertCols = ['user_id'];
  const insertVals = ['$1'];
  const updates = [];
  for (const col of COLUMNS) {
    params.push(Object.prototype.hasOwnProperty.call(values, col) ? values[col] : NEW_ROW_DEFAULTS[col]);
    insertCols.push(col);
    insertVals.push(`$${params.length}`);
    if (Object.prototype.hasOwnProperty.call(values, col)) updates.push(`${col}=EXCLUDED.${col}`);
  }
  updates.push('updated_at=NOW()');
  const sql = `INSERT INTO apply_preferences (${insertCols.join(', ')}, updated_at)
       VALUES (${insertVals.join(', ')}, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}`;
  return { sql, params };
}

export function createSavePreferencesHandler({ db }) {
  return async function savePreferences(req, res) {
    const parsed = parsePreferences(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const { sql, params } = buildPreferencesUpsert(req.user.id, parsed.values);
      await db.query(sql, params);
      res.json({ ok: true });
    } catch (e) {
      console.error('[prefs POST]', e);
      res.status(500).json({ error: 'Failed to save preferences' });
    }
  };
}
