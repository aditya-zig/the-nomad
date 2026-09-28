// Frame-time and draw-call check at a few spots in the district. usage: node scripts/qa-perf.mjs [width] [height]  (needs `pnpm dev`)
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const [, , W = '1920', H = '1080'] = process.argv;
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: +W, h: +H });
const call = (fn, ...args) => page.evaluate(([f, a]) => window.__dead[f](...a), [fn, args]);
const snap = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__dead.snapshot())));
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start');
  await call('advance', 0.2);
  for (const [name, x, z, yaw] of [['spawn', -51, 43.5, -0.98], ['street', -20, 22, -1.5], ['center', 0, 6, 0], ['depot lane', 20, 20.4, -1.57], ['compound yard', 27, -14, 0]]) {
    await call('teleport', x, z, yaw);
    await sleep(1800);
    const s = await snap();
    console.log(`${name.padEnd(14)} fps ${s.fps}  cpu sim ${s.cpuSimMs}ms render ${s.cpuRenderMs}ms  draws ${s.draws}  tris ${(s.triangles / 1000).toFixed(0)}k  zombies active ${s.zombies.active}`);
  }
} catch (e) { console.log('FAILED', e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
