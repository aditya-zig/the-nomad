/**
 * Geometry accumulation for skinned humanoids: primitives and lofted tubes are transformed into model space, given
 * vertex colours / bone weights / glow / spec attributes and merged into ONE BufferGeometry per appearance variant.
 */
import * as THREE from 'three';
import { fbm3, mulberry32, noise3 } from './prng';

/** [boneA, weightA, boneB, weightB] */
export type Weights = [number, number, number, number];

export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

export interface Style {
  color: THREE.Color | ColorFn;
  bone: number | ((p: THREE.Vector3) => Weights);
  /** Emissive strength multiplier (vertex colour is the glow colour). */
  glow?: number;
  /** 0..1 hard-surface amount (metal / plastic / wet: lower roughness, higher metalness). */
  spec?: number;
  /** Skip grime / blood weathering (eyes, lights, teeth accents). */
  clean?: boolean;
}

export interface Splat {
  c: THREE.Vector3;
  r: number;
  /** 0..1 strength. */
  a: number;
  /** Colour of the stain. */
  color: THREE.Color;
}

export interface Weather {
  seed: number;
  /** Global albedo gain (keeps figures readable in dim light). */
  tone?: number;
  /** Extra darkening toward the ground (0..1). */
  dirt: number;
  splats: Splat[];
}

const smoothstepLocal = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const _w: Weights = [0, 1, 0, 0];
const _mm = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class Accum {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly skinIdx: number[] = [];
  readonly skinW: number[] = [];
  readonly glow: number[] = [];
  readonly spec: number[] = [];
  readonly clean: number[] = [];
  readonly idx: number[] = [];
  private uvOffU = 0;
  private uvOffV = 0;
  private partCounter = 0;
  /** Optional local frame applied to every primitive added while set (mirroring with a negative scale is supported). */
  frame: THREE.Matrix4 | null = null;

  get count(): number {
    return this.pos.length / 3;
  }

  /** Start a new logical part: gives it a distinct detail-texture offset. */
  beginPart(): void {
    this.partCounter++;
    this.uvOffU = noise3(this.partCounter * 1.7, 3.1, 0.5) * 8;
    this.uvOffV = noise3(this.partCounter * 2.3, 9.2, 4.5) * 8;
  }

  pushVertex(p: THREE.Vector3, n: THREE.Vector3, style: Style, colorOverride?: THREE.Color, weightOverride?: Weights): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    const c = colorOverride ?? (typeof style.color === 'function' ? style.color(p, n) : style.color);
    this.col.push(c.r, c.g, c.b);
    let w: Weights;
    if (weightOverride) w = weightOverride;
    else if (typeof style.bone === 'number') {
      _w[0] = style.bone;
      _w[1] = 1;
      _w[2] = 0;
      _w[3] = 0;
      w = _w;
    } else w = style.bone(p);
    const wsum = w[1] + w[3] || 1;
    this.skinIdx.push(w[0], w[2], 0, 0);
    this.skinW.push(w[1] / wsum, w[3] / wsum, 0, 0);
    this.glow.push(style.glow ?? 0);
    this.spec.push(style.spec ?? 0);
    this.clean.push(style.clean || (style.glow ?? 0) > 0 ? 1 : 0);
    // planar detail-map projection chosen by the dominant normal axis
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let u: number;
    let v: number;
    if (ay > ax && ay > az) {
      u = p.x;
      v = p.z;
    } else if (ax > az) {
      u = p.z;
      v = p.y;
    } else {
      u = p.x;
      v = p.y;
    }
    this.uv.push(u * 2.4 + this.uvOffU, v * 2.4 + this.uvOffV);
  }

  /** Add a THREE geometry transformed by `m` (and by `this.frame` when set). */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, style: Style): void {
    this.beginPart();
    const pa = geo.attributes.position!;
    const na = geo.attributes.normal!;
    let mm = m;
    if (this.frame) mm = _mm.multiplyMatrices(this.frame, m);
    _nm.getNormalMatrix(mm);
    const mirrored = mm.determinant() < 0;
    const base = this.count;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(mm);
      _n.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
      this.pushVertex(_v, _n, style);
    }
    const index = geo.index;
    const count = index ? index.count : pa.count;
    for (let i = 0; i < count; i += 3) {
      const a = (index ? index.getX(i) : i) + base;
      const b = (index ? index.getX(i + 1) : i + 1) + base;
      const c = (index ? index.getX(i + 2) : i + 2) + base;
      if (mirrored) this.idx.push(a, c, b);
      else this.idx.push(a, b, c);
    }
  }

  toGeometry(weather: Weather): THREE.BufferGeometry {
    this.applyWeather(weather);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIdx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('aSpec', new THREE.Float32BufferAttribute(this.spec, 1));
    const count = this.count;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    return g;
  }

  /** Bake grime, blotchy variation and blood/stain splats into the vertex colours. */
  private applyWeather(w: Weather): void {
    const c = new THREE.Color();
    const dirt = new THREE.Color(0.075, 0.062, 0.05);
    const s = w.seed;
    for (let i = 0; i < this.count; i++) {
      if (this.clean[i]) continue;
      const x = this.pos[i * 3]!;
      const y = this.pos[i * 3 + 1]!;
      const z = this.pos[i * 3 + 2]!;
      const ny = this.nor[i * 3 + 1]!;
      c.setRGB(this.col[i * 3]!, this.col[i * 3 + 1]!, this.col[i * 3 + 2]!);
      // blotchy brightness variation
      const n1 = fbm3(x * 6 + s, y * 6, z * 6, s & 15);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const gain = 1 + ((w.tone ?? 1) - 1) * (1 - smoothstepLocal(0.12, 0.42, lum));
      const k = (0.78 + 0.42 * n1) * gain;
      c.multiplyScalar(k);
      // grime toward the ground
      const g = Math.max(0, 0.75 - y) * w.dirt * (0.55 + 0.9 * noise3(x * 9, y * 9 + s, z * 9, 3));
      if (g > 0) c.lerp(dirt, Math.min(0.8, g));
      // fake ambient occlusion on downward facing surfaces
      if (ny < 0) c.multiplyScalar(1 + ny * 0.22);
      // stains
      for (const sp of w.splats) {
        const dx = x - sp.c.x;
        const dy = y - sp.c.y;
        const dz = z - sp.c.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < sp.r) {
          const f = Math.pow(1 - d / sp.r, 0.8) * sp.a * (0.55 + 0.6 * noise3(x * 25, y * 25, z * 25, 5));
          c.lerp(sp.color, Math.min(0.95, f));
        }
      }
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// shared unit primitives
// ---------------------------------------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function disposeShapeCache(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function compose(pos: THREE.Vector3, rot: THREE.Euler | null, scale: THREE.Vector3): THREE.Matrix4 {
  if (rot) _q.setFromEuler(rot);
  else _q.identity();
  return _m.compose(pos, _q, scale);
}

