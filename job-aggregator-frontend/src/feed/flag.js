// Must match window.__FEED_V2_DEFAULT in public/index.html (flagDefaultParity.test.js enforces it).
export const FEED_V2_DEFAULT = true;

export function isFeedV2Enabled(search, storage, defaultOn = FEED_V2_DEFAULT) {
  const raw = new URLSearchParams(search).get('feed');
  // Only v1/v2 count; anything else falls through to storage, then the default.
  const param = raw === 'v1' || raw === 'v2' ? raw : null;
  try {
    if (param) { storage.setItem('sa_feed', param); }
    const v = param || storage.getItem('sa_feed');
    if (v === 'v2') return true;
    if (v === 'v1') return false;
  } catch {
    if (param === 'v2') return true;
    if (param === 'v1') return false;
  }
  return defaultOn;
}
