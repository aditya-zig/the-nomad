/**
 * Base humanoid body: torso, neck, head with face and hinged jaw, arms, clawed hands, legs and feet, built from lofted
 * tubes and primitives in model space and rigidly / softly skinned to the 18-bone skeleton.
 * Clothing and armour are layered on top by `garments.ts`.
 */
import * as THREE from 'three';
import { B, type Dims, restPositions } from './dims';
import { Accum, box, cone, ell, loft, makeTs, profile, taper, type Style, type Weights } from './mesh';
import { clamp, smoothstep } from './prng';

export interface Ctx {
  acc: Accum;
  D: Dims;
  rest: ReturnType<typeof restPositions>;
  rand: () => number;
  /** Variant girth multiplier (1 = average). */
  girth: number;
  skin: THREE.Color;
  skinDark: THREE.Color;
  skinLight: THREE.Color;
  /** Eye glow colour (linear). */
  eye: THREE.Color;
  eyeGlow: number;
}

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const tmp = new THREE.Color();
const tmp2 = new THREE.Color();

export function hex(h: number): THREE.Color {
  return new THREE.Color(h);
}

// ---------------------------------------------------------------------------------------------------------
// weights helpers
// ---------------------------------------------------------------------------------------------------------

/** Two-bone blend by a scalar `s` across [s0, s1]. */
export function blend2(s: number, s0: number, s1: number, a: number, b: number): Weights {
  const t = smoothstep(s0, s1, s);
  return [a, 1 - t, b, t];
}

/** Torso: pelvis -> spine -> chest by height. */
export function torsoWeights(D: Dims): (t: number, p: THREE.Vector3) => Weights {
  const k = D.k;
  return (_t, p) => {
    const y = p.y;
    if (y <= D.hipY) return [B.pelvis, 1, B.pelvis, 0];
    if (y < 1.09 * k) return blend2(y, D.hipY, 1.09 * k, B.pelvis, B.spine);
    if (y < 1.13 * k) return [B.spine, 1, B.spine, 0];
    if (y < 1.3 * k) return blend2(y, 1.13 * k, 1.3 * k, B.spine, B.chest);
    return [B.chest, 1, B.chest, 0];
  };
}

/** A three-bone limb path (root, mid, end): rigid with soft blends around the joints. `tMid` = parameter of the mid joint. */
export function limbWeights(b0: number, b1: number, b2: number, tMid: number, tEndBlend = 0.94, win = 0.075): (t: number, p: THREE.Vector3) => Weights {
  return (t) => {
    if (t < tMid - win) return [b0, 1, b0, 0];
    if (t < tMid + win) return blend2(t, tMid - win, tMid + win, b0, b1);
    if (t < tEndBlend) return [b1, 1, b1, 0];
    return blend2(t, tEndBlend, 1, b1, b2);
  };
}

// ---------------------------------------------------------------------------------------------------------
// torso
// ---------------------------------------------------------------------------------------------------------

const TY = [0.86, 0.93, 1.03, 1.13, 1.25, 1.36, 1.45, 1.49];
const TRX = [0.16, 0.166, 0.148, 0.152, 0.178, 0.19, 0.165, 0.075];
const TRZ = [0.098, 0.104, 0.092, 0.096, 0.112, 0.108, 0.088, 0.062];
const TY0 = 0.86;
const TY1 = 1.49;

export function torsoPath(D: Dims): THREE.Vector3[] {
  return [V(0, D.k * TY0, 0), V(0, D.k * TY1, 0)];
}

export function torsoT(D: Dims, y: number): number {
  return (y / D.k - TY0) / (TY1 - TY0);
}

export function torsoProf(ctx: Ctx, widthMul = 1, depthMul = 1): (t: number, out: { rx: number; rz: number }) => void {
  const { D } = ctx;
  const g = ctx.girth;
  return profile(TY.map((y, i) => [(y - TY0) / (TY1 - TY0), TRX[i]! * D.k * D.torsoW * g * widthMul, TRZ[i]! * D.k * D.torsoD * g * depthMul] as [number, number, number]));
}

