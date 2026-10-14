import { supabase } from './supabase';
import { createFunnel } from './funnel';

function build() {
  try {
    return createFunnel({
      insert: (row) => supabase.from('analytics_events').insert(row),
      storage: window.localStorage,
      session: window.sessionStorage,
      nav: window.navigator,
      win: window,
      cryptoObj: window.crypto,
    });
  } catch {
    return null; // storage blocked etc.: analytics simply stays off
  }
}

const funnel = build();

// Legacy free-form events. Fire-and-forget, never throws, never blocks the UI.
// They now honour Do-Not-Track / Global Privacy Control like the funnel events.
export function track(eventName, properties = {}) {
  try {
    if (!funnel || !funnel.enabled()) return;
    supabase
      .from('analytics_events')
      .insert({ event_name: eventName, properties })
      .then(() => {}, () => {});
  } catch {
    // tracking must never break the app
  }
}

// Anonymous funnel event with a random visit id (see funnel.js for what is and is not sent).
export function trackFunnel(event, props) {
  try { if (funnel) funnel.track(event, props); } catch { /* never break the app */ }
}
