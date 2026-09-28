/**
 * Collapsed road section (a jagged ridge of tilted asphalt slabs with rebar and rubble mounds that seals the road) and the
 * ruined highway overpass (deck on pillars with one broken span hanging down to the ground).
 */
import * as THREE from 'three';
import type { LevelBuilder } from '../builder';
import type { Place } from '../props';
import { Assembly, Rng, irregularSlab, rockGeometry, seedFrom } from './util';

// ---------------------------------------------------------------------------------------------
// Collapsed road
// ---------------------------------------------------------------------------------------------

export function buildCollapsedRoad(b: LevelBuilder, o: Place & { w: number; d: number; seed?: number }): void {
  const { w, d } = o;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const rng = new Rng(o.seed !== undefined ? o.seed * 7919 + seedFrom(o.x, o.z) : seedFrom(o.x, o.z, 71));
  const m = b.mats;
  const concrete = m.get('concreteWall');
  const asphalt = m.get('asphalt');
  const rubbleMat = m.get('rubble');
  const rust = m.get('rust');
  const steelDark = m.get('steelDark');
  const paintYellow = m.get('paintYellow');
  const rubber = m.get('rubber');
  const tileC = (concrete.userData.tile as number | undefined) ?? 4;
  const tileA = (asphalt.userData.tile as number | undefined) ?? 8;

  const slabAt = (x: number, z: number, sx: number, sz: number, tilt: number, yaw: number, roll: number, lift = 0): { extent: number; g: THREE.Group } => {
    const t = 0.42;
    const extent = sz * Math.sin(Math.abs(tilt)) + t * Math.cos(tilt);
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.rotation.set(tilt, yaw, roll);
    g.position.set(x, extent / 2 + lift, z);
    const shapeSeed = rng.int(1, 1e6);
    const body = new THREE.Mesh(irregularSlab(sx, sz, t, new Rng(shapeSeed), tileC), concrete);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const cap = new THREE.Mesh(irregularSlab(sx * 0.97, sz * 0.97, 0.1, new Rng(shapeSeed), tileA), asphalt);
    cap.position.y = t / 2 + 0.05;
    cap.receiveShadow = true;
    g.add(cap);
    if (rng.chance(0.5)) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, sz * 0.7), paintYellow);
      line.position.set(rng.range(-0.6, 0.6), t / 2 + 0.106, 0);
      g.add(line);
    }
    asm.group.add(g);
    return { extent, g };
  };
  const rebar = (g: THREE.Group, sx: number, sz: number, count: number) => {
    g.updateMatrix();
    for (let k = 0; k < count; k++) {
      const edgeX = (rng.f() - 0.5) * sx * 0.9;
      const side = rng.sign();
      const from = new THREE.Vector3(edgeX, 0, side * sz * 0.5);
      const dir = new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(-0.15, 0.6), side * rng.range(0.8, 1.6)).normalize().multiplyScalar(rng.range(0.7, 1.8));
      const to = from.clone().add(dir);
      from.applyMatrix4(g.matrix);
      to.applyMatrix4(g.matrix);
      asm.tube(k % 3 === 0 ? steelDark : rust, [from.x, from.y, from.z], [to.x, to.y, to.z], 0.014, 4, { cast: false });
    }
  };

  // ---- ridge of leaning slab pairs (A-frames) across the road ------------------------------------------------------------------------
  const n = Math.ceil(w / 2.8) + 1;
  const span = w + 0.6;
  for (let i = 0; i < n; i++) {
    const sx = rng.range(3.0, 3.5);
    const sz = rng.range(2.5, 3.0);
    const alpha = rng.range(0.85, 1.22);
    const yaw = rng.range(-0.16, 0.16);
    const x = -span / 2 + (span * (i + 0.5)) / n + rng.range(-0.2, 0.2);
    const zc = rng.range(-0.25, 0.25);
    const hzc = (sz / 2) * Math.cos(alpha) + 0.05;
    const a = slabAt(x + Math.sin(yaw) * hzc, zc + hzc * Math.cos(yaw), sx, sz, alpha, yaw, rng.range(-0.05, 0.05));
    const bb = slabAt(x - Math.sin(yaw) * hzc, zc - hzc * Math.cos(yaw), sx, sz, -alpha * rng.range(0.85, 1.05), yaw, rng.range(-0.05, 0.05), rng.range(0, 0.12));
    rebar(a.g, sx, sz, rng.int(3, 6));
    rebar(bb.g, sx, sz, rng.int(3, 6));
    const height = Math.min(a.extent, bb.extent + 0.1);
    asm.collide(b, x, zc, sx - 0.3, hzc * 2 + 0.3, height - 0.15, { rot: yaw, mapKind: 'wall', tag: 'collapse-slab' });
  }
  // flat fallen slabs and a sunken sheet in front (hop-able, no collider)
  for (let i = 0; i < 3; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    slabAt(rng.range(-w / 2 + 1.5, w / 2 - 1.5), side * rng.range(2.6, Math.max(3.0, d / 2 - 0.3)), rng.range(2.4, 3.2), rng.range(1.8, 2.4), rng.range(0.06, 0.16) * side, rng.range(-0.5, 0.5), rng.range(-0.1, 0.1));
  }

  // ---- rubble mounds in front of and behind the ridge ---------------------------------------------------------------------------------------
  const mounds = 5;
  for (let mi = 0; mi < mounds; mi++) {
    const side = mi % 2 === 0 ? 1 : -1;
    const mx = -w / 2 + (w * (mi + 0.5)) / mounds + rng.range(-0.6, 0.6);
    const mz = side * rng.range(1.9, Math.max(2.3, d / 2 - 0.4));
    const nRocks = rng.int(6, 9);
    for (let k = 0; k < nRocks; k++) {
      const s = rng.range(0.28, 0.75);
      const mesh = new THREE.Mesh(rockGeometry(rng.int(0, 3)), rubbleMat);
      mesh.scale.set(s * rng.range(0.9, 1.5), s * rng.range(0.6, 1.0), s * rng.range(0.9, 1.5));
      mesh.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      mesh.position.set(mx + rng.range(-0.9, 0.9), s * 0.35, mz + rng.range(-0.8, 0.8));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      asm.group.add(mesh);
    }
    const core = new THREE.Mesh(rockGeometry(mi), rubbleMat);
    core.scale.set(1.15, 0.85, 1.05);
    core.position.set(mx, 0.62, mz);
    core.rotation.set(0.2, rng.range(0, 3), 0.15);
    core.castShadow = true;
    core.receiveShadow = true;
    asm.group.add(core);
    asm.collide(b, mx, mz, 1.9, 1.7, 1.15, { mapKind: 'wall', tag: 'collapse-mound' });
  }
  // scattered small debris (no collider, below hop height)
  for (let i = 0; i < 46; i++) {
    const s = rng.range(0.06, 0.22);
    const mesh = new THREE.Mesh(rockGeometry(rng.int(0, 3)), rubbleMat);
    mesh.scale.set(s * 1.3, s * 0.7, s);
    mesh.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    mesh.position.set(rng.range(-w / 2 - 1, w / 2 + 1), s * 0.25, rng.range(-d / 2, d / 2));
    mesh.receiveShadow = true;
    asm.group.add(mesh);
  }
  // fallen lamp post lying across the pile, with its dead head and dangling cable
  {
    const a: [number, number, number] = [-w * 0.32, 2.3, -1.0];
    const c: [number, number, number] = [w * 0.28, 1.15, 1.6];
    asm.tube(steelDark, a, c, 0.085, 8);
    asm.box(steelDark, 0.95, 0.14, 0.34, c[0] + 0.35, c[1] + 0.02, c[2] + 0.1, { rz: 0.15 });
    asm.box(m.get('glassDark'), 0.7, 0.05, 0.24, c[0] + 0.4, c[1] - 0.06, c[2] + 0.1, { cast: false });
    asm.tube(rubber, [c[0] + 0.7, c[1], c[2]], [c[0] + 1.2, 0.5, c[2] + 0.4], 0.02, 4, { cast: false });
    asm.tube(rubber, [c[0] + 1.2, 0.5, c[2] + 0.4], [c[0] + 1.8, 0.03, c[2] + 0.7], 0.02, 4, { cast: false });
  }
  asm.commit(b);
}

