export function feedUrl(base, state) {
  const p = new URLSearchParams();
  const place = state.place || {};
  if (place.country) p.set('country', place.country);
  if (place.region) p.set('region', place.region);
  if (place.city) p.set('city', place.city);
  if (state.q) p.set('q', state.q);
  if (state.remote) p.set('remote', 'true');
  if (state.type) p.set('type', state.type);
  if (state.days) p.set('days', String(state.days));
  if (state.cursor) p.set('cursor', state.cursor);
  const qs = p.toString();
  return `${base}/v2/jobs/feed${qs ? `?${qs}` : ''}`;
}

export async function fetchFeed(base, state, { signal, token } = {}) {
  const res = await fetch(feedUrl(base, state), {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
  return res.json();
}

export async function fetchSuggest(base, q, { signal } = {}) {
  const term = (q || '').trim();
  if (!term) return [];
  const res = await fetch(`${base}/v2/geo/suggest?q=${encodeURIComponent(term)}`, { signal });
  if (!res.ok) return [];
  return (await res.json()).places || [];
}

export async function fetchStats(base) {
  const res = await fetch(`${base}/v2/stats`);
  if (!res.ok) throw new Error(`Stats request failed (${res.status})`);
  return res.json();
}
