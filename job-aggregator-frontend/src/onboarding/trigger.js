import { ONBOARDING_ENABLED } from './constants';
import { fetchProfile } from './api';
import { hasSavedProfile } from './profileFields';

const seenKey = (uid) => `sa_ob_seen_${uid}`;

export function markSeen(uid, storage = window.localStorage) {
  try { storage.setItem(seenKey(uid), '1'); } catch { /* storage blocked: wizard may reappear once per load */ }
}

// Auto-open the wizard once per user per browser, after any sign-in path (password, Google,
// email-confirm link, returning session), when the account has no saved profile.
// Resolves true only when we positively know the profile is missing.
export async function shouldAutoOpen({ uid, token, storage = window.localStorage, enabled = ONBOARDING_ENABLED, fetchProfileImpl = fetchProfile }) {
  if (!enabled || !uid || !token) return false;
  try { if (storage.getItem(seenKey(uid))) return false; } catch { return false; }
  const profile = await fetchProfileImpl({ token });
  if (profile === undefined) return false; // request failed: do not guess
  return !hasSavedProfile(profile);
}
