import { useCallback, useEffect, useRef, useState } from 'react';

// The signed-in user's shortlist (GET/PUT/DELETE /api/saved-jobs): the same list the phone app writes.
// Ids are loaded once per session; a toggle updates the UI at once and is undone if the server refuses.
// (The list endpoint returns the 500 newest, so a bookmark older than that shows as unsaved until toggled.)
export function useSaved({ apiBase, session }) {
  const token = session?.access_token || null;
  const uid = session?.user?.id || null;
  const [ids, setIds] = useState(() => new Set());
  const [error, setError] = useState('');
  const pending = useRef(new Set());
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    setIds(new Set());
    setError('');
    pending.current = new Set();
    if (!uid || !tokenRef.current) return undefined;
    let live = true;
    fetch(`${apiBase}/api/saved-jobs`, { headers: { Authorization: `Bearer ${tokenRef.current}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (live && body && Array.isArray(body.jobs)) setIds(new Set(body.jobs.map((j) => Number(j.id)))); })
      .catch(() => { /* leave the list empty; saving still works */ });
    return () => { live = false; };
  }, [apiBase, uid]);

  const isSaved = useCallback((id) => ids.has(Number(id)), [ids]);

  // Returns false when signed out (the caller opens sign-in), true otherwise.
  const toggle = useCallback(async (id) => {
    const jobId = Number(id);
    if (!tokenRef.current) return false;
    if (!Number.isSafeInteger(jobId) || jobId <= 0 || pending.current.has(jobId)) return true;
    pending.current.add(jobId);
    const wasSaved = ids.has(jobId);
    const apply = (saved) => setIds((prev) => { const n = new Set(prev); if (saved) n.add(jobId); else n.delete(jobId); return n; });
    apply(!wasSaved);
    setError('');
    try {
      const r = await fetch(`${apiBase}/api/saved-jobs/${jobId}`, {
        method: wasSaved ? 'DELETE' : 'PUT',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      apply(wasSaved);
      setError(wasSaved ? "Couldn't remove it from your shortlist. Try again." : "Couldn't save it to your shortlist. Try again.");
      setTimeout(() => setError(''), 5000);
    } finally {
      pending.current.delete(jobId);
    }
    return true;
  }, [apiBase, ids]);

  return { ids, isSaved, toggle, error };
}
