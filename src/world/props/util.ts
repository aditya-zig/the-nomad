/**
 * Shared helpers for the prop modules: seeded randomness, placement maths, collider helpers, a local material cache,
 * and `Parts` - a pre-merging geometry collector so each prop reaches the LevelBuilder as a handful of meshes
 * (one per material) already in world space.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type LevelBuilder, projectWorldUV } from '../builder';
import type { BoxCollider, ColliderSpec } from '../collision';
import type { MaterialLib, StencilOptions } from '../materials';
import type { Place } from './types';

// ---------------------------------------------------------------------------------------------
// seeded randomness
// ---------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  f(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** Approximately normal, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

export function hashXZ(x: number, z: number, salt = 0): number {
  let h = (Math.round(x * 100) * 73856093) ^ (Math.round(z * 100) * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Deterministic RNG from an explicit seed or the placement position. */
export function rngFor(o: { x: number; z: number; seed?: number }, salt = 0): Rng {
  return new Rng(o.seed !== undefined ? Math.floor(o.seed) + salt * 7919 : hashXZ(o.x, o.z, salt));
}

// ---------------------------------------------------------------------------------------------
// placement
// ---------------------------------------------------------------------------------------------

export function placeMatrix(o: Place): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(o.rot ?? 0);
  m.setPosition(o.x, o.y ?? 0, o.z);
  return m;
}

/** World XZ of a local (lx, lz) offset from a placement. */
export function toWorld(o: Place, lx: number, lz: number): { x: number; z: number } {
  const r = o.rot ?? 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: o.x + c * lx + s * lz, z: o.z - s * lx + c * lz };
}

/** Yaw (rotation.y) that turns local +X toward the world direction (dx, dz). */
export function angleOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// colliders
// ---------------------------------------------------------------------------------------------

export interface LocalColliderOpts extends Partial<Omit<ColliderSpec, 'x' | 'z' | 'hx' | 'hz' | 'y1'>> {
  /** Extra yaw relative to the placement. */
  rotOffset?: number;
}

/** Box collider positioned in a placement's local frame. `w` along local X, `d` along local Z, `h` = top above the placement base. */
export function collideLocal(
  b: LevelBuilder,
  o: Place,
  lx: number,
  lz: number,
  w: number,
  d: number,
  h: number,
  opts: LocalColliderOpts = {},
): BoxCollider {
  const p = toWorld(o, lx, lz);
  const base = o.y ?? 0;
  const { rotOffset, y0, ...rest } = opts;
  return b.collide({
    x: p.x,
    z: p.z,
    hx: w / 2,
    hz: d / 2,
    rot: (o.rot ?? 0) + (rotOffset ?? 0),
    y0: base + (y0 ?? 0),
    y1: base + h,
    ...rest,
  });
}

/**
 * Round obstacle approximated by four boxes rotated 45 degrees apart (corners on the circle), so it never sticks out
 * past the true radius and leaves at most ~8% slivers. Tiny radii use one box.
 */
export function roundCollider(
  b: LevelBuilder,
  o: Place,
  lx: number,
  lz: number,
  r: number,
  h: number,
  opts: LocalColliderOpts = {},
): void {
  if (r < 0.45) {
    const s = r * 1.7;
    collideLocal(b, o, lx, lz, s, s, h, opts);
    return;
  }
  const hl = r * Math.cos(Math.PI / 8);
  const ht = r * Math.sin(Math.PI / 8);
  for (let i = 0; i < 4; i++) {
    collideLocal(b, o, lx, lz, hl * 2, ht * 2, h, { ...opts, rotOffset: (opts.rotOffset ?? 0) + (i * Math.PI) / 4 });
  }
}

// ---------------------------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------------------------

const matCache = new Map<string, THREE.Material>();

/** Module-level cache for props' own (non-library) materials. */
export function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    if (!m.name) m.name = key;
    matCache.set(key, m);
  }
  return m as T;
}

/**
 * `mats.stencil` wrapper: shader program names are built from `material.name`, and a name containing a newline
 * (multi-line sign text) breaks shader compilation, so flatten it.
 */
export function stencil(mats: MaterialLib, text: string, opts?: StencilOptions): THREE.MeshStandardMaterial {
  const m = mats.stencil(text, opts);
  if (/[\r\n]/.test(m.name)) m.name = m.name.replace(/[\r\n]+/g, ' ');
  return m;
}

export function emissiveMat(color: number, intensity: number, roughness = 0.4): THREE.MeshStandardMaterial {
  return cachedMat(
    `em:${color}:${intensity}`,
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.25),
        emissive: color,
        emissiveIntensity: intensity,
        roughness,
      }),
  );
}

