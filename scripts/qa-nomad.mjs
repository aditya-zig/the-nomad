// Connects to ONE externally memory-capped browser. Never launches an extra browser.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('../artifacts/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.NOMAD_CDP || 'http://127.0.0.1:9322');
const page = browser.contexts()[0].pages().find(p => p.url().includes(':5314'));
assert(page, 'Open the Nomad dev server in the capped browser first');
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
const check = (name, ok) => { assert(ok, name); results.push(name); console.log('PASS', name); };
await page.setViewportSize({ width: 1280, height: 800 });
await page.reload();
await page.waitForFunction(() => window.__dead?.snapshot().state === 'title', { timeout: 60000 });
await page.screenshot({ path: new URL('title-desktop.png', out).pathname });
for (const [name, width, height] of [['tablet', 768, 1024], ['mobile', 390, 844]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  check(`${name} title has no horizontal overflow`, await page.evaluate(() => {
    const title = document.querySelector('.ds-title');
    return title.scrollWidth <= title.clientWidth + 1;
  }));
  await page.screenshot({ path: new URL(`title-${name}.png`, out).pathname });
}
await page.setViewportSize({ width: 1280, height: 800 });
await page.getByRole('button', { name: 'Enter the wasteland', exact: true }).click();
await page.waitForFunction(() => window.__dead.snapshot().state === 'playing', { timeout: 15000 });
check('native deploy enters play with pointer lock', await page.evaluate(() => document.pointerLockElement?.id === 'game-canvas'));
check('audio context is running after user gesture', await page.evaluate(() => window.__dead.game.audio.ctxState === 'running'));
await page.evaluate(() => { window.__dead.freeze(true); });
const scenario = await page.evaluate(() => {
  const a = window.__dead;
  const g = a.game;
  const checks = {};
  a.clearZombies();
  const initial = g.session.nomad.cells;
  g.mission.activateTransmitter();
  checks.relayRejectsNoCells = g.session.nomad.cells === initial && g.session.defense.status === 'available';
  // Open the nearest two real caches using the normal hold interaction, not direct rewards.
  const crates = [...g.entities.crates].sort((c, d) => Math.hypot(c.def.x - g.player.x, c.def.z - g.player.z) - Math.hypot(d.def.x - g.player.x, d.def.z - g.player.z));
  for (const c of crates.slice(0, 2)) {
    a.teleport(c.def.x, c.def.z + 1.2);
    a.lookAt(c.def.x, c.def.z);
    a.hold({ interact: true });
    a.advance(1.2);
    a.hold({ interact: false });
    a.advance(.1);
  }
  checks.realCacheHoldGrantsCells = g.session.nomad.cells === 2 && g.session.stats.cratesOpened === 2;
  const once = g.session.nomad.cells;
  g.entities.openCrate(crates[0]);
  checks.cacheGrantsOnlyOnce = g.session.nomad.cells === once;
  // Trading post: open with E, then dispatch actual keyboard handlers for the new keys.
  const station = g.entities.stations.find(s => s.def.kind === 'buy');
  a.teleport(station.def.x, station.def.z + 1);
  a.lookAt(station.def.x, station.def.z);
  a.press('interact'); a.advance(.1);
  checks.tradingPostOpens = g.interaction.panelOpen;
  const digit = n => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${n}`, key: String(n), bubbles: true }));
    const edges = g.inputState.consume(.016);
    a.releaseAll();
    g.simulate(1 / 60, edges);
    document.dispatchEvent(new KeyboardEvent('keyup', { code: `Digit${n}`, key: String(n), bubbles: true }));
  };
  g.session.nomad.water = 5; g.session.nomad.food = 10;
  digit(7); digit(7);
  checks.emberSharesConsumeCells = g.session.nomad.cells === 0 && g.session.nomad.trust.ember === 60 && g.session.nomad.cellsShared === 2;
  checks.emberRestoresSurvivalSupplies = g.session.nomad.water > 80 && g.session.nomad.food > 75;
  const cash = g.session.inv.cash;
  digit(9);
  checks.refillCostsExactly100 = g.session.inv.cash === cash - 100 && g.session.nomad.water > 99 && g.session.nomad.food > 99;
  a.closePanel();
  // More real cache openings provide the rest of the route, with no test-only cell grants.
  for (const c of crates.filter(c => !c.opened).slice(0, 5)) g.entities.openCrate(c);
  const beforeRelay = g.session.nomad.cells;
  g.mission.activateTransmitter();
  g.mission.activateTransmitter();
  checks.relayCostsOnlyTwo = g.session.nomad.cells === beforeRelay - 2 && g.session.defense.status === 'active';
  g.session.defense.status = 'complete';
  g.session.hunt.status = 'complete';
  a.advance(.1);
  checks.extractionUnlocksWithAllRequirements = g.mission.terminalState() === 'available';
  const beforeRemoteCall = g.session.nomad.cells;
  a.teleport(-51, 43.5);
  checks.remoteExtractionCannotSpend = !g.mission.callExtraction() && g.session.nomad.cells === beforeRemoteCall;
  const lz = g.level.data.extraction;
  a.teleport(lz.lzX, lz.lzZ);
  checks.extractionChargesCargoOnce = g.mission.callExtraction() && g.session.nomad.cells === beforeRemoteCall - 3;
  const loadedCells = g.session.nomad.cells;
  checks.duplicateExtractionRejected = !g.mission.callExtraction() && g.session.nomad.cells === loadedCells;
  const water = g.session.nomad.water;
  g.pause('menu');
  g.frameOnce(1);
  checks.pauseFreezesSupplies = g.session.nomad.water === water;
  a.start();
  checks.restartResetsNomad = g.session.nomad.cells === 0 && g.session.nomad.trust.ember === 20 && !g.session.nomad.cargoLoaded;
  return checks;
});
for (const [name, ok] of Object.entries(scenario)) check(name, ok);
await page.evaluate(() => {
  const a = window.__dead;
  const g = a.game;
  a.clearZombies();
  a.teleport(-34, 33, 0);
  a.spawnZombie('runner', -33.5, 26.5, false);
  a.spawnZombie('shambler', -32, 23, false);
  a.lookAt(-33.5, 26.5);
  a.advance(.1);
  g.frameOnce(0);
});
await page.screenshot({ path: new URL('combat-desktop.png', out).pathname });
const performance = await page.evaluate(() => {
  const a = window.__dead;
  const gl = a.game.renderer.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', snapshot: a.snapshot() };
});
check('no runtime errors', errors.length === 0);
await writeFile(new URL('qa-nomad.json', out), JSON.stringify({ checks: results, errors, performance, note: 'Deterministic QA uses explicitly named teleport / clear / contract-state helpers. Native deploy, cache holds, keyboard trade handlers and resource gates use real game paths.' }, null, 2));
console.log(`Saved ${results.length} checks and screenshots in artifacts/`);
// CDP disconnect only; browser lifetime is owned by systemd.
await browser.close();
