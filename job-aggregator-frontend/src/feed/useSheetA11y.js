import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 800px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// True while the viewport is narrow enough for the detail pane to be a full-screen sheet.
export function useIsMobile() {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY).matches : false);
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    on();
    if (mq.addEventListener) { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }
    mq.addListener(on); return () => mq.removeListener(on);
  }, []);
  return mobile;
}

// Modal behaviour for the mobile sheet: focus moves in, Tab is trapped, Escape closes,
// body scroll is locked, and on close focus returns to `openerRef.current` (the card that opened it).
export function useSheetA11y({ active, sheetRef, openerRef, onClose }) {
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!active || !sheet) return undefined;
    const opener = openerRef.current || document.activeElement;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const items = () => [...sheet.querySelectorAll(FOCUSABLE)].filter(el => !el.hasAttribute('hidden'));
    const first = items()[0];
    if (first) first.focus(); else { sheet.tabIndex = -1; sheet.focus(); }

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const firstEl = list[0]; const lastEl = list[list.length - 1];
      if (!sheet.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}
