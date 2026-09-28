#!/usr/bin/env node
// Screenshot helper.
//   node scripts/shot.mjs <url> <out.png> [--w 1280] [--h 720] [--dpr 1] [--wait 1500]
//        [--waitfor "js expression that becomes truthy"] [--eval "js run before the shot"]
//        [--shot "out2.png::js to run first::wait ms"]...   (extra shots after the first; js and wait optional)
//        [--print "js expression whose JSON result is printed"] [--logs] [--nowarn]
// Prints console errors / page errors so broken pages are obvious.
import { openPage, reportLogs, sleep } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const positional = [];
const opts = { shot: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'logs' || key === 'nowarn') { opts[key] = true; continue; }
    const val = argv[++i];
    if (key === 'shot') opts.shot.push(val); else opts[key] = val;
  } else positional.push(a);
}
const [url, out] = positional;
if (!url || !out) { console.error('usage: node scripts/shot.mjs <url> <out.png> [options]'); process.exit(2); }

const { browser, page, logs } = await openPage({ url, w: +(opts.w ?? 1280), h: +(opts.h ?? 720), dpr: +(opts.dpr ?? 1) });
try {
  if (opts.waitfor) await page.waitForFunction(opts.waitfor, null, { timeout: 45000 });
  await sleep(+(opts.wait ?? 1500));
  if (opts.eval) await page.evaluate(opts.eval);
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  for (const spec of opts.shot) {
    const [path, js, wait] = spec.split('::');
    if (js) await page.evaluate(js);
    await sleep(+(wait ?? 500));
    await page.screenshot({ path });
    console.log(`saved ${path}`);
  }
  if (opts.print) console.log('print:', JSON.stringify(await page.evaluate(opts.print)));
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  const errors = reportLogs(logs, { warnings: !opts.nowarn });
  if (opts.logs) for (const l of logs) if (l.type === 'log' || l.type === 'info') console.log(`[${l.type}] ${l.text}`);
  await browser.close();
  process.exitCode = errors ? 1 : 0;
}
