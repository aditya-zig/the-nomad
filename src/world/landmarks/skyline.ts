/**
 * Distant backdrop: a ring of dark, dead city blocks with a few dim lit windows, industrial stacks, cooling towers, radio masts
 * with red beacons and a low ridge line, all beyond the playable bounds and inside the fog. Cheap merged geometry, no colliders.
 */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import { Assembly, Rng, addLattice, cached } from './util';
import { facadeTextures } from './tex';

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function facadeMat(variant: number): THREE.MeshStandardMaterial {
  return cached(`skyline:facade${variant}`, () => {
    const t = facadeTextures(variant);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: t.albedo,
      emissiveMap: t.emissive,
      emissive: new THREE.Color(0xffc98a),
      emissiveIntensity: 0.5,
      roughness: 0.92,
      metalness: 0.04,
    });
    mat.userData.tile = 16;
    return mat;
  });
}

export function buildSkylineBackdrop(b: LevelBuilder, o: { bounds: Bounds; seed?: number }): void {
  const bd = o.bounds;
  const rng = new Rng((o.seed ?? 1) * 104729 + 17);
  const asm = new Assembly(0, 0, 0, 0);
  const m = b.mats;
  const roofMat = cached('skyline:roof', () => new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 1 }));
  const dark = cached('skyline:dark', () => new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.9, metalness: 0.2 }));
  const white = cached('skyline:stackWhite', () => new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.85 }));
  const red = cached('skyline:stackRed', () => new THREE.MeshStandardMaterial({ color: 0x8a2c22, roughness: 0.85 }));
  const concrete = m.get('concreteDark');
  const facades = [facadeMat(0), facadeMat(1), facadeMat(2)];
  const cx = (bd.minX + bd.maxX) / 2;
  const cz = (bd.minZ + bd.maxZ) / 2;

  // outer ground so nothing floats over a void
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), m.get('asphaltWet'));
    g.rotation.x = -Math.PI / 2;
    g.position.set(cx, -0.06, cz);
    g.receiveShadow = false;
    asm.group.add(g);
  }

  interface Placed {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    face: 'n' | 's' | 'e' | 'w';
  }
  const placed: Placed[] = [];
  const rows = [
    { off: 24, depth: [12, 24], height: [14, 36], gap: [2, 8] },
    { off: 54, depth: [14, 28], height: [22, 54], gap: [3, 10] },
    { off: 96, depth: [16, 30], height: [34, 80], gap: [4, 14] },
  ] as const;

  const strip = (side: 'n' | 's' | 'e' | 'w', from: number, to: number, row: (typeof rows)[number]) => {
    let t = from;
    while (t < to) {
      const w = rng.range(12, 30);
      const d = rng.range(row.depth[0], row.depth[1]);
      const h = rng.range(row.height[0], row.height[1]);
      const c = t + w / 2;
      const outward = row.off + d / 2 + rng.range(0, 8);
      let x = 0;
      let z = 0;
      let bw = w;
      let bd2 = d;
      if (side === 'n') {
        x = c;
        z = bd.minZ - outward;
      } else if (side === 's') {
        x = c;
        z = bd.maxZ + outward;
      } else if (side === 'w') {
        z = c;
        x = bd.minX - outward;
        bw = d;
        bd2 = w;
      } else {
        z = c;
        x = bd.maxX + outward;
        bw = d;
        bd2 = w;
      }
      placed.push({ x, z, w: bw, d: bd2, h, face: side });
      t += w + rng.range(row.gap[0], row.gap[1]);
    }
  };
  for (const row of rows) {
    const extend = row.off + 30;
    strip('n', bd.minX - extend, bd.maxX + extend, row);
    strip('s', bd.minX - extend, bd.maxX + extend, row);
    strip('w', bd.minZ, bd.maxZ, row);
    strip('e', bd.minZ, bd.maxZ, row);
  }

  const windowGlows: { x: number; y: number; z: number; c: number }[] = [];
  for (const p of placed) {
    const mat = facades[rng.int(0, 2)]!;
    asm.box(mat, p.w, p.h, p.d, p.x, p.h / 2, p.z, { cast: false, receive: false });
    asm.box(roofMat, p.w + 0.6, 0.5, p.d + 0.6, p.x, p.h + 0.25, p.z, { cast: false, receive: false });
    // setback tier
    if (rng.chance(0.4)) {
      const th = rng.range(4, Math.max(6, p.h * 0.28));
      asm.box(mat, p.w * 0.6, th, p.d * 0.6, p.x + rng.range(-p.w * 0.1, p.w * 0.1), p.h + 0.5 + th / 2, p.z + rng.range(-p.d * 0.1, p.d * 0.1), { cast: false, receive: false });
    }
    // rooftop clutter
    if (rng.chance(0.55)) {
      const kind = rng.int(0, 2);
      const rx = p.x + rng.range(-p.w * 0.3, p.w * 0.3);
      const rz = p.z + rng.range(-p.d * 0.3, p.d * 0.3);
      if (kind === 0) {
        asm.cyl(dark, rng.range(1.5, 3), rng.range(3, 5), rx, p.h + 0.5 + 2, rz, 10, { cast: false });
      } else if (kind === 1) {
        asm.cyl(dark, 0.12, rng.range(8, 20), rx, p.h + 0.5 + 5, rz, 5, { cast: false });
      } else {
        asm.box(dark, rng.range(3, 6), rng.range(1.5, 3), rng.range(2, 4), rx, p.h + 1.6, rz, { cast: false });
      }
    }
    // a few dim lit windows on the face toward the playable area
    if (rng.chance(0.45)) {
      const n = rng.int(2, 6);
      for (let k = 0; k < n; k++) {
        const y = rng.range(3, p.h - 2);
        let wx = p.x;
        let wz = p.z;
        if (p.face === 'n') {
          wz = p.z + p.d / 2 + 0.3;
          wx = p.x + rng.range(-p.w / 2 + 1, p.w / 2 - 1);
        } else if (p.face === 's') {
          wz = p.z - p.d / 2 - 0.3;
          wx = p.x + rng.range(-p.w / 2 + 1, p.w / 2 - 1);
        } else if (p.face === 'w') {
          wx = p.x + p.w / 2 + 0.3;
          wz = p.z + rng.range(-p.d / 2 + 1, p.d / 2 - 1);
        } else {
          wx = p.x - p.w / 2 - 0.3;
          wz = p.z + rng.range(-p.d / 2 + 1, p.d / 2 - 1);
        }
        windowGlows.push({ x: wx, y, z: wz, c: rng.chance(0.75) ? 0xffc890 : 0xbfe0ff });
      }
    }
  }
  for (const wg of windowGlows) b.glow({ x: wg.x, y: wg.y, z: wg.z, color: wg.c, size: 1.5, intensity: 0.75, mode: rng.chance(0.12) ? 'flicker' : 'steady', phase: rng.range(0, 30) });

  // ---- industrial stacks (banded) and cooling towers ---------------------------------------------------------------------------------
  const far = (dist: number, side: number): { x: number; z: number } => {
    const a = rng.range(0, Math.PI * 2);
    void side;
    const rx = (bd.maxX - bd.minX) / 2 + dist;
    const rz = (bd.maxZ - bd.minZ) / 2 + dist;
    return { x: cx + Math.cos(a) * rx, z: cz + Math.sin(a) * rz };
  };
  for (let i = 0; i < 6; i++) {
    const p = far(rng.range(60, 110), i);
    const h = rng.range(44, 76);
    const r = rng.range(1.8, 3.2);
    const bands = 6;
    for (let k = 0; k < bands; k++) {
      const hh = h / bands;
      asm.taper(k % 2 === 0 ? red : white, r * (1 - (k + 1) / bands * 0.25), r * (1 - (k / bands) * 0.25), hh, p.x, hh * k + hh / 2, p.z, 12, { cast: false });
    }
    asm.cyl(concrete, r + 0.6, 1.2, p.x, 0.6, p.z, 12, { cast: false });
    b.glow({ x: p.x, y: h + 0.6, z: p.z, color: 0xff2412, size: 2.6, intensity: 3.0, mode: 'blink', period: 1.8 + rng.range(0, 0.6), duty: 0.3, phase: rng.range(0, 3) });
    b.glow({ x: p.x, y: h * 0.55, z: p.z, color: 0xff2412, size: 1.6, intensity: 2.2, mode: 'steady' });
  }
  for (let i = 0; i < 3; i++) {
    const p = far(rng.range(70, 115), i + 10);
    const h = 38;
    asm.taper(concrete, 9.5, 12, 14, p.x, 7, p.z, 28, { cast: false });
    asm.taper(concrete, 7, 9.5, 14, p.x, 21, p.z, 28, { cast: false });
    asm.taper(concrete, 8.5, 7, 10, p.x, 33, p.z, 28, { cast: false });
    void h;
  }

  // ---- radio masts (lattice) with red beacons -------------------------------------------------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    const p = far(rng.range(35, 120), i + 20);
    const h = rng.range(42, 74);
    const a = new Assembly(p.x, 0, p.z, 0);
    addLattice(a, { y0: 0, y1: h, halfBase: 1.0, halfTop: 0.28, panels: Math.round(h / 4.5), legThickBase: 0.13, legThickTop: 0.07, braceThick: 0.05, legMat: dark, braceMat: dark, cross: false });
    a.commit(b, { cast: false, receive: false });
    b.glow({ x: p.x, y: h + 0.4, z: p.z, color: 0xff2412, size: 2.4, intensity: 3.2, mode: 'blink', period: 1.4 + rng.range(0, 0.8), duty: 0.3, phase: rng.range(0, 3) });
    b.glow({ x: p.x, y: h * 0.5, z: p.z, color: 0xff2412, size: 1.5, intensity: 2.2, mode: 'blink', period: 2.0, duty: 0.3, phase: rng.range(0, 3) });
  }

  // ---- ridge line -------------------------------------------------------------------------------------------------------------------------------------
  {
    const N = 200;
    const rMinX = (bd.maxX - bd.minX) / 2 + 170;
    const rMinZ = (bd.maxZ - bd.minZ) / 2 + 170;
    const pos: number[] = [];
    const idx: number[] = [];
    const noise = (t: number): number => 0.5 + 0.28 * Math.sin(t * 5 + 1.3) + 0.18 * Math.sin(t * 13 + 0.4) + 0.1 * Math.sin(t * 29 + 2.2);
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = cx + Math.cos(t) * rMinX;
      const z = cz + Math.sin(t) * rMinZ;
      const h = 8 + 34 * noise(t);
      pos.push(x, -2, z, x, h, z);
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const ridgeMat = cached('skyline:ridge', () => new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 1, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(geo, ridgeMat);
    mesh.receiveShadow = false;
    asm.group.add(mesh);
  }

  asm.commit(b, { cast: false, receive: false });
}
