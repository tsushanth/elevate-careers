// Anonymous usage counts for the extension: "an application was filled", nothing else.
// A random install id (own namespace, never the account), no URLs, no company names,
// no field values, no IP/user-agent. Off when the browser sends Do Not Track or Global
// Privacy Control. Used by sw.js; every path is fail-silent.

export const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function extTrackingDisabled(nav) {
  try {
    const n = nav || {};
    return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes';
  } catch { return true; }
}

export function newInstallId(cryptoObj) {
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Rows to insert for one completed fill. The first fill ever also emits extension_first_fill.
export function fillRows(installId, alreadySentFirst) {
  const base = { visit_id: installId, surface: 'extension', properties: {} };
  const rows = [];
  if (!alreadySentFirst) rows.push({ ...base, event_name: 'extension_first_fill' });
  rows.push({ ...base, event_name: 'extension_fill' });
  return rows;
}

// store: { get(keys)->Promise<obj>, set(obj)->Promise }. post(rows)->Promise<boolean>.
export async function recordFill({ store, post, nav, cryptoObj }) {
  try {
    if (extTrackingDisabled(nav)) return false;
    let { ext_vid, ext_first_fill_sent } = await store.get(['ext_vid', 'ext_first_fill_sent']);
    if (!INSTALL_ID_RE.test(ext_vid || '')) {
      if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return false;
      ext_vid = newInstallId(cryptoObj);
      await store.set({ ext_vid });
    }
    const ok = await post(fillRows(ext_vid, !!ext_first_fill_sent));
    if (ok && !ext_first_fill_sent) await store.set({ ext_first_fill_sent: true });
    return !!ok;
  } catch {
    return false;
  }
}
