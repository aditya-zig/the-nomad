/** Entry point: capability check, game construction, development test hooks. */
import { Game } from './game/game';

function showFatal(title: string, message: string): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#05080c;color:#cfd8dc;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:24px;text-align:center;pointer-events:auto';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:20px;letter-spacing:0.12em;color:#e2b04a';
  const p = document.createElement('div');
  p.textContent = message;
  p.style.maxWidth = '640px';
  box.append(h, p);
  root.appendChild(box);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');
  if (!canvas || !uiRoot) {
    showFatal('DEAD SIGNAL', 'The page is missing its canvas or UI root.');
    return;
  }
  const game = new Game({ canvas, uiRoot });
  game.onFatal = (m) => showFatal('SOMETHING WENT WRONG', `${m}\n\nReload the page to try again.`);
  try {
    const ok = await game.init();
    if (!ok) return; // unsupported browser: the menus already show the error
    // Inline `import.meta.env.DEV` so the production build drops the whole branch (and the test-hook chunk).
    if (import.meta.env.DEV) {
      const { installTestApi } = await import('./dev/testApi');
      installTestApi(game);
    }
  } catch (err) {
    console.error(err);
    showFatal('FAILED TO START', err instanceof Error ? err.message : String(err));
  }
}

void main();
