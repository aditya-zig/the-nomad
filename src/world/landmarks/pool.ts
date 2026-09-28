/**
 * Toxic pool: a concrete-kerbed basin with railings and an inlet pipe, filled with glowing green liquid whose surface
 * flows (scrolled textures), lit by a pulsing green lamp. Movement blocker (kerb + railing height), bullets pass over.
 */
import * as THREE from 'three';
import type { LampSpec, LevelBuilder } from '../builder';
import type { Place } from '../props';
import { Assembly, Rng, seedFrom } from './util';
import { liquidTextures, signMaterial } from './tex';

export function buildToxicPool(b: LevelBuilder, o: Place & { w: number; d: number }): void {
  const { w, d } = o;
  const rot = o.rot ?? 0;
  const asm = new Assembly(o.x, o.y ?? 0, o.z, rot);
  const m = b.mats;
  const rng = new Rng(seedFrom(o.x, o.z, 5));
  const concrete = m.get('concreteWall');
  const concreteDark = m.get('concreteDark');
  const hazard = m.get('hazard');
  const steel = m.get('steel');
  const steelDark = m.get('steelDark');
  const rust = m.get('rust');
  const barrelBio = m.get('barrelBio');
  const kerbH = 0.5;
  const kt = 0.42;

  // ---- kerb ------------------------------------------------------------------------------------------------------
  asm.box(concrete, w, kerbH, kt, 0, kerbH / 2, -(d / 2 - kt / 2));
  asm.box(concrete, w, kerbH, kt, 0, kerbH / 2, d / 2 - kt / 2);
  asm.box(concrete, kt, kerbH, d - 2 * kt, -(w / 2 - kt / 2), kerbH / 2, 0);
  asm.box(concrete, kt, kerbH, d - 2 * kt, w / 2 - kt / 2, kerbH / 2, 0);
  // hazard-striped cap strips on top of the kerb
  asm.box(hazard, w + 0.04, 0.03, kt + 0.04, 0, kerbH + 0.015, -(d / 2 - kt / 2), { cast: false });
  asm.box(hazard, w + 0.04, 0.03, kt + 0.04, 0, kerbH + 0.015, d / 2 - kt / 2, { cast: false });
  asm.box(hazard, kt + 0.04, 0.03, d - 2 * kt, -(w / 2 - kt / 2), kerbH + 0.015, 0, { cast: false });
  asm.box(hazard, kt + 0.04, 0.03, d - 2 * kt, w / 2 - kt / 2, kerbH + 0.015, 0, { cast: false });
  // basin floor (dark) under the liquid
  asm.box(concreteDark, w - 2 * kt, 0.05, d - 2 * kt, 0, 0.03, 0, { cast: false });
  // outer concrete apron
  asm.box(concreteDark, w + 1.6, 0.06, d + 1.6, 0, 0.03, 0, { cast: false });

  // ---- railing (posts + two rails), with one broken section on the south side ------------------------------------------
  const px = w / 2 - 0.07;
  const pz = d / 2 - 0.07;
  const posts: [number, number][] = [];
  const along = (len: number, step: number) => {
    const n = Math.max(1, Math.round(len / step));
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(-len / 2 + (len * i) / n);
    return out;
  };
  for (const x of along(2 * px, 1.6)) {
    posts.push([x, -pz]);
    posts.push([x, pz]);
  }
  for (const zz of along(2 * pz, 1.6).slice(1, -1)) {
    posts.push([-px, zz]);
    posts.push([px, zz]);
  }
  for (const [x, z] of posts) asm.box(steelDark, 0.06, 0.72, 0.06, x, kerbH + 0.36, z, { cast: false });
  const rail = (x0: number, z0: number, x1: number, z1: number, broken = false) => {
    asm.strut(steelDark, [x0, kerbH + 0.72, z0], [x1, kerbH + 0.72, z1], 0.05, { cast: false });
    if (!broken) asm.strut(steelDark, [x0, kerbH + 0.38, z0], [x1, kerbH + 0.38, z1], 0.04, { cast: false });
  };
  rail(-px, -pz, px, -pz);
  rail(-px, pz, px * 0.15, pz);
  rail(px * 0.55, pz, px, pz);
  // a bent rail hanging into the gap
  asm.strut(steelDark, [px * 0.15, kerbH + 0.72, pz], [px * 0.4, kerbH + 0.1, pz + 0.35], 0.05, { cast: false });
  rail(-px, -pz, -px, pz);
  rail(px, -pz, px, pz);

  // ---- inlet pipe on a concrete bridge (west side) -----------------------------------------------------------------------
  const bridgeLen = 2.6;
  const bx = -(w / 2 + bridgeLen / 2 - 0.2);
  asm.box(concrete, bridgeLen, 0.75, 1.0, bx, 0.375, 0);
  asm.box(hazard, bridgeLen + 0.04, 0.16, 1.04, bx, 0.3, 0, { cast: false });
  asm.tube(steel, [bx - bridgeLen / 2 - 0.4, 0.98, 0], [-(w / 2) + 0.3, 0.98, 0], 0.22, 10);
  asm.cyl(steelDark, 0.3, 0.1, bx - bridgeLen / 2 + 0.3, 0.98, 0, 12, { rz: Math.PI / 2, cast: false });
  asm.cyl(steelDark, 0.3, 0.1, bx + bridgeLen / 2 - 0.5, 0.98, 0, 12, { rz: Math.PI / 2, cast: false });
  asm.cyl(rust, 0.3, 0.05, bx, 1.4, 0, 12, { cast: false }); // valve wheel
  asm.cyl(steelDark, 0.04, 0.4, bx, 1.2, 0, 6, { cast: false });
  asm.collide(b, bx, 0, bridgeLen, 1.0, 1.25, { mapKind: 'prop', surface: 'concrete', tag: 'pool-bridge' });

  // ---- bio drums, sign, cables -------------------------------------------------------------------------------------------
  const drums: [number, number][] = [
    [w / 2 + 0.9, -d / 2 + 0.2],
    [w / 2 + 1.25, -d / 2 + 0.85],
    [w / 2 + 0.85, -d / 2 + 1.35],
  ];
  const drumGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14);
  for (const [dx, dz] of drums) {
    const mesh = asm.mesh(drumGeo, barrelBio, dx, 0.44, dz, { ry: rng.range(0, 6) });
    mesh.receiveShadow = true;
    asm.collide(b, dx, dz, 0.56, 0.56, 0.88, { mapKind: 'prop', surface: 'metal', tag: 'pool-drum' });
  }
  const sign = asm.box(signMaterial(['DANGER', 'TOXIC EFFLUENT', 'NO ENTRY'], { bg: '#d2ac1c', fg: '#131313', aspect: 2.0 }), 1.5, 0.75, 0.04, w * 0.18, kerbH + 1.05, d / 2 + 0.28, { cast: false });
  sign.userData.worldUV = false;
  asm.box(steelDark, 0.07, 1.5, 0.07, w * 0.18 - 0.6, 0.75, d / 2 + 0.28, { cast: false });
  asm.box(steelDark, 0.07, 1.5, 0.07, w * 0.18 + 0.6, 0.75, d / 2 + 0.28, { cast: false });

  // ---- collider: whole basin (kerb + railing height), bullets pass ------------------------------------------------------------------
  asm.collide(b, 0, 0, w, d, 1.3, { blocksShots: false, mapKind: 'prop', surface: 'concrete', tag: 'toxic-pool' });
  asm.commit(b);

  // ---- liquid surface (dynamic, animated) ----------------------------------------------------------------------------------------------
  const tex = liquidTextures();
  const lw = w - 2 * kt;
  const ld = d - 2 * kt;
  const geo = new THREE.PlaneGeometry(lw, ld);
  const uv = geo.attributes.uv!;
  const kU = lw / 3.2;
  const kV = ld / 3.2;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * kU, uv.getY(i) * kV);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex.base,
    emissive: new THREE.Color(0x39ff88),
    emissiveMap: tex.glow,
    emissiveIntensity: 1.1,
    roughness: 0.1,
    metalness: 0.0,
  });
  const liquid = new THREE.Mesh(geo, mat);
  liquid.rotation.x = -Math.PI / 2;
  const lp = asm.world(0, 0);
  liquid.position.set(lp.x, (o.y ?? 0) + kerbH - 0.14, lp.z);
  liquid.rotation.order = 'YXZ';
  liquid.rotation.y = rot;
  liquid.receiveShadow = false;
  b.addDynamic(liquid);

  const lamp: LampSpec = {
    x: lp.x,
    y: (o.y ?? 0) + 1.3,
    z: lp.z,
    color: 0x3dff86,
    intensity: 210,
    distance: 15,
    mode: 'pulse',
    period: 3.4,
    phase: rng.range(0, 3),
    weight: 1,
    pool: Math.max(w, d) * 0.8,
    glow: 3.2,
    tag: 'toxic-pool',
  };
  b.light(lamp);
  const seed = rng.range(0, 10);
  b.tick((_dt, time) => {
    const t = time + seed;
    tex.base.offset.set(t * 0.011, t * 0.006);
    tex.glow.offset.set(-t * 0.021, t * 0.014);
    mat.emissiveIntensity = 0.85 + 0.35 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.4));
  });
}
