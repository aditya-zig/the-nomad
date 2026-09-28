// HUD / mission-state visual checks with real game data.
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const SC = process.env.SC;
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: 1600, h: 900 });
const call = (fn, ...a) => page.evaluate(([f, x]) => window.__dead[f](...x), [fn, a]);
const shot = async (n, wait = 500) => { await sleep(wait); await page.screenshot({ path: `${SC}/s-${n}.png` }); };
const keep = async (secs, at) => { for (let t = 0; t < secs; t += 0.25) { await call('setHealth', 100, 100); if (at) await call('teleport', ...at); await call('advance', 0.25); } };
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start'); await call('freeze', true); await call('clearZombies');
  // station panel
  const buy = await page.evaluate(() => window.__dead.game.level.data.stations.find((x) => x.kind === 'buy'));
  await call('teleport', buy.x - Math.sin(buy.yaw) * 2, buy.z - Math.cos(buy.yaw) * 2, buy.yaw + Math.PI); await call('advance', 0.5);
  await shot('1-station-prompt');
  await call('press', 'interact'); await call('advance', 0.3); await shot('2-station-panel');
  await call('closePanel');
  // tactical map
  await call('press', 'map'); await call('advance', 0.2); await shot('3-tactical-map', 700);
  await call('press', 'map'); await call('advance', 0.2);
  // spire from the LZ side
  await call('teleport', -30, 5, -1.2); await call('look', -1.2, 0.35); await call('advance', 0.5); await shot('4-spire-view');
  // warden hall
  await page.evaluate(() => { const g = window.__dead.game; g.zombies.clearAll(); g.zombies.populate(g.rng); });
  await call('teleport', 30, -33, 0); await call('look', 0, 0.02); await call('advance', 1.0); await shot('5-lab-hall-warden');
  await call('teleport', 30, -36, 0); await call('look', 0, 0.05); await call('advance', 1.5); await shot('6-warden-close');
  // hazard: surge state near the compound
  await call('teleport', 44, -14, 0.8); await call('setElapsed', 520); await call('advance', 3); await shot('7-surge-compound');
  await call('teleport', 54, -14, 3.1); await call('look', 3.1, 0.1); await call('setElapsed', 560); await keep(4); await shot('8-inside-toxic');
  // extraction: helicopter
  await call('setElapsed', 100);
  await page.evaluate(() => { const g = window.__dead.game; g.zombies.clearAll(); const ss = g.session; ss.defense.status = 'complete'; ss.defense.progress = 1; ss.defense.rewardClaimed = true; ss.hunt.status = 'complete'; ss.hunt.rewardClaimed = true; ss.hunt.identified = true; });
  const ex = await page.evaluate(() => window.__dead.game.level.data.extraction);
  await call('teleport', ex.terminalX - 1.5, ex.terminalZ, -Math.PI / 2); await call('advance', 1);
  await shot('9-terminal-available');
  await call('hold', { interact: true }); await call('advance', 2); await call('hold', { interact: false });
  await keep(20, [ex.terminalX - 1.5, ex.terminalZ, 1.57]); await call('look', 1.57, 0.25); await shot('10-called-flare');
  await keep(22, [ex.terminalX - 1.5, ex.terminalZ, 1.57]);
  await call('look', -0.6, 0.5); await keep(8, [ex.lzX + 14, ex.lzZ + 6, -0.6]); await shot('11-heli-inbound');
  await call('look', -1.2, 0.15); await keep(6, [ex.lzX + 10, ex.lzZ + 8, -1.2]); await shot('12-heli-landing');
  await call('look', -1.2, 0.05); await keep(6, [ex.lzX + 12, ex.lzZ + 8, -1.2]); await shot('13-heli-landed');
  console.log('done');
} catch (e) { console.log('FAILED', e.stack || e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
