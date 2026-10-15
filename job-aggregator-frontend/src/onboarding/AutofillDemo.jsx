import React, { useEffect, useRef, useState } from 'react';
import { frameAt, visibleValue, LOOP_MS } from './demoTimeline';
import './demo.css';

const TICK_MS = 80;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return undefined; }
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else if (mq.removeListener) mq.removeListener(on); };
  }, []);
  return reduced;
}

// true while the element is on screen. Without IntersectionObserver we assume visible.
function useInViewport(ref) {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setVisible(e.isIntersecting);
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

// Also pause when the tab is hidden.
function usePageVisible() {
  const [v, setV] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const on = () => setV(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return v;
}

function useLoopClock(running) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(now - last, 250); // a throttled tab must not skip ahead
      last = now;
      setT((prev) => (prev + dt) % LOOP_MS);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);
  return t;
}

/**
 * Animated "resume -> filled application form". Self-contained: no video, no network.
 *
 * props
 *  rows          [{ id, label, value }]  fields that get filled, in order
 *  sourceTitle   heading of the left card ("Your resume")
 *  sourceLines   short lines shown in the left card
 *  label         badge text, e.g. "Demo with sample data" / "Preview with your details"
 *  ariaLabel     text alternative for the whole animation
 *  loop          false = play once and stop on the finished form
 */
export default function AutofillDemo({ rows, sourceTitle = 'Your resume', sourceLines = [], label, ariaLabel, loop = true }) {
  const rootRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const inView = useInViewport(rootRef);
  const pageVisible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const animate = !reduced;
  const running = animate && inView && pageVisible && !paused;
  const t = useLoopClock(running);
  const n = rows.length;

  // Reduced motion: show the finished state, nothing moves.
  const frame = animate ? frameAt(t, n) : { phase: 'done', filled: n, typing: -1, typingProgress: 1, time: 0 };
  const done = frame.phase === 'done' || frame.phase === 'fade';

  return (
    <div className="ob-demo" ref={rootRef} data-phase={frame.phase} data-animating={running ? 'true' : 'false'}>
      <div className="ob-demo-head">
        <span className="ob-demo-badge">{label}</span>
        {animate && loop && (
          <button type="button" className="ob-demo-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
      </div>
      <div className="ob-demo-stage" role="img" aria-label={ariaLabel || `${label}: your resume details are filled into a job application form automatically.`}>
        <div className={`ob-demo-card ob-demo-source${frame.phase === 'resume' ? ' is-active' : ''}`} aria-hidden="true">
          <div className="ob-demo-card-title">{sourceTitle}</div>
          {sourceLines.map((l, i) => <div key={i} className="ob-demo-line">{l}</div>)}
        </div>
        <div className={`ob-demo-card ob-demo-form${frame.phase === 'fade' ? ' is-fading' : ''}`} aria-hidden="true">
          <div className="ob-demo-form-head">
            <span className="ob-demo-form-title">Job application</span>
            <span className={`ob-demo-btn${frame.phase === 'click' ? ' is-pressed' : ''}`}>Autofill</span>
          </div>
          <div className="ob-demo-fields">
            {rows.map((r, i) => {
              const shown = visibleValue(r.value, i, frame);
              const isTyping = frame.typing === i;
              return (
                <div key={r.id} className={`ob-demo-field${shown ? ' is-filled' : ''}${isTyping ? ' is-typing' : ''}`}>
                  <span className="ob-demo-flabel">{r.label}</span>
                  <span className="ob-demo-fvalue">{shown || ' '}</span>
                </div>
              );
            })}
          </div>
          <div className={`ob-demo-status${done ? ' is-on' : ''}`}>
            {n} fields filled &middot; review, then submit
          </div>
        </div>
      </div>
    </div>
  );
}
