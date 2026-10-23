// Staged demo of REAL gameplay: cache holds, clan trading and weapon hits. Scene changes use QA teleports.
// Captures the complete tab (including HUD) via CDP and taps the game's actual WebAudio master for sound.
// Connects to the existing capped browser; never launches a second one.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';

const out = new URL('../artifacts/', import.meta.url);
const frames = new URL('recording-frames/', out);
await mkdir(frames, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.NOMAD_CDP || 'http://127.0.0.1:9322');
const page = browser.contexts()[0].pages().find(p => p.url().includes(':5314'));
if (!page) throw new Error('Open the Nomad dev server in the capped browser first');
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForFunction(() => !!window.__dead);
await page.evaluate(async () => {
  const a = window.__dead;
  a.start(); a.freeze(true); a.clearZombies();
  const g = a.game;
  await g.audio.init(); await g.audio.ctx.resume();
  const dest = g.audio.ctx.createMediaStreamDestination();
  const analyser = g.audio.ctx.createAnalyser();
  analyser.fftSize = 256;
  g.audio.master.connect(dest);
  g.audio.master.connect(analyser);
  const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  window.__recording = { recorder, chunks, dest, analyser, peak: 0, samples: new Float32Array(256) };
  window.__recording.meter = setInterval(() => {
    const r = window.__recording;
    r.analyser.getFloatTimeDomainData(r.samples);
    for (const v of r.samples) r.peak = Math.max(r.peak, Math.abs(v));
  }, 50);
  // Face the first physical power cache, with visible emissive cells on its lid.
  const c = g.entities.crates[0];
  a.teleport(c.def.x - Math.sin(c.def.yaw) * 1.7, c.def.z - Math.cos(c.def.yaw) * 1.7);
  a.lookAt(c.def.x, c.def.z, .95);
  a.advance(.1); g.frameOnce(0);
  recorder.start(500);
});
const cdp = await page.context().newCDPSession(page);
const shots = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const name = `frame-${String(shots.length).padStart(5, '0')}.jpg`;
  writeFileSync(new URL(name, frames), Buffer.from(data, 'base64'));
  shots.push({ name, time: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 960, maxHeight: 600, everyNthFrame: 2 });
await page.evaluate(() => window.__dead.freeze(false));
await page.waitForTimeout(1800);
await page.evaluate(() => { window.__dead.hold({ interact: true }); window.__dead.advance(1 / 60); });
await page.waitForTimeout(1700);
await page.evaluate(() => {
  const a = window.__dead, g = a.game;
  a.releaseAll();
  const c = g.entities.crates[1];
  a.teleport(c.def.x - Math.sin(c.def.yaw) * 1.7, c.def.z - Math.cos(c.def.yaw) * 1.7);
  a.lookAt(c.def.x, c.def.z, .95);
});
await page.waitForTimeout(1300);
await page.evaluate(() => { window.__dead.hold({ interact: true }); window.__dead.advance(1 / 60); });
await page.waitForTimeout(1700);
await page.evaluate(() => {
  const a = window.__dead, g = a.game;
  a.releaseAll();
  const s = g.entities.stations.find(s => s.def.kind === 'buy');
  a.teleport(s.def.x - Math.sin(s.def.yaw) * 1.6, s.def.z - Math.cos(s.def.yaw) * 1.6);
  a.lookAt(s.def.x, s.def.z, 1.1);
  a.press('interact'); a.advance(1 / 60);
});
await page.waitForTimeout(1600);
await page.screenshot({ path: new URL('clan-exchange.png', out).pathname });
await page.evaluate(() => { window.__dead.digit(7); window.__dead.advance(1 / 60); });
await page.waitForTimeout(1100);
await page.evaluate(() => { window.__dead.digit(7); window.__dead.advance(1 / 60); });
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const a = window.__dead;
  a.closePanel(); a.releaseAll();
  a.teleport(-34, 33);
  a.lookAt(-33.5, 26.5);
  a.spawnZombie('runner', -33.5, 26.5, true);
  a.spawnZombie('shambler', -32, 23, true);
  a.spawnZombie('armored', -35, 20, true);
});
await page.waitForTimeout(1800);
await page.screenshot({ path: new URL('visible-enemies.png', out).pathname });
await page.evaluate(() => {
  const a = window.__dead, g = a.game;
  window.__demoAim = setInterval(() => {
    const target = g.zombies.zombies.filter(z => z.alive && !z.dormant)
      .sort((x, y) => Math.hypot(x.x - g.player.x, x.z - g.player.z) - Math.hypot(y.x - g.player.x, y.z - g.player.z))[0];
    if (target) { a.lookAt(target.x, target.z, 1.55); g.inputState.fireHeld = true; }
    else a.releaseAll();
  }, 90);
});
await page.waitForTimeout(5800);
await page.evaluate(() => {
  clearInterval(window.__demoAim);
  window.__dead.releaseAll();
  window.__dead.press('reload'); window.__dead.advance(1 / 60);
});
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const a = window.__dead;
  a.spawnZombie('runner', -33, 22, true);
  a.lookAt(-33, 22);
  a.hold({ ads: true }); a.advance(1 / 60);
});
await page.waitForTimeout(700);
await page.evaluate(() => { window.__dead.hold({ fire: true }); window.__dead.advance(1 / 60); });
await page.waitForTimeout(1800);
await page.evaluate(() => { window.__dead.releaseAll(); window.__dead.freeze(true); });
await page.waitForTimeout(500);
await cdp.send('Page.stopScreencast');
const recording = await page.evaluate(async () => {
  const r = window.__recording;
  clearInterval(r.meter);
  await new Promise(resolve => { r.recorder.onstop = resolve; r.recorder.stop(); });
  const blob = new Blob(r.chunks, { type: 'audio/webm' });
  const data = await new Promise(resolve => { const f = new FileReader(); f.onload = () => resolve(f.result); f.readAsDataURL(blob); });
  window.__dead.game.audio.master.disconnect(r.dest);
  window.__dead.game.audio.master.disconnect(r.analyser);
  return { data, peak: r.peak, snapshot: window.__dead.snapshot() };
});
await writeFile(new URL('game-audio.webm', out), Buffer.from(recording.data.split(',')[1], 'base64'));
let concat = '';
for (let i = 0; i < shots.length; i++) {
  concat += `file '${shots[i].name}'\n`;
  if (i + 1 < shots.length) concat += `duration ${Math.max(.001, shots[i + 1].time - shots[i].time).toFixed(6)}\n`;
}
if (shots.length) concat += `file '${shots.at(-1).name}'\n`;
await writeFile(new URL('frames.ffconcat', frames), concat);
await writeFile(new URL('recording-info.json', out), JSON.stringify({
  frames: shots.length, duration: shots.at(-1).time - shots[0].time,
  audioPeak: recording.peak, snapshot: recording.snapshot,
  staging: 'Scene teleports and QA-spawned enemies. Cell collection, two Ember donations, ammunition use, hits, damage and kills are real gameplay. No fake footage or replacement soundtrack.',
}, null, 2));
console.log('Recording complete:', shots.length, 'frames; audio peak:', recording.peak, 'kills:', recording.snapshot.kills, 'cells shared:', recording.snapshot.nomad.cellsShared);
await browser.close();
