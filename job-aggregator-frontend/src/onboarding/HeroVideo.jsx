import React, { useEffect, useRef, useState } from 'react';
import './demo.css';

// Plays a real recording only while it is on screen. With reduced motion it does not
// autoplay: the poster shows and the native controls let the visitor start it.
export default function HeroVideo({ media, label = 'Demo with sample data' }) {
  const ref = useRef(null);
  const [reduced] = useState(() => {
    try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    const v = ref.current;
    if (!v || reduced || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
      }
    }, { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);
  const ratio = `${media.width || 16} / ${media.height || 9}`;
  return (
    <div className="ob-demo">
      <div className="ob-demo-head"><span className="ob-demo-badge">{label}</span></div>
      <video
        ref={ref}
        className="ob-hero-video"
        style={{ aspectRatio: ratio }}
        muted
        loop
        playsInline
        preload="none"
        controls={reduced}
        poster={media.poster || undefined}
        aria-label="Screen recording: SimplyApply filling a job application from a resume (sample data)"
      >
        {media.webm && <source src={media.webm} type="video/webm" />}
        {media.mp4 && <source src={media.mp4} type="video/mp4" />}
      </video>
    </div>
  );
}
