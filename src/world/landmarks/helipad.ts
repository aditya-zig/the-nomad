/**
 * Helipad: painted concrete disc with worn ring / H / chevron markings, a ring of amber edge lights with a chase
 * pattern, and an animated windsock. Flush with the ground (no collider) except the windsock mast.
 */
import * as THREE from 'three';
import type { LampSpec, LevelBuilder } from '../builder';
import type { Place } from '../props';
import { Assembly, Rng, cached, seedFrom } from './util';
import { helipadTexture } from './tex';

function scaledUv(g: THREE.BufferGeometry, k: number): void {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
}

export function buildHelipad(b: LevelBuilder, o: Place & { radius?: number }): void {
  const R = o.radius ?? 11;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 11));
  const slab = m.get('concreteSlab');
  const dark = m.get('concreteDark');
  const steelDark = m.get('steelDark');
  const steel = m.get('steel');
  const amberEm = m.get('emAmber');
  const tileS = (slab.userData.tile as number | undefined) ?? 6;
  const tileD = (dark.userData.tile as number | undefined) ?? 4;

  // pad disc + rim
  const disc = new THREE.CircleGeometry(R, 80);
  disc.rotateX(-Math.PI / 2);
  scaledUv(disc, (2 * R) / tileS);
  asm.mesh(disc, slab, 0, 0.03, 0, { cast: false });
  const rim = new THREE.RingGeometry(R, R + 1.1, 80);
  rim.rotateX(-Math.PI / 2);
  scaledUv(rim, (2 * (R + 1.1)) / tileD);
  asm.mesh(rim, dark, 0, 0.022, 0, { cast: false });
  // expansion joints (thin dark strips across the pad)
  const jointMat = cached('helipad:joint', () => new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 1 }));
  for (const off of [-R * 0.5, 0, R * 0.5]) {
    const half = Math.sqrt(Math.max(0, R * R - off * off));
    asm.box(jointMat, half * 2 - 0.4, 0.004, 0.06, 0, 0.034, off, { cast: false, receive: false });
    asm.box(jointMat, 0.06, 0.004, half * 2 - 0.4, off, 0.034, 0, { cast: false, receive: false });
  }
  // painted markings
  {
    const size = (2 * R) / 0.955;
    const mat = cached(
      'helipad:paint',
      () =>
        new THREE.MeshStandardMaterial({
          map: helipadTexture(),
          transparent: true,
          roughness: 0.8,
          metalness: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
    );
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.04;
    plane.receiveShadow = true;
    asm.group.add(plane);
  }

  // edge lights
  const N = 24;
  const lr = R + 0.5;
  const lampBase = new THREE.CylinderGeometry(0.16, 0.19, 0.08, 10);
  const lampDome = new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * lr;
    const z = Math.sin(a) * lr;
    const base = new THREE.Mesh(lampBase, steelDark);
    base.position.set(x, 0.04, z);
    base.receiveShadow = true;
    asm.group.add(base);
    const dome = new THREE.Mesh(lampDome, amberEm);
    dome.position.set(x, 0.08, z);
    asm.group.add(dome);
    const p = asm.world(x, z);
    b.glow({ x: p.x, y: asm.y + 0.22, z: p.z, color: 0xffa838, size: 0.55, intensity: 1.3, mode: 'steady' });
    b.glow({ x: p.x, y: asm.y + 0.28, z: p.z, color: 0xffb95a, size: 1.05, intensity: 2.2, mode: 'blink', period: 2.4, duty: 0.14, phase: (i / N) * 2.4 });
  }
  // four real lamps on the pad edge (subtle amber wash on the concrete)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const p = asm.world(Math.cos(a) * (R + 0.7), Math.sin(a) * (R + 0.7));
    const lamp: LampSpec = { x: p.x, y: asm.y + 1.0, z: p.z, color: 0xffb060, intensity: 70, distance: 15, weight: 0.9, pool: 7, tag: 'helipad' };
    b.light(lamp);
  }
  // tie-down rings + a few scuffs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const g = new THREE.TorusGeometry(0.12, 0.025, 6, 12);
    g.rotateX(Math.PI / 2);
    asm.mesh(g, steel, Math.cos(a) * (R - 0.9), 0.045, Math.sin(a) * (R - 0.9), { cast: false });
  }

  // windsock mast (collider) - dynamic sock built below
  const ma = 0.62;
  const mx = Math.cos(ma) * (R + 2.4);
  const mz = Math.sin(ma) * (R + 2.4);
  asm.box(dark, 0.6, 0.3, 0.6, mx, 0.15, mz, { cast: false });
  asm.cyl(steel, 0.05, 5.0, mx, 2.8, mz, 8);
  asm.cyl(steelDark, 0.09, 0.4, mx, 0.5, mz, 8, { cast: false });
  asm.collide(b, mx, mz, 0.5, 0.5, 4.5, { mapKind: 'prop', surface: 'metal', tag: 'windsock' });
  // red obstruction light on the mast top
  {
    const p = asm.world(mx, mz);
    b.glow({ x: p.x, y: asm.y + 5.4, z: p.z, color: 0xff2412, size: 0.9, intensity: 2.6, mode: 'blink', period: 1.8, duty: 0.35, phase: 0.2 });
  }
  asm.commit(b);

  // ---- windsock (dynamic) -----------------------------------------------------------------------------------------------------------------
  const orange = cached('helipad:sockOrange', () => new THREE.MeshStandardMaterial({ color: 0xd2621c, roughness: 0.85, side: THREE.DoubleSide }));
  const whiteM = cached('helipad:sockWhite', () => new THREE.MeshStandardMaterial({ color: 0xd8d5cb, roughness: 0.85, side: THREE.DoubleSide }));
  const top = new THREE.Group();
  const pp = asm.world(mx, mz);
  top.position.set(pp.x, (o.y ?? 0) + 5.05, pp.z);
  const yawRoot = new THREE.Group();
  top.add(yawRoot);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 20), steel);
  ring.rotation.y = Math.PI / 2;
  yawRoot.add(ring);
  const segs: THREE.Group[] = [];
  const segLen = 0.44;
  let parent: THREE.Object3D = yawRoot;
  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(i === 0 ? 0 : segLen, 0, 0);
    const r0 = 0.33 - i * 0.045;
    const r1 = 0.33 - (i + 1) * 0.045;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, segLen, 12, 1, true), i % 2 === 0 ? orange : whiteM);
    cyl.rotation.z = Math.PI / 2;
    cyl.position.x = segLen / 2;
    cyl.castShadow = true;
    pivot.add(cyl);
    parent.add(pivot);
    parent = pivot;
    segs.push(pivot);
  }
  b.addDynamic(top);
  const phase = rng.range(0, 6);
  const baseYaw = -0.8 - rot;
  b.tick((_dt, time) => {
    const t = time + phase;
    const wind = 0.62 + 0.18 * Math.sin(t * 0.55) + 0.12 * Math.sin(t * 1.7 + 1.3);
    yawRoot.rotation.y = baseYaw + 0.45 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.9);
    const droop = (1 - wind) * 1.05;
    for (let i = 0; i < segs.length; i++) {
      segs[i]!.rotation.z = -(droop * (0.5 + i * 0.28)) + 0.05 * Math.sin(t * 3.1 + i * 0.9) * (1 - wind + 0.2);
    }
  });
}
