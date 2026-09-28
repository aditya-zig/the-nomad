/**
 * THE SPIRE - the contamination landmark. A 58 m tapered lattice tower on a heavy warning-striped plinth with a
 * pulsing green contamination core near the top, red aircraft beacons, dish arrays, platforms, guy wires and cable runs.
 * Silhouette-first: it has to read from 100+ m away through fog (fog-immune glow sprites + blinking beacons).
 */
import * as THREE from 'three';
import type { LampSpec, LevelBuilder } from '../builder';
import type { SpireHandle } from '../landmarks';
import type { Place } from '../props';
import { Assembly, Rng, addDishTo, addLattice, addPlatform, cached, emissiveMat, glowSprite, lerp, seedFrom } from './util';
import { signMaterial } from './tex';

const GREEN = new THREE.Color(0x2bff70);
const RED = new THREE.Color(0xff2a14);

export function buildSpire(b: LevelBuilder, o: Place & { height?: number }): SpireHandle {
  const H = o.height ?? 58;
  const k = H / 58;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 58));

  const steelDark = m.get('steelDark');
  const steel = m.get('steel');
  const concreteDark = m.get('concreteDark');
  const concrete = m.get('concreteWall');
  const hazard = m.get('hazard');
  const rubber = m.get('rubber');
  const grating = m.get('grating');
  const orange = cached('spire:orange', () => new THREE.MeshStandardMaterial({ color: 0xa9481c, roughness: 0.62, metalness: 0.35 }));
  const white = cached('spire:white', () => new THREE.MeshStandardMaterial({ color: 0xb7b3a6, roughness: 0.6, metalness: 0.3 }));
  const dishMat = cached('spire:dish', () => new THREE.MeshStandardMaterial({ color: 0xc4c6c4, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide }));
  const glassMat = cached(
    'spire:glass',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x9fe8c0,
        transparent: true,
        opacity: 0.16,
        roughness: 0.1,
        metalness: 0,
        depthWrite: false,
      }),
  );

  // ---- plinth -------------------------------------------------------------------------------
  const apronH = 0.38;
  const blockTop = 1.65;
  asm.box(concreteDark, 13, apronH, 13, 0, apronH / 2, 0, { cast: false });
  asm.box(concrete, 10.6, blockTop - apronH, 10.6, 0, (blockTop + apronH) / 2, 0);
  asm.box(hazard, 10.72, 0.34, 10.72, 0, 1.05, 0, { cast: false });
  asm.box(concreteDark, 10.95, 0.26, 10.95, 0, blockTop + 0.13, 0); // cornice cap
  const plinthTop = blockTop + 0.26;
  // corner base plates, gussets and anchor nuts
  const hb = 3.9;
  const cornerSigns: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sz] of cornerSigns) {
    asm.box(steel, 1.15, 0.1, 1.15, sx * hb, plinthTop + 0.05, sz * hb, { cast: false });
    for (const [ax, az] of [
      [-0.42, -0.42],
      [0.42, -0.42],
      [0.42, 0.42],
      [-0.42, 0.42],
    ] as const) {
      asm.cyl(steelDark, 0.045, 0.13, sx * hb + ax, plinthTop + 0.16, sz * hb + az, 6, { cast: false });
    }
  }

  // ---- lattice ---------------------------------------------------------------------------------
  const latY0 = plinthTop + 0.1;
  const latY1 = 40.6 * k;
  const halfBase = 3.9;
  const halfTop = 1.15;
  const ease = (t: number): number => 1 - Math.pow(1 - t, 1.45);
  const halfAt = (y: number): number => lerp(halfBase, halfTop, ease((y - latY0) / (latY1 - latY0)));
  const panels = Math.round(22 * k);
  // painted bands on the legs alternate orange / dark steel, braces stay dark
  const bandPanels = 3;
  for (let band = 0; band * bandPanels < panels; band++) {
    const p0 = band * bandPanels;
    const p1 = Math.min(panels, p0 + bandPanels);
    const y0 = lerp(latY0, latY1, p0 / panels);
    const y1 = lerp(latY0, latY1, p1 / panels);
    const legMat = band % 2 === 0 ? orange : steelDark;
    addLatticeSlice(asm, y0, y1, p1 - p0, halfAt, legMat, steel, latY0, latY1, panels);
  }
  // top ring of the main lattice
  for (let i = 0; i < 4; i++) {
    const a = cornerSigns[i]!;
    const c = cornerSigns[(i + 1) % 4]!;
    const h = halfTop;
    asm.strut(steel, [a[0] * h, latY1, a[1] * h], [c[0] * h, latY1, c[1] * h], 0.14);
  }

  // ---- ladder up the +Z face ---------------------------------------------------------------------
  const platformYs = [14 * k, 27 * k, latY1];
  {
    const yTop = platformYs[0]!;
    const zAt = (y: number) => halfAt(y) + 0.06;
    asm.strut(steelDark, [-0.26, plinthTop, zAt(plinthTop)], [-0.26, yTop, zAt(yTop)], 0.05);
    asm.strut(steelDark, [0.26, plinthTop, zAt(plinthTop)], [0.26, yTop, zAt(yTop)], 0.05);
    for (let y = plinthTop + 0.4; y < yTop; y += 0.42) asm.strut(steelDark, [-0.26, y, zAt(y)], [0.26, y, zAt(y)], 0.028, { cast: false });
  }

  // ---- platforms ---------------------------------------------------------------------------------
  for (const y of platformYs) addPlatform(asm, y, halfAt(y), grating, steelDark, steel);

  // ---- cable bundles along two legs ------------------------------------------------------------
  for (const [sx, sz] of [cornerSigns[1]!, cornerSigns[3]!]) {
    const o1 = 0.34;
    const yMid = platformYs[1]!;
    asm.tube(rubber, [sx * (halfBase + o1), plinthTop, sz * (halfBase + o1)], [sx * (halfAt(yMid) + o1), yMid, sz * (halfAt(yMid) + o1)], 0.07, 6, { cast: false });
    asm.tube(rubber, [sx * (halfBase + o1 + 0.14), plinthTop, sz * (halfBase + o1)], [sx * (halfAt(yMid) + o1 + 0.14), yMid, sz * (halfAt(yMid) + o1)], 0.055, 6, { cast: false });
    for (let y = plinthTop + 1.5; y < yMid; y += 3.1) {
      asm.box(steelDark, 0.3, 0.1, 0.3, sx * (halfAt(y) + o1 + 0.06), y, sz * (halfAt(y) + o1), { cast: false });
    }
  }

  // ---- upper transition + contamination core + mast -------------------------------------------------
  const coreY0 = 43 * k;
  const coreY1 = 51 * k;
  const coreYm = (coreY0 + coreY1) / 2;
  // upper lattice (slimmer)
  addLattice(asm, {
    y0: latY1,
    y1: coreY0,
    halfBase: halfTop,
    halfTop: 0.85,
    panels: 2,
    legThickBase: 0.15,
    legThickTop: 0.13,
    braceThick: 0.08,
    legMat: steelDark,
    braceMat: steel,
    cross: true,
  });
  // mast through the core
  asm.cyl(steel, 0.3, H - coreY0 - 2.4 * k, 0, coreY0 + (H - coreY0 - 2.4 * k) / 2, 0, 10);
  // core bottom / mid / top rings
  for (const y of [coreY0, coreYm, coreY1]) {
    asm.cyl(steelDark, 1.95, 0.22, 0, y, 0, 20);
    asm.cyl(hazard, 1.99, 0.06, 0, y + (y === coreY1 ? -0.13 : 0.13), 0, 20, { cast: false });
  }
  // core ribs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    asm.strut(steelDark, [Math.cos(a) * 1.75, coreY0, Math.sin(a) * 1.75], [Math.cos(a) * 1.75, coreY1, Math.sin(a) * 1.75], 0.13);
  }
  // translucent glass jacket
  asm.cyl(glassMat, 1.62, coreY1 - coreY0, 0, coreYm, 0, 20, { cast: false });
  // crown ornaments: dish array below the core + panel antennas
  const dishY = 37.6 * k;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const r = halfAt(dishY) + 0.55;
    addDishTo(asm.group, dishMat, steel, Math.cos(a) * r, dishY - i * 1.5, Math.sin(a) * r, a, 1.5 + i * 0.25);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.25;
    const r = 1.4;
    asm.box(white, 0.5, 2.2, 0.12, Math.cos(a) * r, coreY1 + 1.6 * k, Math.sin(a) * r, { ry: -a + Math.PI / 2 });
  }
  // upper antenna crossarms
  const armY1 = H - 4.6 * k;
  const armY2 = H - 2.2 * k;
  asm.strut(steel, [-2.1, armY1, 0], [2.1, armY1, 0], 0.09);
  asm.strut(steel, [0, armY2, -1.6], [0, armY2, 1.6], 0.09);
  for (const s of [-2.1, 2.1]) asm.tube(steelDark, [s, armY1, 0], [s, armY1 + 1.6, 0], 0.03, 5, { cast: false });
  for (const s of [-1.6, 1.6]) asm.tube(steelDark, [0, armY2, s], [0, armY2 + 1.2, s], 0.03, 5, { cast: false });
  // top spike + beacon housing
  asm.taper(steel, 0.05, 0.2, 2.6 * k, 0, H - 1.3 * k, 0, 8);
  asm.sphere(steelDark, 0.28, 0, H + 0.05, 0, 10);

  // ---- guy wires to anchor pylons -------------------------------------------------------------------
  const wireTopY = coreY0;
  const anchorR = 19 * k;
  const pylonH = 6;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ax = Math.cos(a) * anchorR;
    const az = Math.sin(a) * anchorR;
    const tx = Math.cos(a) * 1.85;
    const tz = Math.sin(a) * 1.85;
    asm.strut(steelDark, [tx, wireTopY, tz], [ax, pylonH, az], 0.06, { cast: false });
    // insulators every ~12 m along the wire
    for (let f = 0.25; f < 0.95; f += 0.25) {
      asm.box(white, 0.16, 0.16, 0.16, lerp(tx, ax, f), lerp(wireTopY, pylonH, f), lerp(tz, az, f), { cast: false });
    }
    asm.box(concrete, 1.3, 1.4, 1.3, ax, 0.7, az);
    asm.box(steelDark, 0.4, pylonH - 1.4, 0.4, ax, 1.4 + (pylonH - 1.4) / 2, az);
    asm.box(hazard, 1.34, 0.3, 1.34, ax, 0.5, az, { cast: false });
    asm.collide(b, ax, az, 1.3, 1.3, 1.4, { mapKind: 'prop', tag: 'spire-anchor' });
  }

  // ---- service equipment around the plinth -------------------------------------------------------------
  const cab = (lx: number, lz: number, ry: number) => {
    asm.box(oliveCab(), 2.2, 2.3, 1.4, lx, 1.15, lz, { ry });
    asm.box(hazard, 2.24, 0.3, 1.44, lx, 0.45, lz, { ry, cast: false });
    for (let i = -1; i <= 1; i += 2) asm.cyl(white, 0.16, 0.5, lx + Math.cos(ry) * i * 0.6, 2.55, lz - Math.sin(ry) * i * 0.6, 8);
    const pos = asm.world(lx, lz);
    b.collide({ x: pos.x, z: pos.z, hx: 1.1, hz: 0.7, rot: rot + ry, y1: 2.5 + asm.y, y0: asm.y, mapKind: 'prop', surface: 'metal', tag: 'spire-cabinet' });
  };
  cab(0, 8.4, 0);
  cab(-8.4, 2.5, Math.PI / 2);
  // cable trench covers (flat) from plinth to cabinets
  asm.box(concreteDark, 0.5, 0.06, 2.4, 1.6, 0.04, 6.6, { cast: false });
  asm.box(concreteDark, 2.6, 0.06, 0.5, -6.8, 0.04, 1.4, { cast: false });
  // warning signs mounted on plinth faces
  const sign1 = signMaterial(['DANGER', 'CONTAMINATION', 'KEEP OUT'], { bg: '#d2ac1c', fg: '#131313', aspect: 2.2 });
  const sign2 = signMaterial(['HIGH VOLTAGE'], { bg: '#c73a22', fg: '#f4ecdc', aspect: 2.4 });
  const signPlane = (mat: THREE.Material, lx: number, lz: number, ry: number, w: number, h: number, y: number) => {
    const mesh = asm.box(mat, w, h, 0.05, lx, y, lz, { ry, cast: false });
    mesh.userData.worldUV = false;
  };
  signPlane(sign1, 0, 5.42, 0, 2.6, 1.2, 1.05);
  signPlane(sign2, -5.42, -1.9, -Math.PI / 2, 1.9, 0.8, 1.1);
  signPlane(sign1, 5.42, 0.5, Math.PI / 2, 2.6, 1.2, 1.05);
  signPlane(sign2, 1.9, -5.42, Math.PI, 1.9, 0.8, 1.1);

  // ---- collider: heavy plinth (apron is a low step, ignored by movement rules) --------------------------------
  asm.collide(b, 0, 0, 10.95, 10.95, blockTop + 0.26, { mapKind: 'building', tag: 'spire-base' });

  asm.commit(b);

  // ---- static red aircraft beacons (fog-immune, GPU blink) ------------------------------------------------------
  const worldPt = (lx: number, y: number, lz: number) => {
    const p = asm.world(lx, lz);
    return { x: p.x, y: y + asm.y, z: p.z };
  };
  const beacon = (lx: number, y: number, lz: number, size: number, phase: number, period = 1.6, duty = 0.3) => {
    const p = worldPt(lx, y, lz);
    b.glow({ ...p, color: 0xff2412, size, intensity: 3.4, mode: 'blink', period, duty, phase });
  };
  beacon(0, H + 0.3, 0, 3.4, 0, 1.6, 0.34);
  beacon(0, H - 6 * k, 0, 1.6, 0.8, 1.6, 0.3);
  for (const y of [platformYs[2]!, platformYs[1]!, platformYs[0]!]) {
    const h = halfAt(y) + 0.75;
    let n = 0;
    for (const [sx, sz] of cornerSigns) {
      beacon(sx * h, y + 1.0, sz * h, 1.3, 0.35 * n + platformYs.indexOf(y) * 0.4, 2.2, 0.2);
      n++;
    }
  }
  // steady red lights on the plinth corners so the base reads at night
  for (const [sx, sz] of cornerSigns) {
    const p = worldPt(sx * 5.9, 0.9, sz * 5.9);
    b.glow({ ...p, color: 0xff4a24, size: 0.9, intensity: 2.2, mode: 'steady' });
  }

  // ---- dynamic contamination core -----------------------------------------------------------------------------------
  const dyn = new THREE.Group();
  dyn.position.set(o.x, o.y ?? 0, o.z);
  dyn.rotation.y = rot;
  const coreMat = emissiveMat(0x2bff70, 2.4, 0x04140a);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, coreY1 - coreY0 - 0.5, 20), coreMat);
  core.position.y = coreYm;
  dyn.add(core);
  const capMat = emissiveMat(0x2bff70, 3.2, 0x04140a);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 12), capMat);
  bulb.position.y = coreYm;
  dyn.add(bulb);
  const tex = m.glowTexture;
  const spriteCore = glowSprite(tex, 0x2bff70, 30 * k, 1.5, 0.5);
  spriteCore.position.set(0, coreYm, 0);
  const spriteHalo = glowSprite(tex, 0x1fe060, 64 * k, 1.0, 0.1);
  spriteHalo.position.set(0, coreYm, 0);
  dyn.add(spriteHalo, spriteCore);
  const surgeFlash: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const s = glowSprite(tex, 0xff2210, 7 * k, 3.0, 0);
    s.position.set(Math.cos(a) * 2.3, coreYm + (i % 2 === 0 ? 2.6 : -2.6), Math.sin(a) * 2.3);
    dyn.add(s);
    surgeFlash.push(s);
  }
  // green platform lamps on the top lattice platform (turn red in surge)
  const platLamps: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sz] = cornerSigns[i]!;
    const h = halfAt(latY1) + 0.5;
    const s = glowSprite(tex, 0x2bff70, 2.6, 1.6, 0.9);
    s.position.set(sx * h, latY1 + 0.5, sz * h);
    dyn.add(s);
    platLamps.push(s);
  }
  b.addDynamic(dyn);

  // pooled lights: big core lamp + two green base up-lights (mutated for surge)
  const corePos = worldPt(0, coreYm, 0);
  const coreLamp: LampSpec = { ...corePos, color: 0x2bff70, intensity: 5200, distance: 95, mode: 'pulse', period: 3.4, phase: 0, weight: 1.2, tag: 'spire-core' };
  b.light(coreLamp);
  const baseLamps: LampSpec[] = [];
  for (const [sx, sz] of [
    [-1, 1],
    [1, -1],
  ] as const) {
    const p = worldPt(sx * 8.6, 2.0, sz * 8.6);
    const lamp: LampSpec = { ...p, color: 0x2bff70, intensity: 230, distance: 28, mode: 'pulse', period: 3.4, phase: 0, weight: 1, pool: 9, tag: 'spire-base' };
    b.light(lamp);
    baseLamps.push(lamp);
  }
  const allLamps = [coreLamp, ...baseLamps];
  const baseIntensity = allLamps.map((l) => l.intensity);

  // ---- animation state ----------------------------------------------------------------------------------------------
  let surge = false;
  let mix = 0; // 0 green .. 1 red
  let acc = rng.f(); // pulse accumulator in cycles
  const tmpColor = new THREE.Color();
  b.tick((dt, time) => {
    mix += ((surge ? 1 : 0) - mix) * (1 - Math.exp(-dt * 1.6));
    const period = lerp(3.4, 1.05, mix);
    acc += dt / period;
    const pulse = 0.5 + 0.5 * Math.sin(acc * Math.PI * 2);
    tmpColor.copy(GREEN).lerp(RED, mix);
    const flick = surge ? 0.85 + 0.15 * Math.sin(time * 37) * Math.sin(time * 11) : 1;
    coreMat.emissive.copy(tmpColor);
    coreMat.emissiveIntensity = lerp(0.8, 2.0, pulse) * flick;
    capMat.emissive.copy(tmpColor);
    capMat.emissiveIntensity = lerp(1.3, 3.0, pulse) * flick;
    spriteCore.material.color.copy(tmpColor).multiplyScalar(lerp(1.0, 1.8, pulse));
    spriteCore.material.opacity = lerp(0.3, 0.55, pulse);
    spriteCore.scale.setScalar(30 * k * lerp(0.94, 1.08, pulse));
    spriteHalo.material.color.copy(tmpColor);
    spriteHalo.material.opacity = lerp(0.06, 0.15, pulse) * (surge ? 1.5 : 1);
    for (let i = 0; i < 4; i++) {
      platLamps[i]!.material.color.copy(tmpColor).multiplyScalar(1.6);
      const flashOn = Math.sin(time * 9 + i * 1.57) > 0.1;
      surgeFlash[i]!.material.opacity = mix > 0.05 ? (flashOn ? 0.95 : 0.1) * mix : 0;
    }
    for (let i = 0; i < allLamps.length; i++) {
      const l = allLamps[i]!;
      l.color = tmpColor.getHex();
      l.period = period;
      l.phase = acc * period - time; // keeps the pooled light's pulse in sync with this accumulator
      l.intensity = baseIntensity[i]! * (1 + mix * 0.35);
    }
  });

  return {
    top: { x: o.x, y: (o.y ?? 0) + H, z: o.z },
    setSurge(on: boolean) {
      surge = on;
    },
  };
}

