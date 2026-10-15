// Is the SimplyApply extension installed in this browser, and can this browser install it?

// The extension's detect.js sets this attribute on <html> once the pending extension release
// ships. Older builds only set a flag in an isolated world the page cannot see, so for them
// detection returns false and the UI offers an "I installed it" button instead.
export function extensionVersion(doc = document) {
  try { return doc.documentElement.getAttribute('data-simplyapply-ext'); } catch { return null; }
}

export function isExtensionInstalled(doc = document) {
  return extensionVersion(doc) !== null;
}

// Desktop Chromium (Chrome, Edge, Brave, Opera...) can install from the Chrome Web Store.
export function canInstallExtension(nav = navigator) {
  try {
    const ua = String(nav.userAgent || '');
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return false;
    const brands = (nav.userAgentData && nav.userAgentData.brands) || [];
    if (brands.some((b) => /chromium|google chrome/i.test(b.brand))) return true;
    return /Chrome\//.test(ua) && !/Firefox\//.test(ua);
  } catch { return false; }
}

export function browserLabel(nav = navigator) {
  const ua = String((nav && nav.userAgent) || '');
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'a phone or tablet';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'this browser';
}

// Polls for the marker (it can appear after install + reload). Returns a stop function.
export function watchExtension(onFound, { doc = document, intervalMs = 1500, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  if (isExtensionInstalled(doc)) { onFound(); return () => {}; }
  const id = setIntervalImpl(() => { if (isExtensionInstalled(doc)) { clearIntervalImpl(id); onFound(); } }, intervalMs);
  return () => clearIntervalImpl(id);
}
