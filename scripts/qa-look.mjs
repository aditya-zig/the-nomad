// Quick visual check: deploy at a position and take screenshots. usage: node scripts/qa-look.mjs out-prefix "x,z,yaw,pitch" ...
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const SC = process.env.SC;
const prefix = process.argv[2] || 'look';
const views = process.argv.slice(3).map((v) => v.split(',').map(Number));
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: W, h: H });
const call = (fn, ...args) => page.evaluate(([f, a]) => window.__dead[f](...a), [fn, args]);
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start');
  await call('advance', 0.5);
  let i = 0;
  for (const [x, z, yaw, pitch = 0] of views) {
    await call('teleport', x, z, yaw);
    await call('look', yaw, pitch);
    await call('advance', 0.8);
    await sleep(900);
    await page.screenshot({ path: `${SC}/${prefix}-${i++}.png` });
  }
  console.log('saved', i, 'shots');
} catch (e) { console.log('FAILED', e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