function oliveCab(): THREE.Material {
  return cached('spire:cabinet', () => new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 0.6, metalness: 0.45 }));
}

/** One slice of the lattice between y0 and y1 (panel indices continue the global tapered profile). */
function addLatticeSlice(
  asm: Assembly,
  y0: number,
  y1: number,
  n: number,
  halfAt: (y: number) => number,
  legMat: THREE.Material,
  braceMat: THREE.Material,
  latY0: number,
  latY1: number,
  totalPanels: number,
): void {
  const corner = (y: number, k: number): [number, number, number] => {
    const h = halfAt(y);
    return [k === 0 || k === 3 ? -h : h, y, k < 2 ? -h : h];
  };
  for (let i = 0; i < n; i++) {
    const ya = lerp(y0, y1, i / n);
    const yb = lerp(y0, y1, (i + 1) / n);
    const t = (ya - latY0) / (latY1 - latY0);
    const leg = lerp(0.42, 0.16, t);
    const brace = lerp(0.12, 0.08, t);
    const idx = Math.round(t * totalPanels);
    for (let k = 0; k < 4; k++) {
      asm.strut(legMat, corner(ya, k), corner(yb, k), leg);
      asm.strut(braceMat, corner(ya, k), corner(ya, (k + 1) % 4), brace);
      const a0 = corner(ya, k);
      const a1 = corner(ya, (k + 1) % 4);
      const b0 = corner(yb, k);
      const b1 = corner(yb, (k + 1) % 4);
      asm.strut(braceMat, a0, b1, brace, { cast: false });
      asm.strut(braceMat, a1, b0, brace, { cast: false });
    }
    if (idx % 4 === 0) {
      asm.strut(braceMat, corner(ya, 0), corner(ya, 2), brace * 0.8, { cast: false });
      asm.strut(braceMat, corner(ya, 1), corner(ya, 3), brace * 0.8, { cast: false });
    }
  }
}
