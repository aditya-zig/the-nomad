/**
 * Containment dome: a steel-ribbed glass hemisphere on a concrete drum, glowing contamination inside, service annexes with
 * pipes, catwalk and a sealed hazard door. Collider = ring wall around the drum plus the annexes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LampSpec, LevelBuilder } from '../builder';
import type { Place } from '../props';
import { Assembly, Rng, cached, emissiveMat, glowSprite, seedFrom } from './util';
import { signMaterial } from './tex';

class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly r: number,
    private readonly phi: number,
    private readonly y0: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const theta = (Math.PI / 2) * (1 - t);
    return target.set(this.r * Math.sin(theta) * Math.cos(this.phi), this.y0 + this.r * Math.cos(theta), this.r * Math.sin(theta) * Math.sin(this.phi));
  }
}

function drumGeo(r: number, h: number, seg: number, tile: number): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, false);
  const uv = g.attributes.uv!;
  const circ = 2 * Math.PI * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
  return g;
}

export function buildContainmentDome(b: LevelBuilder, o: Place & { radius?: number }): void {
  const R = o.radius ?? 9;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 9));
  const concrete = m.get('concreteWall');
  const concreteDark = m.get('concreteDark');
  const steel = m.get('steel');
  const steelDark = m.get('steelDark');
  const hazard = m.get('hazard');
  const grating = m.get('grating');
  const rust = m.get('rust');
  const rubber = m.get('rubber');
  const olive = cached('xmit:olive', () => new THREE.MeshStandardMaterial({ color: 0x4a5738, roughness: 0.62, metalness: 0.45 }));
  const glass = cached(
    'dome:glass',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xaee8d0,
        transparent: true,
        opacity: 0.13,
        roughness: 0.06,
        metalness: 0.15,
        envMapIntensity: 1.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
  );

  const drumR = R + 0.7;
  const drumH = 2.6;
  const seg = 48;
  const tileC = (concrete.userData.tile as number | undefined) ?? 4;

  // ---- apron, drum, hazard band -------------------------------------------------------------------------------------
  asm.mesh(drumGeo(drumR + 2.6, 0.3, seg, (concreteDark.userData.tile as number | undefined) ?? 4), concreteDark, 0, 0.15, 0, { cast: false });
  asm.mesh(drumGeo(drumR, drumH, seg, tileC), concrete, 0, drumH / 2, 0);
  asm.mesh(drumGeo(drumR + 0.03, 0.4, seg, 1), hazard, 0, 1.0, 0, { cast: false });
  asm.mesh(drumGeo(drumR + 0.25, 0.28, seg, tileC), concreteDark, 0, drumH + 0.14, 0); // cornice
  // buttresses
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const cx = Math.cos(a) * (drumR + 0.2);
    const cz = Math.sin(a) * (drumR + 0.2);
    asm.box(concreteDark, 0.55, drumH - 0.3, 0.7, cx, (drumH - 0.3) / 2 + 0.15, cz, { ry: -a + Math.PI / 2, cast: false });
  }

  // ---- catwalk around the dome base (top of the drum) -----------------------------------------------------------------------
  const cwR = drumR - 0.15;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    asm.box(grating, 1.55, 0.06, 0.9, Math.cos(a) * cwR, drumH + 0.31, Math.sin(a) * cwR, { ry: -a + Math.PI / 2, cast: false });
  }
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rr = drumR + 0.2;
    asm.box(steelDark, 0.05, 1.05, 0.05, Math.cos(a) * rr, drumH + 0.85, Math.sin(a) * rr, { cast: false });
  }
  for (let i = 0; i < 32; i++) {
    const a0 = (i / 32) * Math.PI * 2;
    const a1 = ((i + 1) / 32) * Math.PI * 2;
    const rr = drumR + 0.2;
    asm.strut(steelDark, [Math.cos(a0) * rr, drumH + 1.35, Math.sin(a0) * rr], [Math.cos(a1) * rr, drumH + 1.35, Math.sin(a1) * rr], 0.045, { cast: false });
    asm.strut(steelDark, [Math.cos(a0) * rr, drumH + 0.85, Math.sin(a0) * rr], [Math.cos(a1) * rr, drumH + 0.85, Math.sin(a1) * rr], 0.035, { cast: false });
  }

  // ---- glass hemisphere with steel ribs -----------------------------------------------------------------------------------------
  const y0 = drumH + 0.28;
  asm.mesh(new THREE.SphereGeometry(R, 44, 22, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, y0, 0, { cast: false, receive: false });
  const ribGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const phi = (i / 16) * Math.PI * 2;
    ribGeos.push(new THREE.TubeGeometry(new ArcCurve(R + 0.05, phi, y0), 14, 0.075, 6));
  }
  for (const th of [0.38, 0.72, 1.05, 1.36]) {
    const g = new THREE.TorusGeometry((R + 0.05) * Math.sin(th), 0.075, 6, 56);
    g.rotateX(Math.PI / 2);
    g.translate(0, y0 + (R + 0.05) * Math.cos(th), 0);
    ribGeos.push(g);
  }
  const ribs = mergeGeometries(ribGeos, false);
  for (const g of ribGeos) g.dispose();
  if (ribs) asm.mesh(ribs, steelDark, 0, 0, 0, { cast: false });
  // base ring
  {
    const g = new THREE.TorusGeometry(R + 0.05, 0.14, 8, 64);
    g.rotateX(Math.PI / 2);
    asm.mesh(g, steel, 0, y0, 0, { cast: false });
  }
  // apex vent stack
  asm.cyl(steelDark, 0.55, 1.4, 0, y0 + R + 0.5, 0, 10);
  asm.cyl(steel, 0.75, 0.16, 0, y0 + R + 1.25, 0, 12, { cast: false });

  // ---- sealed hazard door, sign, warning light (faces local +Z) -----------------------------------------------------------------------
  asm.box(steelDark, 2.5, 2.7, 0.35, 0, 1.6, drumR + 0.1);
  asm.box(hazard, 2.1, 0.22, 0.4, 0, 0.55, drumR + 0.12, { cast: false });
  asm.box(steel, 1.9, 2.3, 0.14, 0, 1.55, drumR + 0.32, { cast: false });
  asm.box(rust, 0.12, 0.8, 0.1, 0.5, 1.45, drumR + 0.42, { cast: false });
  const sgn = asm.box(signMaterial(['BIOHAZARD', 'LEVEL 4 CONTAINMENT'], { bg: '#d2ac1c', fg: '#131313', aspect: 2.4 }), 1.7, 0.7, 0.04, 0, 3.18, drumR + 0.42, { cast: false });
  sgn.userData.worldUV = false;
  {
    const p = asm.world(-1.55, drumR + 0.35);
    b.glow({ x: p.x, y: asm.y + 2.8, z: p.z, color: 0xff2412, size: 0.9, intensity: 3, mode: 'blink', period: 1.7, duty: 0.4, phase: 0.3 });
  }

  // ---- service annexes: concrete blocks with pipes rising into the drum wall ----------------------------------------------------------------
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const rr = drumR + 1.9;
    const bx = ux * rr;
    const bz = uz * rr;
    const ry = -a + Math.PI / 2;
    asm.box(concrete, 2.5, 1.5, 3.4, bx, 0.75, bz, { ry });
    asm.box(hazard, 2.54, 0.24, 3.44, bx, 0.45, bz, { ry, cast: false });
    // pipes climbing from the annex roof into the drum wall
    for (let p = -1; p <= 1; p += 2) {
      const ox = -uz * p * 0.65;
      const oz = ux * p * 0.65;
      const from: [number, number, number] = [bx + ox, 1.75, bz + oz];
      const to: [number, number, number] = [ux * (drumR + 0.05) + ox, 2.2, uz * (drumR + 0.05) + oz];
      asm.tube(steel, from, to, 0.24, 8);
      asm.sphere(steel, 0.27, from[0], from[1], from[2], 10); // elbow joints hide the pipe ends
      asm.sphere(steel, 0.27, to[0], to[1], to[2], 10);
      asm.cyl(steelDark, 0.36, 0.1, from[0], 1.53, from[2], 12, { cast: false }); // flange on the annex roof
    }
    // valve wheel + gauge
    asm.cyl(rust, 0.32, 0.06, bx + ux * 0.4, 1.9, bz + uz * 0.4, 12, { rx: Math.PI / 2, ry, cast: false });
    asm.cyl(olive, 0.12, 0.3, bx - ux * 0.5 + -uz * 0.9, 1.65, bz - uz * 0.5 + ux * 0.9, 10, { cast: false });
    const pos = asm.world(bx, bz);
    b.collide({ x: pos.x, z: pos.z, hx: 1.25, hz: 1.7, rot: rot + ry, y0: asm.y, y1: asm.y + 1.5, mapKind: 'building', tag: 'dome-annex' });
  }

  // ---- collider: closed ring wall around the drum ------------------------------------------------------------------------------------------
  {
    const n = 16;
    const thick = 2.4;
    const cr = drumR - thick / 2 + 0.25;
    const len = 2 * drumR * Math.tan(Math.PI / n) * 1.12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pos = asm.world(Math.cos(a) * cr, Math.sin(a) * cr);
      b.collide({ x: pos.x, z: pos.z, hx: thick / 2, hz: len / 2, rot: rot - a, y0: asm.y, y1: asm.y + drumH + 0.3, mapKind: 'tank', tag: 'dome-drum' });
    }
  }

  // ---- toxic ooze puddles + cables around the base --------------------------------------------------------------------------------------------
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(drumR + 2.8, drumR + 5.5);
    asm.tube(rubber, [Math.cos(a) * (drumR + 0.6), 0.06, Math.sin(a) * (drumR + 0.6)], [Math.cos(a + 0.25) * r, 0.06, Math.sin(a + 0.25) * r], 0.05, 5, { cast: false });
  }
  // ---- static interior: steel scaffold + dark tendrils ---------------------------------------------------------------------------------------
  const y0i = y0;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    asm.box(steelDark, 0.16, 6.5, 0.16, Math.cos(a) * (R - 1.6), y0i + 3.3, Math.sin(a) * (R - 1.6), { cast: false });
  }
  for (const yy of [2.0, 4.4]) {
    const g = new THREE.TorusGeometry(R - 1.6, 0.09, 6, 40);
    g.rotateX(Math.PI / 2);
    asm.mesh(g, steelDark, 0, y0i + yy, 0, { cast: false });
  }
  {
    const tendrilMat = cached('dome:tendril', () => new THREE.MeshStandardMaterial({ color: 0x080b0a, roughness: 0.55, metalness: 0.1 }));
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 14; i++) {
      const th0 = rng.range(0, Math.PI * 2);
      const r0 = rng.range(1.8, 5.2);
      const turns = rng.range(0.6, 1.6);
      const hTop = rng.range(2.8, 6.8);
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        const th = th0 + t * turns * 2;
        const rr = r0 * (1 - 0.55 * t) + Math.sin(t * 7 + i) * 0.35;
        pts.push(new THREE.Vector3(Math.cos(th) * rr, y0i + 0.15 + t * hTop, Math.sin(th) * rr));
      }
      geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, rng.range(0.08, 0.2), 6));
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) asm.mesh(merged, tendrilMat, 0, 0, 0, { cast: false });
  }
  asm.commit(b);

  // ---- glowing mass (one dynamic merged translucent mesh + hot core), pulses ---------------------------------------------------------------------
  const massParts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
    massParts.push(g);
  };
  add(new THREE.CylinderGeometry(1.7, 2.0, 6.4, 20), 0, y0 + 3.3, 0);
  add(new THREE.SphereGeometry(3.0, 20, 14), 0, y0 + 4.4, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(0, 0.6);
    const rr = rng.range(3.0, 5.0);
    const s = rng.range(0.7, 1.3);
    add(new THREE.SphereGeometry(s, 12, 9), Math.cos(a) * rr, y0 + rng.range(0.9, 3.6), Math.sin(a) * rr, 1, rng.range(0.8, 1.5), 1);
  }
  const massGeo = mergeGeometries(massParts, false)!;
  for (const g of massParts) g.dispose();
  const massMat = new THREE.MeshStandardMaterial({
    color: 0x04160a,
    emissive: new THREE.Color(0x18ff5c),
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    roughness: 0.3,
  });
  const hotMat = emissiveMat(0x18ff5c, 2.0, 0x04140a);
  const dyn = new THREE.Group();
  dyn.position.set(o.x, o.y ?? 0, o.z);
  dyn.rotation.y = rot;
  const mass = new THREE.Mesh(massGeo, massMat);
  mass.renderOrder = 2;
  dyn.add(mass);
  const hot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), hotMat);
  hot.position.set(0, y0 + 4.4, 0);
  dyn.add(hot);
  const sprite = glowSprite(m.glowTexture, 0x22ff66, R * 2.4, 1.2, 0.22);
  sprite.position.set(0, y0 + 4.2, 0);
  dyn.add(sprite);
  b.addDynamic(dyn);

  const lampPos = asm.world(0, 0);
  const lamp: LampSpec = {
    x: lampPos.x,
    y: (o.y ?? 0) + y0 + 4.4,
    z: lampPos.z,
    color: 0x22ff66,
    intensity: 900,
    distance: 34,
    mode: 'pulse',
    period: 4.1,
    phase: rng.range(0, 4),
    weight: 1.1,
    pool: drumR + 5,
    tag: 'dome-core',
  };
  b.light(lamp);
  let acc = rng.f();
  b.tick((dt, time) => {
    acc += dt / 4.1;
    lamp.phase = (acc + 0.6 / (Math.PI * 2)) * 4.1 - time; // keep the pooled light in sync with the core pulse
    const pulse = 0.5 + 0.5 * Math.sin(acc * Math.PI * 2 + 0.6);
    massMat.emissiveIntensity = 0.5 + 0.55 * pulse;
    hotMat.emissiveIntensity = 1.4 + 1.4 * pulse;
    sprite.material.opacity = 0.09 + 0.09 * pulse;
    sprite.scale.setScalar(R * 2.4 * (0.95 + 0.07 * pulse));
  });
}
