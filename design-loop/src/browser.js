import { chromium } from 'playwright';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// Captures a screenshot; returns null (rather than throwing) on failure so
// callers can degrade to cached reference shots (LinkedIn anti-bot risk).
// `login` (email/password) signs in via AuthModal before navigating to `postLoginTab`.
// `scrollTo` scrolls the viewport before the shot (e.g. past the hero to the job list).
export async function capture(url, viewportName, outPath, { login, postLoginTab, scrollTo } = {}) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[viewportName] });
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2000);

    if (login) {
      await page.click('text=Sign In', { timeout: 10_000 });
      await page.fill('input[type="email"]', login.email);
      await page.fill('input[type="password"]', login.password);
      await page.click('.auth-submit');
      await page.waitForTimeout(2500);
    }
    if (postLoginTab) {
      await page.click(`a[href="#${postLoginTab}"]`, { timeout: 10_000 });
      await page.waitForTimeout(1500);
    }
    if (scrollTo) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: outPath, type: 'png', fullPage: false });
    return outPath;
  } catch (err) {
    console.error(`[capture] failed for ${url} (${viewportName}): ${err.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

export { VIEWPORTS };
