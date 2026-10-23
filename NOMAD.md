# Ashfall Run: modification and validation notes

## Provenance

Base: `bridge-mind/sonnet-5-5-zombies-game`, shallow-cloned using GitHub CLI. Upstream revision: `9294d67a8548cb851acfd1a5aafdc6d68b008ee4`. Local working branch: `mod/nomad-ashfall`. Personal repository: https://github.com/aditya-zig/the-nomad (private). The original repository is retained as the `upstream` remote; no changes are pushed to it.

The original game provides the procedural industrial district, weapon/viewmodel system, enemy rigs and AI, renderer architecture, audio synthesis, extraction helicopter, collision/navigation and base UI. Original notices remain in `LICENSE`; the original README is preserved as `UPSTREAM.md`.

## Added or modified for Nomad

- New power-cell economy: salvage yields depend on threat region; the relay consumes two cells; extraction cargo consumes three.
- Ember Union / Iron Vultures trust, explicit cell-sharing choices, and different survival / combat rewards. An alliance is required for extraction.
- Food and water depletion, sprint-dependent thirst, starvation damage, cache replenishment and paid resupply.
- Physical emissive battery bundles on unopened caches. Shared low-poly geometry and materials; no additional dynamic lights or downloaded assets.
- Cell/alliance navigation markers, objective status, expedition HUD, trading entries and end-of-run reporting.
- Ash-colored haze, warm lighting, redesigned Nomad title and briefing, and separate local-storage keys.
- An integrated-GPU Medium preset, with existing dynamic-resolution adaptation retained.
- Pure rule tests, repeatable browser QA, real-audio recording tooling and an optional memory-capped Linux launcher.

No new runtime libraries were added. `ASSETS.md` still describes the upstream assets and dependencies.

## Validation performed

- `npm run build`: PASS (TypeScript checks and production Vite build).
- `npm test -- --maxWorkers=1`: **103 tests pass across 10 files**.
- `git diff --check`: PASS.
- `bash -n scripts/play-safe.sh`: PASS. The packaged launcher was syntax-checked, not re-launched after closing the test browser. Equivalent systemd resource limits were used throughout browser testing.
- Production bundle scan: no `__dead` or recording-helper hooks found.
- `scripts/qa-nomad.mjs`: **19 browser checks pass**, including native pointer-lock deployment, audio activation, cache hold interactions, one-time loot, real digit-key handlers, cell spending, clan trust, paid refill, extraction cargo guards, pause and restart.
- Title screens inspected at 1280×800, 768×1024 and 390×844. No horizontal overflow. Phone menu scrolls; touch gameplay is not implemented. Desktop side controls also scroll on short screens rather than clipping.
- Visible enemies and nine-entry trading menu inspected in screenshots. The full site-style inspector was not run: this is an existing game interface, and its independent browser launch would violate the one-test-browser memory policy.

Browser: installed Google Chrome, actual AMD Radeon hardware WebGL via ANGLE/OpenGL (not software rendering). Test browser process tree was capped at 1280 MiB with zero swap; development server at 384 MiB. The process-tree peak reached the browser cap without terminating the test. This is not a GPU memory bound or a guarantee against all system memory pressure. The owned browser was stopped afterward; unrelated applications were untouched.

Sample instantaneous FPS readings were approximately 41 in the frozen QA scene and 52 at the end of the recording, at 1280×800 Medium. These are limited scene observations, **not a full-map performance benchmark**.

## Recording

Local output: `artifacts/nomad-gameplay-with-audio.mp4` — approximately 25 seconds, 960×600, H.264 + AAC, 4.8 MB.

The footage captures the real browser tab including HUD. Audio is tapped from the actual game WebAudio master, not a replacement soundtrack. The encoded file was checked with ffprobe and volumedetect: audio mean −20.1 dB, maximum −1.4 dB (not silent). The run collected two caches, donated two cells to Ember, fired actual weapon rounds and registered five kills.

The demo is **staged**, not an uninterrupted campaign playthrough: QA teleports join locations and QA-spawned enemies stage combat. Browser QA also uses explicit contract-state helpers to reach extraction checks quickly. A complete natural, unassisted campaign and the entire helicopter victory cinematic were **not re-played** for this adaptation.

Local screenshots / machine-readable evidence:

- `artifacts/title-desktop.png`, `title-tablet.png`, `title-mobile.png`
- `artifacts/combat-desktop.png`, `visible-enemies.png`, `clan-exchange.png`
- `artifacts/qa-nomad.json`, `recording-info.json`

Artifacts are excluded from git. Preserve the MP4 separately if sharing this checkout.

## Repeating browser QA

Use one isolated browser with remote debugging at `127.0.0.1:9322`, under the limits above, with the Vite dev server at `127.0.0.1:5314`. Then run:

```bash
node scripts/qa-nomad.mjs
node scripts/record-nomad.mjs
```

These scripts connect to the existing browser; they do not launch another. The recording script writes timestamped JPEG frames and game audio. To encode:

```bash
ffmpeg -f concat -safe 0 -i artifacts/recording-frames/frames.ffconcat \
  -i artifacts/game-audio.webm -vf 'fps=24,scale=960:600' \
  -c:v libx264 -preset veryfast -crf 22 -threads 2 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -shortest -movflags +faststart \
  artifacts/nomad-gameplay-with-audio.mp4
```

Run build/test/encoding under process limits on small-memory machines. Do not run additional game/browser instances concurrently. Chrome remote debugging is for local QA only; the normal safe launcher does not enable it.
