import React, { Suspense, useEffect, useState } from 'react';
import './hero.css';

const HeroDemo = React.lazy(() => import('./HeroDemo'));

// Mount the demo after the first paint and an idle moment, so the job feed is never
// competing with the animation chunk for the network or the main thread.
function useAfterIdle(timeoutMs = 1500) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const go = () => { if (!cancelled) setReady(true); };
    let handle;
    if (typeof window.requestIdleCallback === 'function') {
      handle = window.requestIdleCallback(go, { timeout: timeoutMs });
      return () => { cancelled = true; if (window.cancelIdleCallback) window.cancelIdleCallback(handle); };
    }
    handle = setTimeout(go, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [timeoutMs]);
  return ready;
}

export default function ValueHero({ onGetStarted, media }) {
  const ready = useAfterIdle();
  return (
    <section className="ob-hero" aria-labelledby="ob-hero-title">
      <div className="ob-hero-copy">
        <h2 id="ob-hero-title">Upload your resume once. Autofill every job application.</h2>
        <p>
          SimplyApply reads your resume, then fills the application on Greenhouse, Lever, Ashby, Workday and more with one click.
          You review everything before you submit.
        </p>
        <button type="button" className="ob-hero-cta" onClick={onGetStarted}>Get started free</button>
        <p className="ob-hero-fine">Free. Takes about a minute. Works in Chrome.</p>
      </div>
      <div className="ob-hero-demo" data-ready={ready ? 'true' : 'false'}>
        {ready ? (
          <Suspense fallback={<div className="ob-hero-ph" aria-hidden="true" />}>
            <HeroDemo media={media} />
          </Suspense>
        ) : <div className="ob-hero-ph" aria-hidden="true" />}
      </div>
    </section>
  );
}
