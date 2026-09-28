/**
 * Ammunition and reload state machine (pure). Invariants that the tests enforce:
 *  - mag + reserve never increases through reloading (rounds only move from reserve to mag),
 *  - a reload transfers ammunition at most once (magazine) or once per shell,
 *  - cancelling (weapon switch, pause) never duplicates or destroys ammunition,
 *  - the state can never get stuck: `reload` either progresses to null or is cancelled.
 */
import type { WeaponStats } from './weaponStats';

export type ShellPhase = 'start' | 'load' | 'pump' | 'end';

export type ReloadState =
  | { kind: 'mag'; t: number; duration: number; transferAt: number; empty: boolean; transferred: boolean }
  | {
      kind: 'shell';
      phase: ShellPhase;
      t: number;
      duration: number;
      transferred: boolean;
      wasEmpty: boolean;
      pumped: boolean;
      /** Stop after the current shell (player pressed fire / reload again). */
      stopRequested: boolean;
    };

export interface AmmoState {
  mag: number;
  reserve: number;
  magSize: number;
  reserveMax: number;
  reload: ReloadState | null;
}

export function createAmmo(magSize: number, reserve: number, reserveMax: number, mag = magSize): AmmoState {
  return { mag: Math.min(mag, magSize), reserve: Math.min(reserve, reserveMax), magSize, reserveMax, reload: null };
}

export type ReloadStyle = 'magazine' | 'shell';

export function canFire(a: AmmoState, style: ReloadStyle): boolean {
  if (a.mag <= 0) return false;
  if (a.reload === null) return true;
  // a shotgun may interrupt a shell reload by firing (but not during the final pump/end lock-in)
  return style === 'shell' && a.reload.kind === 'shell';
}

/** Consume one round. Firing during a shell reload cancels it (rounds already loaded stay loaded). */
export function consumeRound(a: AmmoState): boolean {
  if (a.mag <= 0) return false;
  a.mag -= 1;
  if (a.reload && a.reload.kind === 'shell') a.reload = null;
  return true;
}

export function canReload(a: AmmoState): boolean {
  return a.reload === null && a.mag < a.magSize && a.reserve > 0;
}

export function startReload(a: AmmoState, style: ReloadStyle, s: WeaponStats, transferAt: number): boolean {
  if (!canReload(a)) return false;
  if (style === 'magazine') {
    const empty = a.mag === 0;
    a.reload = {
      kind: 'mag',
      t: 0,
      duration: empty ? s.reloadEmpty : s.reloadTactical,
      transferAt,
      empty,
      transferred: false,
    };
  } else {
    a.reload = {
      kind: 'shell',
      phase: 'start',
      t: 0,
      duration: s.shellStart,
      transferred: false,
      wasEmpty: a.mag === 0,
      pumped: a.mag > 0,
      stopRequested: false,
    };
  }
  return true;
}

/** Request a shell reload to stop after the current shell; returns true if there was a shell reload to stop. */
export function requestShellStop(a: AmmoState): boolean {
  if (a.reload && a.reload.kind === 'shell') {
    a.reload.stopRequested = true;
    return true;
  }
  return false;
}

/** Cancel any reload (weapon switch / pause). Rounds already moved into the magazine stay there. */
export function cancelReload(a: AmmoState): void {
  a.reload = null;
}

/** Advance the reload; returns true when a reload completed on this call. */
export function updateReload(a: AmmoState, dt: number, s: WeaponStats): boolean {
  const r = a.reload;
  if (!r) return false;
  r.t += dt;
  if (r.kind === 'mag') {
    if (!r.transferred && r.t >= r.duration * r.transferAt) {
      const n = Math.min(a.magSize - a.mag, a.reserve);
      a.mag += n;
      a.reserve -= n;
      r.transferred = true;
    }
    if (r.t >= r.duration) {
      // safety: make sure the transfer happened even for degenerate timings
      if (!r.transferred) {
        const n = Math.min(a.magSize - a.mag, a.reserve);
        a.mag += n;
        a.reserve -= n;
      }
      a.reload = null;
      return true;
    }
    return false;
  }
  // shell reload
  let guard = 0;
  while (a.reload && a.reload.kind === 'shell' && guard++ < 64) {
    const sr: Extract<ReloadState, { kind: 'shell' }> = a.reload;
    if (sr.phase === 'load' && !sr.transferred && sr.t >= sr.duration * 0.6) {
      if (a.mag < a.magSize && a.reserve > 0) {
        a.mag += 1;
        a.reserve -= 1;
      }
      sr.transferred = true;
    }
    if (sr.t < sr.duration) break;
    const carry = sr.t - sr.duration;
    switch (sr.phase) {
      case 'start':
        sr.phase = 'load';
        sr.duration = s.shellEach;
        sr.transferred = false;
        sr.t = carry;
        break;
      case 'load': {
        if (!sr.transferred) {
          // degenerate timing safety
          if (a.mag < a.magSize && a.reserve > 0) {
            a.mag += 1;
            a.reserve -= 1;
          }
        }
        if (sr.wasEmpty && !sr.pumped && a.mag > 0) {
          sr.phase = 'pump';
          sr.duration = s.shellPump;
          sr.t = carry;
        } else if (a.mag < a.magSize && a.reserve > 0 && !sr.stopRequested) {
          sr.duration = s.shellEach;
          sr.transferred = false;
          sr.t = carry;
        } else {
          sr.phase = 'end';
          sr.duration = s.shellEnd;
          sr.t = carry;
        }
        break;
      }
      case 'pump':
        sr.pumped = true;
        if (a.mag < a.magSize && a.reserve > 0 && !sr.stopRequested) {
          sr.phase = 'load';
          sr.duration = s.shellEach;
          sr.transferred = false;
          sr.t = carry;
        } else {
          sr.phase = 'end';
          sr.duration = s.shellEnd;
          sr.t = carry;
        }
        break;
      case 'end':
        a.reload = null;
        return true;
    }
  }
  return false;
}

/** Add ammunition to the reserve, clamped to the maximum; returns how many rounds were actually added. */
export function addReserve(a: AmmoState, n: number): number {
  const room = Math.max(0, a.reserveMax - a.reserve);
  const add = Math.min(room, Math.max(0, Math.floor(n)));
  a.reserve += add;
  return add;
}

export function isFull(a: AmmoState): boolean {
  return a.reserve >= a.reserveMax && a.mag >= a.magSize;
}

/** 0..1 progress through the whole reload for HUD purposes. */
export function reloadProgress(a: AmmoState): number {
  const r = a.reload;
  if (!r) return 0;
  if (r.kind === 'mag') return Math.min(1, r.t / r.duration);
  const base: Record<ShellPhase, number> = { start: 0, load: 0.15, pump: 0.6, end: 0.85 };
  const span: Record<ShellPhase, number> = { start: 0.15, load: 0.45, pump: 0.25, end: 0.15 };
  return base[r.phase] + span[r.phase] * Math.min(1, r.t / Math.max(1e-6, r.duration));
}

/** Changes the magazine size (upgrade): keeps rounds, tops up the magazine from nothing and the reserve to its new max. */
export function applyUpgradeAmmo(a: AmmoState, magSize: number, reserveMax: number): void {
  a.magSize = magSize;
  a.reserveMax = reserveMax;
  a.mag = magSize;
  a.reserve = reserveMax;
  a.reload = null;
}
