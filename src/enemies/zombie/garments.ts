/**
 * Clothing layers for the base body: lofted shells with ragged hems, sleeves, trousers, gowns and accessories.
 */
import * as THREE from 'three';
import { B } from './dims';
import {
  type Ctx,
  V,
  addFeet,
  armBones,
  armPath,
  armProf,
  armTMid,
  blend2,
  hex,
  legBones,
  legPath,
  legProf,
  legTMid,
  limbWeights,
  torsoPath,
  torsoProf,
  torsoT,
  torsoWeights,
  type ShoeKind,
} from './body';
import { box, ell, loft, makeTs, taper, type Weights } from './mesh';
import { smoothstep } from './prng';

export type TopKind = 'tshirt' | 'shirt' | 'hoodie' | 'jacket' | 'overalls' | 'gown' | 'labcoat' | 'tank' | 'none';
export type BottomKind = 'jeans' | 'slacks' | 'cargo' | 'shorts' | 'scrubs' | 'none';

export interface Outfit {
  name: string;
  top: TopKind;
  topColor: number;
  accent: number;
  sleeves: 'short' | 'long' | 'torn' | 'none';
  bottom: BottomKind;
  bottomColor: number;
  shoes: ShoeKind;
  shoeColor: number;
  missingShoe?: 1 | -1 | 0;
  hair: 'none' | 'short' | 'patchy' | 'long' | 'strands';
  hairColor: number;
  skin: number;
  extras?: ('tie' | 'belt' | 'pockets' | 'lanyard' | 'bandage' | 'cap')[];
}

const tmpC = new THREE.Color();

function flat(c: THREE.Color): (t: number, a: number, p: THREE.Vector3, n: THREE.Vector3) => THREE.Color {
  return () => tmpC.copy(c);
}

/** Torso shell between heights y0..y1 (in units of k). */
export function torsoShell(ctx: Ctx, y0: number, y1: number, color: THREE.Color, inflate: number, jag: number, seed: number, opts: { capTop?: boolean; spec?: number } = {}): void {
  const { acc, D } = ctx;
  const t0 = torsoT(D, y0 * D.k);
  const t1 = torsoT(D, y1 * D.k);
  loft(acc, {
    path: torsoPath(D),
    ts: makeTs(t0, t1, 8, [torsoT(D, D.hipY), torsoT(D, 1.09 * D.k), torsoT(D, 1.28 * D.k)]),
    radial: 12,
    prof: torsoProf(ctx),
    inflate,
    hint: V(0, 0, 1),
    color: flat(color),
    weights: torsoWeights(D),
    jagStart: jag,
    jagSeed: seed,
    capEnd: opts.capTop ? 0.015 * D.k : 0,
    spec: opts.spec ?? 0,
    wobble: 0.045,
  });
  if (jag > 0.02 * D.k) hemFlaps(ctx, y0, color, seed);
}

/** Torn cloth strips hanging from a torso hem. */
function hemFlaps(ctx: Ctx, y0: number, color: THREE.Color, seed: number): void {
  const { acc, D } = ctx;
  const k = D.k;
  const prof = torsoProf(ctx);
  const out = { rx: 0, rz: 0 };
  prof(torsoT(D, y0 * k), out);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2 + ((seed * 0.37) % 1);
    const len = (0.05 + ((Math.sin(seed * 7.3 + i * 4.1) + 1) * 0.5) * 0.07) * k;
    const x = Math.cos(a) * (out.rx + 0.014 * k);
    const z = Math.sin(a) * (out.rz + 0.014 * k);
    const bone = y0 * k < D.hipY ? B.pelvis : B.spine;
    box(acc, x, y0 * k - len * 0.4, z, 0.035 * k, len, 0.006 * k, { color: color.clone().multiplyScalar(0.92), bone }, [0, -a + Math.PI / 2, 0]);
  }
}