export function addTorsoSkin(ctx: Ctx, colorFn?: (t: number, ang: number, p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, rib = 0): void {
  const { acc, D } = ctx;
  const ts = makeTs(0, 1, 12, [torsoT(D, D.hipY), torsoT(D, 1.09 * D.k), torsoT(D, 1.28 * D.k)]);
  const c0 = ctx.skin;
  loft(acc, {
    path: torsoPath(D),
    ts,
    radial: 12,
    prof: torsoProf(ctx),
    hint: V(0, 0, 1),
    color:
      colorFn ??
      ((_t, _a, p, n) => {
        tmp.copy(c0);
        if (rib > 0 && n.z < -0.3 && p.y > 1.12 * D.k && p.y < 1.42 * D.k) {
          const band = Math.sin((p.y / D.k) * 78);
          if (band > 0.35 && Math.abs(p.x) < 0.14 * D.k) tmp.lerp(ctx.skinDark, rib * (band - 0.35));
        }
        return tmp;
      }),
    weights: torsoWeights(D),
    capStart: 0.02 * D.k,
    capEnd: 0.02 * D.k,
    spec: 0.1,
  });
}

// ---------------------------------------------------------------------------------------------------------
// neck & head
// ---------------------------------------------------------------------------------------------------------

export function neckWeights(D: Dims): (t: number, p: THREE.Vector3) => Weights {
  const k = D.k;
  return (_t, p) => {
    const y = p.y;
    if (y < 1.47 * k) return blend2(y, 1.4 * k, 1.47 * k, B.chest, B.neck);
    if (y < 1.55 * k) return [B.neck, 1, B.neck, 0];
    return blend2(y, 1.55 * k, 1.62 * k, B.neck, B.head);
  };
}

export function addNeck(ctx: Ctx, wr = 1): void {
  const { acc, D } = ctx;
  const k = D.k;
  const r = 0.05 * k * Math.sqrt(D.torsoW) * wr;
  loft(acc, {
    path: [V(0, 1.42 * k, 0.006 * k), V(0, 1.6 * k, -0.006 * k)],
    ts: makeTs(0, 1, 6),
    radial: 9,
    prof: profile([
      [0, r * 1.3, r * 1.25],
      [0.4, r * 1.0, r * 1.0],
      [1, r * 0.92, r * 0.95],
    ]),
    hint: V(0, 0, 1),
    color: () => tmp.copy(ctx.skin).lerp(ctx.skinDark, 0.12),
    weights: neckWeights(D),
    spec: 0.08,
  });
}

export type HairStyle = 'none' | 'short' | 'patchy' | 'long' | 'strands';

export interface HeadOpts {
  hair: HairStyle;
  hairColor: THREE.Color;
  /** Extra emphasis for gaunt faces (0..1). */
  gaunt: number;
  /** Lower-face wound (blood around mouth) 0..1 handled in weather; here only the teeth colour. */
  teeth: THREE.Color;
}

export function headCenter(D: Dims): THREE.Vector3 {
  return V(0, D.headY + D.headCenterUp, -0.004 * D.k * D.headS);
}

export function addHead(ctx: Ctx, o: HeadOpts): void {
  const { acc, D } = ctx;
  const hs = D.k * D.headS;
  const C = headCenter(D);
  const skin = ctx.skin;
  const dark = ctx.skinDark;
  const rx = 0.078 * hs * (1 - 0.06 * o.gaunt);
  const ry = 0.108 * hs;
  const rz = 0.098 * hs;

  const headColor: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color = (p, n) => {
    tmp.copy(skin);
    const dx = (p.x - C.x) / hs;
    const dy = (p.y - C.y) / hs;
    const dz = (p.z - C.z) / hs;
    if (dz < -0.04) {
      // sunken eye sockets
      const ex = Math.abs(dx) - 0.037;
      const ey = dy - 0.022;
      const eye = Math.exp(-((ex * ex) / (0.026 * 0.026) + (ey * ey) / (0.024 * 0.024)));
      tmp.lerp(dark, 0.85 * eye);
      // hollow cheeks
      const cx = Math.abs(dx) - 0.05;
      const cy = dy + 0.02;
      const ch = Math.exp(-((cx * cx) / (0.03 * 0.03) + (cy * cy) / (0.03 * 0.03)));
      tmp.lerp(dark, (0.5 + 0.35 * o.gaunt) * ch);
      // temples and forehead veins: slight grey-green tint
      if (dy > 0.05) tmp.lerp(tmp2.copy(skin).lerp(dark, 0.4), 0.2 * smoothstep(0.05, 0.11, dy));
    }
    // the mouth line: darken near the lower rim of the cranium
    if (dy < -0.026 && n.y < 0.2) tmp.lerp(tmp2.setRGB(0.05, 0.012, 0.014), smoothstep(-0.026, -0.038, dy));
    return tmp;
  };

  const headStyle: Style = { color: headColor, bone: B.head, spec: 0.12 };
  // cranium: upper part of an ellipsoid (open at the bottom where the jaw closes it)
  {
    const g = new THREE.SphereGeometry(1, 16, 11, 0, Math.PI * 2, 0, 2.0);
    // taper the face toward the chin: narrower lower half, flatter forehead
    const pa = g.attributes.position!;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      const nar = 1 - 0.16 * smoothstep(0.15, -0.42, y);
      const flat = z < 0 ? 1 - 0.05 * smoothstep(0.3, 0.9, y) : 1;
      pa.setXYZ(i, x * nar, y, z * flat);
    }
    g.computeVertexNormals();
    const m = new THREE.Matrix4().compose(V(C.x, C.y + 0.004 * hs, C.z), new THREE.Quaternion(), V(rx, ry, rz));
    acc.add(g, m, headStyle);
    g.dispose();
  }
  // brow ridge and cheekbones
  for (const s of [-1, 1]) {
    // heavy scowling brow, angled down toward the nose
    box(acc, C.x + s * 0.037 * hs, C.y + 0.047 * hs, C.z - 0.077 * hs, 0.07 * hs * (1 - 0.06 * o.gaunt), 0.012 * hs, 0.021 * hs, { color: tmp.copy(skin).lerp(dark, 0.6).clone(), bone: B.head }, [-0.25, 0, s * 0.3]);
  }
  for (const s of [-1, 1]) {
    ell(acc, C.x + s * 0.053 * hs, C.y - 0.013 * hs, C.z - 0.064 * hs, 0.019 * hs, 0.012 * hs, 0.015 * hs, { color: tmp.copy(ctx.skinLight).clone(), bone: B.head }, [0.3, s * 0.5, 0], 6, 5);
    // ears
    ell(acc, C.x + s * 0.079 * hs, C.y - 0.004 * hs, C.z + 0.004 * hs, 0.012 * hs, 0.025 * hs, 0.015 * hs, { color: tmp.copy(skin).lerp(dark, 0.15).clone(), bone: B.head }, [0, 0, s * 0.15], 6, 5);
  }
  // deep eye sockets (nearly black) with glowing eyes proud of them
  const socket = tmp.copy(dark).multiplyScalar(0.18).clone();
  for (const s of [-1, 1]) {
    ell(acc, C.x + s * 0.037 * hs, C.y + 0.02 * hs, C.z - 0.074 * hs, 0.03 * hs, 0.024 * hs, 0.013 * hs, { color: socket, bone: B.head }, [0, 0, s * 0.22], 9, 7);
    ell(acc, C.x + s * 0.037 * hs, C.y + 0.017 * hs, C.z - 0.0865 * hs, 0.0078 * hs, 0.0066 * hs, 0.0055 * hs, { color: ctx.eye, bone: B.head, glow: ctx.eyeGlow, clean: true }, null, 8, 6);
  }
  // nose
  cone(acc, C.x, C.y - 0.006 * hs, C.z - 0.09 * hs, 0.013 * hs, 0.03 * hs, { color: tmp.copy(skin).lerp(dark, 0.12).clone(), bone: B.head }, [-Math.PI / 2 + 0.3, 0, 0], 5);

  // cheeks: fill the sides of the mouth gap so the opening reads as an oval, not a wide arc
  for (const s of [-1, 1]) {
    ell(acc, C.x + s * 0.052 * hs, C.y - 0.05 * hs, C.z - 0.03 * hs, 0.022 * hs, 0.032 * hs, 0.05 * hs, { color: tmp.copy(skin).lerp(dark, 0.3).clone(), bone: B.head, spec: 0.1 }, [0, s * 0.2, 0], 7, 6);
  }
  // upper teeth (on the head) and gum line
  const rimY = C.y - 0.038 * hs;
  const teethStyle: Style = { color: o.teeth.clone().multiplyScalar(0.8), bone: B.head, clean: true };
  const gum: Style = { color: hex(0x4a1418), bone: B.head, clean: true };
  for (let i = -3; i <= 3; i++) {
    if (ctx.rand() < 0.22) continue; // missing teeth
    const a = i * 0.27;
    const x = Math.sin(a) * 0.058 * hs;
    const z = C.z - Math.cos(a) * 0.074 * hs;
    const h = (0.011 + ctx.rand() * 0.008) * hs;
    box(acc, C.x + x, rimY - 0.004 * hs - h * 0.3, z, 0.0072 * hs, h, 0.005 * hs, teethStyle, [ctx.rand() * 0.2 - 0.1, -a, ctx.rand() * 0.3 - 0.15]);
  }
  ell(acc, C.x, rimY + 0.001 * hs, C.z - 0.005 * hs, 0.066 * hs, 0.007 * hs, 0.08 * hs, gum, null, 10, 4);

  // ---- jaw (own bone) ----
  const jawC = V(C.x, C.y - 0.056 * hs, C.z - 0.016 * hs);
  const jawColor: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color = (p, n) => {
    tmp.copy(skin).lerp(dark, 0.08);
    const dy = (p.y - jawC.y) / hs;
    if (dy > 0.02 && n.y > -0.2) tmp.lerp(tmp2.setRGB(0.05, 0.012, 0.014), smoothstep(0.02, 0.035, dy));
    return tmp;
  };
  {
    const g = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 1.15, 1.99);
    const pa = g.attributes.position!;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      // chin: pull the front-lower part forward and narrow it
      const chin = smoothstep(-0.2, -0.9, y) * (z < 0 ? 1 : 0);
      pa.setXYZ(i, x * (1 - 0.3 * chin), y, z * (1 + 0.14 * chin));
    }
    g.computeVertexNormals();
    const m = new THREE.Matrix4().compose(jawC, new THREE.Quaternion(), V(0.062 * hs * (1 - 0.05 * o.gaunt), 0.052 * hs, 0.08 * hs));
    acc.add(g, m, { color: jawColor, bone: B.jaw, spec: 0.12 });
    g.dispose();
  }
  // mouth floor / tongue and lower teeth
  ell(acc, jawC.x, jawC.y + 0.01 * hs, jawC.z + 0.004 * hs, 0.052 * hs, 0.012 * hs, 0.068 * hs, { color: hex(0x3a0d12), bone: B.jaw, clean: true, spec: 0.35 }, null, 10, 4);
  for (let i = -3; i <= 3; i++) {
    if (ctx.rand() < 0.3) continue;
    const a = i * 0.28;
    const x = Math.sin(a) * 0.049 * hs;
    const z = jawC.z - Math.cos(a) * 0.066 * hs;
    box(acc, jawC.x + x, jawC.y + 0.02 * hs, z, 0.0068 * hs, (0.009 + ctx.rand() * 0.007) * hs, 0.005 * hs, teethStyle, [ctx.rand() * 0.2 - 0.1, -a, ctx.rand() * 0.3 - 0.15]);
  }

  addHair(ctx, C, rx, ry, rz, o);
}

