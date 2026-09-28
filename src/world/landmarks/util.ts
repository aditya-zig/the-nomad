/**
 * Shared helpers for landmarks and interiors: seeded PRNG, cached unit geometry, an `Assembly` part builder (a group that
 * is positioned/rotated like a prop and then baked through the LevelBuilder), lattice-tower generation and glow sprites.
 */
import * as THREE from 'three';
import type { AddOpts, LevelBuilder } from '../builder';
import type { BoxCollider, ColliderSpec } from '../collision';

// ---------------------------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(Math.floor(seed) ^ 0x9e3779b9);
  }
  f(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]!;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Stable string -> number hash for seeding from positions. */
export function seedFrom(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.floor(n * 100) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Geometry caches (never disposed: shared for the lifetime of the page)
// ---------------------------------------------------------------------------------------------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const sphereCache = new Map<number, THREE.SphereGeometry>();
const cylCache = new Map<string, THREE.CylinderGeometry>();

export function unitBox(): THREE.BoxGeometry {
  return UNIT_BOX;
}

export function unitSphere(seg = 16): THREE.SphereGeometry {
  let g = sphereCache.get(seg);
  if (!g) {
    g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.6)));
    sphereCache.set(seg, g);
  }
  return g;
}

/** Cached cylinder with explicit radii (tapered allowed). */
export function cylGeo(rTop: number, rBottom: number, h: number, seg = 12, open = false): THREE.CylinderGeometry {
  const key = `${rTop.toFixed(3)}|${rBottom.toFixed(3)}|${h.toFixed(3)}|${seg}|${open ? 1 : 0}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

export interface PartOpts {
  cast?: boolean;
  receive?: boolean;
  rx?: number;
  ry?: number;
  rz?: number;
}

export type V3 = readonly [number, number, number];

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

/** A group positioned like a prop (x, y, z, rot). Parts are added in LOCAL coordinates, then `commit` bakes them. */
export class Assembly {
  readonly group = new THREE.Group();
  readonly cos: number;
  readonly sin: number;
  private readonly defaultCast: boolean;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly rot = 0,
    opts: { cast?: boolean } = {},
  ) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = rot;
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    this.defaultCast = opts.cast ?? true;
  }

  /** Local (lx, lz) to world XZ (matches THREE rotation.y and the collider convention). */
  world(lx: number, lz: number): { x: number; z: number } {
    return { x: this.x + this.cos * lx + this.sin * lz, z: this.z - this.sin * lx + this.cos * lz };
  }

  private put(mesh: THREE.Mesh, px: number, py: number, pz: number, o?: PartOpts): THREE.Mesh {
    mesh.position.set(px, py, pz);
    mesh.rotation.order = 'YXZ'; // yaw outermost: `ry` turns the part, `rx`/`rz` tilt it in its own frame
    if (o) {
      if (o.rx || o.ry || o.rz) mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
      mesh.castShadow = o.cast ?? this.defaultCast;
      mesh.receiveShadow = o.receive ?? true;
    } else {
      mesh.castShadow = this.defaultCast;
      mesh.receiveShadow = true;
    }
    this.group.add(mesh);
    return mesh;
  }

  box(mat: THREE.Material, w: number, h: number, d: number, px: number, py: number, pz: number, o?: PartOpts): THREE.Mesh {
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.scale.set(w, h, d);
    return this.put(m, px, py, pz, o);
  }

  /** Vertical cylinder of uniform radius (unit geometry scaled). */
  cyl(mat: THREE.Material, r: number, h: number, px: number, py: number, pz: number, seg = 12, o?: PartOpts): THREE.Mesh {
    const m = new THREE.Mesh(cylGeo(1, 1, 1, seg), mat);
    m.scale.set(r, h, r);
    return this.put(m, px, py, pz, o);
  }

  /** Tapered cylinder (exact geometry, cached). */
  taper(mat: THREE.Material, rTop: number, rBottom: number, h: number, px: number, py: number, pz: number, seg = 12, o?: PartOpts): THREE.Mesh {
    return this.put(new THREE.Mesh(cylGeo(rTop, rBottom, h, seg), mat), px, py, pz, o);
  }

  sphere(mat: THREE.Material, r: number, px: number, py: number, pz: number, seg = 16, o?: PartOpts): THREE.Mesh {
    const m = new THREE.Mesh(unitSphere(seg), mat);
    m.scale.setScalar(r);
    return this.put(m, px, py, pz, o);
  }

  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, o?: PartOpts): THREE.Mesh {
    return this.put(new THREE.Mesh(geo, mat), px, py, pz, o);
  }

  /** Square-section strut between two local points. */
  strut(mat: THREE.Material, a: V3, b: V3, thick: number, o?: PartOpts & { thickZ?: number }): THREE.Mesh {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    if (len < 1e-5) return this.box(mat, thick, thick, thick, a[0], a[1], a[2], o);
    _dir.divideScalar(len);
    _mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.scale.set(thick, len, o?.thickZ ?? thick);
    m.quaternion.setFromUnitVectors(Y_AXIS, _dir);
    m.position.copy(_mid);
    m.castShadow = o?.cast ?? this.defaultCast;
    m.receiveShadow = o?.receive ?? true;
    this.group.add(m);
    return m;
  }

  /** Round tube between two local points. */
  tube(mat: THREE.Material, a: V3, b: V3, radius: number, seg = 6, o?: PartOpts): THREE.Mesh {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    _dir.divideScalar(Math.max(len, 1e-6));
    _mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const m = new THREE.Mesh(cylGeo(1, 1, 1, seg), mat);
    m.scale.set(radius, len, radius);
    m.quaternion.setFromUnitVectors(Y_AXIS, _dir);
    m.position.copy(_mid);
    m.castShadow = o?.cast ?? this.defaultCast;
    m.receiveShadow = o?.receive ?? true;
    this.group.add(m);
    return m;
  }

  /** Register an axis-aligned-in-local-space box collider (converted to world with this assembly's rotation). */
  collide(b: LevelBuilder, lx: number, lz: number, w: number, d: number, y1: number, opts: Partial<ColliderSpec> = {}): BoxCollider {
    const p = this.world(lx, lz);
    const extra = opts.rot ?? 0;
    return b.collide({
      x: p.x,
      z: p.z,
      hx: w / 2,
      hz: d / 2,
      y0: this.y + (opts.y0 ?? 0),
      y1: this.y + y1,
      rot: this.rot + extra,
      blocksMove: opts.blocksMove ?? true,
      blocksShots: opts.blocksShots ?? true,
      surface: opts.surface ?? 'concrete',
      mapKind: opts.mapKind ?? 'prop',
      tag: opts.tag,
    });
  }

  commit(b: LevelBuilder, opts?: AddOpts): void {
    b.add(this.group, opts);
  }
}

// ---------------------------------------------------------------------------------------------
// Lattice towers
// ---------------------------------------------------------------------------------------------

export interface LatticeSpec {
  y0: number;
  y1: number;
  /** Half-width of the square footprint at the bottom / top (centre line of legs). */
  halfBase: number;
  halfTop: number;
  panels: number;
  legThickBase: number;
  legThickTop: number;
  braceThick: number;
  legMat: THREE.Material;
  braceMat: THREE.Material;
  /** Taper easing (0..1 -> 0..1). Default linear. */
  ease?: (t: number) => number;
  /** X-bracing on every panel (true) or alternating single diagonals. */
  cross?: boolean;
  /** Add plan (horizontal) X braces every N panels (0 = none). */
  planBraceEvery?: number;
  center?: { x: number; z: number };
}

/** Adds a square 4-legged lattice tower with horizontals and face bracing. Returns the half-width per level. */
export function addLattice(asm: Assembly, s: LatticeSpec): number[] {
  const cx = s.center?.x ?? 0;
  const cz = s.center?.z ?? 0;
  const ease = s.ease ?? ((t: number) => t);
  const halves: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= s.panels; i++) {
    const t = i / s.panels;
    halves.push(s.halfBase + (s.halfTop - s.halfBase) * ease(t));
    ys.push(s.y0 + (s.y1 - s.y0) * t);
  }
  const corner = (i: number, k: number): V3 => {
    const h = halves[i]!;
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sz = k < 2 ? -1 : 1;
    return [cx + sx * h, ys[i]!, cz + sz * h];
  };
  for (let i = 0; i < s.panels; i++) {
    const t = i / s.panels;
    const leg = s.legThickBase + (s.legThickTop - s.legThickBase) * t;
    for (let k = 0; k < 4; k++) {
      asm.strut(s.legMat, corner(i, k), corner(i + 1, k), leg);
      // horizontal at the panel base
      asm.strut(s.braceMat, corner(i, k), corner(i, (k + 1) % 4), s.braceThick);
      // diagonals on face k -> k+1
      const a0 = corner(i, k);
      const a1 = corner(i, (k + 1) % 4);
      const b0 = corner(i + 1, k);
      const b1 = corner(i + 1, (k + 1) % 4);
      if (s.cross || (i + k) % 2 === 0) asm.strut(s.braceMat, a0, b1, s.braceThick);
      if (s.cross || (i + k) % 2 === 1) asm.strut(s.braceMat, a1, b0, s.braceThick);
    }
    if (s.planBraceEvery && i % s.planBraceEvery === 0) {
      asm.strut(s.braceMat, corner(i, 0), corner(i, 2), s.braceThick * 0.8);
      asm.strut(s.braceMat, corner(i, 1), corner(i, 3), s.braceThick * 0.8);
    }
  }
  for (let k = 0; k < 4; k++) asm.strut(s.braceMat, corner(s.panels, k), corner(s.panels, (k + 1) % 4), s.braceThick);
  return halves;
}

// ---------------------------------------------------------------------------------------------
// Sprites / materials
// ---------------------------------------------------------------------------------------------

export function glowSprite(tex: THREE.Texture, hex: number, size: number, intensity = 1, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: new THREE.Color(hex).multiplyScalar(intensity),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  s.renderOrder = 6;
  return s;
}

/** Emissive standard material with its own state (dynamic objects clone/create these; never mutate shared ones). */
export function emissiveMat(hex: number, intensity: number, base = 0x0a0d10): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: base,
    emissive: new THREE.Color(hex),
    emissiveIntensity: intensity,
    roughness: 0.45,
    metalness: 0.1,
  });
}

const memoCache = new Map<string, unknown>();
/** Generic lazy cache (textures, geometry sets). */
export function memo<T>(key: string, make: () => T): T {
  if (!memoCache.has(key)) memoCache.set(key, make());
  return memoCache.get(key) as T;
}

/** Cached local material (for custom looks that are not in the shared library). */
export function cached<T extends THREE.Material>(key: string, make: () => T): T {
  return memo(key, make);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Shared structural parts
// ---------------------------------------------------------------------------------------------

/** Grating deck with railings around a tower section of half-width `half` at height `y`. */
export function addPlatform(asm: Assembly, y: number, half: number, deck: THREE.Material, rail: THREE.Material, trim: THREE.Material): void {
  const w = half * 2 + 1.5;
  asm.box(deck, w, 0.1, w, 0, y, 0);
  asm.box(trim, w + 0.1, 0.06, w + 0.1, 0, y - 0.1, 0, { cast: false });
  const post = w / 2 - 0.05;
  const posts: [number, number][] = [
    [-post, -post],
    [post, -post],
    [post, post],
    [-post, post],
    [0, -post],
    [post, 0],
    [0, post],
    [-post, 0],
  ];
  for (const [px, pz] of posts) asm.box(rail, 0.06, 1.1, 0.06, px, y + 0.6, pz, { cast: false });
  for (let i = 0; i < 4; i++) {
    const a = posts[i]!;
    const c = posts[(i + 1) % 4]!;
    asm.strut(rail, [a[0], y + 1.13, a[1]], [c[0], y + 1.13, c[1]], 0.05, { cast: false });
    asm.strut(rail, [a[0], y + 0.62, a[1]], [c[0], y + 0.62, c[1]], 0.04, { cast: false });
  }
}

let hornGeo: THREE.CylinderGeometry | null = null;
function hornGeometry(): THREE.CylinderGeometry {
  if (!hornGeo) hornGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6);
  return hornGeo;
}

/** Parabolic dish (bowl opens toward local +Z) with feed horn and hub. Origin at the dish centre. */
export function makeDish(dishMat: THREE.Material, hubMat: THREE.Material, r: number): THREE.Group {
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 6, 0, Math.PI * 2, 0, 0.95), dishMat);
  cap.rotation.x = -Math.PI / 2; // spherical-cap pole toward -Z so the bowl opens toward +Z
  cap.position.z = r * 0.8;
  cap.castShadow = true;
  g.add(cap);
  const horn = new THREE.Mesh(hornGeometry(), hubMat);
  horn.rotation.x = Math.PI / 2;
  horn.position.z = r * 0.55;
  horn.scale.set(1, r * 1.1, 1);
  g.add(horn);
  const hub = new THREE.Mesh(hornGeometry(), hubMat);
  hub.rotation.x = Math.PI / 2;
  hub.scale.set(3.2, 1.0, 3.2);
  hub.position.z = -r * 0.1;
  g.add(hub);
  return g;
}

/** Dish on a bracket at (x, y, z) inside `parent`, pointing outward along angle `a` (radians about Y), slightly tilted down. */
export function addDishTo(parent: THREE.Object3D, dishMat: THREE.Material, arm: THREE.Material, x: number, y: number, z: number, a: number, r: number): void {
  const g = makeDish(dishMat, arm, r);
  g.position.set(x, y, z);
  g.rotation.order = 'YXZ';
  g.rotation.y = -a + Math.PI / 2;
  g.rotation.x = 0.12;
  parent.add(g);
  const bx = x * 0.55;
  const bz = z * 0.55;
  const bracket = new THREE.Mesh(UNIT_BOX, arm);
  const dir = new THREE.Vector3(x - bx, 0.1, z - bz);
  const len = dir.length();
  bracket.scale.set(0.1, len, 0.1);
  bracket.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  bracket.position.set((x + bx) / 2, y - 0.05, (z + bz) / 2);
  parent.add(bracket);
}

// ---------------------------------------------------------------------------------------------
// Irregular rocks
// ---------------------------------------------------------------------------------------------

const rockCache = new Map<number, THREE.BufferGeometry>();

/** Irregular low-poly rock (unit-ish size), 4 cached variants. Vertex displacement is a pure function of position so shared corners stay welded. */
export function rockGeometry(variant: number): THREE.BufferGeometry {
  const v = ((variant % 4) + 4) % 4;
  let g = rockCache.get(v);
  if (!g) {
    g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position!;
    const p = new THREE.Vector3();
    const ph = v * 1.7 + 0.3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const n = Math.sin(p.x * 3.1 + ph) * Math.sin(p.y * 2.7 + ph * 1.3) * Math.sin(p.z * 3.4 + ph * 0.7);
      const n2 = Math.sin(p.x * 7.3 + p.z * 5.1 + ph) * 0.5 + Math.sin(p.y * 6.1 - p.x * 4.4) * 0.5;
      p.multiplyScalar(0.82 + 0.28 * n + 0.1 * n2);
      // flatten the underside a little so rocks sit on the ground
      if (p.y < -0.5) p.y = -0.5 + (p.y + 0.5) * 0.3;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();
    rockCache.set(v, g);
  }
  return g;
}

/**
 * Irregular broken slab (jittered outline with chipped corners) as extruded geometry lying flat: outline in XZ, thickness
 * along Y centred on 0. UVs are scaled to metres / `tile` so tiling materials keep their texel density.
 */
export function irregularSlab(sx: number, sz: number, t: number, rng: Rng, tile: number): THREE.BufferGeometry {
  const hx = sx / 2;
  const hz = sz / 2;
  const j = (a: number) => rng.range(0, a);
  const pts: [number, number][] = [
    [-hx + j(0.5), -hz + j(0.5)],
    [-hx * 0.3, -hz - rng.range(-0.15, 0.05)],
    [hx * 0.2 + j(0.3), -hz + j(0.15)],
    [hx - j(0.7), -hz + j(0.6)],
    [hx + rng.range(-0.1, 0.05), -hz * 0.2],
    [hx - j(0.5), hz - j(0.6)],
    [hx * 0.35, hz + rng.range(-0.2, 0.02)],
    [-hx * 0.25 + j(0.4), hz - j(0.15)],
    [-hx + j(0.6), hz - j(0.5)],
    [-hx - rng.range(-0.15, 0.05), hz * 0.1],
  ];
  const shape = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  g.translate(0, t / 2, 0);
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  g.computeVertexNormals();
  return g;
}
