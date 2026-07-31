import { chromium } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { fillerFn } from './filler.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runApply({ jobUrl, profile, jobDescription, dryRun = false }) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  try {
    // Expose AI answer function to the browser page context
    await page.exposeFunction('getAIAnswer', async (question, jobDesc) => {
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: `You are helping fill out a job application form. Answer this field concisely and professionally.

Job description context:
${jobDesc || 'Not provided'}

Applicant profile summary:
Name: ${profile.firstName} ${profile.lastName}
Current role: ${profile.currentTitle || 'Software Engineer'}
Years of experience: ${profile.yearsOfExperience || 'several'}
Key skills: ${(profile.skills || []).join(', ')}

Field to answer: "${question}"

Rules:
- If the question is a yes/no about work authorization or sponsorship, answer based on profile.workAuth and profile.sponsorship fields.
- For open-ended questions, write 2-4 sentences in first person.
- For "how did you hear about us", say "Job board".
- Return ONLY the answer text, no preamble.`,
          }],
        });
        return msg.content[0]?.text?.trim() || null;
      } catch (e) {
        console.error('[getAIAnswer] error:', e.message);
        return null;
      }
    });

    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30_000 });

    // Give SPA forms a moment to hydrate
    await page.waitForTimeout(1500);

    // Serialize the filler function to a string for page.evaluate
    const fillerStr = fillerFn.toString();

    const result = await page.evaluate(
      new Function('args', `return (${fillerStr})(args)`),
      { profile, jobDescription, dryRun }
    );

    // Screenshot for the review UI (base64 PNG)
    const screenshotBuf = await page.screenshot({ type: 'png', fullPage: false });
    const screenshot = screenshotBuf.toString('base64');

    // Extract company from URL
    const company = extractCompany(jobUrl);

    return { ...result, screenshot, company, jobUrl };
  } finally {
    await browser.close();
  }
}

function extractCompany(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('greenhouse.io')) {
      const forParam = u.searchParams.get('for');
      if (forParam) return forParam;
      const seg = u.pathname.split('/').find(s => s && s !== 'embed' && s !== 'job_app');
      return seg || null;
    }
    if (u.hostname.includes('lever.co')) return u.pathname.split('/')[1] || null;
    if (u.hostname.includes('ashbyhq.com')) return u.pathname.split('/')[1] || null;
    if (u.hostname.includes('myworkdayjobs.com')) return u.hostname.split('.')[0];
    const parts = u.hostname.replace(/^www\./, '').split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  } catch { return null; }
}
