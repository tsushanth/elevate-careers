import { trackFunnel } from '../track';

export const EXTENSION_URL = 'https://chromewebstore.google.com/detail/simplyapply-%E2%80%94-ai-job-auto/ocdeebjeffdjmfgmclnlphkhfdcdpdkf';
export const API_URL = 'https://elevate-careers-api.fly.dev';

// Build-time switch: set REACT_APP_ONBOARDING_V2=0 to ship the site without the
// wizard and the new hero (rollback without reverting code).
export const ONBOARDING_ENABLED = process.env.REACT_APP_ONBOARDING_V2 !== '0';

// The only values ever sent as onboarding_step.step. No content, no field names, no counts.
export const ONBOARDING_STEPS = [
  'resume_shown', 'resume_parsed', 'profile_saved', 'install_shown',
  'install_clicked', 'preview_shown', 'done', 'skipped',
];

export function trackOnboarding(step, track = trackFunnel) {
  if (!ONBOARDING_STEPS.includes(step)) return false;
  track('onboarding_step', { step });
  return true;
}
