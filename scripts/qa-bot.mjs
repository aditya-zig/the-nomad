#!/usr/bin/env node
// Plays the whole mission with the QA bot and prints progress. usage: node scripts/qa-bot.mjs [runs] [--shots dir]
import { readFileSync } from 'node:fs';
import { openPage, reportLogs, sleep } from './lib/browser.mjs';

const runs = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 1);
const shotDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const botSrc = readFileSync(new URL('./lib/bot.js', import.meta.url), 'utf8');
const results = [];

for (let r = 0; r < runs; r++) {
  const { browser, page, logs } = await openPage({ url: 'http://127.0.0.1:5173/', w: 1280, h: 720 });
  try {
    await page.waitForFunction('window.__dead', null, { timeout: 90000 });
    await sleep(1200);
    await page.evaluate(() => { window.__dead.start(); window.__dead.freeze(true); });
    await page.evaluate((src) => { (0, eval)(src); }, botSrc);
    await page.evaluate((seed) => { const g = window.__dead.game; g.rng = new g.rng.constructor(seed); g.zenv.rng = g.rng; }, 1000 + r * 77);
    const t0 = Date.now();
    let last = '';
    for (let chunk = 0; chunk < 400; chunk++) {
      const s = await page.evaluate(() => window.__bot.run(15));
      const line = `t=${s.elapsed}s hp=${s.hp}/${s.armor} $${s.cash} kills=${s.kills} acc=${s.accuracy} phase=${s.phase} defense=${s.defense} hunt=${s.hunt} ex=${s.extraction} region=${s.region} pos=${s.pos}`;
      if (line !== last) console.log(`  run${r + 1} ${line}`);
      last = line;
      if (shotDir && chunk % 8 === 0) await page.screenshot({ path: `${shotDir}/bot-r${r + 1}-${String(chunk).padStart(3, '0')}.png` });
      if (s.state !== 'playing' || s.ended) { results.push({ run: r + 1, ...s, wall: ((Date.now() - t0) / 1000).toFixed(0) + 's' }); break; }
      if (s.elapsed > 900) { results.push({ run: r + 1, ...s, timeout: true }); break; }
    }
    const trace = await page.evaluate(() => window.__bot.trace.slice(-14));
    console.log('  trace (last 28 s):\n   ' + trace.join('\n   '));
    const log = await page.evaluate(() => window.__bot.log.slice(-15));
    if (log.length) console.log('  bot notes:\n   ' + log.join('\n   '));
    await sleep(500);
  } catch (e) {
    console.log('run failed', e.message);
  } finally {
    reportLogs(logs, { warnings: false });
    await browser.close();
  }
}
console.log('\n=== results ===');
for (const r of results) console.log(JSON.stringify({ run: r.run, outcome: r.ended && r.ended.outcome, reason: r.ended && r.ended.reason, time: r.elapsed, kills: r.kills, headshots: r.headshots, accuracy: r.accuracy, cashEarned: r.cashEarned, tiers: r.tiers, crates: r.crates, phase: r.phase, stuck: r.botStats && r.botStats.stuckEvents, plates: r.botStats && r.botStats.plateUses }));
