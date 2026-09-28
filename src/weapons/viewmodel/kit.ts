/**
 * Geometry kit for hard-surface weapon parts. A `PartBuilder` collects beveled boxes, cylinders, lathes and extruded
 * side profiles into per-material buckets and merges each bucket into one mesh (few draw calls per part).
 *
 * Weapon space: +X right, +Y up, -Z forward. `f` (forward distance) = -z. All units are metres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export type MatKey = string;

export interface Xform {
  rx?: number;
  ry?: number;
  rz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Box-projected UVs from vertex position/normal (continuous across joined parts of one bucket). */
export function assignBoxUV(geo: THREE.BufferGeometry, perMeter: number): void {
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  let uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ax >= ay && ax >= az) uv.setXY(i, z * perMeter, y * perMeter);
    else if (ay >= az) uv.setXY(i, x * perMeter, z * perMeter);
    else uv.setXY(i, x * perMeter, y * perMeter);
  }
  uv.needsUpdate = true;
}

/** Sample an arc as [f, y] points (angle in radians, counter-clockwise in the f-y plane). */
export function arcPts(cf: number, cy: number, r: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cf + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function stripToNonIndexedPosNormalUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position!.count * 2), 2));
  }
  out = out === g ? g : out;
  return out;
}

export class PartBuilder {
  private readonly buckets = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly owned: THREE.BufferGeometry[] = [];
  triangles = 0;

  add(mat: MatKey, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    if (matrix) geo.applyMatrix4(matrix);
    const g = stripToNonIndexedPosNormalUv(geo);
    if (g !== geo) geo.dispose();
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
    this.triangles += g.attributes.position!.count / 3;
    return this;
  }

  private xf(x: number, y: number, z: number, t?: Xform, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    _e.set(t?.rx ?? 0, t?.ry ?? 0, t?.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    return _m.compose(_p, _q, _s);
  }

  /** Beveled box centred at (x, y, z) with full size (w, h, d); `r` = bevel radius. */
  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.0012, t?: Xform, seg = 2): this {
    const rr = Math.min(r, w * 0.49, h * 0.49, d * 0.49);
    // automatic level of detail: tiny boxes get a single chamfer segment or none at all
    const smallest = Math.min(w, h, d);
    const s = smallest < 0.012 ? 1 : seg;
    const g = rr > 0.00005 && smallest >= 0.0035 ? new RoundedBoxGeometry(w, h, d, s, rr) : new THREE.BoxGeometry(w, h, d);
    return this.add(mat, g, this.xf(x, y, z, t));
  }

  /** Cylinder / cone along `axis`, `len` long, centred at (x, y, z). Radii: top = +axis end. */
  cyl(mat: MatKey, rFront: number, rBack: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'z', seg = 14, t?: Xform): this {
    const g = new THREE.CylinderGeometry(rFront, rBack, len, seg, 1, false);
    if (axis === 'z') g.rotateX(-Math.PI / 2); // +Y (top radius) -> -Z (forward)
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return this.add(mat, g, this.xf(x, y, z, t));
  }

  sphere(mat: MatKey, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 12, t?: Xform): this {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4));
    return this.add(mat, g, this.xf(x, y, z, t, sx, sy, sz));
  }

  /**
   * Extrude a closed side profile. `pts` are [f, y] (f = forward distance, z = -f), `width` extends along X centred on `x`.
   * `bevel` rounds the silhouette edges; `crease` (radians) controls smoothing of the bevel normals.
   */
  side(mat: MatKey, pts: [number, number][], width: number, x = 0, bevel = 0.0012, crease = 0.9, zOff = 0): this {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], pts[i]![1]);
    shape.closePath();
    const b = Math.min(bevel, width * 0.4);
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.0005, width - 2 * b),
      bevelEnabled: b > 0.00005,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 4,
    });
    g.translate(0, 0, -(width - 2 * b) / 2);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, zOff);
    g = toCreasedNormals(g, crease);
    return this.add(mat, g);
  }

  /**
   * Prism along the barrel axis: extrude a polygon given in the XY plane (`pts` = [x, y]) from f0 (back) to f1 (front).
   * The polygon is centred at (cx, cy). Facet normals stay crisp (creased).
   */
  prism(mat: MatKey, pts: [number, number][], cx: number, cy: number, f0: number, f1: number, bevel = 0.0008, crease = 0.5): this {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], pts[i]![1]);
    shape.closePath();
    const len = Math.abs(f1 - f0);
    const b = Math.min(bevel, len * 0.3);
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.0005, len - 2 * b),
      bevelEnabled: b > 0.00005,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 1,
      steps: 1,
      curveSegments: 4,
    });
    // extrusion runs +Z from -b .. len-b; move so it spans z in [-f1, -f0]
    g.translate(cx, cy, -Math.max(f0, f1) + b);
    g = toCreasedNormals(g, crease);
    return this.add(mat, g);
  }

  /** Lathe (body of revolution) about an axis parallel to Z. `pts` = [radius, f] from back to front; starts at f0. */
  lathe(mat: MatKey, pts: [number, number][], x: number, y: number, f0: number, seg = 20, t?: Xform): this {
    const v = pts.map(([r, f]) => new THREE.Vector2(r, f));
    const g = new THREE.LatheGeometry(v, seg);
    g.rotateX(-Math.PI / 2);
    return this.add(mat, g, this.xf(x, y, -f0, t));
  }

  torus(mat: MatKey, radius: number, tube: number, x: number, y: number, z: number, t?: Xform, seg = 10): this {
    return this.add(mat, new THREE.TorusGeometry(radius, tube, 6, seg), this.xf(x, y, z, t));
  }

  /** Flat plane facing +Z (toward the camera), useful for lenses / decals. Width along X, height along Y. */
  plane(mat: MatKey, w: number, h: number, x: number, y: number, z: number, t?: Xform): this {
    return this.add(mat, new THREE.PlaneGeometry(w, h), this.xf(x, y, z, t));
  }

  /**
   * Merge each bucket into a mesh. `uvScale` = texels per metre for box-projected UVs (default 9; grips use more).
   * Returns a Group whose children are the merged meshes.
   */
  build(getMat: (key: MatKey) => THREE.Material, uvScale: Record<string, number> = {}, cast = false): THREE.Group {
    const group = new THREE.Group();
    for (const [key, list] of this.buckets) {
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (!merged) {
        console.warn('viewmodel: merge failed for bucket', key);
        continue;
      }
      if (list.length > 1) for (const g of list) g.dispose();
      const uvs = uvScale[key] ?? 9;
      if (uvs > 0) assignBoxUV(merged, uvs); // 0 = keep the geometry's own UVs (labelled planes)
      merged.computeBoundingSphere();
      this.owned.push(merged);
      const mesh = new THREE.Mesh(merged, getMat(key));
      mesh.name = key;
      mesh.castShadow = cast;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
  }
}
