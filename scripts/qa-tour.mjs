// Visual tour: teleport to key locations and screenshot each. usage: SC=dir node scripts/qa-tour.mjs prefix name:x,z,yaw,pitch ...
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const SC = process.env.SC;
const prefix = process.argv[2];
const stops = process.argv.slice(3).map((a) => { const [name, v] = a.split(':'); const [x, z, yaw, pitch = 0] = v.split(',').map(Number); return { name, x, z, yaw, pitch }; });
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: W, h: H });
const call = (fn, ...a) => page.evaluate(([f, x]) => window.__dead[f](...x), [fn, a]);
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start'); await call('freeze', true); await call('clearZombies');
  if (process.env.ZOMBIES) await page.evaluate(() => { const g = window.__dead.game; g.zombies.populate(g.rng); });
  await page.evaluate(() => { window.__dead.game.hud.setVisible(false); });
  for (const s of stops) {
    await call('teleport', s.x, s.z, s.yaw); await call('look', s.yaw, s.pitch);
    await call('advance', 0.6); await sleep(700);
    await page.screenshot({ path: `${SC}/${prefix}-${s.name}.png` });
  }
  console.log('done', stops.length);
} catch (e) { console.log('FAILED', e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
