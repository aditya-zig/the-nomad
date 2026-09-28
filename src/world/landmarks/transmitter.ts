/**
 * The defense-contract relay station: 22 m comms tower with a rotating dish, equipment shack, generators, console,
 * cable runs and painted floor markings for the defense circle. Dark and dead until `setState` brings it to life.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LampSpec, LevelBuilder } from '../builder';
import type { TransmitterHandle } from '../landmarks';
import type { Place } from '../props';
import { Assembly, Rng, addLattice, addPlatform, cached, emissiveMat, glowSprite, lerp, makeDish, seedFrom } from './util';
import { type ConsoleState, defenseRingTexture, drawConsoleScreen, signMaterial } from './tex';

const AMBER = new THREE.Color(0xffa020);
const CYAN = new THREE.Color(0x3fd8ff);
const GREENC = new THREE.Color(0x35ff80);
const OFFC = new THREE.Color(0x000000);

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function buildTransmitterSite(b: LevelBuilder, o: Place & { radius: number }): TransmitterHandle {
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 22));

  const steelDark = m.get('steelDark');
  const steel = m.get('steel');
  const concreteDark = m.get('concreteDark');
  const concrete = m.get('concreteWall');
  const corrugated = m.get('corrugated');
  const roof = m.get('roof');
  const hazard = m.get('hazard');
  const rubber = m.get('rubber');
  const grating = m.get('grating');
  const glassDark = m.get('glassDark');
  const orange = cached('spire:orange', () => new THREE.MeshStandardMaterial({ color: 0xa9481c, roughness: 0.62, metalness: 0.35 }));
  const white = cached('spire:white', () => new THREE.MeshStandardMaterial({ color: 0xb7b3a6, roughness: 0.6, metalness: 0.3 }));
  const dishMat = cached('spire:dish', () => new THREE.MeshStandardMaterial({ color: 0xc4c6c4, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }));
  const olive = cached('xmit:olive', () => new THREE.MeshStandardMaterial({ color: 0x4a5738, roughness: 0.62, metalness: 0.45 }));
  const yellow = cached('xmit:yellow', () => new THREE.MeshStandardMaterial({ color: 0xc9a521, roughness: 0.6, metalness: 0.2 }));

  // ---- floor markings for the defense circle ------------------------------------------------------------------------
  {
    const tex = defenseRingTexture();
    const size = ((o.radius * 2) / 496) * 512;
    const mat = cached(
      'xmit:ringMat',
      () =>
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          roughness: 0.85,
          metalness: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
    );
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = 0;
    plane.position.y = 0.035;
    plane.receiveShadow = true;
    plane.castShadow = false;
    asm.group.add(plane);
    // hazard-striped pad around the tower footing
    for (const [lx, lz, w, d] of [
      [0, -2.75, 5.9, 0.35],
      [0, 2.75, 5.9, 0.35],
      [-2.75, 0, 0.35, 5.2],
      [2.75, 0, 0.35, 5.2],
    ] as const) {
      asm.box(hazard, w, 0.03, d, lx, 0.015, lz, { cast: false });
    }
  }

  // ---- tower ------------------------------------------------------------------------------------------------------
  const footY = 1.2;
  const towerTop = 21.4;
  const halfBase = 1.55;
  const halfTop = 0.42;
  const halfAt = (y: number) => lerp(halfBase, halfTop, (y - footY) / (towerTop - footY));
  asm.box(concreteDark, 5.0, 0.32, 5.0, 0, 0.16, 0, { cast: false });
  asm.box(concrete, 4.5, footY - 0.32, 4.5, 0, (footY + 0.32) / 2, 0);
  asm.box(hazard, 4.56, 0.26, 4.56, 0, 0.62, 0, { cast: false });
  const panels = 10;
  for (let band = 0; band < 5; band++) {
    const y0 = lerp(footY, towerTop, (band * 2) / panels);
    const y1 = lerp(footY, towerTop, (band * 2 + 2) / panels);
    addLattice(asm, {
      y0,
      y1,
      halfBase: halfAt(y0),
      halfTop: halfAt(y1),
      panels: 2,
      legThickBase: lerp(0.22, 0.09, (y0 - footY) / (towerTop - footY)),
      legThickTop: lerp(0.22, 0.09, (y1 - footY) / (towerTop - footY)),
      braceThick: 0.06,
      legMat: band % 2 === 0 ? orange : white,
      braceMat: steelDark,
      cross: true,
      planBraceEvery: 2,
    });
  }
  // base plates
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    asm.box(steel, 0.7, 0.08, 0.7, sx * halfBase, footY + 0.04, sz * halfBase, { cast: false });
  }
  // ladder on the +Z face, safety hoops
  {
    const zAt = (y: number) => halfAt(y) + 0.06;
    asm.strut(steelDark, [-0.22, footY, zAt(footY)], [-0.22, towerTop, zAt(towerTop)], 0.04);
    asm.strut(steelDark, [0.22, footY, zAt(footY)], [0.22, towerTop, zAt(towerTop)], 0.04);
    for (let y = footY + 0.4; y < towerTop; y += 0.38) asm.strut(steelDark, [-0.22, y, zAt(y)], [0.22, y, zAt(y)], 0.025, { cast: false });
  }
  // platforms: mid (dish level) and top
  addPlatform(asm, 16.0, halfAt(16.0), grating, steelDark, steel);
  addPlatform(asm, towerTop, halfAt(towerTop), grating, steelDark, steel);
  // mast + beacon housing
  asm.taper(steel, 0.04, 0.12, 2.6, 0, towerTop + 1.3, 0, 8);
  asm.sphere(steelDark, 0.22, 0, towerTop + 2.65, 0, 10);
  // cable bundle up one leg
  asm.tube(rubber, [halfBase + 0.3, footY, halfBase + 0.3], [halfAt(16) + 0.3, 16, halfAt(16) + 0.3], 0.055, 6, { cast: false });

  // ---- console (faces local +X, the operator stands at +X) ------------------------------------------------------------------
  const consoleX = 3.8;
  asm.box(steelDark, 0.75, 0.95, 1.5, consoleX, 0.475, 0); // pedestal
  asm.box(concreteDark, 1.05, 0.06, 1.72, consoleX, 0.98, 0, { cast: false }); // top slab
  asm.box(olive, 0.5, 0.07, 1.4, consoleX + 0.1, 1.08, 0, { rz: -0.28 }); // keyboard deck sloping toward the operator
  for (let i = -3; i <= 3; i++) asm.box(steel, 0.08, 0.035, 0.09, consoleX + 0.1, 1.15, i * 0.19, { rz: -0.28, cast: false });
  const bx = consoleX - 0.22;
  asm.box(steelDark, 0.12, 0.72, 1.22, bx, 1.4, 0, { rz: 0.22 }); // screen bezel (tilted back)
  asm.box(steelDark, 0.16, 0.42, 0.5, bx - 0.05, 1.1, 0, { cast: false }); // stand
  asm.tube(rubber, [consoleX - 0.4, 0.05, 0.3], [1.9, 0.05, 0.9], 0.04, 5, { cast: false });
  asm.tube(rubber, [consoleX - 0.4, 0.05, -0.3], [2.0, 0.05, -0.8], 0.04, 5, { cast: false });
  asm.collide(b, consoleX, 0, 0.8, 1.6, 1.15, { mapKind: 'prop', surface: 'metal', tag: 'relay-console' });
  // equipment cabinet next to the console
  asm.box(olive, 0.9, 1.5, 0.7, consoleX - 0.2, 0.75, -3.0);
  asm.box(hazard, 0.94, 0.22, 0.74, consoleX - 0.2, 0.3, -3.0, { cast: false });
  asm.collide(b, consoleX - 0.2, -3.0, 0.9, 0.7, 1.5, { mapKind: 'prop', surface: 'metal', tag: 'relay-cabinet' });

  // ---- tower footing collider ----------------------------------------------------------------------------------------------
  asm.collide(b, 0, 0, 4.5, 4.5, footY, { mapKind: 'building', tag: 'relay-tower-base' });

  // ---- equipment shack (not enterable) ---------------------------------------------------------------------------------------
  {
    const sx = -6.6;
    const sz = -2.2;
    const w = 5.2;
    const d = 3.4;
    const h = 3.0;
    asm.box(concreteDark, w + 0.3, 0.3, d + 0.3, sx, 0.15, sz, { cast: false });
    asm.box(corrugated, w, h, d, sx, h / 2 + 0.15, sz);
    asm.box(roof, w + 0.4, 0.14, d + 0.4, sx, h + 0.22, sz);
    asm.box(steelDark, w + 0.44, 0.1, 0.1, sx, h + 0.1, sz + d / 2 + 0.2, { cast: false });
    // door + frame on the tower-facing (+X) wall
    const fx = sx + w / 2;
    asm.box(steelDark, 0.12, 2.25, 1.1, fx + 0.05, 1.28, sz + 0.9);
    asm.box(steel, 0.05, 2.1, 0.94, fx + 0.12, 1.25, sz + 0.9, { cast: false });
    asm.box(steel, 0.06, 0.1, 0.32, fx + 0.14, 1.2, sz + 1.2, { cast: false }); // handle
    // window
    asm.box(steelDark, 0.1, 0.95, 1.4, fx + 0.03, 1.9, sz - 0.9, { cast: false });
    asm.box(glassDark, 0.04, 0.8, 1.25, fx + 0.06, 1.9, sz - 0.9, { cast: false });
    // sign
    const sign = asm.box(signMaterial(['RELAY STN 7', 'AUTHORIZED PERSONNEL'], { bg: '#8b8f7f', fg: '#1a1d17', aspect: 2.6 }), 1.3, 0.5, 0.04, fx + 0.1, 2.7, sz + 0.9, { ry: Math.PI / 2, cast: false });
    sign.userData.worldUV = false;
    // roof gear: AC, vents, whip antenna, conduit
    asm.box(steel, 1.1, 0.75, 0.8, sx - 1.2, h + 0.7, sz + 0.2);
    asm.cyl(steelDark, 0.32, 0.06, sx - 1.2, h + 1.1, sz + 0.2, 14, { cast: false });
    asm.cyl(steel, 0.09, 0.7, sx + 1.5, h + 0.6, sz - 0.6, 8);
    asm.cyl(steel, 0.09, 0.5, sx + 1.9, h + 0.5, sz - 0.6, 8);
    asm.cyl(steelDark, 0.02, 3.2, sx + 2.2, h + 1.7, sz + 0.9, 5, { cast: false });
    asm.tube(rubber, [fx + 0.14, 2.9, sz + 0.2], [fx + 0.14, 0.4, sz + 0.2], 0.05, 5, { cast: false });
    // side vent louvres
    for (let i = 0; i < 5; i++) asm.box(steelDark, 0.05, 0.05, 1.0, sx - w / 2 - 0.02, 1.5 + i * 0.12, sz, { cast: false });
    asm.collide(b, sx, sz, w, d, h + 0.3, { mapKind: 'building', tag: 'relay-shack' });
  }

  // ---- generators ------------------------------------------------------------------------------------------------------------
  const gen = (lx: number, lz: number, ry: number) => {
    asm.box(steelDark, 2.7, 0.2, 1.35, lx, 0.1, lz, { ry, cast: false });
    asm.box(olive, 2.35, 0.95, 1.1, lx, 0.68, lz, { ry });
    asm.box(steel, 1.6, 0.28, 0.9, lx, 1.3, lz, { ry });
    asm.cyl(steelDark, 0.07, 0.9, lx + Math.cos(ry) * 0.8, 1.55, lz - Math.sin(ry) * 0.8, 8, { cast: false });
    asm.box(steelDark, 0.55, 0.42, 0.05, lx + Math.sin(ry) * 0.58, 0.9, lz + Math.cos(ry) * 0.58, { ry, cast: false });
    for (let i = 0; i < 4; i++) asm.box(steel, 0.05, 0.6, 0.06, lx - Math.cos(ry) * 1.2, 0.72, lz + Math.sin(ry) * 1.2 + (i - 1.5) * 0.22, { ry, cast: false });
    const p = asm.world(lx, lz);
    b.collide({ x: p.x, z: p.z, hx: 1.28, hz: 0.68, rot: rot + ry, y0: asm.y, y1: asm.y + 1.45, mapKind: 'prop', surface: 'metal', tag: 'relay-generator' });
  };
  gen(-6.4, 2.7, 0.0);
  gen(-3.2, 4.4, 0.35);
  // jerry cans + cable ramps
  for (const [lx, lz, ry] of [
    [-4.5, 2.2, 0.4],
    [-4.2, 2.6, -0.3],
    [-8.4, 3.6, 0.1],
  ] as const) {
    asm.box(olive, 0.36, 0.5, 0.18, lx, 0.25, lz, { ry, cast: false });
  }
  asm.tube(rubber, [-4.1, 0.05, -1.4], [-3.3, 0.05, 2.9], 0.05, 5, { cast: false });
  asm.tube(rubber, [-3.3, 0.05, 2.9], [-2.8, 0.05, 4.0], 0.05, 5, { cast: false });
  asm.tube(rubber, [-3.9, 0.05, -1.2], [-2.4, 0.05, -0.2], 0.06, 5, { cast: false });
  asm.tube(rubber, [-2.4, 0.05, -0.2], [-2.4, 0.05, 0.0], 0.06, 5, { cast: false });
  for (const [lx, lz, ry] of [
    [-3.6, 0.6, 1.2],
    [-3.3, 2.0, 1.5],
    [-2.9, 3.4, 1.2],
  ] as const) {
    asm.box(yellow, 0.7, 0.09, 0.28, lx, 0.045, lz, { ry, cast: false });
  }
  // debris / detail: fallen crates and a toppled drum for a lived-in look
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(5.5, o.radius * 0.85);
    asm.box(concreteDark, rng.range(0.15, 0.4), rng.range(0.06, 0.16), rng.range(0.15, 0.4), Math.cos(a) * r, 0.05, Math.sin(a) * r, { ry: rng.range(0, 3), cast: false });
  }

  for (const [lx, lz] of [
    [-6.6 + 1.8, -2.2 + 1.75],
    [-6.6 - 1.4, -2.2 + 1.75],
  ] as const) {
    asm.box(steelDark, 0.09, 0.5, 0.09, lx, 3.5, lz, { cast: false });
  }

  // floodlight heads: static housings on the tower legs (x4) and the shack roof (x2); lenses are dynamic (below)
  const floodDefs: { lx: number; y: number; lz: number; ry: number }[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const y = 3.7;
    const h = halfAt(y) + 0.35;
    floodDefs.push({ lx: sx * h, y, lz: sz * h, ry: Math.atan2(sx, sz) });
  }
  floodDefs.push({ lx: -6.6 + 1.8, y: 3.75, lz: -2.2 + 1.75, ry: 0.2 });
  floodDefs.push({ lx: -6.6 - 1.4, y: 3.75, lz: -2.2 + 1.75, ry: -0.35 });
  for (const f of floodDefs) {
    asm.box(steelDark, 0.5, 0.28, 0.26, f.lx, f.y, f.lz, { ry: f.ry });
    asm.box(steel, 0.06, 0.06, 0.4, f.lx - Math.sin(f.ry) * 0.16, f.y - 0.16, f.lz - Math.cos(f.ry) * 0.16, { ry: f.ry, cast: false });
  }

  asm.commit(b);

  // ---- dynamic parts ----------------------------------------------------------------------------------------------------------
  const dyn = new THREE.Group();
  dyn.position.set(o.x, o.y ?? 0, o.z);
  dyn.rotation.y = rot;

  // rotating dish
  const pivot = new THREE.Group();
  pivot.position.set(0, 18.7, 0);
  dyn.add(pivot);
  const dish = makeDish(dishMat, steel, 1.25);
  dish.position.set(1.7, 0, 0);
  dish.rotation.order = 'YXZ';
  dish.rotation.y = Math.PI / 2; // +Z (dish axis) -> +X (outward from the pivot)
  dish.rotation.x = -0.15;
  pivot.add(dish);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), steelDark.clone());
  arm.position.set(0.85, -0.1, 0);
  pivot.add(arm);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), steelDark.clone());
  collar.position.set(0, 0, 0);
  pivot.add(collar);
  pivot.rotation.y = 0.9;

  // tower status lights: one instanced mesh, per-instance HDR colour
  const NL = 8;
  const lightMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), NL);
  {
    const mat4 = new THREE.Matrix4();
    for (let i = 0; i < NL; i++) {
      const y = 3.4 + i * 2.05;
      const k = i % 4;
      const sx = k === 0 || k === 3 ? -1 : 1;
      const sz = k < 2 ? -1 : 1;
      const h = halfAt(y) + 0.16;
      mat4.makeTranslation(sx * h, y, sz * h);
      lightMesh.setMatrixAt(i, mat4);
      lightMesh.setColorAt(i, new THREE.Color(0.03, 0.035, 0.04));
    }
  }
  lightMesh.frustumCulled = false;
  dyn.add(lightMesh);
  const lightCol = new THREE.Color();
  // top beacon
  const topMat = emissiveMat(0xffa020, 0, 0x0a0d10);
  const topBulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), topMat);
  topBulb.position.set(0, towerTop + 2.65, 0);
  dyn.add(topBulb);
  const glowTex = m.glowTexture;
  const topGlow = glowSprite(glowTex, 0xffa020, 3.0, 2.2, 0);
  topGlow.position.copy(topBulb.position);
  dyn.add(topGlow);
  const consoleGlow = glowSprite(glowTex, 0x3fd8ff, 1.6, 1.4, 0);
  consoleGlow.position.set(consoleX - 0.3, 1.55, 0);
  dyn.add(consoleGlow);

  // floodlight lenses: all six quads merged into one dynamic mesh with a shared emissive material
  const lensMat = emissiveMat(0xdfeaff, 0, 0x1a1e22);
  const floodLamps: LampSpec[] = [];
  const lensGeos: THREE.BufferGeometry[] = [];
  for (const f of floodDefs) {
    const lens = new THREE.PlaneGeometry(0.4, 0.2);
    lens.rotateY(f.ry);
    lens.translate(f.lx + Math.sin(f.ry) * 0.141, f.y, f.lz + Math.cos(f.ry) * 0.141);
    lensGeos.push(lens);
    const p = asm.world(f.lx + Math.sin(f.ry) * 0.5, f.lz + Math.cos(f.ry) * 0.5);
    const lamp: LampSpec = { x: p.x, y: f.y + (o.y ?? 0) - 0.1, z: p.z, color: 0xdfeaff, intensity: 0, distance: 24, weight: 1.1, tag: 'relay-flood' };
    b.light(lamp);
    floodLamps.push(lamp);
  }
  const lensMerged = mergeGeometries(lensGeos, false)!;
  for (const g of lensGeos) g.dispose();
  dyn.add(new THREE.Mesh(lensMerged, lensMat));
  // console light
  const consolePos = asm.world(consoleX - 0.5, 0);
  const consoleLamp: LampSpec = { x: consolePos.x, y: (o.y ?? 0) + 1.6, z: consolePos.z, color: 0xffa020, intensity: 0, distance: 9, weight: 1, tag: 'relay-console' };
  b.light(consoleLamp);

  // console screen (canvas texture)
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 200;
  const ctx = cv.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(cv);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.2, color: 0x0a0c0e, roughness: 0.3, metalness: 0.1 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.7), screenMat);
  // sits on the bezel's front face (facing local +X)
  screen.position.set(bx + 0.07, 1.415, 0);
  screen.rotation.order = 'ZYX'; // yaw to face +X first, then tilt back about the Z axis
  screen.rotation.y = Math.PI / 2;
  screen.rotation.z = 0.22;
  dyn.add(screen);
  b.addDynamic(dyn);

  // ---- state machine ------------------------------------------------------------------------------------------------------------
  let state: ConsoleState = 'off';
  let progress = 0;
  let stateT = 0;
  let lastScreenKey = '';
  let dishSpin = 0;
  let dishSpeed = 0;
  let power = 0; // smoothed flood power 0..1
  const tmp = new THREE.Color();
  let clock = 0;

  const redraw = (time: number, force: boolean) => {
    const key = `${state}|${Math.round(progress * 100)}|${state === 'active' ? Math.floor(time * 6) : 0}`;
    if (!force && key === lastScreenKey) return;
    lastScreenKey = key;
    drawConsoleScreen(ctx, cv.width, cv.height, state, progress, time);
    screenTex.needsUpdate = true;
  };
  redraw(0, true);

  b.tick((dt, time) => {
    clock = time;
    stateT += dt;
    // dish
    const targetSpeed = state === 'active' ? 0.75 : 0;
    dishSpeed += (targetSpeed - dishSpeed) * (1 - Math.exp(-dt * (state === 'done' ? 1.4 : 2.2)));
    dishSpin += dishSpeed * dt;
    pivot.rotation.y = 0.9 + dishSpin;

    // floodlights: flicker on when the site powers up
    const wantPower = state === 'active' ? 1 : state === 'done' ? 0.7 : 0;
    let target = wantPower;
    if (wantPower > 0 && stateT < 1.2 && state !== 'done') target = hash(Math.floor(stateT * 16) + 3.1) > 0.5 ? wantPower : 0.05;
    power += (target - power) * (1 - Math.exp(-dt * 14));
    lensMat.emissiveIntensity = power * 3.2;
    for (const l of floodLamps) l.intensity = 95 * power;

    // tower lights
    const lit = Math.ceil(progress * NL);
    for (let i = 0; i < NL; i++) {
      let col = OFFC;
      let inten = 0;
      if (state === 'ready') {
        col = AMBER;
        inten = ((clock + i * 0.11) % 1.8) < 0.22 ? 2.6 : 0.15;
      } else if (state === 'active') {
        col = CYAN;
        const front = i === lit - 1;
        inten = i < lit ? (front ? 2.4 + 1.6 * Math.sin(clock * 9) : 2.6) : 0.18;
      } else if (state === 'done') {
        col = GREENC;
        inten = 2.4;
      }
      lightCol.copy(col).multiplyScalar(inten);
      lightCol.r += 0.03;
      lightCol.g += 0.035;
      lightCol.b += 0.04;
      lightMesh.setColorAt(i, lightCol);
    }
    lightMesh.instanceColor!.needsUpdate = true;
    // top beacon
    let topOn = 0;
    tmp.copy(OFFC);
    if (state === 'ready') {
      tmp.copy(AMBER);
      topOn = clock % 1.8 < 0.4 ? 1 : 0.05;
    } else if (state === 'active') {
      tmp.copy(CYAN);
      topOn = clock % 0.7 < 0.18 ? 1 : 0.12;
    } else if (state === 'done') {
      tmp.copy(GREENC);
      topOn = 0.85;
    }
    topMat.emissive.copy(tmp);
    topMat.emissiveIntensity = topOn * 4.5;
    topGlow.material.color.copy(tmp).multiplyScalar(2.2);
    topGlow.material.opacity = topOn * 0.9;
    // console lamp + glow
    if (state === 'off') {
      consoleLamp.intensity = 0;
      consoleGlow.material.opacity = 0;
    } else if (state === 'ready') {
      consoleLamp.color = 0xffa020;
      consoleLamp.intensity = 26;
      consoleLamp.mode = 'steady';
      consoleGlow.material.color.copy(AMBER).multiplyScalar(1.4);
      consoleGlow.material.opacity = 0.5;
    } else if (state === 'active') {
      consoleLamp.color = 0x3fd8ff;
      consoleLamp.intensity = 70;
      consoleLamp.mode = 'pulse';
      consoleLamp.period = 1.4;
      consoleGlow.material.color.copy(CYAN).multiplyScalar(1.4);
      consoleGlow.material.opacity = 0.55;
    } else {
      consoleLamp.color = 0x35ff80;
      consoleLamp.intensity = 55;
      consoleLamp.mode = 'steady';
      consoleGlow.material.color.copy(GREENC).multiplyScalar(1.4);
      consoleGlow.material.opacity = 0.5;
    }
    screenMat.emissiveIntensity = state === 'off' ? 0.25 : 1.2;
    redraw(time, false);
  });

  const cp = asm.world(consoleX, 0);
  return {
    console: { x: cp.x, y: (o.y ?? 0) + 1.4, z: cp.z },
    consoleYaw: rot - Math.PI / 2,
    setState(s) {
      if (s === state) return;
      state = s;
      stateT = 0;
      if (s === 'off') progress = 0;
      redraw(clock, true);
    },
    setProgress(p) {
      progress = Math.max(0, Math.min(1, p));
    },
  };
}
