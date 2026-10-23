# THE NOMAD: Survive the Wastelands

**Ashfall Run** — a single-player 3D browser survival shooter. Scavenge power cells, make clan alliances, fight the infected, and bring your caravan home.

A substantial local adaptation of [DEAD SIGNAL: EXCLUSION ZONE](https://github.com/bridge-mind/sonnet-5-5-zombies-game) by bridge-mind. The original Three.js combat, procedural models, world and synthesized audio remain the foundation; the new expedition mechanics and presentation are described below. Original documentation: [UPSTREAM.md](UPSTREAM.md). Original notices remain in [LICENSE](LICENSE).

## Play

Node 22.12+, pnpm, and a desktop browser with hardware-accelerated WebGL 2 are required.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed localhost address. Click **ENTER THE WASTELAND** to capture the mouse and enable sound. **Esc** pauses; headphones recommended. Menus adapt to smaller screens, but gameplay requires keyboard and mouse, not touch.

### Memory-capped Linux launcher

```bash
pnpm play:safe
```

This starts one isolated Chrome/Chromium game browser at **http://127.0.0.1:5314**, capped at **1280 MiB RAM / no swap**, and a server capped at 384 MiB. It refuses a second launcher-owned browser or less than 1.8 GiB available RAM. It never closes other apps. Requires a systemd user session and X11/XWayland. These are process-tree limits, **not a cap on separate GPU/driver allocations**. Use Medium or Low quality on integrated graphics; High remains an opt-in expensive preset.

Stop only the game services:

```bash
systemctl --user stop nomad-browser nomad-dev
```

## The expedition

- **Scavenge:** hold **E** at power caches. Green battery bundles mark the loot. Low / medium / high-threat caches provide **1 / 2 / 3 cells**, plus water, food and the original combat supplies.
- **Restore the relay:** spend **2 cells**, then defend the depot uplink for 55 seconds.
- **Choose your allies:** at any trading post or armory, press **E**, then **7** or **8** to share a cell. Each donation adds **20 trust** to that clan; trust starts at 20. Two donations to one clan secure its alliance.
  - **Ember Union [7]:** water +40, food +35.
  - **Iron Vultures [8]:** armor +25, funds +$150.
- **Survive:** water and food drain while playing; sprinting uses more water. Empty supplies damage health. Salvage replenishes supplies; **9** at a trading post refills both for **$100**.
- **Hunt:** eliminate the Warden in the research compound.
- **Bring power home:** finish both contracts, earn **60 trust with either clan**, and carry **3 cells** to the LZ Echo beacon. Calling extraction spends those cells once. Survive the horde and board the helicopter.

A minimum successful resource budget is **7 salvaged cells**: 2 relay + 2 shared + 3 convoy cargo. Spending cells on one purpose means they cannot serve another. The ash/contamination surge starts at 7:30; the district seals at 12:00. Restart resets every expedition resource and clan relationship.

## Controls

- **WASD / mouse:** move / look. **Shift:** sprint. **Space / C:** jump / crouch.
- **Left / right mouse:** fire / aim. **R:** reload. **1 / 2 / wheel:** switch weapons.
- **E:** interact; hold where prompted. **G:** grenade. **Q:** armor plate.
- **M:** tactical map. **Esc:** pause.
- **At a trading post:** **1–6** original equipment purchases; **7 / 8** share with Ember / Iron; **9** buy survival supplies. The world continues while trading.

## Development

```bash
pnpm build
pnpm typecheck
pnpm test --maxWorkers=1
```

The Medium preset is tuned for integrated GPUs: 1× pixel-ratio cap, 1024px directional shadows, no bloom or MSAA targets, and reduced transient effect budgets. Existing automatic resolution scaling remains enabled.

New rules: `src/logic/nomad.ts`. Game integration: `src/game/`. Presentation: `src/ui/nomad.css`, `src/ui/nomadView.ts`, `src/render/stage.ts`. Battery models: `src/world/powerCells.ts`. No new runtime dependencies or external assets.

See [NOMAD.md](NOMAD.md) for validation, limitations and attribution. Local screenshots and the staged gameplay recording with actual game audio live in `artifacts/` (excluded from git).
