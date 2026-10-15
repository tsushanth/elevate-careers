// True when supabase-js left a session in localStorage. Used only to decide, before the
// async getSession() resolves, whether a signed-out hero should render. Avoids a hero that
// flashes in and out (layout shift) for returning signed-in visitors.
export function hasStoredSession(storage) {
  try {
    const s = storage || window.localStorage;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && /^sb-.+-auth-token$/.test(k) && s.getItem(k)) return true;
    }
  } catch { /* storage blocked: treat as signed out */ }
  return false;
}
