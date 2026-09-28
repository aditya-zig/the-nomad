// Extraction sequence check: flare, inbound, landing and boarding, with screenshots into $SC. usage: SC=dir node scripts/qa-heli.mjs
import { openPage, reportLogs, sleep } from './lib/browser.mjs';
const SC = process.env.SC;
const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: 1600, h: 900 });
const call = (fn, ...a) => page.evaluate(([f, x]) => window.__dead[f](...x), [fn, a]);
const shot = async (n, wait = 400) => { await sleep(wait); await page.screenshot({ path: `${SC}/h-${n}.png` }); };
const keepAt = async (secs, pos, look) => { for (let t = 0; t < secs; t += 0.25) { await call('setHealth', 100, 100); await call('teleport', pos[0], pos[1], 0); await call('lookAt', look[0], look[1], look[2]); await call('advance', 0.25); } };
try {
  await page.waitForFunction('window.__dead', null, { timeout: 60000 });
  await sleep(1500);
  await call('start'); await call('freeze', true); await call('clearZombies');
  await page.evaluate(() => { const ss = window.__dead.game.session; ss.defense.status = 'complete'; ss.defense.progress = 1; ss.defense.rewardClaimed = true; ss.hunt.status = 'complete'; ss.hunt.rewardClaimed = true; ss.hunt.identified = true; });
  const ex = await page.evaluate(() => window.__dead.game.level.data.extraction);
  await call('teleport', ex.terminalX - 1.5, ex.terminalZ, 0); await call('advance', 1);
  await shot('0-terminal', 300);
  await call('hold', { interact: true }); await call('advance', 2); await call('hold', { interact: false });
  const clear = async () => { await call('clearZombies'); };
  const phase = () => page.evaluate(() => window.__dead.game.session.extraction);
  const pos = [ex.lzX + 24, ex.lzZ + 14];
  const stepUntil = async (pred, max = 80, at = pos, look = [ex.lzX, ex.lzZ, 8]) => { for (let i = 0; i < max; i++) { await clear(); await keepAt(0.5, at, look); const e = await phase(); if (pred(e)) return e; } return await phase(); };
  await keepAt(6, pos, [ex.lzX, ex.lzZ, 3]); await shot('1-flare', 200);
  await stepUntil((e) => e.phase === 'inbound'); await keepAt(3, pos, [ex.lzX + 10, ex.lzZ - 8, 22]); await shot('2-inbound', 200);
  await keepAt(5, pos, [ex.lzX + 6, ex.lzZ, 18]); await shot('3-approach', 100);
  await stepUntil((e) => e.phase === 'landing'); await keepAt(2, pos, [ex.lzX, ex.lzZ, 14]); await shot('4-descending', 100);
  await keepAt(4, pos, [ex.lzX, ex.lzZ, 6]); await shot('4b-low', 100);
  await stepUntil((e) => e.phase === 'landed'); await keepAt(3, pos, [ex.lzX, ex.lzZ, 2]); await shot('5-landed', 200);
  const door = await page.evaluate(() => window.__dead.game.mission.heliDoorPos());
  console.log('door', JSON.stringify(door));
  await call('teleport', door.x + 3, door.z + 2.5, 0); await call('lookAt', door.x, door.z, 1.4); await call('advance', 0.4); await shot('6-door-close', 200);
  await call('teleport', door.x + 1.4, door.z + 0.6, 0); await call('lookAt', door.x, door.z, 1.3); await call('press', 'interact'); await call('advance', 0.5); await shot('7-boarding-a', 100);
  await call('advance', 1.2); await shot('8-boarding-b', 100);
  await call('advance', 1.0); await shot('9-boarding-c', 100);
  console.log('done');
} catch (e) { console.log('FAILED', e.stack || e.message); }
finally { reportLogs(logs, { warnings: false }); await browser.close(); }
