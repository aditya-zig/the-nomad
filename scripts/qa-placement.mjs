// Prints the level placement report (blocked / unreachable points) and runs the level validator. usage: node scripts/qa-placement.mjs
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: 1280, h: 720 });
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1000);
  console.log(JSON.stringify(await page.evaluate(() => window.__dead.game.level.placement), null, 1));
  console.log(JSON.stringify(await page.evaluate(() => window.__dead.validateLevel()), null, 1));
} catch (e) { console.log('FAILED', e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