function addHair(ctx: Ctx, C: THREE.Vector3, rx: number, ry: number, rz: number, o: HeadOpts): void {
  const { acc, D } = ctx;
  const hs = D.k * D.headS;
  if (o.hair === 'none') return;
  const style: Style = { color: o.hairColor.clone(), bone: B.head, spec: 0.05 };
  const rand = ctx.rand;
  // scalp cap covering only the crown (so it never reads as a helmet)
  const capLen = o.hair === 'short' ? 0.95 : o.hair === 'long' ? 1.3 : 0.62;
  const g = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, capLen);
  const pa = g.attributes.position!;
  const seedOff = rand() * 10;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    const rimness = smoothstep(0.75, 0.2, y);
    const j = Math.abs((Math.sin(i * 12.9898 + seedOff) * 43758.5453) % 1);
    pa.setXYZ(i, pa.getX(i) * (1 - rimness * 0.1 * j), y - rimness * 0.18 * j, pa.getZ(i) * (1 - rimness * 0.1 * j));
  }
  g.computeVertexNormals();
  const tilt = o.hair === 'patchy' ? (rand() - 0.5) * 0.7 : 0.1;
  const m = new THREE.Matrix4().compose(V(C.x, C.y + 0.01 * hs, C.z + 0.008 * hs), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, tilt)), V(rx * 1.06, ry * 1.05, rz * 1.05));
  acc.add(g, m, style);
  g.dispose();
  // strands drooping from the sides and back of the scalp (never straight up)
  const nStr = o.hair === 'long' ? 30 : o.hair === 'strands' ? 22 : o.hair === 'short' ? 16 : 7;
  for (let i = 0; i < nStr; i++) {
    const az = rand() * Math.PI * 2;
    const el = 0.75 + rand() * (o.hair === 'long' ? 0.75 : 0.5);
    const x = Math.sin(az) * Math.sin(el) * rx * 1.04;
    const y = Math.cos(el) * ry * 1.04;
    const z = Math.cos(az) * Math.sin(el) * rz * 1.04;
    if (z < -0.02 * hs && o.hair !== 'strands') continue; // keep the forehead clear
    const len = (o.hair === 'long' ? 0.15 : o.hair === 'strands' ? 0.1 : 0.05) * hs * (0.5 + rand() * 0.9);
    const top = V(C.x + x, C.y + 0.01 * hs + y, C.z + z);
    const out = V(x, 0, z).normalize();
    const bot = top.clone().addScaledVector(out, 0.016 * hs).add(V(0, -len, 0));
    taper(acc, top, bot, 0.0075 * hs, 0.0018 * hs, style, 4);
  }
}

