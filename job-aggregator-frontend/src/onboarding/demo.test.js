import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { frameAt, visibleValue, LOOP_MS } from './demoTimeline';
import AutofillDemo from './AutofillDemo';
import ValueHero from './ValueHero';
import HeroDemo from './HeroDemo';
import { previewRows, SAMPLE_PROFILE } from './profileFields';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('loop is about 20 s and phases run in order', () => {
  expect(LOOP_MS).toBe(20000);
  const order = [0, 3500, 8000, 17000, 19500].map((t) => frameAt(t, 8).phase);
  expect(order).toEqual(['resume', 'click', 'filling', 'done', 'fade']);
  expect(frameAt(LOOP_MS + 100, 8).phase).toBe('resume');
});

test('fields fill monotonically and all are filled before done', () => {
  let prev = 0;
  for (let t = 0; t < LOOP_MS; t += 100) {
    const f = frameAt(t, 8);
    if (t < 19000) expect(f.filled).toBeGreaterThanOrEqual(prev);
    prev = f.filled;
  }
  expect(frameAt(17000, 8).filled).toBe(8);
  expect(visibleValue('abcd', 0, { filled: 0, typing: 0, typingProgress: 0.5 })).toBe('ab');
  expect(visibleValue('abcd', 1, { filled: 0, typing: 0, typingProgress: 0.5 })).toBe('');
  expect(visibleValue('abcd', 0, { filled: 1, typing: -1, typingProgress: 1 })).toBe('abcd');
});

function mount(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, root, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const rows = previewRows(SAMPLE_PROFILE);

function setMotion(reduce) {
  window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
}

test('reduced motion: shows the finished form, no timers, no pause button', () => {
  setMotion(true);
  jest.useFakeTimers();
  const m = mount(<AutofillDemo rows={rows} label="Demo with sample data" sourceLines={['a']} />);
  expect(m.host.querySelectorAll('.ob-demo-field.is-filled')).toHaveLength(8);
  expect(m.host.textContent).toContain('Alex');
  expect(m.host.querySelector('.ob-demo-pause')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  m.unmount();
  jest.useRealTimers();
});

test('animates while visible, pauses on button, and stops timers on unmount', () => {
  setMotion(false);
  jest.useFakeTimers();
  const m = mount(<AutofillDemo rows={rows} label="Demo with sample data" sourceLines={['a']} />);
  expect(m.host.querySelectorAll('.ob-demo-field.is-filled')).toHaveLength(0);
  expect(m.host.querySelector('.ob-demo-badge').textContent).toBe('Demo with sample data');
  act(() => { jest.advanceTimersByTime(17000); });
  expect(m.host.querySelectorAll('.ob-demo-field.is-filled').length).toBe(8);
  const before = m.host.querySelector('.ob-demo').dataset.phase;
  act(() => { m.host.querySelector('.ob-demo-pause').click(); });
  expect(m.host.querySelector('.ob-demo').dataset.animating).toBe('false');
  act(() => { jest.advanceTimersByTime(5000); });
  expect(m.host.querySelector('.ob-demo').dataset.phase).toBe(before);
  m.unmount();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('pauses when scrolled off screen (IntersectionObserver)', () => {
  setMotion(false);
  jest.useFakeTimers();
  let cb;
  globalThis.IntersectionObserver = class { constructor(c) { cb = c; } observe() {} disconnect() {} };
  const m = mount(<AutofillDemo rows={rows} label="x" sourceLines={[]} />);
  expect(m.host.querySelector('.ob-demo').dataset.animating).toBe('false'); // not intersecting yet
  act(() => cb([{ isIntersecting: true }]));
  expect(m.host.querySelector('.ob-demo').dataset.animating).toBe('true');
  act(() => cb([{ isIntersecting: false }]));
  expect(m.host.querySelector('.ob-demo').dataset.animating).toBe('false');
  m.unmount();
  delete globalThis.IntersectionObserver;
  jest.useRealTimers();
});

test('HeroDemo uses a video only when media is configured', () => {
  setMotion(false);
  const a = mount(<HeroDemo media={{ mp4: '', webm: '', poster: '' }} />);
  expect(a.host.querySelector('video')).toBeNull();
  expect(a.host.querySelector('.ob-demo-badge').textContent).toBe('Demo with sample data');
  a.unmount();
  const b = mount(<HeroDemo media={{ mp4: '/demo/a.mp4', webm: '', poster: '/p.jpg', width: 1280, height: 720 }} />);
  expect(b.host.querySelector('video source').getAttribute('src')).toBe('/demo/a.mp4');
  expect(b.host.querySelector('video').muted).toBe(true);
  expect(b.host.textContent).toContain('Demo with sample data');
  b.unmount();
});

test('ValueHero: promise + CTA render immediately, CTA calls back, demo mounts lazily', async () => {
  setMotion(false);
  jest.useFakeTimers();
  delete window.requestIdleCallback;
  const onGetStarted = jest.fn();
  const m = mount(<ValueHero onGetStarted={onGetStarted} />);
  expect(m.host.querySelector('h2').textContent).toMatch(/Autofill every job application/);
  expect(m.host.querySelector('.ob-demo')).toBeNull(); // not before idle
  expect(m.host.querySelector('.ob-hero-ph')).not.toBeNull(); // space reserved
  act(() => m.host.querySelector('.ob-hero-cta').click());
  expect(onGetStarted).toHaveBeenCalled();
  expect(m.host.querySelector('.ob-hero-cta').textContent).toBe('Get started free');
  await act(async () => { jest.advanceTimersByTime(400); });
  jest.useRealTimers();
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(m.host.querySelector('.ob-demo')).not.toBeNull();
  m.unmount();
});
