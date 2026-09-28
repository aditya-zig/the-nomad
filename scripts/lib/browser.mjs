// Shared headless-Chrome helper for screenshots and scripted QA (uses the locally installed Google Chrome).
import { chromium } from 'playwright-core';

export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Launch Chrome (hardware WebGL through ANGLE/Metal) and open `url`. Console output is collected in `logs`. */
export async function openPage({ url, w = 1280, h = 720, dpr = 1, args = [] } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...args],
  });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e && e.stack ? e.stack : e) }));
  page.on('requestfailed', (r) => logs.push({ type: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText ?? ''}` }));
  if (url) await page.goto(url, { waitUntil: 'load' });
  return { browser, context, page, logs };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Print collected console errors/warnings. Returns the number of errors. */
export function reportLogs(logs, { warnings = true } = {}) {
  let errors = 0;
  for (const l of logs) {
    if (l.type === 'error' || l.type === 'pageerror' || l.type === 'requestfailed') {
      errors++;
      console.log(`[${l.type}] ${l.text}`);
    } else if (warnings && l.type === 'warning') {
      console.log(`[warning] ${l.text}`);
    }
  }
  return errors;
}