/** Sleeve over an arm from the shoulder to parameter `tEnd`. */
export function sleeve(ctx: Ctx, s: 1 | -1, tEnd: number, color: THREE.Color, inflate: number, jag: number, seed: number): void {
  const { acc, D } = ctx;
  // cloth cover over the shoulder ball
  {
    const shR = ctx.rest[s < 0 ? B.shL : B.shR]!;
    const r = 0.055 * D.k * Math.pow(D.armT, 0.75) * Math.sqrt(ctx.girth) + inflate + 0.004 * D.k;
    ell(acc, shR.x, shR.y - 0.006 * D.k, shR.z, r, r * 1.0, r, { color: color.clone(), bone: s < 0 ? B.shL : B.shR }, null, 12, 9);
  }
  const [b0, b1, b2] = armBones(s);
  const tm = armTMid(D);
  loft(acc, {
    path: armPath(ctx, s),
    ts: makeTs(0.015, tEnd, 8, [tm - 0.08, tm, tm + 0.08]),
    radial: 9,
    prof: armProf(ctx),
    inflate,
    hint: V(0, 0, 1),
    color: flat(color),
    weights: limbWeights(b0, b1, b2, tm),
    jagEnd: jag,
    jagSeed: seed,
    wobble: 0.05,
  });
  if (jag > 0.02 * D.k && tEnd < 0.9) sleeveFlaps(ctx, s, tEnd, color, seed);
}

/** Torn strips hanging from a cut sleeve. */
function sleeveFlaps(ctx: Ctx, s: 1 | -1, tEnd: number, color: THREE.Color, seed: number): void {
  const { acc, D } = ctx;
  const path = armPath(ctx, s);
  const l1 = path[0]!.distanceTo(path[1]!);
  const l2 = path[1]!.distanceTo(path[2]!);
  const total = l1 + l2;
  let d = tEnd * total;
  let idx = 0;
  if (d > l1) {
    d -= l1;
    idx = 1;
  }
  const seg = idx === 0 ? l1 : l2;
  const p = new THREE.Vector3().lerpVectors(path[idx]!, path[idx + 1]!, d / seg);
  const dir = new THREE.Vector3().subVectors(path[idx + 1]!, path[idx]!).normalize();
  const bone = idx === 0 ? (s < 0 ? B.shL : B.shR) : s < 0 ? B.elL : B.elR;
  const prof = armProf(ctx);
  const out = { rx: 0, rz: 0 };
  prof(tEnd, out);
  const r = Math.max(out.rx, out.rz) + 0.014 * D.k;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + seed * 0.3;
    const len = (0.035 + ((Math.sin(seed * 3.1 + i * 5.7) + 1) * 0.5) * 0.06) * D.k;
    const off = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const c = p.clone().add(off).addScaledVector(dir, len * 0.4);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const g = new THREE.BoxGeometry(0.028 * D.k, len, 0.005 * D.k);
    acc.add(g, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)), { color: color.clone().multiplyScalar(0.9), bone });
    g.dispose();
  }
}

/** Trouser leg from the hip to parameter `tEnd`, with a slightly flared cuff. */
export function trouserLeg(ctx: Ctx, s: 1 | -1, tEnd: number, color: THREE.Color, inflate: number, jag: number, seed: number, flare = 0.008): void {
  const { acc, D } = ctx;
  const [b0, b1, b2] = legBones(s);
  const tm = legTMid(D);
  const base = legProf(ctx);
  const out = { rx: 0, rz: 0 };
  loft(acc, {
    path: legPath(ctx, s),
    ts: makeTs(0.0, tEnd, 10, [tm - 0.08, tm, tm + 0.08]),
    radial: 10,
    prof: (t, o) => {
      base(t, o);
      const f = smoothstep(tEnd - 0.14, tEnd, t) * flare * D.k;
      o.rx += f;
      o.rz += f;
      void out;
    },
    inflate,
    hint: V(0, 0, 1),
    color: flat(color),
    weights: limbWeights(b0, b1, b2, tm, 0.95, 0.06),
    jagEnd: jag,
    jagSeed: seed,
    capStart: 0,
    wobble: 0.05,
  });
}

/** Skin-coloured tear patch poking through fabric (knees, elbows, belly). */
function tearPatch(ctx: Ctx, x: number, y: number, z: number, r: number, bone: number): void {
  ell(ctx.acc, x, y, z, r, r * 1.1, r * 0.35, { color: ctx.skin.clone().lerp(ctx.skinDark, 0.25), bone, spec: 0.1 }, null, 6, 5);
}

