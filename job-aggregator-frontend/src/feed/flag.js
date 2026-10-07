// The default flips to true at cutover (Task 16).
export const FEED_V2_DEFAULT = false;

export function isFeedV2Enabled(search, storage, defaultOn = FEED_V2_DEFAULT) {
  const param = new URLSearchParams(search).get('feed');
  try {
    if (param === 'v2' || param === 'v1') { storage.setItem('sa_feed', param); }
    const v = param || storage.getItem('sa_feed');
    if (v === 'v2') return true;
    if (v === 'v1') return false;
  } catch {
    if (param === 'v2') return true;
    if (param === 'v1') return false;
  }
  return defaultOn;
}
