import crypto from 'crypto';

// Dependency-free email helpers, shared by the API (confirmation email) and the
// Mac mini drip harness. Never throws: a failed send returns { ok: false }.

// RESEND_API_URL exists so tests can point the sender at a local mock server.
const RESEND_ENDPOINT = () => process.env.RESEND_API_URL || 'https://api.resend.com/emails';

export const SITE_URL = () => (process.env.PUBLIC_SITE_URL || 'https://www.simplyappl.ai').replace(/\/$/, '');
export const FROM = () => process.env.EMAIL_FROM || 'SimplyApply <hello@simplyappl.ai>';

// Signed tokens so an unsubscribe link only ever works for the address it was made for.
function secret() {
  const s = process.env.EMAIL_TOKEN_SECRET;
  if (!s) throw new Error('EMAIL_TOKEN_SECRET is not configured');
  return s;
}
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32);

export function makeToken(email) {
  const payload = Buffer.from(String(email).trim().toLowerCase()).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return Buffer.from(payload, 'base64url').toString('utf8'); } catch { return null; }
}

export const unsubscribeUrl = (email) => `${SITE_URL()}/api/public/unsubscribe?token=${encodeURIComponent(makeToken(email))}`;

export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Footer required on every email: who we are, postal address, why they got it, and a working opt-out.
export function footer(email) {
  const address = (process.env.EMAIL_POSTAL_ADDRESS || '').trim();
  const link = unsubscribeUrl(email);
  return {
    text: `\n\n--\nSimplyApply (simplyappl.ai)\n${address}\nYou're receiving this because you asked for your resume check results and tips. Unsubscribe: ${link}`,
    html: `<p style="color:#6b7280;font-size:12px;margin-top:28px;line-height:1.5">SimplyApply (simplyappl.ai)<br/>${escapeHtml(address)}<br/>You're receiving this because you asked for your resume check results and tips. <a href="${link}">Unsubscribe</a></p>`,
  };
}

export function requireSendConfig() {
  if (!process.env.RESEND_API_KEY) return 'RESEND_API_KEY is not set';
  if (!(process.env.EMAIL_POSTAL_ADDRESS || '').trim()) return 'EMAIL_POSTAL_ADDRESS is not set (required in every email footer)';
  return null;
}

export async function sendEmail({ to, subject, html, text }) {
  const problem = requireSendConfig();
  if (problem) return { ok: false, error: problem };
  const f = footer(to);
  try {
    const res = await fetch(RESEND_ENDPOINT(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM(),
        to,
        subject,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1d29;max-width:560px">${html}${f.html}</div>`,
        text: `${text}${f.text}`,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl(to)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
