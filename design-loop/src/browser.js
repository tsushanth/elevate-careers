import { chromium } from 'playwright';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// Captures a screenshot; returns null (rather than throwing) on failure so
// callers can degrade to cached reference shots (LinkedIn anti-bot risk).
export async function capture(url, viewportName, outPath) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[viewportName] });
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2000);
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
