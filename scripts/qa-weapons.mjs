// Weapon presentation shots in the real game: ADS, fire, reload, sprint, pistol, shotgun, grenade, plate.
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const SC = process.env.SC;
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: 1600, h: 900 });
const call = (fn, ...a) => page.evaluate(([f, x]) => window.__dead[f](...x), [fn, a]);
const shot = async (n, wait = 350) => { await sleep(wait); await page.screenshot({ path: `${SC}/w-${n}.png` }); };
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start'); await call('freeze', true); await call('clearZombies');
  await call('teleport', -20, 22.5, -Math.PI / 2); await call('look', -Math.PI / 2, 0.0);
  const z = await call('spawnZombie', 'shambler', -8, 22.5, false);
  await call('advance', 1.2); await shot('1-hip');
  await call('hold', { ads: true }); await call('advance', 0.5); await shot('2-ads');
  await call('hold', { fire: true }); await call('advance', 0.12); await shot('3-fire-ads', 50); await call('hold', { fire: false, ads: false });
  await call('advance', 0.8);
  await call('hold', { fire: true }); await call('advance', 0.1); await shot('4-fire-hip', 30); await call('advance', 0.2); await call('hold', { fire: false });
  await call('advance', 1); await call('press', 'reload'); await call('advance', 0.5); await shot('5-reload-a', 200); await call('advance', 0.6); await shot('5-reload-b', 200); await call('advance', 0.5); await shot('5-reload-c', 200);
  await call('advance', 2);
  await call('hold', { forward: 1, sprint: true }); await call('advance', 0.6); await shot('6-sprint', 150); await call('releaseAll'); await call('advance', 0.5);
  await call('press', 'slot2'); await call('advance', 0.8); await shot('7-pistol');
  await call('hold', { ads: true }); await call('advance', 0.4); await shot('8-pistol-ads'); await call('hold', { ads: false });
  await call('press', 'slot1'); await call('advance', 0.8);
  await call('give', { cash: 9000 });
  await page.evaluate(() => { const inv = window.__dead.game.session.inv; const { createCarried } = window.__dead; });
  // shotgun via the real purchase path
  const buy = await page.evaluate(() => window.__dead.game.level.data.stations.find((x) => x.kind === 'buy'));
  await call('teleport', buy.x - Math.sin(buy.yaw) * 2, buy.z - Math.cos(buy.yaw) * 2, buy.yaw + Math.PI); await call('advance', 0.3);
  await call('press', 'interact'); await call('advance', 0.2); await shot('9-buy-panel', 200);
  await call('press', 'wheel'); await call('advance', 0.7); await call('digit', 5); await call('advance', 0.3); await call('closePanel');
  await call('teleport', -20, 22.5, -Math.PI / 2); await call('look', -Math.PI / 2, 0); await call('advance', 1.2); await shot('10-shotgun');
  await call('click'); await call('advance', 0.05); await shot('11-shotgun-fire', 20);
  await call('advance', 0.5); await shot('12-shotgun-pump', 100);
  await call('hold', { ads: true }); await call('advance', 0.5); await shot('13-shotgun-ads'); await call('hold', { ads: false });
  await call('press', 'reload'); await call('advance', 0.9); await shot('14-shotgun-reload', 100);
  await call('advance', 4);
  await call('press', 'grenade'); await call('advance', 0.2); await shot('15-grenade-a', 100); await call('advance', 0.35); await shot('15-grenade-b', 60);
  await call('advance', 3.5); await shot('16-explosion', 80);
  await call('press', 'plate'); await call('advance', 0.8); await shot('17-plate', 100);
  console.log('done');
} catch (e) { console.log('FAILED', e.stack || e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
