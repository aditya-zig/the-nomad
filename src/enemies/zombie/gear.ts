/**
 * Special gear: riot armour for the Armored Infected and the heavy hazmat containment suit for the Warden.
 */
import * as THREE from 'three';
import { B } from './dims';
import { type Ctx, V, addHands, armBones, armPath, armProf, armTMid, headCenter, hex, legBones, legPath, legProf, legTMid, limbWeights, torsoPath, torsoProf, torsoT, torsoWeights } from './body';
import { sleeve, torsoShell, trouserLeg } from './garments';
import { box, cyl, ell, loft, makeTs, taper, type Style } from './mesh';
import { mulberry32 } from './prng';

const PALETTES = [
  { plate: 0x545c66, cloth: 0x5a6250, trim: 0xb8962c },
  { plate: 0x5a6446, cloth: 0x4c5440, trim: 0xb8b09a },
  { plate: 0x4e5058, cloth: 0x50535c, trim: 0xb45a30 },
  { plate: 0x62594a, cloth: 0x4c4840, trim: 0xa8a690 },
];

function mirrored(ctx: Ctx, fn: (s: 1 | -1) => void): void {
  for (const s of [-1, 1] as const) {
    ctx.acc.frame = new THREE.Matrix4().makeScale(s, 1, 1);
    fn(s);
  }
  ctx.acc.frame = null;
}

