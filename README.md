# Sonnet 5.5 Zombies Game

**DEAD SIGNAL: EXCLUSION ZONE** — a single-player, first-person zombie extraction shooter that runs in your browser.

Built by Claude Sonnet 5.5 and its sub-agents in Claude Code from a single prompt, using Three.js, TypeScript and Vite.
Every model, texture and sound is generated in code: no downloaded assets, no backend, no accounts.

Drop into a quarantined industrial district at blue hour, finish two contracts, upgrade your gear, then call the
helicopter and hold out long enough to board it.

## Play

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5173
```

You need Node.js 22.12 or newer, [pnpm](https://pnpm.io/), and a desktop browser with WebGL 2 and Pointer Lock
(developed and tested in Chrome). Click **DEPLOY** to capture the mouse; **Esc** pauses.

## The mission

1. **Restore the relay** — activate the transmitter, then stay inside the marked circle for 55 seconds while the infected converge on it.
2. **Eliminate the Warden** — find the armored elite in the research compound. Shoot the helmet off, then go for the head.
3. **Extract** — call the helicopter from the LZ radio, survive the final horde, and board it alive.

Each contract pays out once. Tougher zombies and better loot wait in the higher-threat regions. Spend your cash at the supply
cages and the armory bench. At 7:30 a contamination surge spreads out from the compound, and the district is sealed at 12:00.
You lose if you die, if the district seals before you call extraction, or if the helicopter leaves without you.

## Controls

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `W A S D` | Move | `E` | Interact (hold where prompted) |
| Mouse | Look | `1` / `2` or wheel | Switch weapon |
| Left / right mouse | Fire / aim down sights | `G` | Throw frag grenade |
| `R` | Reload | `Q` | Apply armor plate |
| `Shift` | Sprint | `M` | Tactical map |
| `Space` / `C` | Jump / crouch (toggle) | `Esc` | Pause |

At a supply cage or the armory bench, press `E` to open it and `1`–`6` to buy.

## Development

```bash
pnpm build       # type-check and build to dist/
pnpm preview     # serve the production build
pnpm typecheck
pnpm test        # unit tests for the game rules (vitest)
```

Game balance lives in `src/config.ts`. `scripts/` has optional headless-Chrome QA helpers (they use your installed Chrome,
override the path with `CHROME_PATH`) and `dev/` has per-module preview pages served by `pnpm dev`.
See [ASSETS.md](./ASSETS.md) for asset and dependency notes.

## License

[MIT](./LICENSE)