/** Ellipsoid centred at `c` with radii `r`, optionally rotated. */
export function ellipsoid(acc: Accum, c: THREE.Vector3, r: THREE.Vector3, style: Style, rot: THREE.Euler | null = null, ws = 10, hs = 8): void {
  const g = cached(`sph${ws}x${hs}`, () => new THREE.SphereGeometry(1, ws, hs));
  acc.add(g, compose(c, rot, r), style);
}

export function ell(acc: Accum, x: number, y: number, z: number, rx: number, ry: number, rz: number, style: Style, rot: [number, number, number] | null = null, ws = 10, hs = 8): void {
  _p.set(x, y, z);
  _s.set(rx, ry, rz);
  const g = cached(`sph${ws}x${hs}`, () => new THREE.SphereGeometry(1, ws, hs));
  if (rot) _e.set(rot[0], rot[1], rot[2], 'XYZ');
  acc.add(g, compose(_p, rot ? _e : null, _s), style);
}

/** Box centred at (x, y, z) with full size (w, h, d), optionally rotated (Euler XYZ). */
export function box(acc: Accum, x: number, y: number, z: number, w: number, h: number, d: number, style: Style, rot: [number, number, number] | null = null): void {
  const g = cached('box', () => new THREE.BoxGeometry(1, 1, 1));
  _p.set(x, y, z);
  _s.set(w, h, d);
  if (rot) _e.set(rot[0], rot[1], rot[2], 'XYZ');
  acc.add(g, compose(_p, rot ? _e : null, _s), style);
}