export function plainMat(color: number, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  return cachedMat(`plain:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

// ---------------------------------------------------------------------------------------------
// geometry normalisation and part collection
// ---------------------------------------------------------------------------------------------

export function normaliseGeometry(g: THREE.BufferGeometry, wantColor: boolean): void {
  for (const name of Object.keys(g.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'uv') continue;
    if (name === 'color' && wantColor) continue;
    g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position!.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (wantColor && !g.attributes.color) {
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  }
  if (!g.index) {
    const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
}

function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.index!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, a);
  }
}

export interface PartOpts {
  /** Euler XYZ rotation (radians) about the part centre. */
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  cast?: boolean;
  receive?: boolean;
  /** Force / forbid world-projected UVs (default: only Box/Plane geometry on materials with `userData.tile`). */
  worldUV?: boolean;
  /** Vertex colour multiplier (requires a material with `vertexColors: true`). */
  color?: number;
}

interface PartGroup {
  mat: THREE.Material;
  cast: boolean;
  receive: boolean;
  geos: THREE.BufferGeometry[];
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Collects geometry parts (in the placement's local space) grouped by material, then `flush`es one merged world-space
 * mesh per material into the LevelBuilder.
 */
export class Parts {
  private readonly groups = new Map<string, PartGroup>();
  private base: THREE.Matrix4;

  constructor(place?: Place) {
    this.base = place ? placeMatrix(place) : new THREE.Matrix4();
  }

  /** Extra transform applied on top of the placement (e.g. a tilt for wrecks). Set before adding parts. */
  setBase(m: THREE.Matrix4): void {
    this.base = m.clone();
  }

  get baseMatrix(): THREE.Matrix4 {
    return this.base;
  }

  geo(mat: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, o: PartOpts = {}, owned = true): void {
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'XYZ');
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    const local = new THREE.Matrix4().compose(_v, _q, _s);
    this.geoM(mat, g, local, o, owned);
  }

  /** Add geometry with an explicit local matrix (placement base is applied on top). */
  geoM(mat: THREE.Material, g: THREE.BufferGeometry, local: THREE.Matrix4, o: PartOpts = {}, owned = true): void {
    const geom = owned ? g : g.clone();
    _m.copy(local).premultiply(this.base);
    const type = g.type;
    geom.applyMatrix4(_m);
    const wantColor = (mat as THREE.MeshStandardMaterial).vertexColors === true;
    normaliseGeometry(geom, wantColor);
    if (_m.determinant() < 0) flipWinding(geom);
    if (wantColor && o.color !== undefined) {
      _c.set(o.color);
      const col = geom.attributes.color!;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    const tile = (mat.userData?.tile as number | undefined) ?? 0;
    const uvWorld = o.worldUV ?? ((type === 'BoxGeometry' || type === 'PlaneGeometry') && tile > 0);
    if (uvWorld && tile > 0) projectWorldUV(geom, tile);
    const cast = o.cast ?? true;
    const receive = o.receive ?? true;
    const key = `${mat.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}`;
    let grp = this.groups.get(key);
    if (!grp) {
      grp = { mat, cast, receive, geos: [] };
      this.groups.set(key, grp);
    }
    grp.geos.push(geom);
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, o: PartOpts = {}): void {
    this.geo(mat, new THREE.BoxGeometry(w, h, d), x, y, z, o);
  }

  /** Chamfered box (flat-shaded bevel of `c` metres on every edge). */
  bevelBox(mat: THREE.Material, w: number, h: number, d: number, c: number, x: number, y: number, z: number, o: PartOpts = {}): void {
    this.geo(mat, bevelBoxGeometry(w, h, d, c), x, y, z, { worldUV: true, ...o });
  }

  /** Cylinder whose axis runs along `axis` (default Y). */
  cyl(
    mat: THREE.Material,
    rTop: number,
    rBot: number,
    h: number,
    seg: number,
    x: number,
    y: number,
    z: number,
    axis: 'x' | 'y' | 'z' = 'y',
    o: PartOpts = {},
    open = false,
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    this.geo(mat, g, x, y, z, o);
  }

  sphere(mat: THREE.Material, r: number, ws: number, hs: number, x: number, y: number, z: number, o: PartOpts = {}): void {
    this.geo(mat, new THREE.SphereGeometry(r, ws, hs), x, y, z, o);
  }

  /** Thin box strut / rope / tube between two local points (length along the segment, square cross-section `th`). */
  strut(mat: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, th: number, o: PartOpts = {}): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    _v.set(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), _v);
    const local = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    this.geoM(mat, new THREE.BoxGeometry(len, th, th), local, { worldUV: false, ...o });
  }

  /** Round tube between two local points. */
  tube(mat: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg = 6, o: PartOpts = {}): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const local = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    this.geoM(mat, new THREE.CylinderGeometry(r, r, len, seg, 1), local, { worldUV: false, ...o });
  }

  /** Tapered tube from A (radius rA) to B (radius rB). */
  taper(mat: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, rA: number, rB: number, seg = 5, o: PartOpts = {}): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const local = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    this.geoM(mat, new THREE.CylinderGeometry(rB, rA, len, seg, 1), local, { worldUV: false, ...o });
  }

  /** Plane facing +Z (rotate with `ry`/`rx` to orient). */
  plane(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, o: PartOpts = {}): void {
    this.geo(mat, new THREE.PlaneGeometry(w, h), x, y, z, o);
  }

  /**
   * Extrude a closed 2D profile (points in local x,y) along local Z, centred on `z`. `bevel` chamfers every edge
   * (adds `bevel` to the outline, so shrink the profile slightly if exact size matters).
   */
  extrude(
    mat: THREE.Material,
    pts: readonly (readonly [number, number])[],
    depth: number,
    bevel: number,
    x: number,
    y: number,
    z: number,
    o: PartOpts = {},
  ): void {
    this.geo(mat, extrudeProfile(pts, depth, bevel), x, y, z, { worldUV: true, ...o });
  }

  flush(b: LevelBuilder): void {
    for (const grp of this.groups.values()) {
      const merged = grp.geos.length === 1 ? grp.geos[0]! : mergeGeometries(grp.geos, false);
      if (!merged) {
        console.warn('props: merge failed for a part group');
        continue;
      }
      if (grp.geos.length > 1) for (const g of grp.geos) g.dispose();
      const mesh = new THREE.Mesh(merged, grp.mat);
      mesh.castShadow = grp.cast;
      mesh.receiveShadow = grp.receive;
      b.add(mesh);
    }
    this.groups.clear();
  }
}

/** Multiply UVs (e.g. by 1/tile) for geometry whose UVs are in metres (extrusions). */
export function scaleUV(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const uv = g.attributes.uv;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  uv.needsUpdate = true;
  return g;
}

/** Closed 2D profile extruded along Z and centred on z = 0. */
export function extrudeProfile(pts: readonly (readonly [number, number])[], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], pts[i]![1]);
  shape.closePath();
  const inner = Math.max(0.001, depth - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: inner,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -inner / 2);
  return g;
}

/** Box with flat chamfered edges (w x h x d overall). */
export function bevelBoxGeometry(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const cc = Math.min(c, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const shape = new THREE.Shape();
  const hw = w / 2 - cc;
  const hh = h / 2 - cc;
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  const inner = Math.max(0.001, d - 2 * cc);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: inner,
    bevelEnabled: true,
    bevelThickness: cc,
    bevelSize: cc,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -inner / 2);
  return g;
}

/**
 * Builds ONE merged geometry from several transformed primitives (position/normal/uv + optional vertex colour).
 * Used for cached, instanced prop geometry.
 */
export class GeoBuilder {
  private readonly geos: THREE.BufferGeometry[] = [];
  private colored = false;

  add(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, o: PartOpts = {}): this {
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'XYZ');
    _q.setFromEuler(_e);
    _v.set(x, y, z);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _m.compose(_v, _q, _s);
    g.applyMatrix4(_m);
    if (o.color !== undefined) this.colored = true;
    normaliseGeometry(g, o.color !== undefined);
    if (_m.determinant() < 0) flipWinding(g);
    if (o.color !== undefined) {
      _c.set(o.color);
      const col = g.attributes.color!;
      for (let i = 0; i < col.count; i++) col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    this.geos.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, o: PartOpts = {}): this {
    return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, o);
  }

  cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', o: PartOpts = {}): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(Math.PI / 2);
    return this.add(g, x, y, z, o);
  }

  build(): THREE.BufferGeometry {
    if (this.colored) {
      for (const g of this.geos) if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3).fill(1), 3));
    }
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    if (!merged) throw new Error('GeoBuilder: merge failed');
    return merged;
  }
}

// ---------------------------------------------------------------------------------------------
// misc maths
// ---------------------------------------------------------------------------------------------

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Cheap smooth 3D value noise (deterministic) used for dents and organic shapes. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const h = (a: number, b: number, c: number): number => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), sx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy),
    sz,
  );
}

/** Displace vertices by a smooth position-only field (coincident vertices move together, so no cracks) and refresh normals. */
export function dentGeometry(g: THREE.BufferGeometry, amp: number, freq: number, seed: number): void {
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const dx = noise3(x * freq + seed, y * freq, z * freq) - 0.5;
    const dy = noise3(x * freq, y * freq + seed * 1.7, z * freq) - 0.5;
    const dz = noise3(x * freq, y * freq, z * freq + seed * 2.3) - 0.5;
    pos.setXYZ(i, x + dx * amp, y + dy * amp, z + dz * amp);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}