// ---------------------------------------------------------------------------------------------------------
// arms and hands
// ---------------------------------------------------------------------------------------------------------

export function armPath(ctx: Ctx, s: 1 | -1): THREE.Vector3[] {
  const r = ctx.rest;
  const sh = s < 0 ? B.shL : B.shR;
  const el = s < 0 ? B.elL : B.elR;
  const ha = s < 0 ? B.haL : B.haR;
  return [V(r[sh]!.x, r[sh]!.y, r[sh]!.z), V(r[el]!.x, r[el]!.y, r[el]!.z), V(r[ha]!.x, r[ha]!.y, r[ha]!.z)];
}

export function armProf(ctx: Ctx, mul = 1): (t: number, out: { rx: number; rz: number }) => void {
  const { D } = ctx;
  const m = D.k * D.armT * mul * Math.sqrt(ctx.girth);
  return profile([
    [0, 0.054 * m, 0.052 * m],
    [0.22, 0.05 * m, 0.048 * m],
    [0.5, 0.041 * m, 0.04 * m],
    [0.62, 0.043 * m, 0.042 * m],
    [0.85, 0.034 * m, 0.031 * m],
    [1, 0.03 * m, 0.027 * m],
  ]);
}

export function armTMid(D: Dims): number {
  return D.upperArm / (D.upperArm + D.foreArm);
}

