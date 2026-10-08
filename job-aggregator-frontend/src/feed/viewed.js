// Jobs the user has opened, remembered per browser so the list can dim them. Capped, most recent kept.
const KEY = 'sa_viewed';
const CAP = 500;

export function loadViewed() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(a) ? a.filter(n => Number.isFinite(n)) : []);
  } catch { return new Set(); }
}

export function addViewed(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return loadViewed();
  const set = loadViewed();
  set.delete(n); set.add(n);                       // re-insert so the newest is last
  const list = [...set].slice(-CAP);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return new Set(list);
}
