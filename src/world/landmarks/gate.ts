/**
 * Quarantine checkpoint gate: two concrete gate piers carrying a sign gantry, a sliding bar gate that never closes
 * the road completely (>= 3.2 m gap), a guard booth with a lit window, floodlights and amber beacons.
 * Local X runs across the road; `width` is the clear opening between the piers.
 */
import * as THREE from 'three';
import type { LampSpec, LevelBuilder } from '../builder';
import type { Place } from '../props';
import { Assembly, Rng, cached, seedFrom } from './util';
import { signMaterial } from './tex';

export function buildQuarantineGate(b: LevelBuilder, o: Place & { width: number; open?: number }): void {
  const width = o.width;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 14));
  const concrete = m.get('concreteWall');
  const concreteDark = m.get('concreteDark');
  const steel = m.get('steel');
  const steelDark = m.get('steelDark');
  const hazard = m.get('hazard');
  const rubber = m.get('rubber');
  const glassDark = m.get('glassDark');
  const metalPanel = m.get('metalPanel');
  const roofMat = m.get('roof');
  const lampEm = m.get('lampCool');
  const amberEm = m.get('emAmber');
  const paintWhite = cached('gate:white', () => new THREE.MeshStandardMaterial({ color: 0xb9b6ab, roughness: 0.6, metalness: 0.3 }));

  const halfClear = width / 2;
  const pierX = halfClear + 0.6;
  const pierH = 4.4;

  // ---- piers ----------------------------------------------------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    const x = s * pierX;
    asm.box(concreteDark, 1.7, 0.35, 1.7, x, 0.175, 0, { cast: false });
    asm.box(concrete, 1.2, pierH, 1.2, x, pierH / 2, 0);
    asm.box(hazard, 1.24, 0.9, 1.24, x, 0.75, 0, { cast: false });
    asm.box(steel, 1.4, 0.16, 1.4, x, pierH + 0.08, 0);
    // amber beacon dome + floodlight bracket
    asm.cyl(steelDark, 0.16, 0.14, x, pierH + 0.24, 0, 10, { cast: false });
    asm.sphere(amberEm, 0.15, x, pierH + 0.34, 0, 10, { cast: false });
    // vertical conduit on the outer face
    asm.tube(rubber, [x + s * 0.68, 0.3, 0.3], [x + s * 0.68, pierH - 0.3, 0.3], 0.04, 5, { cast: false });
    asm.collide(b, x, 0, 1.25, 1.25, pierH, { mapKind: 'wall', tag: 'gate-pier' });
    const p = asm.world(x, 0);
    b.glow({ x: p.x, y: asm.y + pierH + 0.55, z: p.z, color: 0xffa020, size: 1.3, intensity: 2.6, mode: 'blink', period: 1.5, duty: 0.4, phase: s > 0 ? 0 : 0.75 });
  }

  // ---- sign gantry across the top -----------------------------------------------------------------------------------------------------
  const beamY = pierH - 0.15;
  const beamLen = 2 * pierX + 1.2;
  asm.box(steelDark, beamLen, 0.5, 0.5, 0, beamY, 0);
  asm.box(steel, beamLen, 0.08, 0.6, 0, beamY + 0.29, 0, { cast: false });
  for (let i = -1; i <= 1; i += 2) {
    // hanging sign boards below the beam
    const sgn = asm.box(
      signMaterial(i < 0 ? ['QUARANTINE', 'ZONE'] : ['NO ENTRY BEYOND', 'THIS POINT'], { bg: i < 0 ? '#b8321c' : '#d2ac1c', fg: i < 0 ? '#f2ead8' : '#131313', aspect: 2.3 }),
      2.6,
      1.12,
      0.07,
      i * (halfClear * 0.52),
      beamY - 0.8,
      0.03,
      { cast: false },
    );
    sgn.userData.worldUV = false;
    asm.box(steelDark, 0.06, 0.4, 0.06, i * (halfClear * 0.52) - 1.0, beamY - 0.25, 0.03, { cast: false });
    asm.box(steelDark, 0.06, 0.4, 0.06, i * (halfClear * 0.52) + 1.0, beamY - 0.25, 0.03, { cast: false });
  }
  // floodlight heads on the beam ends, aimed at the roadway
  const lamps: LampSpec[] = [];
  for (const s of [-1, 1]) {
    const x = s * (pierX - 1.3);
    asm.box(steelDark, 0.62, 0.3, 0.3, x, beamY - 0.4, 0.5, { rx: 0.5 });
    asm.box(lampEm, 0.5, 0.2, 0.04, x, beamY - 0.34, 0.66, { rx: 0.5, cast: false });
    const p = asm.world(x, 0.9);
    const lamp: LampSpec = { x: p.x, y: asm.y + beamY - 0.6, z: p.z, color: 0xdfeaff, intensity: 85, distance: 22, weight: 1, pool: 8, glow: 0.8, tag: 'gate-flood', mode: s > 0 ? 'flicker' : 'steady' };
    b.light(lamp);
    lamps.push(lamp);
  }

  // ---- sliding bar gate (never closes the road completely) -------------------------------------------------------------------------------------
  const open = Math.max(0, Math.min(1, o.open ?? 0.4));
  const gap = Math.max(3.2, width * open);
  const leafLen = width - gap;
  if (leafLen > 0.4) {
    const x0 = -halfClear;
    const x1 = x0 + leafLen;
    const cx = (x0 + x1) / 2;
    const gh = 2.3;
    asm.box(steelDark, leafLen, 0.12, 0.1, cx, 0.3, 0.05);
    asm.box(steelDark, leafLen, 0.12, 0.1, cx, gh, 0.05);
    asm.box(steelDark, leafLen, 0.1, 0.08, cx, gh * 0.55, 0.05, { cast: false });
    const nBars = Math.max(2, Math.round(leafLen / 0.28));
    for (let i = 0; i <= nBars; i++) {
      const x = x0 + 0.06 + ((leafLen - 0.12) * i) / nBars;
      asm.box(steel, 0.05, gh - 0.3, 0.05, x, 0.3 + (gh - 0.3) / 2, 0.05, { cast: false });
    }
    // diagonal braces
    asm.strut(steelDark, [x0 + 0.1, 0.34, 0.05], [x1 - 0.1, gh - 0.05, 0.05], 0.06, { cast: false });
    asm.strut(steelDark, [x0 + 0.1, gh - 0.05, 0.05], [x1 - 0.1, 0.34, 0.05], 0.06, { cast: false });
    // hazard plate + guide wheels + ground track
    const plate = asm.box(signMaterial(['QUARANTINE'], { bg: '#d2ac1c', fg: '#131313', aspect: 3.2 }), Math.min(2.6, leafLen * 0.7), 0.8, 0.05, cx, gh * 0.55, 0.11, { cast: false });
    plate.userData.worldUV = false;
    for (const wx of [x0 + 0.5, x1 - 0.5]) asm.box(steelDark, 0.3, 0.18, 0.2, wx, 0.12, 0.05, { cast: false });
    asm.box(steelDark, width + 1.6, 0.03, 0.14, 0, 0.015, 0.05, { cast: false });
    asm.collide(b, cx, 0.05, leafLen, 0.16, gh + 0.06, { blocksShots: false, mapKind: 'fence', surface: 'metal', tag: 'gate-leaf' });
  }

  // ---- guard booth (beside the gate, on the road shoulder) ------------------------------------------------------------------------------------------
  {
    const bx = halfClear + 3.3;
    const bz = -1.6;
    const bw = 2.4;
    const bh = 2.6;
    asm.box(concreteDark, bw + 0.3, 0.2, bw + 0.3, bx, 0.1, bz, { cast: false });
    asm.box(metalPanel, bw, bh, bw, bx, bh / 2 + 0.2, bz);
    asm.box(hazard, bw + 0.04, 0.32, bw + 0.04, bx, 0.42, bz, { cast: false });
    asm.box(roofMat, bw + 0.5, 0.14, bw + 0.5, bx, bh + 0.27, bz);
    asm.box(steelDark, bw + 0.54, 0.08, 0.08, bx, bh + 0.16, bz + bw / 2 + 0.25, { cast: false });
    // windows on the road-facing sides (glass) + frame
    for (const [wx, wz, ry, ww] of [
      [bx - bw / 2 - 0.02, bz, Math.PI / 2, 1.5],
      [bx, bz + bw / 2 + 0.02, 0, 1.6],
      [bx, bz - bw / 2 - 0.02, 0, 1.6],
    ] as const) {
      asm.box(steelDark, ww + 0.14, 1.0, 0.1, wx, 1.9, wz, { ry, cast: false });
      asm.box(glassDark, ww, 0.86, 0.06, wx, 1.9, wz, { ry, cast: false });
    }
    // door on the +X (outer) side + AC unit + antenna
    asm.box(steelDark, 0.1, 2.0, 0.9, bx + bw / 2 + 0.03, 1.2, bz + 0.3, { cast: false });
    asm.box(paintWhite, 0.8, 0.6, 0.5, bx + 0.3, bh + 0.65, bz - 0.4);
    asm.cyl(steelDark, 0.02, 2.4, bx - 0.8, bh + 1.4, bz + 0.5, 5, { cast: false });
    asm.collide(b, bx, bz, bw, bw, bh + 0.35, { mapKind: 'building', tag: 'gate-booth' });
    // warm interior lamp + window glow
    const p = asm.world(bx - bw / 2 - 0.35, bz);
    const lamp: LampSpec = { x: p.x, y: asm.y + 1.9, z: p.z, color: 0xffc27a, intensity: 42, distance: 9, weight: 0.8, glow: 1.2, tag: 'gate-booth' };
    b.light(lamp);
  }

  // ---- road-edge details: bollards and cable ----------------------------------------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    const x = s * (pierX + 1.2);
    asm.box(concreteDark, 0.42, 0.9, 0.42, x, 0.45, 1.3);
    asm.box(hazard, 0.44, 0.3, 0.44, x, 0.7, 1.3, { cast: false });
    asm.collide(b, x, 1.3, 0.42, 0.42, 0.9, { mapKind: 'prop', tag: 'gate-bollard' });
  }
  asm.tube(rubber, [-pierX + 0.5, 0.04, 0.9], [pierX - 0.5, 0.04, 0.9], 0.03, 5, { cast: false });
  void rng;
  asm.commit(b);
}