// ---------------------------------------------------------------------------------------------
// Overpass ruin
// ---------------------------------------------------------------------------------------------

export function buildOverpassRuin(b: LevelBuilder, o: Place & { length: number; width?: number }): void {
  const L = o.length;
  const Wd = o.width ?? 11;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const rng = new Rng(seedFrom(o.x, o.z, 88));
  const m = b.mats;
  const concrete = m.get('concreteWall');
  const concreteDark = m.get('concreteDark');
  const steelDark = m.get('steelDark');
  const rust = m.get('rust');
  const rubbleMat = m.get('rubble');
  const rubber = m.get('rubber');

  const deckT = 0.9;
  const deckTop = 7.0;
  const deckMid = deckTop - deckT / 2;
  const xb = L / 2 - 20; // intact deck ends here
  const stubX0 = L / 2 - 5; // far stub starts here
  const halfW = Wd / 2;

  // ---- intact deck, parapets, girders -----------------------------------------------------------------------------------------------------
  const intactLen = xb + L / 2;
  const intactCx = (xb - L / 2) / 2;
  asm.box(concrete, intactLen, deckT, Wd, intactCx, deckMid, 0);
  for (const s of [-1, 1]) {
    asm.box(concreteDark, intactLen, 0.9, 0.45, intactCx, deckTop + 0.45, s * (halfW - 0.22));
  }
  for (let i = 0; i < 4; i++) {
    const z = -halfW + 1.4 + (i * (Wd - 2.8)) / 3;
    asm.box(steelDark, intactLen - 0.2, 0.62, 0.42, intactCx, deckTop - deckT - 0.31, z, { cast: false });
  }
  // cross diaphragms
  for (let x = -L / 2 + 3; x < xb; x += 6) asm.box(concreteDark, 0.3, 0.5, Wd - 1.2, x, deckTop - deckT - 0.28, 0, { cast: false });
  // far stub
  const stubLen = L / 2 - stubX0;
  asm.box(concrete, stubLen, deckT, Wd, stubX0 + stubLen / 2, deckMid, 0);
  for (const s of [-1, 1]) asm.box(concreteDark, stubLen, 0.9, 0.45, stubX0 + stubLen / 2, deckTop + 0.45, s * (halfW - 0.22));
  for (let i = 0; i < 4; i++) {
    const z = -halfW + 1.4 + (i * (Wd - 2.8)) / 3;
    asm.box(steelDark, stubLen - 0.2, 0.62, 0.42, stubX0 + stubLen / 2, deckTop - deckT - 0.31, z, { cast: false });
  }

  // ---- jagged broken edges + dangling rebar ---------------------------------------------------------------------------------------------------
  const teeth = (x: number, dir: number) => {
    let z = -halfW + 0.3;
    while (z < halfW - 0.3) {
      const wd = rng.range(0.5, 1.5);
      const len = rng.range(0.3, 1.5);
      const th = rng.range(0.4, deckT);
      asm.box(concrete, len, th, Math.min(wd, halfW - z), x + dir * len / 2, deckTop - th / 2 - rng.range(0, 0.15), z + Math.min(wd, halfW - z) / 2, { cast: false });
      const nr = rng.int(1, 3);
      for (let k = 0; k < nr; k++) {
        const rz = z + rng.range(0.1, wd - 0.1);
        const ry = deckTop - deckT * rng.range(0.2, 0.8);
        const dl = rng.range(1.2, 3.4);
        const dx = dir * rng.range(0.1, 0.9);
        const p0: [number, number, number] = [x + dir * len * 0.6, ry, rz];
        const p1: [number, number, number] = [x + dir * len * 0.6 + dx, ry - dl * 0.55, rz + rng.range(-0.15, 0.15)];
        const p2: [number, number, number] = [x + dir * len * 0.6 + dx * 1.7, ry - dl, rz + rng.range(-0.3, 0.3)];
        asm.tube(rust, p0, p1, 0.016, 4, { cast: false });
        asm.tube(steelDark, p1, p2, 0.016, 4, { cast: false });
      }
      z += wd + 0.1;
    }
  };
  teeth(xb, 1);
  teeth(stubX0, -1);
  teeth(-L / 2, -1);
  teeth(L / 2, 1);

  // ---- pillars and cap beams ----------------------------------------------------------------------------------------------------------------------
  const spacing = 12;
  const count = Math.max(2, Math.floor((L - 4) / spacing) + 1);
  const x0 = -((count - 1) * spacing) / 2;
  for (let k = 0; k < count; k++) {
    const x = x0 + k * spacing;
    const broken = x > xb + 2 && x < stubX0 - 2; // pier under the missing span
    for (const s of [-1, 1]) {
      const z = s * (halfW - 2.4);
      const h = broken ? rng.range(1.6, 2.4) : deckTop - deckT;
      asm.box(concrete, 1.6, h, 1.6, x, h / 2, z);
      asm.box(concreteDark, 2.0, 0.35, 2.0, x, 0.175, z, { cast: false });
      asm.collide(b, x, z, 1.7, 1.7, h, { mapKind: 'wall', tag: 'overpass-pier' });
      if (broken) {
        for (let r = 0; r < 6; r++) asm.tube(rust, [x + rng.range(-0.6, 0.6), h, z + rng.range(-0.6, 0.6)], [x + rng.range(-0.9, 0.9), h + rng.range(0.6, 1.6), z + rng.range(-0.9, 0.9)], 0.02, 4, { cast: false });
      }
    }
    if (!broken) asm.box(concrete, 1.5, 1.05, Wd - 1.0, x, deckTop - deckT - 0.53, 0, { cast: false });
  }

  // ---- the hanging span: hinged at the far stub, resting on rubble at ground level ------------------------------------------------------------------------------
  const phi = Math.atan2(5.65, 9);
  const Ls = Math.hypot(9, 5.65);
  const hingeX = stubX0;
  const hingeY = deckMid;
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, hingeY, 0);
  pivot.rotation.z = phi;
  const slabW = Wd - 0.6;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(Ls, deckT, slabW), concrete);
  slab.position.x = -Ls / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  pivot.add(slab);
  for (const s of [-1, 1]) {
    const par = new THREE.Mesh(new THREE.BoxGeometry(Ls, 0.9, 0.45), concreteDark);
    par.position.set(-Ls / 2, deckT / 2 + 0.45, s * (slabW / 2 - 0.22));
    par.castShadow = true;
    pivot.add(par);
  }
  for (let i = 0; i < 4; i++) {
    const z = -slabW / 2 + 1.2 + (i * (slabW - 2.4)) / 3;
    const gr = new THREE.Mesh(new THREE.BoxGeometry(Ls - 0.2, 0.62, 0.42), steelDark);
    gr.position.set(-Ls / 2, -deckT / 2 - 0.31, z);
    pivot.add(gr);
  }
  asm.group.add(pivot);
  // colliders along the slab (underside rises with height, so tall segments stay walk-under)
  const segLen = 1.4;
  const nSeg = Math.ceil(Ls / segLen);
  const vHalf = deckT / 2 / Math.cos(phi);
  for (let i = 0; i < nSeg; i++) {
    const s0 = i * segLen;
    const s1 = Math.min(Ls, s0 + segLen);
    const xa = hingeX - s0 * Math.cos(phi);
    const xc = hingeX - s1 * Math.cos(phi);
    const ya = hingeY - s0 * Math.sin(phi);
    const yc = hingeY - s1 * Math.sin(phi);
    const y0 = Math.max(0, yc - vHalf);
    const y1 = ya + vHalf;
    asm.collide(b, (xa + xc) / 2, 0, Math.abs(xa - xc) + 0.05, slabW, y1, { y0, mapKind: 'wall', tag: 'overpass-slab' });
  }
  // rubble heap where the slab landed
  const landX = hingeX - 9;
  for (let i = 0; i < 16; i++) {
    const s = rng.range(0.4, 1.1);
    const mesh = new THREE.Mesh(rockGeometry(rng.int(0, 3)), rubbleMat);
    mesh.scale.set(s * 1.3, s * 0.8, s);
    mesh.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    mesh.position.set(landX - rng.range(0.3, 3.5), s * 0.45, rng.range(-halfW + 0.8, halfW - 0.8));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    asm.group.add(mesh);
  }
  asm.collide(b, landX - 2.0, 0, 3.6, Wd - 1.6, 1.3, { mapKind: 'wall', tag: 'overpass-rubble' });
  // slab landing end: broken concrete + rebar
  for (let k = 0; k < 10; k++) {
    const z = rng.range(-slabW / 2 + 0.3, slabW / 2 - 0.3);
    const p0: [number, number, number] = [landX - 0.2, 0.6, z];
    const p1: [number, number, number] = [landX - rng.range(0.8, 1.8), rng.range(0.3, 1.0), z + rng.range(-0.3, 0.3)];
    asm.tube(rust, p0, p1, 0.018, 4, { cast: false });
  }
  // dangling cables and a bent guard rail off the intact edge
  for (let k = 0; k < 6; k++) {
    const z = rng.range(-halfW + 0.6, halfW - 0.6);
    const top: [number, number, number] = [xb - 0.2, deckTop - 0.5, z];
    const mid: [number, number, number] = [xb + rng.range(0.4, 1.0), 4.6, z + rng.range(-0.3, 0.3)];
    const bot: [number, number, number] = [xb + rng.range(0.8, 2.0), rng.range(2.6, 3.8), z + rng.range(-0.5, 0.5)];
    asm.tube(rubber, top, mid, 0.03, 4, { cast: false });
    asm.tube(rubber, mid, bot, 0.03, 4, { cast: false });
  }

  // ---- shots stop at the deck (nobody can reach it) ----------------------------------------------------------------------------------------------------------------
  asm.collide(b, intactCx, 0, intactLen, Wd, deckTop, { y0: deckTop - deckT, blocksMove: false, mapKind: 'none', tag: 'overpass-deck' });
  asm.collide(b, stubX0 + stubLen / 2, 0, stubLen, Wd, deckTop, { y0: deckTop - deckT, blocksMove: false, mapKind: 'none', tag: 'overpass-deck' });
  asm.commit(b);
}
