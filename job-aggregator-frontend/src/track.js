import { supabase } from './supabase';

// Fire-and-forget event logging. Never throws, never blocks the UI.
export function track(eventName, properties = {}) {
  try {
    supabase
      .from('analytics_events')
      .insert({ event_name: eventName, properties })
      .then(() => {}, () => {});
  } catch {
    // tracking must never break the app
  }
}