/** Cylinder / frustum with its axis along local Y, centred at (x, y, z), then rotated. */
export function cyl(acc: Accum, x: number, y: number, z: number, rTop: number, rBottom: number, h: number, style: Style, rot: [number, number, number] | null = null, radial = 10, open = false): void {
  const key = `cyl${radial}_${rTop / Math.max(rBottom, 1e-4)}_${open ? 1 : 0}`;
  const g = cached(key, () => new THREE.CylinderGeometry(rTop / Math.max(rBottom, 1e-4), 1, 1, radial, 1, open));
  _p.set(x, y, z);
  _s.set(rBottom, h, rBottom);
  if (rot) _e.set(rot[0], rot[1], rot[2], 'XYZ');
  acc.add(g, compose(_p, rot ? _e : null, _s), style);
}

/** Cone pointing along +Y in local space (apex up), base radius r, height h. */
export function cone(acc: Accum, x: number, y: number, z: number, r: number, h: number, style: Style, rot: [number, number, number] | null = null, radial = 6): void {
  const g = cached(`cone${radial}`, () => new THREE.ConeGeometry(1, 1, radial, 1));
  _p.set(x, y, z);
  _s.set(r, h, r);
  if (rot) _e.set(rot[0], rot[1], rot[2], 'XYZ');
  acc.add(g, compose(_p, rot ? _e : null, _s), style);
}

/**
 * Cylinder / tapered capsule between two world points a and b with radii ra, rb (segment-aligned), capped with a
 * flat end. Used for straps, cables, fingers and pipes.
 */
export function rod(acc: Accum, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, style: Style, radial = 6): void {
  const g = cached(`rod${radial}`, () => {
    const cg = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
    return cg;
  });
  const len = a.distanceTo(b);
  if (len < 1e-5) return;
  const mid = _p.copy(a).add(b).multiplyScalar(0.5);
  const dir = _v.copy(b).sub(a).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // non-uniform taper: build the geometry by scaling radii through two matrices is not possible, so approximate using mean radius
  // and add a second thin frustum for strong taper when needed.
  const r = (ra + rb) * 0.5;
  _s.set(r, len, r);
  _m.compose(mid, _q, _s);
  acc.add(g, _m, style);
}

/** Tapered rod (true frustum) between two points. */
export function taper(acc: Accum, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, style: Style, radial = 6): void {
  const len = a.distanceTo(b);
  if (len < 1e-5) return;
  const g = new THREE.CylinderGeometry(rb, ra, len, radial, 1, false);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
  acc.add(g, m, style);
  g.dispose();
}

// ---------------------------------------------------------------------------------------------------------
// lofted tube
// ---------------------------------------------------------------------------------------------------------

export interface LoftOpts {
  path: THREE.Vector3[];
  /** Ring parameters (by arc length) in [0, 1], ascending. */
  ts: number[];
  radial: number;
  prof: (t: number, out: { rx: number; rz: number }) => void;
  inflate?: number;
  hint: THREE.Vector3;
  color: (t: number, ang: number, p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;
  weights: number | ((t: number, p: THREE.Vector3) => Weights);
  /** Dome depth (metres) closing the first / last ring; 0 or undefined leaves the end open. */
  capStart?: number;
  capEnd?: number;
  /** Ragged-edge amplitude (metres) pulling the first / last ring vertices back along the tube. */
  jagStart?: number;
  jagEnd?: number;
  jagSeed?: number;
  glow?: number;
  spec?: number;
  clean?: boolean;
  /** Flip triangle winding (for inward facing shells). */
  inside?: boolean;
  /** Irregular radius modulation (cloth folds / muscle) as a fraction of the radius. */
  wobble?: number;
}

export function makeTs(t0: number, t1: number, n: number, extra: number[] = []): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(t0 + ((t1 - t0) * i) / (n - 1));
  for (const e of extra) if (e > t0 + 1e-4 && e < t1 - 1e-4) out.push(e);
  out.sort((a, b) => a - b);
  // remove near duplicates
  const res: number[] = [];
  for (const t of out) if (res.length === 0 || t - res[res.length - 1]! > 0.004) res.push(t);
  return res;
}

