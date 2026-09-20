import { escapeHtml, SITE_URL } from './email.js';

// Templated (not model-written) copy: everyone receiving these opted in, and the
// only personalization is real data (their score, their stored role/location,
// live job listings), so nothing here can invent claims about a person.

export const CONSENT_TEXT = 'Email me my resume check results and occasional job-search tips from SimplyApply. I can unsubscribe anytime.';
export const CONSENT_VERSION = 'v1';

// step -> days after the address was confirmed
export const DRIP_STEPS = [
  { step: 1, dayOffset: 0 },
  { step: 2, dayOffset: 3 },
  { step: 3, dayOffset: 7 },
  { step: 4, dayOffset: 14 },
];

export function confirmationEmail({ confirmUrl }) {
  return {
    subject: 'Confirm your email to get your resume results',
    text: `Thanks for trying the SimplyApply resume check.\n\nPlease confirm your email address so we can send your results and a few job-search tips:\n${confirmUrl}\n\nIf you didn't request this, you can ignore this message and nothing will be sent.`,
    html: `<p>Thanks for trying the SimplyApply resume check.</p><p>Please confirm your email address so we can send your results and a few job-search tips:</p><p><a href="${escapeHtml(confirmUrl)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Confirm my email</a></p><p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this message and nothing will be sent.</p>`,
  };
}

const jobsText = (jobs) => jobs.map((j) => `- ${j.title} at ${j.company_name}: ${j.apply_url}`).join('\n');
const jobsHtml = (jobs) => `<ul style="padding-left:18px">${jobs.map((j) => `<li style="margin-bottom:6px"><a href="${escapeHtml(j.apply_url)}">${escapeHtml(j.title)}</a> at ${escapeHtml(j.company_name)}</li>`).join('')}</ul>`;
const rolePhrase = (role) => (role ? ` ${role}` : '');

export function dripEmail(step, { role, score, fixes = [], jobs = [] }) {
  const site = SITE_URL();
  const hasJobs = jobs.length > 0;

  if (step === 1) {
    const fixText = fixes.length ? `\n\nTop things to fix:\n${fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '';
    const fixHtml = fixes.length ? `<p><strong>Top things to fix:</strong></p><ol>${fixes.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ol>` : '';
    const scoreLine = Number.isFinite(score) ? `Your resume scored ${score}/100 on our check.` : 'Here are your resume check results.';
    return {
      subject: 'Your resume check results',
      text: `${scoreLine}${fixText}${hasJobs ? `\n\nOpen${rolePhrase(role)} roles that match what you searched for:\n${jobsText(jobs)}` : ''}\n\nYou can run the check again anytime: ${site}/resume-check`,
      html: `<p>${escapeHtml(scoreLine)}</p>${fixHtml}${hasJobs ? `<p><strong>Open${escapeHtml(rolePhrase(role))} roles that match what you searched for:</strong></p>${jobsHtml(jobs)}` : ''}<p>You can run the check again anytime: <a href="${site}/resume-check">${site}/resume-check</a></p>`,
    };
  }

  if (step === 2) {
    const tips = [
      'Mirror the exact keywords from each job posting in your skills and bullets. Applicant tracking systems match on wording.',
      'Lead every bullet with what you did, then the measurable result (numbers, scale, time saved).',
      'Keep formatting simple: one column, standard section headings, no text inside images.',
    ];
    return {
      subject: `3 quick ways to tailor your resume${role ? ` for ${role}` : ''}`,
      text: `${tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}${hasJobs ? `\n\nFresh${rolePhrase(role)} roles to try these on:\n${jobsText(jobs)}` : ''}`,
      html: `<ol>${tips.map((t) => `<li style="margin-bottom:8px">${escapeHtml(t)}</li>`).join('')}</ol>${hasJobs ? `<p><strong>Fresh${escapeHtml(rolePhrase(role))} roles to try these on:</strong></p>${jobsHtml(jobs)}` : ''}`,
    };
  }

  if (step === 3) {
    return {
      subject: 'Stop retyping the same details on every application',
      text: `SimplyApply autofills job applications on Greenhouse, Lever, Ashby and more using your saved profile, so you fill in your details once.\n\nTake a look: ${site}`,
      html: `<p>SimplyApply autofills job applications on Greenhouse, Lever, Ashby and more using your saved profile, so you fill in your details once.</p><p><a href="${site}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">See how it works</a></p>`,
    };
  }

  return {
    subject: hasJobs ? `New${rolePhrase(role)} roles, and a last note from us` : 'A last note from us',
    text: `${hasJobs ? `Here are some open${rolePhrase(role)} roles:\n${jobsText(jobs)}\n\n` : ''}This is the last email in this series. You won't hear from us again unless you sign up for something else. Good luck with the search.`,
    html: `${hasJobs ? `<p><strong>Open${escapeHtml(rolePhrase(role))} roles:</strong></p>${jobsHtml(jobs)}` : ''}<p>This is the last email in this series. You won't hear from us again unless you sign up for something else. Good luck with the search.</p>`,
  };
}