export function armBones(s: 1 | -1): [number, number, number] {
  return s < 0 ? [B.shL, B.elL, B.haL] : [B.shR, B.elR, B.haR];
}

export function addArmsSkin(ctx: Ctx, skinFn?: (s: 1 | -1) => (t: number, a: number, p: THREE.Vector3, n: THREE.Vector3) => THREE.Color): void {
  const { acc, D } = ctx;
  for (const s of [-1, 1] as const) {
    const [b0, b1, b2] = armBones(s);
    const tm = armTMid(D);
    const fn =
      skinFn?.(s) ??
      ((t: number) => {
        tmp.copy(ctx.skin);
        if (t > 0.5 && t < 0.85) tmp.lerp(ctx.skinDark, 0.1);
        return tmp;
      });
    loft(acc, {
      path: armPath(ctx, s),
      ts: makeTs(0, 1, 9, [tm - 0.08, tm, tm + 0.08]),
      radial: 9,
      prof: armProf(ctx),
      hint: V(0, 0, 1),
      color: fn,
      weights: limbWeights(b0, b1, b2, tm),
      capStart: 0.01 * D.k,
      spec: 0.1,
      wobble: 0.03,
      jagSeed: 11 + s,
    });
    // shoulder ball
    const sh = ctx.rest[s < 0 ? B.shL : B.shR]!;
    const r = 0.055 * D.k * Math.pow(D.armT, 0.75) * Math.sqrt(ctx.girth);
    ell(acc, sh.x, sh.y - 0.006 * D.k, sh.z, r, r * 1.0, r, { color: ctx.skin.clone().lerp(ctx.skinDark, 0.05), bone: s < 0 ? B.shL : B.shR, spec: 0.1 }, null, 12, 9);
  }
}