export function addRiotGear(ctx: Ctx, index: number): void {
  const { acc, D } = ctx;
  const k = D.k;
  const pal = PALETTES[index % PALETTES.length]!;
  const plate: Style = { color: hex(pal.plate), bone: B.chest, spec: 0.55 };
  const cloth: Style = { color: hex(pal.cloth), bone: B.spine, spec: 0.15 };
  const tape: Style = { color: hex(pal.trim), bone: B.chest, clean: true };
  const gW = ctx.girth * D.torsoW;
  const gD = ctx.girth * D.torsoD;
  const rand = mulberry32(9000 + index * 31);

  // ---- helmet ----
  const hs = k * D.headS;
  const C = headCenter(D);
  const helmet: Style = { color: hex(pal.plate).multiplyScalar(1.15), bone: B.head, spec: 0.65 };
  {
    const dome = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, 1.28);
    acc.add(dome, new THREE.Matrix4().compose(V(C.x, C.y + 0.012 * hs, C.z + 0.004 * hs), new THREE.Quaternion(), V(0.098 * hs, 0.118 * hs, 0.113 * hs)), helmet);
    dome.dispose();
    // side / back skirt (open at the front)
    const skirt = new THREE.SphereGeometry(1, 18, 5, 3 * Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 1.28, 0.62);
    acc.add(skirt, new THREE.Matrix4().compose(V(C.x, C.y + 0.012 * hs, C.z + 0.004 * hs), new THREE.Quaternion(), V(0.099 * hs, 0.118 * hs, 0.114 * hs)), { ...helmet, color: hex(pal.plate).multiplyScalar(1.05) });
    skirt.dispose();
  }
  // brim, visor plates with a glowing-eye slit, chin bar, neck guard
  box(acc, C.x, C.y + 0.05 * hs, C.z - 0.104 * hs, 0.17 * hs, 0.014 * hs, 0.032 * hs, helmet, [0.25, 0, 0]);
  box(acc, C.x, C.y + 0.046 * hs, C.z - 0.1 * hs, 0.168 * hs, 0.026 * hs, 0.016 * hs, { ...helmet, color: hex(0x15181a) });
  box(acc, C.x, C.y - 0.014 * hs, C.z - 0.098 * hs, 0.164 * hs, 0.044 * hs, 0.014 * hs, { color: hex(0x1a1d20), bone: B.head, spec: 0.75 }, [0.1, 0, 0]);
  for (const s of [-1, 1]) {
    box(acc, C.x + s * 0.082 * hs, C.y + 0.012 * hs, C.z - 0.075 * hs, 0.012 * hs, 0.09 * hs, 0.05 * hs, { color: hex(0x1a1d20), bone: B.head, spec: 0.7 }, [0, s * 0.5, 0]);
    box(acc, C.x + s * 0.083 * hs, C.y - 0.02 * hs, C.z + 0.03 * hs, 0.012 * hs, 0.09 * hs, 0.09 * hs, helmet);
  }
  // neck guard
  box(acc, C.x, C.y - 0.036 * hs, C.z + 0.086 * hs, 0.15 * hs, 0.06 * hs, 0.02 * hs, { ...helmet, color: hex(pal.cloth) }, [-0.15, 0, 0]);
  // straps
  for (const s of [-1, 1]) taper(acc, V(C.x + s * 0.082 * hs, C.y - 0.01 * hs, C.z - 0.03 * hs), V(C.x + s * 0.04 * hs, C.y - 0.1 * hs, C.z - 0.06 * hs), 0.006 * hs, 0.006 * hs, { color: hex(0x101112), bone: B.head }, 4);
  // dull red status light on the brim
  ell(acc, C.x + 0.055 * hs, C.y + 0.075 * hs, C.z - 0.095 * hs, 0.008 * hs, 0.006 * hs, 0.006 * hs, { color: new THREE.Color(1, 0.06, 0.04), bone: B.head, glow: 2.2, clean: true }, null, 6, 4);

  // ---- torso: carrier vest ----
  const zf = -(0.112 * gD * k + 0.028 * k);
  const zb = 0.112 * gD * k + 0.028 * k;
  torsoShell(ctx, 0.99, 1.25, hex(pal.cloth), 0.03 * k, 0.0, 77);
  box(acc, 0, 1.25 * k, zf, 0.3 * k * gW * 0.95, 0.34 * k, 0.045 * k, plate);
  box(acc, 0, 1.3 * k, zf - 0.01 * k, 0.25 * k * gW * 0.9, 0.18 * k, 0.02 * k, { ...plate, color: hex(pal.plate).multiplyScalar(1.25) });
  box(acc, 0, 1.25 * k, zb, 0.29 * k * gW * 0.95, 0.34 * k, 0.045 * k, plate);
  for (const x of [-0.09, 0, 0.09]) box(acc, x * k * gW, 1.04 * k, zf + 0.006 * k, 0.075 * k, 0.09 * k, 0.045 * k, cloth);
  box(acc, 0, 1.005 * k, zf + 0.01 * k, 0.32 * k * gW, 0.028 * k, 0.05 * k, { color: hex(0x15161a), bone: B.spine, spec: 0.2 });
  mirrored(ctx, (s) => {
    const sh = s < 0 ? B.shL : B.shR;
    // shoulder straps
    box(acc, 0.105 * k * gW, 1.455 * k, 0, 0.07 * k, 0.03 * k, 0.22 * k * gD, { color: hex(pal.cloth), bone: B.chest, spec: 0.2 }, [0, 0, -0.28]);
    // pauldron: layered plates
    ell(acc, D.shX + 0.012 * k, D.shY + 0.03 * k, 0, 0.104 * k * Math.sqrt(D.armT), 0.06 * k, 0.116 * k, { color: hex(pal.plate), bone: sh, spec: 0.6 }, [0, 0, -0.42], 10, 6);
    ell(acc, D.shX + 0.03 * k, D.shY - 0.012 * k, 0, 0.098 * k * Math.sqrt(D.armT), 0.05 * k, 0.108 * k, { color: hex(pal.plate).multiplyScalar(1.2), bone: sh, spec: 0.6 }, [0, 0, -0.6], 10, 6);
    box(acc, D.shX + 0.07 * k, D.shY + 0.0 * k, 0, 0.03 * k, 0.03 * k, 0.09 * k, tape);
    // thigh guard, knee pad, shin guard
    const hb = s < 0 ? B.hipL : B.hipR;
    const kb = s < 0 ? B.knL : B.knR;
    box(acc, D.hipX, 0.78 * k, -0.082 * k * D.legT, 0.115 * k * D.legT, 0.25 * k, 0.03 * k, { color: hex(pal.plate), bone: hb, spec: 0.55 });
    ell(acc, D.hipX, D.kneeY + 0.005 * k, -0.062 * k * D.legT, 0.066 * k * D.legT, 0.075 * k, 0.045 * k, { color: hex(pal.plate).multiplyScalar(1.15), bone: kb, spec: 0.6 }, null, 9, 6);
    box(acc, D.hipX, D.kneeY - 0.005 * k, 0.02 * k, 0.108 * k * D.legT, 0.03 * k, 0.11 * k * D.legT, cloth.color instanceof THREE.Color ? { color: cloth.color.clone(), bone: kb } : cloth);
    box(acc, D.hipX, 0.29 * k, -0.066 * k * D.legT, 0.095 * k * D.legT, 0.27 * k, 0.028 * k, { color: hex(pal.plate), bone: kb, spec: 0.55 });
    // holster on one leg
    if (s > 0) box(acc, D.hipX + 0.075 * k * D.legT, 0.74 * k, 0.0, 0.035 * k, 0.15 * k, 0.09 * k, { color: hex(0x151719), bone: hb, spec: 0.3 });
    // elbow pad + forearm guard
    const [, elb] = armBones(s);
    const e = ctx.rest[elb]!;
    const w = ctx.rest[s < 0 ? B.haL : B.haR]!;
    ell(acc, s * 0 + (s > 0 ? e.x : -e.x), e.y, e.z, 0.062 * k * D.armT, 0.064 * k, 0.064 * k * D.armT, { color: hex(pal.plate).multiplyScalar(1.1), bone: elb, spec: 0.6 }, null, 8, 6);
    const ex = s > 0 ? e.x : -e.x;
    const wx = s > 0 ? w.x : -w.x;
    taper(acc, V(ex + 0.01 * k, e.y - 0.05 * k, e.z - 0.03 * k), V(wx + 0.008 * k, w.y + 0.04 * k, w.z - 0.03 * k), 0.052 * k * D.armT, 0.042 * k * D.armT, { color: hex(pal.plate), bone: elb, spec: 0.5 }, 6);
  });
  // radio on the left strap with antenna
  box(acc, -0.11 * k * gW, 1.4 * k, zf + 0.005 * k, 0.05 * k, 0.09 * k, 0.04 * k, { color: hex(0x151719), bone: B.chest, spec: 0.3 });
  taper(acc, V(-0.11 * k * gW, 1.44 * k, zf), V(-0.115 * k * gW, 1.62 * k, zf + 0.02 * k), 0.004 * k, 0.002 * k, { color: hex(0x151719), bone: B.chest }, 4);
  // status light on the chest, tape marks, bullet dents
  box(acc, 0.09 * k * gW, 1.36 * k, zf - 0.03 * k, 0.018 * k, 0.018 * k, 0.008 * k, { color: new THREE.Color(1, 0.05, 0.03), bone: B.chest, glow: 2.6, clean: true });
  box(acc, -0.06 * k * gW, 1.16 * k, zf - 0.024 * k, 0.09 * k, 0.014 * k, 0.006 * k, tape, [0, 0, 0.5]);
  box(acc, 0.07 * k * gW, 1.12 * k, zf - 0.024 * k, 0.09 * k, 0.014 * k, 0.006 * k, tape, [0, 0, -0.5]);
  for (let i = 0; i < 4; i++) ell(acc, (rand() - 0.5) * 0.22 * k, (1.15 + rand() * 0.25) * k, zf - 0.024 * k, 0.012 * k, 0.012 * k, 0.005 * k, { color: hex(0x0b0c0d), bone: B.chest, clean: true }, null, 5, 4);
}

