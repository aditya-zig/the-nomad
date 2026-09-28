/**
 * Shared helpers for the dynamic models: seeded PRNG, geometry batching (vertex colours + per-vertex emissive),
 * a "detail" standard material (procedural panel seams / rivets / grime / windows / emissive pulse injected through
 * onBeforeCompile), reference-counted caches, a tileable noise texture and additive halo points.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Reference-counted caches (shared geometry / textures / materials across instances)
// ---------------------------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  refs: number;
  dispose: () => void;
}
const cache = new Map<string, CacheEntry>();

/** Get (or build) a shared resource. Every `acquire` must be paired with a `release`. */
export function acquire<T>(key: string, make: () => T, dispose: (v: T) => void): T {
  let e = cache.get(key);
  if (!e) {
    const value = make();
    e = { value, refs: 0, dispose: () => dispose(value) };
    cache.set(key, e);
  }
  e.refs++;
  return e.value as T;
}

export function release(key: string): void {
  const e = cache.get(key);
  if (!e) return;
  e.refs--;
  if (e.refs <= 0) {
    e.dispose();
    cache.delete(key);
  }
}

/** Frees every shared resource regardless of reference counts (app teardown). */
export function disposeModelCaches(): void {
  for (const e of cache.values()) e.dispose();
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Geometry batching
// ---------------------------------------------------------------------------------------------

export type Vec3T = [number, number, number];
export type ColorLike = number | THREE.Color;

/** HDR colour helper: hex colour multiplied by `k` (values > 1 feed bloom / emissive). */
export function hdr(hex: number, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}
export type ColorFn = (out: THREE.Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

export interface XForm {
  pos?: Vec3T;
  /** Euler XYZ radians. */
  rot?: Vec3T;
  scale?: Vec3T | number;
}

export interface VRange {
  start: number;
  count: number;
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

export function matrixFrom(xf: XForm, out: THREE.Matrix4 = _m4): THREE.Matrix4 {
  const r = xf.rot ?? [0, 0, 0];
  _e.set(r[0], r[1], r[2], 'XYZ');
  _q.setFromEuler(_e);
  const sc = xf.scale ?? 1;
  if (typeof sc === 'number') _s.set(sc, sc, sc);
  else _s.set(sc[0], sc[1], sc[2]);
  const p = xf.pos ?? [0, 0, 0];
  _p.set(p[0], p[1], p[2]);
  return out.compose(_p, _q, _s);
}

/** Collects primitives into ONE BufferGeometry with per-vertex colour (linear) and per-vertex emissive (`aEmis`). */
export class GeoBatch {
  private geos: THREE.BufferGeometry[] = [];
  private vcount = 0;
  private tris = 0;

  get triangles(): number {
    return this.tris;
  }

  get vertexCount(): number {
    return this.vcount;
  }

  /** Takes ownership of `geo` (it is transformed in place). */
  add(geo: THREE.BufferGeometry, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike): VRange {
    if (xf) geo.applyMatrix4(matrixFrom(xf));
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    const n = geo.attributes.position!.count;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const col = new Float32Array(n * 3);
    const pos = geo.attributes.position!;
    const nor = geo.attributes.normal!;
    if (typeof color === 'function') {
      for (let i = 0; i < n; i++) {
        color(_c, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
      }
    } else {
      _c.set(color);
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const em = new Float32Array(n * 3);
    if (emis !== undefined) {
      _c.set(emis);
      for (let i = 0; i < n; i++) {
        em[i * 3] = _c.r;
        em[i * 3 + 1] = _c.g;
        em[i * 3 + 2] = _c.b;
      }
    }
    geo.setAttribute('aEmis', new THREE.BufferAttribute(em, 3));
    if (!geo.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    this.geos.push(geo);
    const start = this.vcount;
    this.vcount += n;
    this.tris += geo.index!.count / 3;
    return { start, count: n };
  }

  box(w: number, h: number, d: number, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike): VRange {
    return this.add(new THREE.BoxGeometry(w, h, d), color, xf, emis);
  }

  /** Bevelled box (rounded edges). */
  rbox(w: number, h: number, d: number, r: number, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike, seg = 1): VRange {
    return this.add(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.49)), color, xf, emis);
  }

  cyl(rTop: number, rBot: number, h: number, seg: number, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike, open = false): VRange {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), color, xf, emis);
  }

  sphere(r: number, ws: number, hs: number, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike): VRange {
    return this.add(new THREE.SphereGeometry(r, ws, hs), color, xf, emis);
  }

  torus(R: number, r: number, radial: number, tubular: number, arc: number, color: ColorLike | ColorFn, xf?: XForm, emis?: ColorLike): VRange {
    return this.add(new THREE.TorusGeometry(R, r, radial, tubular, arc), color, xf, emis);
  }

  /** Cylinder running from point a to point b. */
  strut(a: Vec3T, b: Vec3T, radius: number, seg: number, color: ColorLike | ColorFn, emis?: ColorLike, radiusB?: number): VRange {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    _dir.normalize();
    _q.setFromUnitVectors(_up, _dir);
    const g = new THREE.CylinderGeometry(radiusB ?? radius, radius, len, seg, 1);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _s.set(1, 1, 1);
    g.applyMatrix4(_m4.compose(_p, _q, _s));
    return this.add(g, color, undefined, emis);
  }

  /** Box between two points with a given cross-section (w x d), `up` hints the orientation of the section. */
  beam(a: Vec3T, b: Vec3T, w: number, d: number, color: ColorLike | ColorFn, emis?: ColorLike): VRange {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _dir.length();
    _dir.normalize();
    _q.setFromUnitVectors(_up, _dir);
    const g = new THREE.BoxGeometry(w, len, d);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _s.set(1, 1, 1);
    g.applyMatrix4(_m4.compose(_p, _q, _s));
    return this.add(g, color, undefined, emis);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (!merged) throw new Error('GeoBatch: merge failed');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Write a constant colour into a vertex range of a `color`-like attribute (allocation free). */
export function writeRange(attr: THREE.BufferAttribute, range: VRange, r: number, g: number, b: number): void {
  const a = attr.array as Float32Array;
  for (let i = range.start; i < range.start + range.count; i++) {
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// Detail material
// ---------------------------------------------------------------------------------------------

const GLSL_LIB = /* glsl */ `
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1.,0.,0.)), f.x), mix(h13(i + vec3(0.,1.,0.)), h13(i + vec3(1.,1.,0.)), f.x), f.y),
             mix(mix(h13(i + vec3(0.,0.,1.)), h13(i + vec3(1.,0.,1.)), f.x), mix(h13(i + vec3(0.,1.,1.)), h13(i + vec3(1.,1.,1.)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ return vn3(p) * 0.55 + vn3(p * 2.13) * 0.3 + vn3(p * 4.7) * 0.15; }
float seamLine(float c, float period, float w){
  float d = abs(fract(c / period + 0.5) - 0.5) * period;
  float ww = max(w, fwidth(c) * 1.6);
  return (1.0 - smoothstep(ww * 0.35, ww, d)) * (w / ww);
}
float rivetLine(float d, float t, float sp, float off, float rad){
  float dd = abs(d) - off;
  float tt = abs(fract(t / sp + 0.5) - 0.5) * sp;
  float r = length(vec2(dd, tt));
  float rr = max(rad, fwidth(t) * 1.4);
  return (1.0 - smoothstep(rr * 0.5, rr, r)) * (rad / rr);
}
float sdRoundRect(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export interface DetailOptions {
  /** Unique program key: materials with the same tag and code must share it. */
  tag: string;
  color?: number;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** Procedural panel seams, rivets, grime and chips (object-space). */
  panels?: { x: number; y: number; z: number; grime?: number; wear?: number; rivets?: boolean; tint?: number };
  /** Reads the `aEmis` vertex attribute into the emissive term (times `uEmisGain`, optionally pulsing). */
  emis?: boolean;
  /** Extra GLSL declarations (uniforms, functions), inserted before main. */
  declare?: string;
  /** GLSL run right after the colour is known (may set `gWin`); has `diffuseColor`, `vObjPos`, `vObjNrm`. */
  colorCode?: string;
  /** GLSL run after roughness/metalness are known (has `roughnessFactor`, `metalnessFactor`, `gWin`). */
  materialCode?: string;
  /** GLSL run after the emissive term starts (has `totalEmissiveRadiance`, `diffuseColor`). */
  emissiveCode?: string;
  /** GLSL for an early `discard` (runs at the top of main). */
  discardCode?: string;
  uniforms?: Record<string, THREE.IUniform>;
}

export interface DetailUniforms {
  emisGain: THREE.IUniform<number>;
  time: THREE.IUniform<number>;
  pulse: THREE.IUniform<number>;
  pulseSpeed: THREE.IUniform<number>;
  objOffset: THREE.IUniform<THREE.Vector3>;
}

export function makeDetailUniforms(): DetailUniforms {
  return {
    emisGain: { value: 1 },
    time: { value: 0 },
    pulse: { value: 0 },
    pulseSpeed: { value: 2.2 },
    objOffset: { value: new THREE.Vector3() },
  };
}

export function createDetailMaterial(o: DetailOptions, u: DetailUniforms = makeDetailUniforms()): { material: THREE.MeshStandardMaterial; uniforms: DetailUniforms } {
  const mat = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: true,
    roughness: o.roughness ?? 0.6,
    metalness: o.metalness ?? 0.3,
    envMapIntensity: o.envMapIntensity ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  const p = o.panels;
  const panelCode = p
    ? /* glsl */ `
    {
      vec3 an = abs(normalize(vObjNrm));
      float wx = 1.0 - smoothstep(0.55, 0.9, an.x);
      float wy = 1.0 - smoothstep(0.55, 0.9, an.y);
      float wz = 1.0 - smoothstep(0.55, 0.9, an.z);
      float sx = seamLine(vObjPos.x, ${f(p.x)}, 0.011) * wx;
      float sy = seamLine(vObjPos.y, ${f(p.y)}, 0.011) * wy;
      float sz = seamLine(vObjPos.z, ${f(p.z)}, 0.011) * wz;
      float seam = max(max(sx, sy), sz);
      vec3 pid = floor(vec3(vObjPos.x / ${f(p.x)}, vObjPos.y / ${f(p.y)}, vObjPos.z / ${f(p.z)}));
      float pv = h13(pid + floor(an * 2.5));
      diffuseColor.rgb *= 1.0 - ${f(p.tint ?? 0.1)} * 0.5 + ${f(p.tint ?? 0.1)} * pv;
      ${
        p.rivets
          ? `float rv = rivetLine((fract(vObjPos.z / ${f(p.z)} + 0.5) - 0.5) * ${f(p.z)}, vObjPos.y, 0.12, 0.03, 0.009) * wz
                 + rivetLine((fract(vObjPos.y / ${f(p.y)} + 0.5) - 0.5) * ${f(p.y)}, vObjPos.z + vObjPos.x, 0.12, 0.03, 0.009) * wy;
             diffuseColor.rgb *= 1.0 - clamp(rv, 0.0, 1.0) * 0.4;`
          : ''
      }
      float g1 = fbm3(vObjPos * vec3(1.4, 2.3, 1.4));
      float streak = fbm3(vec3(vObjPos.x * 3.2, vObjPos.y * 0.4, vObjPos.z * 3.2));
      float lowDirt = smoothstep(1.9, 0.6, vObjPos.y);
      float dirt = clamp((g1 - 0.42) * 1.5 + streak * 0.45 + lowDirt * 0.35 + seam * 0.25, 0.0, 1.0) * ${f(p.grime ?? 0.6)};
      diffuseColor.rgb *= mix(1.0, 0.56, dirt);
      float chip = smoothstep(0.83, 0.88, vn3(vObjPos * 47.0)) * smoothstep(0.4, 0.65, vn3(vObjPos * 4.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + vec3(0.015), chip * ${f(p.wear ?? 0.5)});
      diffuseColor.rgb *= 1.0 - seam * 0.55;
      gSeam = seam;
      gDirt = dirt;
    }`
    : '';

  const emisCode = o.emis
    ? /* glsl */ `
    {
      float pl = 1.0;
      if (uPulse > 0.0) pl = 1.0 - uPulse + uPulse * (0.5 + 0.5 * sin(uTime * uPulseSpeed + vWPos.x * 0.9 + vWPos.z * 1.7));
      totalEmissiveRadiance += vEmis * uEmisGain * pl;
    }`
    : '';

  mat.customProgramCacheKey = () => `detail:${o.tag}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uEmisGain = u.emisGain;
    shader.uniforms.uTime = u.time;
    shader.uniforms.uPulse = u.pulse;
    shader.uniforms.uPulseSpeed = u.pulseSpeed;
    shader.uniforms.uObjOffset = u.objOffset;
    if (o.uniforms) for (const [k, v] of Object.entries(o.uniforms)) shader.uniforms[k] = v;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aEmis;
         uniform vec3 uObjOffset;
         varying vec3 vObjPos; varying vec3 vObjNrm; varying vec3 vEmis; varying vec3 vWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vObjPos = position + uObjOffset; vObjNrm = normal; vEmis = aEmis;
         vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uEmisGain; uniform float uTime; uniform float uPulse; uniform float uPulseSpeed;
         varying vec3 vObjPos; varying vec3 vObjNrm; varying vec3 vEmis; varying vec3 vWPos;
         float gWin = 0.0; float gSeam = 0.0; float gDirt = 0.0;
         ${GLSL_LIB}
         ${o.declare ?? ''}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         ${o.discardCode ?? ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         ${panelCode}
         ${o.colorCode ?? ''}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, 0.92, clamp(gDirt * 0.7 + gSeam * 0.5, 0.0, 1.0));
         ${o.materialCode ?? ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         ${emisCode}
         ${o.emissiveCode ?? ''}`,
      );
  };
  return { material: mat, uniforms: u };
}

// ---------------------------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------------------------

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

export function canvasTexture(canvas: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 4;
  t.needsUpdate = true;
  return t;
}

export const UI_FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---------------------------------------------------------------------------------------------
// Noise texture (tileable value noise, RGBA = four independent fields)
// ---------------------------------------------------------------------------------------------

function periodicNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lattice[(y0 % cells) * cells + (x0 % cells)]!;
      const b = lattice[(y0 % cells) * cells + ((x0 + 1) % cells)]!;
      const c = lattice[((y0 + 1) % cells) * cells + (x0 % cells)]!;
      const d = lattice[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)]!;
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

export function getNoiseTexture(): THREE.DataTexture {
  return acquire(
    'noise-tex',
    () => {
      const size = 256;
      const rand = mulberry32(90210);
      const data = new Uint8Array(size * size * 4);
      const bases = [4, 6, 8, 3];
      for (let ch = 0; ch < 4; ch++) {
        const o1 = periodicNoise(size, bases[ch]!, rand);
        const o2 = periodicNoise(size, bases[ch]! * 2, rand);
        const o3 = periodicNoise(size, bases[ch]! * 4, rand);
        for (let i = 0; i < size * size; i++) {
          const v = o1[i]! * 0.55 + o2[i]! * 0.3 + o3[i]! * 0.15;
          data[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
      }
      const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    },
    (t) => t.dispose(),
  );
}

// ---------------------------------------------------------------------------------------------
// Halo points: additive glows that follow 3D positions, sized in world metres
// ---------------------------------------------------------------------------------------------

const haloVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    float px = aSize * uScale / max(-mv.z, 0.3);
    gl_PointSize = clamp(px, 1.0, 220.0);
  }
`;
const haloFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float core = exp(-d * d * 8.0);
    float halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.4) * 0.6;
    float a = clamp(core + halo, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

const _v2 = new THREE.Vector2();

export class HaloPoints {
  readonly points: THREE.Points;
  private readonly colors: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor(items: { x: number; y: number; z: number; size: number }[]) {
    const n = items.length;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const it = items[i]!;
      pos[i * 3] = it.x;
      pos[i * 3 + 1] = it.y;
      pos[i * 3 + 2] = it.z;
      size[i] = it.size;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.colors = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.colors);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    this.material = new THREE.ShaderMaterial({
      vertexShader: haloVertex,
      fragmentShader: haloFragment,
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(_v2);
      const proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1.7;
      this.material.uniforms.uScale!.value = _v2.y * proj * 0.5;
    };
  }

  set(i: number, r: number, g: number, b: number): void {
    const a = this.colors.array as Float32Array;
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }

  commit(): void {
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Radial soft glow texture (white, alpha falloff). */
export function makeRadialTexture(size = 128, stops: [number, string][] = [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas);
}