/** Claw hand (right-hand model mirrored for the left). `size` scales the whole hand. */
export function addHands(ctx: Ctx, opts: { glove?: THREE.Color; gloveSpec?: number; clawColor?: THREE.Color; size?: number; fist?: boolean } = {}): void {
  const { acc, D } = ctx;
  const hs = D.k * Math.pow(D.armT, 0.6) * (opts.size ?? 1);
  const claw = opts.clawColor ?? hex(0x6b5a3c);
  for (const s of [-1, 1] as const) {
    const bone = s < 0 ? B.haL : B.haR;
    const W = ctx.rest[bone]!;
    const frame = new THREE.Matrix4()
      .makeTranslation(W.x, W.y, W.z)
      .multiply(new THREE.Matrix4().makeRotationZ(s * D.armAngle))
      .multiply(new THREE.Matrix4().makeScale(s, 1, 1));
    acc.frame = frame;
    const base: Style = { color: (opts.glove ?? ctx.skin).clone(), bone, spec: opts.gloveSpec ?? 0.1 };
    const palmColor = opts.glove ? opts.glove.clone() : ctx.skin.clone().lerp(ctx.skinDark, 0.1);
    const st: Style = { ...base, color: palmColor };
    // palm: thin along X (palm faces inward), broad along Z
    box(acc, 0, -0.046 * hs, 0, 0.03 * hs, 0.09 * hs, 0.08 * hs, st);
    if (opts.fist) {
      // big fist: curled finger block
      ell(acc, -0.012 * hs, -0.11 * hs, 0, 0.032 * hs, 0.036 * hs, 0.044 * hs, st, null, 8, 6);
      for (let i = 0; i < 4; i++) ell(acc, -0.034 * hs, -0.118 * hs, (-0.03 + i * 0.02) * hs, 0.014 * hs, 0.02 * hs, 0.011 * hs, st, null, 6, 5);
      // thumb
      ell(acc, -0.03 * hs, -0.06 * hs, -0.038 * hs, 0.012 * hs, 0.028 * hs, 0.012 * hs, st, [0.3, 0, 0], 6, 5);
    } else {
      const fingerLen = [0.078, 0.086, 0.078, 0.062];
      for (let i = 0; i < 4; i++) {
        const z = (-0.03 + i * 0.02) * hs;
        const L = fingerLen[i]! * hs;
        const base0 = V(0, -0.09 * hs, z);
        const mid = V(-0.006 * hs, -0.09 * hs - L * 0.55, z + (i - 1.5) * 0.003 * hs);
        const tip = V(-0.026 * hs, -0.09 * hs - L * 0.93, z + (i - 1.5) * 0.006 * hs);
        taper(acc, base0, mid, 0.0125 * hs, 0.01 * hs, st, 5);
        taper(acc, mid, tip, 0.01 * hs, 0.0072 * hs, st, 5);
        // claw
        const dir = tip.clone().sub(mid).normalize();
        const cl = tip.clone().addScaledVector(dir, 0.028 * hs);
        taper(acc, tip, cl, 0.0058 * hs, 0.0007 * hs, { color: claw.clone(), bone, clean: true }, 4);
      }
      // thumb
      const t0 = V(-0.004 * hs, -0.03 * hs, -0.038 * hs);
      const t1 = V(-0.02 * hs, -0.072 * hs, -0.052 * hs);
      const t2 = V(-0.034 * hs, -0.098 * hs, -0.044 * hs);
      taper(acc, t0, t1, 0.013 * hs, 0.01 * hs, st, 5);
      taper(acc, t1, t2, 0.01 * hs, 0.0065 * hs, st, 5);
      taper(acc, t2, t2.clone().add(t2.clone().sub(t1).normalize().multiplyScalar(0.024 * hs)), 0.006 * hs, 0.0007 * hs, { color: claw.clone(), bone, clean: true }, 4);
    }
    acc.frame = null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// legs and feet
// ---------------------------------------------------------------------------------------------------------

export function legPath(ctx: Ctx, s: 1 | -1): THREE.Vector3[] {
  const r = ctx.rest;
  const hip = s < 0 ? B.hipL : B.hipR;
  const kn = s < 0 ? B.knL : B.knR;
  const an = s < 0 ? B.anL : B.anR;
  return [V(r[hip]!.x, r[hip]!.y, 0), V(r[kn]!.x, r[kn]!.y, 0), V(r[an]!.x, r[an]!.y, 0)];
}

export function legProf(ctx: Ctx, mul = 1): (t: number, out: { rx: number; rz: number }) => void {
  const { D } = ctx;
  const m = D.k * D.legT * mul * Math.sqrt(ctx.girth);
  return profile([
    [0, 0.09 * m, 0.094 * m],
    [0.16, 0.085 * m, 0.09 * m],
    [0.46, 0.063 * m, 0.067 * m],
    [0.52, 0.056 * m, 0.06 * m],
    [0.6, 0.058 * m, 0.064 * m],
    [0.68, 0.06 * m, 0.07 * m],
    [0.9, 0.041 * m, 0.043 * m],
    [1, 0.035 * m, 0.037 * m],
  ]);
}

export function legTMid(D: Dims): number {
  return D.thigh / (D.thigh + D.shin);
}

export function legBones(s: 1 | -1): [number, number, number] {
  return s < 0 ? [B.hipL, B.knL, B.anL] : [B.hipR, B.knR, B.anR];
}

export function addLegsSkin(ctx: Ctx): void {
  const { acc, D } = ctx;
  for (const s of [-1, 1] as const) {
    const [b0, b1, b2] = legBones(s);
    const tm = legTMid(D);
    loft(acc, {
      path: legPath(ctx, s),
      ts: makeTs(0, 1, 10, [tm - 0.08, tm, tm + 0.08]),
      radial: 9,
      prof: legProf(ctx),
      hint: V(0, 0, 1),
      color: (t) => {
        tmp.copy(ctx.skin);
        if (t > 0.45 && t < 0.6) tmp.lerp(ctx.skinDark, 0.18);
        return tmp;
      },
      weights: limbWeights(b0, b1, b2, tm, 0.95, 0.06),
      capStart: 0.01 * D.k,
      capEnd: 0.005 * D.k,
      spec: 0.1,
      wobble: 0.03,
      jagSeed: 21 + s,
    });
  }
}

export type ShoeKind = 'boots' | 'sneakers' | 'barefoot' | 'dress' | 'combat';

export function addFeet(ctx: Ctx, kind: ShoeKind, color: THREE.Color, opts: { missing?: 1 | -1 | 0; sole?: THREE.Color } = {}): void {
  const { acc, D } = ctx;
  const k = D.k * Math.pow(D.legT, 0.5);
  const kk = D.k;
  for (const s of [-1, 1] as const) {
    const bone = s < 0 ? B.anL : B.anR;
    const A = ctx.rest[bone]!;
    acc.frame = new THREE.Matrix4().makeTranslation(A.x, A.y, 0).multiply(new THREE.Matrix4().makeScale(s, 1, 1));
    const bare = kind === 'barefoot' || opts.missing === s;
    if (bare) {
      const st: Style = { color: ctx.skin.clone().lerp(ctx.skinDark, 0.1), bone, spec: 0.1 };
      ell(acc, 0, -0.05 * kk, -0.05 * kk, 0.045 * k, 0.034 * kk, 0.11 * kk, st, null, 8, 6);
      ell(acc, 0, -0.045 * kk, 0.045 * kk, 0.04 * k, 0.038 * kk, 0.04 * kk, st, null, 7, 5);
      for (let i = 0; i < 5; i++) {
        ell(acc, (0.02 - i * 0.011) * k, -0.07 * kk, -0.158 * kk + i * 0.005 * kk, 0.0085 * k, 0.008 * kk, 0.014 * kk, { ...st, color: ctx.skin.clone().lerp(ctx.skinDark, 0.2) }, null, 5, 4);
      }
    } else {
      const upper: Style = { color: color.clone(), bone, spec: kind === 'boots' || kind === 'combat' ? 0.18 : 0.12 };
      const sole: Style = { color: (opts.sole ?? (kind === 'sneakers' ? hex(0x8c8a80) : hex(0x1a1816))).clone(), bone };
      ell(acc, 0, -0.074 * kk, -0.055 * kk, 0.052 * k, 0.014 * kk, 0.148 * kk, sole, null, 10, 4);
      box(acc, 0, -0.078 * kk, 0.05 * kk, 0.086 * k, 0.016 * kk, 0.07 * kk, sole);
      ell(acc, 0, -0.05 * kk, -0.11 * kk, 0.049 * k, 0.04 * kk, 0.1 * kk, upper, null, 10, 7);
      box(acc, 0, -0.055 * kk, 0.042 * kk, 0.09 * k, 0.05 * kk, 0.08 * kk, upper);
      box(acc, 0, -0.03 * kk, -0.005 * kk, 0.086 * k, 0.07 * kk, 0.11 * kk, upper);
      if (kind === 'boots' || kind === 'combat') {
        cyl2(acc, 0, 0.02 * kk, 0.005 * kk, 0.052 * k, 0.058 * k, kind === 'combat' ? 0.17 * kk : 0.13 * kk, upper);
        // laces / strap band
        cyl2(acc, 0, 0.03 * kk, 0.005 * kk, 0.058 * k, 0.058 * k, 0.02 * kk, { color: hex(0x1c1a17), bone });
      } else {
        cyl2(acc, 0, 0.005 * kk, 0.006 * kk, 0.046 * k, 0.05 * k, 0.05 * kk, upper);
      }
    }
    acc.frame = null;
  }
}

function cyl2(acc: Accum, x: number, y: number, z: number, rTop: number, rBot: number, h: number, st: Style): void {
  // small helper around THREE.CylinderGeometry using the frame mechanism
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 10, 1, false);
  acc.add(g, new THREE.Matrix4().makeTranslation(x, y, z), st);
  g.dispose();
}

// ---------------------------------------------------------------------------------------------------------
// wounds
// ---------------------------------------------------------------------------------------------------------

export function addWound(ctx: Ctx, c: THREE.Vector3, r: number, bone: number, nrm: THREE.Vector3): void {
  const flat = V(r, r * 0.7, r * 0.3);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), nrm.clone().normalize());
  const m = new THREE.Matrix4().compose(c, q, flat);
  const g = new THREE.SphereGeometry(1, 7, 5);
  ctx.acc.add(g, m, { color: hex(0x4a0d10), bone, spec: 0.55, clean: true });
  g.dispose();
  const m2 = new THREE.Matrix4().compose(c.clone().addScaledVector(nrm, 0.002), q, V(r * 0.55, r * 0.4, r * 0.34));
  const g2 = new THREE.SphereGeometry(1, 6, 4);
  ctx.acc.add(g2, m2, { color: hex(0x1d0507), bone, spec: 0.4, clean: true });
  g2.dispose();
}

export { clamp };
