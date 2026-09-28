# Assets and attribution

**DEAD SIGNAL: EXCLUSION ZONE ships with no third-party assets.**

- **Geometry and models** (district, buildings, props, vehicles, weapons, hands, zombies, helicopter, stations) are built from
  Three.js primitives and procedural geometry in code.
- **Textures and decals** are painted at runtime with Canvas 2D and procedural noise (`src/world/textures/`, `src/fx/textures.ts`,
  `src/weapons/viewmodel/materials.ts`, `src/enemies/zombie/material.ts`).
- **Audio** is synthesised at runtime with the Web Audio API (`src/audio/synth/`). No audio files are included.
- **Fonts** are system font stacks (no web fonts are loaded).
- All names, brands, insignia and freight markings in the game are fictional.

## Software dependencies

| Package | License |
| --- | --- |
| [three](https://threejs.org/) | MIT |
| [vite](https://vitejs.dev/) | MIT |
| [typescript](https://www.typescriptlang.org/) | Apache-2.0 |
| [vitest](https://vitest.dev/) | MIT |
| [playwright-core](https://playwright.dev/) (dev-only QA scripts) | Apache-2.0 |
