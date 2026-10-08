// The chosen job family (role slug), remembered across reloads for everyone, signed in or not.
const KEY = 'sa_role';

export function loadRole() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function saveRole(slug) {
  try { if (slug) localStorage.setItem(KEY, slug); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}