// ---------------------------------------------------------------------------------------------------------
// WARDEN: hazmat containment suit
// ---------------------------------------------------------------------------------------------------------

export function addWardenSuit(ctx: Ctx): void {
  const { acc, D } = ctx;
  const k = D.k;
  const suit = hex(0x9b8b34);
  const suitDark = hex(0x6f6424);
  const rubber = hex(0x27282a);
  const steel = hex(0x8e9298);
  const green = new THREE.Color(0.22, 1.0, 0.46);
  const gW = D.torsoW;
  const gD = D.torsoD;
  const rearZ = 0.112 * gD * k;

  // ---- padded suit shells with accordion folds ----
  const fold = (base: (t: number, o: { rx: number; rz: number }) => void, freq: number, amp: number) => (t: number, o: { rx: number; rz: number }) => {
    base(t, o);
    const m = 1 + amp * Math.sin(t * freq);
    o.rx *= m;
    o.rz *= m;
  };
  loft(acc, {
    path: torsoPath(D),
    ts: makeTs(0, 1, 26, [torsoT(D, D.hipY), torsoT(D, 1.09 * k), torsoT(D, 1.28 * k)]),
    radial: 14,
    prof: fold(torsoProf(ctx, 1.02, 1.05), 70, 0.035),
    inflate: 0.05 * k,
    hint: V(0, 0, 1),
    color: (_t, _a, p) => suit.clone().lerp(suitDark, p.y < 1.05 * k ? 0.35 : 0),
    weights: torsoWeights(D),
    capEnd: 0.02 * k,
    jagStart: 0,
    spec: 0.28,
  });
  for (const s of [-1, 1] as const) {
    const [b0, b1, b2] = armBones(s);
    const tm = armTMid(D);
    loft(acc, {
      path: armPath(ctx, s),
      ts: makeTs(0.02, 1, 16, [tm - 0.08, tm, tm + 0.08]),
      radial: 10,
      prof: fold(armProf(ctx, 1.05), 44, 0.05),
      inflate: 0.03 * k,
      hint: V(0, 0, 1),
      color: (t) => suit.clone().lerp(suitDark, t > 0.5 ? 0.3 : 0),
      weights: limbWeights(b0, b1, b2, tm),
      spec: 0.28,
    });
    // rubber glove cuff and big fist
    const W = ctx.rest[b2]!;
    ell(acc, W.x, W.y + 0.02 * k, W.z, 0.062 * k * Math.pow(D.armT, 0.6), 0.05 * k, 0.062 * k * Math.pow(D.armT, 0.6), { color: rubber.clone(), bone: b2, spec: 0.3 }, null, 8, 6);
    // legs
    const [l0, l1, l2] = legBones(s);
    const lm = legTMid(D);
    const lb = legProf(ctx, 1.08);
    loft(acc, {
      path: legPath(ctx, s),
      ts: makeTs(0, 0.99, 16, [lm - 0.08, lm, lm + 0.08]),
      radial: 10,
      prof: fold(lb, 38, 0.04),
      inflate: 0.03 * k,
      hint: V(0, 0, 1),
      color: (t) => suit.clone().lerp(suitDark, t > 0.55 ? 0.35 : 0.1),
      weights: limbWeights(l0, l1, l2, lm, 0.95, 0.06),
      spec: 0.28,
    });
  }
  addHands(ctx, { glove: rubber, gloveSpec: 0.3, clawColor: hex(0x151515), size: 1.05, fist: true });

  // ---- knee/elbow armour with hazard stripes, big rubber boots ----
  mirrored(ctx, (s) => {
    const sh = s < 0 ? B.shL : B.shR;
    const kb = s < 0 ? B.knL : B.knR;
    const [, elb] = armBones(s);
    const e = ctx.rest[elb]!;
    ell(acc, D.shX + 0.02 * k, D.shY + 0.03 * k, 0, 0.13 * k * Math.sqrt(D.armT), 0.07 * k, 0.14 * k, { color: rubber.clone().multiplyScalar(1.3), bone: sh, spec: 0.45 }, [0, 0, -0.4], 10, 7);
    for (let i = 0; i < 4; i++) box(acc, D.shX + (0.06 + i * 0.03) * k, D.shY + (0.04 - i * 0.012) * k, 0, 0.02 * k, 0.012 * k, 0.15 * k, { color: i % 2 ? hex(0x111111) : hex(0xc9a92a), bone: sh, clean: true }, [0, 0, -0.4]);
    ell(acc, s > 0 ? e.x : -e.x, e.y, e.z - 0.01 * k, 0.085 * k * Math.sqrt(D.armT), 0.075 * k, 0.085 * k * Math.sqrt(D.armT), { color: rubber.clone().multiplyScalar(1.4), bone: elb, spec: 0.4 }, null, 8, 6);
    ell(acc, D.hipX, D.kneeY, -0.09 * k, 0.09 * k * Math.sqrt(D.legT), 0.085 * k, 0.05 * k, { color: rubber.clone().multiplyScalar(1.4), bone: kb, spec: 0.4 }, null, 8, 6);
  });

  // ---- belt of hazard blocks ----
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    box(acc, Math.cos(a) * 0.175 * k * gW, 1.0 * k, Math.sin(a) * 0.12 * k * gD, 0.05 * k, 0.05 * k, 0.045 * k, { color: i % 2 ? hex(0x161616) : hex(0xc9a92a), bone: B.spine, clean: true, spec: 0.2 }, [0, -a, 0]);
  }

  // ---- chains across the chest ----
  const chain = (a: THREE.Vector3, b: THREE.Vector3, links: number, sag: number): void => {
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      const next = new THREE.Vector3().lerpVectors(a, b, Math.min(1, (i + 1) / (links - 1)));
      next.y -= Math.sin(Math.min(1, (i + 1) / (links - 1)) * Math.PI) * sag;
      const dir = next.sub(p);
      const ang = Math.atan2(dir.y, dir.x);
      box(acc, p.x, p.y, p.z, 0.05 * k, 0.026 * k, i % 2 ? 0.012 * k : 0.024 * k, { color: steel.clone(), bone: B.chest, spec: 0.85 }, [i % 2 ? Math.PI / 2 : 0, 0, ang]);
    }
  };
  const zf = -(0.112 * gD * k + 0.06 * k);
  chain(V(-0.24 * k * gW, 1.43 * k, zf + 0.03 * k), V(0.2 * k * gW, 1.05 * k, zf), 12, 0.02 * k);
  chain(V(0.24 * k * gW, 1.43 * k, zf + 0.03 * k), V(-0.2 * k * gW, 1.05 * k, zf), 12, 0.02 * k);
  // padlock / gauge
  box(acc, 0, 1.24 * k, zf - 0.012 * k, 0.09 * k, 0.09 * k, 0.03 * k, { color: steel.clone(), bone: B.chest, spec: 0.8 });
  ell(acc, 0, 1.24 * k, zf - 0.03 * k, 0.026 * k, 0.026 * k, 0.012 * k, { color: green.clone(), bone: B.chest, glow: 1.3, clean: true }, null, 7, 5);

  // ---- containment tank on the back ----
  const tankR = 0.125 * k;
  const tankH = 0.62 * k;
  const tz = rearZ + 0.05 * k + tankR * 0.95;
  const ty = 1.24 * k;
  cyl(acc, 0, ty, tz, tankR, tankR, tankH, { color: hex(0x7d827a), bone: B.chest, spec: 0.55 }, null, 14);
  ell(acc, 0, ty + tankH * 0.5, tz, tankR, tankR * 0.42, tankR, { color: hex(0x7d827a), bone: B.chest, spec: 0.55 }, null, 14, 6);
  ell(acc, 0, ty - tankH * 0.5, tz, tankR, tankR * 0.42, tankR, { color: hex(0x6d716a), bone: B.chest, spec: 0.55 }, null, 14, 6);
  // valve, straps
  cyl(acc, 0, ty + tankH * 0.5 + tankR * 0.42, tz, 0.035 * k, 0.045 * k, 0.05 * k, { color: hex(0xb08c26), bone: B.chest, spec: 0.5 }, null, 8);
  for (const dy of [-0.2, 0.2]) cyl(acc, 0, ty + dy * k, tz, tankR + 0.008 * k, tankR + 0.008 * k, 0.04 * k, { color: rubber.clone(), bone: B.chest, spec: 0.25 }, null, 14);
  // glowing crack and leak
  const crack: THREE.Vector3[] = [];
  const rr = mulberry32(4242);
  let cx = 0;
  let cy = ty + tankH * 0.32;
  for (let i = 0; i < 7; i++) {
    crack.push(V(tankR * 0.55 * Math.sin(cx), cy, tz + tankR * 0.98 * Math.cos(cx) * 0 + tankR * 0.9));
    cx += (rr() - 0.5) * 0.8;
    cy -= tankH * 0.12;
  }
  for (let i = 0; i < crack.length - 1; i++) {
    const a = crack[i]!;
    const b = crack[i + 1]!;
    taper(acc, V(a.x, a.y, tz + tankR * 0.96 * Math.cos(Math.asin(clampN(a.x / tankR, -0.9, 0.9)))), V(b.x, b.y, tz + tankR * 0.96 * Math.cos(Math.asin(clampN(b.x / tankR, -0.9, 0.9)))), 0.011 * k, 0.008 * k, { color: green.clone(), bone: B.chest, glow: 1.5, clean: true }, 4);
  }
  // level window and hoses
  box(acc, 0.05 * k, ty - 0.02 * k, tz + tankR * 0.97, 0.03 * k, 0.4 * k, 0.012 * k, { color: green.clone().multiplyScalar(0.8), bone: B.chest, glow: 1.0, clean: true }, [0, 0.35, 0]);
  const hc = headCenter(D);
  taper(acc, V(0.03 * k, ty + tankH * 0.5 + tankR * 0.5, tz), V(0.1 * k, 1.5 * k, rearZ * 0.6), 0.02 * k, 0.017 * k, { color: rubber.clone(), bone: B.chest, spec: 0.2 }, 6);
  taper(acc, V(0.1 * k, 1.5 * k, rearZ * 0.6), V(0.13 * k, hc.y - 0.04 * k, hc.z + 0.05 * k), 0.017 * k, 0.015 * k, { color: rubber.clone(), bone: B.neck, spec: 0.2 }, 6);
  taper(acc, V(-0.05 * k, ty - tankH * 0.5, tz), V(-0.16 * k * gW, 1.0 * k, rearZ * 0.9), 0.02 * k, 0.016 * k, { color: rubber.clone(), bone: B.spine, spec: 0.2 }, 6);
  // leaking drips: glowing green runs down the suit
  for (let i = 0; i < 5; i++) {
    const x = (rr() - 0.5) * 0.16 * k;
    const y0 = ty - tankH * 0.45;
    taper(acc, V(x, y0, tz + tankR * 0.7), V(x * 1.1, y0 - (0.18 + rr() * 0.3) * k, rearZ + 0.045 * k), 0.012 * k, 0.004 * k, { color: green.clone().multiplyScalar(0.9), bone: B.spine, glow: 1.2, clean: true }, 4);
  }

  // ---- helmet: big rounded hood with a dark visor, burning eye lenses, respirator and hinged grille ----
  const hs = k * D.headS;
  const C = hc;
  const helm: Style = { color: hex(0x8a7d2a), bone: B.head, spec: 0.45 };
  const rub: Style = { color: hex(0x1d1e20), bone: B.head, spec: 0.35 };
  {
    const g = new THREE.SphereGeometry(1, 22, 16);
    acc.add(g, new THREE.Matrix4().compose(V(C.x, C.y + 0.02 * hs, C.z + 0.012 * hs), new THREE.Quaternion(), V(0.134 * hs, 0.142 * hs, 0.14 * hs)), helm);
    g.dispose();
  }
  // seam ring at the neck and a raised crest
  cyl(acc, C.x, C.y - 0.09 * hs, C.z + 0.01 * hs, 0.11 * hs, 0.125 * hs, 0.05 * hs, rub, null, 14);
  box(acc, C.x, C.y + 0.155 * hs, C.z + 0.01 * hs, 0.028 * hs, 0.03 * hs, 0.16 * hs, { color: hex(0x1d1e20), bone: B.head, spec: 0.4 });
  // visor housing (dark glass) wrapping the front, with two burning eye lenses
  box(acc, C.x, C.y + 0.022 * hs, C.z - 0.118 * hs, 0.2 * hs, 0.07 * hs, 0.034 * hs, { color: hex(0x0d0f11), bone: B.head, spec: 0.85 });
  for (const s of [-1, 1]) {
    box(acc, C.x + s * 0.094 * hs, C.y + 0.022 * hs, C.z - 0.096 * hs, 0.03 * hs, 0.07 * hs, 0.06 * hs, { color: hex(0x0d0f11), bone: B.head, spec: 0.85 }, [0, s * 0.75, 0]);
    ell(acc, C.x + s * 0.045 * hs, C.y + 0.024 * hs, C.z - 0.1365 * hs, 0.022 * hs, 0.011 * hs, 0.006 * hs, { color: new THREE.Color(1.0, 0.2, 0.03), bone: B.head, glow: 1.6, clean: true }, [0, 0, s * 0.22], 8, 5);
  }
  // respirator with grille slats on the jaw bone and side canisters
  const jawC = V(C.x, C.y - 0.062 * hs, C.z - 0.06 * hs);
  ell(acc, jawC.x, jawC.y, jawC.z, 0.082 * hs, 0.045 * hs, 0.08 * hs, { color: hex(0x2a2c2f), bone: B.jaw, spec: 0.5 }, null, 10, 6);
  for (let i = -3; i <= 3; i++) box(acc, jawC.x + i * 0.02 * hs, jawC.y - 0.004 * hs, jawC.z - 0.078 * hs, 0.007 * hs, 0.06 * hs, 0.014 * hs, { color: hex(0x08090a), bone: B.jaw, clean: true });
  for (const s of [-1, 1]) {
    cyl(acc, C.x + s * 0.105 * hs, C.y - 0.055 * hs, C.z - 0.07 * hs, 0.04 * hs, 0.046 * hs, 0.085 * hs, { color: hex(0x35383b), bone: B.head, spec: 0.5 }, [Math.PI / 2, 0, s * 0.35], 10);
    cyl(acc, C.x + s * 0.112 * hs, C.y - 0.055 * hs, C.z - 0.125 * hs, 0.047 * hs, 0.047 * hs, 0.012 * hs, { color: hex(0xb8922a), bone: B.head, spec: 0.4 }, [Math.PI / 2, 0, s * 0.35], 10);
  }
  // small warning lamp on the crown (dull red pulse baked as glow)
  ell(acc, C.x - 0.07 * hs, C.y + 0.12 * hs, C.z - 0.09 * hs, 0.012 * hs, 0.012 * hs, 0.012 * hs, { color: new THREE.Color(1, 0.08, 0.05), bone: B.head, glow: 2.2, clean: true }, null, 6, 4);

  // ---- boots ----
  mirrored(ctx, (s) => {
    const ab = s < 0 ? B.anL : B.anR;
    const A = ctx.rest[ab]!;
    ell(acc, D.hipX, A.y - 0.03 * k, -0.06 * k, 0.085 * k * Math.sqrt(D.legT), 0.06 * k, 0.15 * k, { color: rubber.clone().multiplyScalar(1.2), bone: ab, spec: 0.3 }, null, 9, 6);
    cyl(acc, D.hipX, A.y + 0.07 * k, 0.0, 0.075 * k * Math.sqrt(D.legT), 0.085 * k * Math.sqrt(D.legT), 0.17 * k, { color: rubber.clone().multiplyScalar(1.2), bone: ab, spec: 0.3 }, null, 10);
    box(acc, D.hipX, 0.008 * k, -0.06 * k, 0.15 * k * Math.sqrt(D.legT), 0.02 * k, 0.32 * k, { color: hex(0x151515), bone: ab });
  });
  // shoulder-mounted lamp
  cyl(acc, -D.shX - 0.02 * k, D.shY + 0.13 * k, 0, 0.04 * k, 0.04 * k, 0.06 * k, { color: hex(0x2a2b2d), bone: B.shL, spec: 0.5 }, null, 8);
  ell(acc, -D.shX - 0.02 * k, D.shY + 0.16 * k, -0.02 * k, 0.03 * k, 0.03 * k, 0.03 * k, { color: new THREE.Color(1, 0.5, 0.12), bone: B.shL, glow: 1.2, clean: true }, null, 6, 4);
  void sleeve;
  void trouserLeg;
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