/** Gown / coat shell: torso from the neckline down over the hips to `yHem`, flaring; the skirt follows the legs partially. */
function skirtShell(ctx: Ctx, yTop: number, yHem: number, color: THREE.Color, flare: number, jag: number, seed: number, wide: number): void {
  const { acc, D } = ctx;
  const k = D.k;
  const w = torsoWeights(D);
  const prof = torsoProf(ctx);
  // path continues below the pelvis: straight down
  const path = [V(0, yHem * k, 0), V(0, yTop * k, 0)];
  const len = (yTop - yHem) * k;
  const yb = TORSO_BASE * k;
  loft(acc, {
    path,
    ts: makeTs(0, 1, 14),
    radial: 14,
    prof: (t, o) => {
      const y = yHem * k + t * len;
      // torso profile above the hips, flared skirt below
      const tt = Math.max(0, Math.min(1, (y - yb) / (1.49 * k - yb)));
      prof(tt, o);
      if (y < 0.93 * k) {
        const f = smoothstep(0.93 * k, yHem * k, y);
        o.rx += f * flare * k * wide;
        o.rz += f * flare * k * wide * 0.8;
      }
      o.rx += 0.006 * k;
      o.rz += 0.006 * k;
    },
    hint: V(0, 0, 1),
    color: flat(color),
    weights: (_t, p): Weights => {
      const y = p.y;
      const base = w(0, p);
      if (y >= 0.93 * k) return base;
      // lower skirt: follow the thighs a little so legs do not stab through
      const f = smoothstep(0.93 * k, 0.66 * k, y) * 0.55;
      const hb = p.x < 0 ? B.hipL : B.hipR;
      return [B.pelvis, 1 - f, hb, f];
    },
    jagStart: jag,
    jagSeed: seed,
    capEnd: 0.015 * k,
  });
}

const TORSO_BASE = 0.86;

