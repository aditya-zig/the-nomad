/**
 * UI-wide accessibility preferences shared by the HUD and the menus.
 * The reduced-motion flag combines the OS-level `prefers-reduced-motion` query with the in-game setting; while it is
 * active the root element carries the `ds-rm` class, which CSS uses to disable decorative animation.
 */
let osReduced = false;
let settingReduced = false;

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  osReduced = mq.matches;
  const onChange = (e: MediaQueryListEvent): void => {
    osReduced = e.matches;
    apply();
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
}

function apply(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('ds-rm', reducedMotion());
}

export function reducedMotion(): boolean {
  return osReduced || settingReduced;
}

export function setReducedMotionSetting(v: boolean): void {
  settingReduced = v;
  apply();
}

apply();
