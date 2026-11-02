// Supabase sends a password-reset link back to the site with the result in the URL hash:
//   success  #access_token=...&type=recovery
//   failure  #error=access_denied&error_code=otp_expired&error_description=...
// supabase-js strips the hash soon after load, so read it once, synchronously, at import.

const parse = (hash) => new URLSearchParams(String(hash || '').replace(/^#/, ''));

export function isRecoveryHash(hash) { return parse(hash).get('type') === 'recovery'; }

// 'expired' for a dead/used link, else null.
export function resetLinkProblem(hash) {
  const p = parse(hash);
  if (p.get('type') === 'recovery') return null;
  const code = p.get('error_code');
  if (code === 'otp_expired') return 'expired';
  return p.get('error') === 'access_denied' && p.get('error_description') && /recover|reset|expired|invalid/i.test(p.get('error_description')) ? 'expired' : null;
}

export const RECOVERY_AT_LOAD = typeof window !== 'undefined' ? isRecoveryHash(window.location.hash) : false;
export const RESET_PROBLEM_AT_LOAD = typeof window !== 'undefined' ? resetLinkProblem(window.location.hash) : null;