export function addOutfit(ctx: Ctx, o: Outfit): void {
  const { acc, D, rand } = ctx;
  const k = D.k;
  const top = hex(o.topColor);
  const acc2 = hex(o.accent);
  const bottom = hex(o.bottomColor);
  const seed = Math.floor(rand() * 9999);

  // ---------------- bottoms ----------------
  if (o.top !== 'gown' && o.top !== 'labcoat') {
    if (o.bottom !== 'none') {
      const isShorts = o.bottom === 'shorts';
      const tEnd = isShorts ? 0.4 : 0.965;
      const infl = o.bottom === 'cargo' ? 0.012 * k : o.bottom === 'slacks' ? 0.007 * k : 0.009 * k;
      for (const s of [-1, 1] as const) trouserLeg(ctx, s, tEnd, bottom, infl, isShorts ? 0.03 * k : 0.035 * k, seed + s, isShorts ? 0.004 : o.bottom === 'jeans' ? 0.006 : 0.01);
      // waistband / hips
      torsoShell(ctx, 0.87, 1.02, bottom, 0.01 * k, 0, seed);
      if (o.extras?.includes('belt') || o.bottom === 'jeans') torsoShell(ctx, 0.985, 1.03, hex(0x2a2119), 0.019 * k, 0, seed + 21, { spec: 0.15 });
      if (o.bottom === 'cargo') {
        for (const s of [-1, 1] as const) {
          const bone = s < 0 ? B.hipL : B.hipR;
          box(acc, s * (D.hipX + 0.075 * k * D.legT), 0.78 * k, 0.005 * k, 0.03 * k, 0.15 * k, 0.11 * k, { color: bottom.clone().multiplyScalar(0.88), bone });
        }
      }
      // knee tears
      if (!isShorts && rand() < 0.75) {
        const s = rand() < 0.5 ? -1 : 1;
        tearPatch(ctx, s * D.hipX, D.kneeY, -0.058 * k * D.legT, 0.03 * k, s < 0 ? B.knL : B.knR);
      }
    }
  }

  // ---------------- tops ----------------
  switch (o.top) {
    case 'tshirt':
    case 'tank': {
      const hem = 0.93 + rand() * rand() * 0.2;
      torsoShell(ctx, hem, o.top === 'tank' ? 1.42 : 1.465, top, 0.011 * k, 0.035 * k, seed + 3);
      if (o.top === 'tshirt') for (const s of [-1, 1] as const) sleeve(ctx, s, 0.34 + rand() * 0.08, top, 0.012 * k, 0.025 * k, seed + 5 * s);
      break;
    }
    case 'shirt': {
      torsoShell(ctx, 0.9, 1.465, top, 0.011 * k, 0.03 * k, seed + 4);
      const torn = o.sleeves === 'torn';
      for (const s of [-1, 1] as const) sleeve(ctx, s, torn ? 0.5 + rand() * 0.2 : 0.9, top, 0.011 * k, torn ? 0.04 * k : 0.012 * k, seed + 7 * s);
      collar(ctx, top.clone().multiplyScalar(0.9));
      if (o.extras?.includes('tie')) {
        box(acc, 0.004 * k, 1.315 * k, -0.118 * k * D.torsoD * ctx.girth, 0.034 * k, 0.22 * k, 0.008 * k, { color: acc2.clone(), bone: B.chest }, [0.08, 0, 0.03]);
        box(acc, 0, 1.43 * k, -0.098 * k * D.torsoD * ctx.girth, 0.04 * k, 0.03 * k, 0.02 * k, { color: acc2.clone(), bone: B.chest });
      }
      break;
    }
    case 'hoodie': {
      torsoShell(ctx, 0.88, 1.465, top, 0.016 * k, 0.03 * k, seed + 6);
      for (const s of [-1, 1] as const) sleeve(ctx, s, o.sleeves === 'torn' ? 0.7 : 0.94, top, 0.016 * k, o.sleeves === 'torn' ? 0.035 * k : 0.01 * k, seed + 8 * s);
      // bunched hood at the nape
      ell(acc, 0, 1.5 * k, 0.062 * k * D.torsoD, 0.09 * k, 0.055 * k, 0.07 * k, { color: top.clone().multiplyScalar(0.9), bone: B.chest }, null, 9, 6);
      box(acc, 0, 1.07 * k, -0.108 * k * D.torsoD * ctx.girth, 0.2 * k, 0.09 * k, 0.03 * k, { color: top.clone().multiplyScalar(0.86), bone: B.spine });
      break;
    }
    case 'jacket': {
      torsoShell(ctx, 0.88, 1.47, top, 0.02 * k, 0.03 * k, seed + 9, { spec: 0.18 });
      for (const s of [-1, 1] as const) sleeve(ctx, s, 0.93, top, 0.018 * k, 0.012 * k, seed + 11 * s);
      collar(ctx, top.clone().multiplyScalar(0.92), 0.075);
      // zipper / opening line
      box(acc, 0, 1.17 * k, -0.116 * k * D.torsoD * ctx.girth, 0.012 * k, 0.55 * k, 0.006 * k, { color: hex(0x15130f), bone: B.chest });
      for (const s of [-1, 1] as const) box(acc, s * 0.06 * k, 1.36 * k, -0.116 * k * D.torsoD * ctx.girth, 0.11 * k, 0.026 * k, 0.014 * k, { color: top.clone().multiplyScalar(0.8), bone: B.chest });
      break;
    }
    case 'overalls': {
      // long-sleeve undershirt + bib and straps in accent colour
      torsoShell(ctx, 0.9, 1.465, acc2, 0.009 * k, 0.02 * k, seed + 12);
      for (const s of [-1, 1] as const) sleeve(ctx, s, 0.9, acc2, 0.009 * k, 0.012 * k, seed + 13 * s);
      torsoShell(ctx, 0.87, 1.25, top, 0.018 * k, 0, seed + 14);
      box(acc, 0, 1.17 * k, -0.118 * k * D.torsoD * ctx.girth, 0.22 * k * D.torsoW, 0.16 * k, 0.014 * k, { color: top.clone().multiplyScalar(0.92), bone: B.spine });
      for (const s of [-1, 1] as const) {
        taper(acc, V(s * 0.08 * k, 1.27 * k, -0.11 * k * D.torsoD), V(s * 0.115 * k, 1.47 * k, -0.02 * k), 0.017 * k, 0.017 * k, { color: top.clone(), bone: B.chest }, 4);
        taper(acc, V(s * 0.115 * k, 1.47 * k, -0.02 * k), V(s * 0.12 * k, 1.44 * k, 0.09 * k), 0.017 * k, 0.017 * k, { color: top.clone(), bone: B.chest }, 4);
      }
      break;
    }
    case 'gown': {
      skirtShell(ctx, 1.47, 0.6 + rand() * 0.06, top, 0.03, 0.05 * k, seed + 15, 1);
      break;
    }
    case 'labcoat': {
      skirtShell(ctx, 1.47, 0.48 + rand() * 0.05, top, 0.045, 0.045 * k, seed + 16, 1);
      for (const s of [-1, 1] as const) sleeve(ctx, s, 0.9, top, 0.016 * k, 0.02 * k, seed + 17 * s);
      collar(ctx, top.clone().multiplyScalar(0.95), 0.08);
      // scrubs underneath show at the neck: accent-coloured V
      box(acc, 0, 1.4 * k, -0.105 * k * D.torsoD * ctx.girth, 0.05 * k, 0.1 * k, 0.01 * k, { color: acc2.clone(), bone: B.chest });
      break;
    }
    default:
      break;
  }

  // ---------------- accessories ----------------
  if (o.extras?.includes('lanyard')) {
    taper(acc, V(-0.05 * k, 1.44 * k, -0.06 * k), V(0, 1.18 * k, -0.128 * k * D.torsoD * ctx.girth), 0.006 * k, 0.006 * k, { color: acc2.clone(), bone: B.chest }, 4);
    taper(acc, V(0.05 * k, 1.44 * k, -0.06 * k), V(0, 1.18 * k, -0.128 * k * D.torsoD * ctx.girth), 0.006 * k, 0.006 * k, { color: acc2.clone(), bone: B.chest }, 4);
    box(acc, 0, 1.15 * k, -0.13 * k * D.torsoD * ctx.girth, 0.055 * k, 0.075 * k, 0.006 * k, { color: hex(0xb8b9b0), bone: B.chest, clean: true });
  }
  if (o.extras?.includes('bandage')) {
    const s = rand() < 0.5 ? -1 : 1;
    const [b0, b1] = armBones(s);
    void b0;
    const el = ctx.rest[b1]!;
    box(acc, el.x + s * 0.005 * k, el.y - 0.06 * k, el.z, 0.11 * k * D.armT * 0.9, 0.09 * k, 0.11 * k * D.armT * 0.9, { color: hex(0x9d968a), bone: b1 });
    box(acc, el.x + s * 0.005 * k, el.y - 0.06 * k, el.z, 0.117 * k * D.armT * 0.9, 0.03 * k, 0.117 * k * D.armT * 0.9, { color: hex(0x5b2523), bone: b1, clean: true });
  }

  // ---------------- shoes ----------------
  addFeet(ctx, o.shoes, hex(o.shoeColor), { missing: o.missingShoe ?? 0 });
}

function collar(ctx: Ctx, color: THREE.Color, r = 0.068): void {
  const { acc, D } = ctx;
  const k = D.k;
  const g = new THREE.CylinderGeometry(r * k * Math.sqrt(D.torsoW), (r + 0.012) * k * Math.sqrt(D.torsoW), 0.035 * k, 10, 1, true);
  const m = new THREE.Matrix4().makeTranslation(0, 1.475 * k, 0.004 * k);
  acc.add(g, m, { color: color.clone(), bone: B.chest });
  // add a back-face shell so the open collar is visible from inside as well
  const st = new THREE.Matrix4().makeTranslation(0, 1.475 * k, 0.004 * k).multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  acc.add(g, st, { color: color.clone().multiplyScalar(0.8), bone: B.chest });
  g.dispose();
}

export { blend2 };