export function loft(acc: Accum, o: LoftOpts): void {
  acc.beginPart();
  const path = o.path;
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const l = path[i]!.distanceTo(path[i + 1]!);
    segLen.push(l);
    total += l;
  }
  const pointAt = (t: number, out: THREE.Vector3, tan: THREE.Vector3): void => {
    let d = Math.max(0, Math.min(1, t)) * total;
    let i = 0;
    while (i < segLen.length - 1 && d > segLen[i]!) {
      d -= segLen[i]!;
      i++;
    }
    const u = segLen[i]! > 0 ? d / segLen[i]! : 0;
    out.lerpVectors(path[i]!, path[i + 1]!, u);
    tan.subVectors(path[i + 1]!, path[i]!).normalize();
  };

  const nR = o.ts.length;
  const N = o.radial;
  const P = new Float32Array(nR * N * 3);
  const centers: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const rr = { rx: 0, rz: 0 };
  const c = new THREE.Vector3();
  const T = new THREE.Vector3();
  const d = new THREE.Vector3();
  const s = new THREE.Vector3();
  const rand = mulberry32(o.jagSeed ?? 1234);
  const jagS: number[] = [];
  const jagE: number[] = [];
  for (let k = 0; k < N; k++) {
    jagS.push((0.15 + 0.85 * rand()) * (k % 2 === 0 ? 1 : 0.35));
    jagE.push((0.15 + 0.85 * rand()) * (k % 2 === 0 ? 1 : 0.35));
  }
  const infl = o.inflate ?? 0;
  for (let i = 0; i < nR; i++) {
    const t = o.ts[i]!;
    pointAt(t, c, T);
    // smooth the tangent between neighbouring segments near joints
    const t2 = new THREE.Vector3();
    const c2 = new THREE.Vector3();
    pointAt(Math.min(1, t + 0.02), c2, t2);
    T.add(t2).normalize();
    o.prof(t, rr);
    d.copy(o.hint).addScaledVector(T, -o.hint.dot(T));
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0).addScaledVector(T, -T.x);
    d.normalize();
    s.crossVectors(T, d).normalize();
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const wob = o.wobble ? 1 + o.wobble * (noise3(i * 1.31 + (o.jagSeed ?? 0) * 0.13, Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + t * 4, 2) - 0.5) * 2 : 1;
      const wx = (rr.rx + infl) * wob;
      const wz = (rr.rz + infl) * wob;
      let px = c.x + s.x * wx * ca + d.x * wz * sa;
      let py = c.y + s.y * wx * ca + d.y * wz * sa;
      let pz = c.z + s.z * wx * ca + d.z * wz * sa;
      if (i === 0 && o.jagStart) {
        const j = o.jagStart * jagS[k]!;
        px += T.x * j;
        py += T.y * j;
        pz += T.z * j;
      }
      if (i === nR - 1 && o.jagEnd) {
        const j = o.jagEnd * jagE[k]!;
        px -= T.x * j;
        py -= T.y * j;
        pz -= T.z * j;
      }
      const o3 = (i * N + k) * 3;
      P[o3] = px;
      P[o3 + 1] = py;
      P[o3 + 2] = pz;
    }
    centers.push(c.clone());
    tangents.push(T.clone());
  }

  // normals from the ring grid
  const base = acc.count;
  const nrm = new THREE.Vector3();
  const a1 = new THREE.Vector3();
  const a2 = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const st: Style = { color: new THREE.Color(1, 1, 1), bone: 0, glow: o.glow, spec: o.spec, clean: o.clean };
  for (let i = 0; i < nR; i++) {
    const ip = Math.max(0, i - 1);
    const inx = Math.min(nR - 1, i + 1);
    for (let k = 0; k < N; k++) {
      const kp = (k + N - 1) % N;
      const kn = (k + 1) % N;
      a1.set(P[(inx * N + k) * 3]! - P[(ip * N + k) * 3]!, P[(inx * N + k) * 3 + 1]! - P[(ip * N + k) * 3 + 1]!, P[(inx * N + k) * 3 + 2]! - P[(ip * N + k) * 3 + 2]!);
      a2.set(P[(i * N + kn) * 3]! - P[(i * N + kp) * 3]!, P[(i * N + kn) * 3 + 1]! - P[(i * N + kp) * 3 + 1]!, P[(i * N + kn) * 3 + 2]! - P[(i * N + kp) * 3 + 2]!);
      nrm.crossVectors(a2, a1).normalize();
      // make sure it points away from the axis
      const cx = centers[i]!;
      pos.set(P[(i * N + k) * 3]!, P[(i * N + k) * 3 + 1]!, P[(i * N + k) * 3 + 2]!);
      if (nrm.dot(_v.subVectors(pos, cx)) < 0) nrm.negate();
      if (o.inside) nrm.negate();
      const t = o.ts[i]!;
      const ang = (k / N) * Math.PI * 2;
      const col = o.color(t, ang, pos, nrm);
      const w = typeof o.weights === 'number' ? ([o.weights, 1, 0, 0] as Weights) : o.weights(t, pos);
      acc.pushVertex(pos, nrm, st, col, w);
    }
  }
  const flip = !!o.inside;
  for (let i = 0; i < nR - 1; i++) {
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      const a = base + i * N + k;
      const b = base + i * N + k1;
      const cc = base + (i + 1) * N + k;
      const dd = base + (i + 1) * N + k1;
      // (ring direction) x (path direction) points INWARD for this parameterisation, so wind the other way for outward faces
      if (!flip) {
        acc.idx.push(a, dd, b, a, cc, dd);
      } else {
        acc.idx.push(a, b, dd, a, dd, cc);
      }
    }
  }
  // caps
  const cap = (ringIdx: number, depth: number, sign: number) => {
    const cen = centers[ringIdx]!;
    const tan = tangents[ringIdx]!;
    const tip = new THREE.Vector3().copy(cen).addScaledVector(tan, sign * depth);
    const ti = o.ts[ringIdx]!;
    const w = typeof o.weights === 'number' ? ([o.weights, 1, 0, 0] as Weights) : o.weights(ti, tip);
    const col = o.color(ti, 0, tip, tan);
    const nn = new THREE.Vector3().copy(tan).multiplyScalar(sign);
    const ci = acc.count;
    acc.pushVertex(tip, nn, st, col, w);
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      const a = base + ringIdx * N + k;
      const b = base + ringIdx * N + k1;
      // ring vertex normals are radial; the cap uses its own duplicated vertices for a crisp edge
      const pa = new THREE.Vector3(P[(ringIdx * N + k) * 3]!, P[(ringIdx * N + k) * 3 + 1]!, P[(ringIdx * N + k) * 3 + 2]!);
      const pb = new THREE.Vector3(P[(ringIdx * N + k1) * 3]!, P[(ringIdx * N + k1) * 3 + 1]!, P[(ringIdx * N + k1) * 3 + 2]!);
      const wa = typeof o.weights === 'number' ? ([o.weights, 1, 0, 0] as Weights) : o.weights(ti, pa);
      const wb = typeof o.weights === 'number' ? ([o.weights, 1, 0, 0] as Weights) : o.weights(ti, pb);
      const ia = acc.count;
      acc.pushVertex(pa, nn, st, o.color(ti, 0, pa, nn), wa);
      const ib = acc.count;
      acc.pushVertex(pb, nn, st, o.color(ti, 0, pb, nn), wb);
      void a;
      void b;
      if ((sign > 0) !== flip) acc.idx.push(ci, ib, ia);
      else acc.idx.push(ci, ia, ib);
    }
  };
  if (o.capStart) cap(0, o.capStart, -1);
  if (o.capEnd) cap(nR - 1, o.capEnd, 1);
}

/** Convenience: piecewise-linear profile through (t, rx, rz) samples. */
export function profile(samples: [number, number, number][]): (t: number, out: { rx: number; rz: number }) => void {
  return (t, out) => {
    if (t <= samples[0]![0]) {
      out.rx = samples[0]![1];
      out.rz = samples[0]![2];
      return;
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i]!;
      const b = samples[i + 1]!;
      if (t <= b[0]) {
        const u = (t - a[0]) / (b[0] - a[0] || 1);
        out.rx = a[1] + (b[1] - a[1]) * u;
        out.rz = a[2] + (b[2] - a[2]) * u;
        return;
      }
    }
    const l = samples[samples.length - 1]!;
    out.rx = l[1];
    out.rz = l[2];
  };
}
