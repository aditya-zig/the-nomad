/**
 * LevelBuilder: the single interface props / structures / landmarks use to put content in the world.
 *
 *  - `add(object3D)` bakes every plain Mesh in the object (at its CURRENT world transform) into static batches that are
 *    merged per (material, shadow flags, spatial chunk) - hundreds of props become a few dozen draw calls.
 *    Box and Plane geometries with a tiling material (`material.userData.tile`) automatically get world-projected UVs,
 *    so textures stay continuous and unstretched across adjacent pieces. Other geometry (cylinders, custom meshes)
 *    keeps its own UVs.
 *  - `instanced(...)` for repeated single-mesh props (barrels, crates, sandbags, cones, barriers).
 *  - `collide(...)` registers gameplay collision. Visual and collision geometry should agree.
 *  - `light(...)` registers a lamp candidate for the dynamic light pool (+ optional glow sprite and ground light pool).
 *  - `glow(...)` static glow / warning beacon.
 *  - `tick(fn)` per-frame animation callbacks for things that move (spinning dishes, blinking emissives).
 *  - `addDynamic(obj)` adds an object to the scene untouched (use for anything animated by transform).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type BoxCollider, type ColliderSpec, CollisionWorld } from './collision';
import { GlowField, type GlowSpec } from './glow';
import type { MaterialLib } from './materials';

export type TickFn = (dt: number, time: number) => void;

export interface AddOpts {
  /** Override shadow casting for every mesh in the object. */
  cast?: boolean;
  /** Override shadow receiving for every mesh in the object. */
  receive?: boolean;
}

export interface LampSpec {
  x: number;
  y: number;
  z: number;
  /** sRGB hex. */
  color: number;
  /** PointLight intensity in candela (physical units). Street lamp ~ 120-300, interior tube ~ 40-90. */
  intensity: number;
  /** Cutoff distance in metres. */
  distance: number;
  mode?: 'steady' | 'flicker' | 'blink' | 'pulse' | 'fail';
  period?: number;
  duty?: number;
  phase?: number;
  /** Selection priority multiplier for the dynamic light pool. */
  weight?: number;
  /** Radius (m) of an additive light pool decal on the ground under the lamp. 0 = none. */
  pool?: number;
  /** Diameter (m) of the glow sprite at the lamp. 0 = none. */
  glow?: number;
  /** Which region/zone tag - free-form, used for debugging. */
  tag?: string;
}

export interface InstanceSet {
  add(x: number, y: number, z: number, rotY?: number, sx?: number, sy?: number, sz?: number): void;
  addMatrix(m: THREE.Matrix4): void;
}

interface Batch {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  geos: THREE.BufferGeometry[];
}

interface InstDef {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  matrices: THREE.Matrix4[];
}

/** Spatial chunk size for static batches: fewer, larger batches (draw calls) at the cost of coarser culling. */
const CHUNK = 78;

export class LevelBuilder {
  readonly root = new THREE.Group();
  readonly lights: LampSpec[] = [];
  readonly ticks: TickFn[] = [];
  readonly glows: GlowSpec[] = [];
  glowField: GlowField | null = null;
  private readonly batches = new Map<string, Batch>();
  private readonly instDefs = new Map<string, InstDef>();
  private readonly dynamic: THREE.Object3D[] = [];
  private finalized = false;
  stats = { bakedMeshes: 0, staticDrawCalls: 0, instancedMeshes: 0, triangles: 0 };

  constructor(
    readonly mats: MaterialLib,
    readonly world: CollisionWorld,
  ) {
    this.root.name = 'LevelStatic';
  }

  // ---------------------------------------------------------------------------------------------
  // geometry
  // ---------------------------------------------------------------------------------------------

  /** Bake all plain meshes inside `obj` (at their current world transform) into merged static batches. */
  add(obj: THREE.Object3D, opts: AddOpts = {}): void {
    if (this.finalized) throw new Error('LevelBuilder: add() after finalize()');
    obj.updateWorldMatrix(true, true);
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        this.dynamic.push(mesh);
        return;
      }
      if (Array.isArray(mesh.material)) {
        // multi-material meshes are kept as-is
        this.dynamic.push(mesh);
        return;
      }
      this.bake(mesh, opts);
    });
  }

  /** Add an object untouched (animated / individually culled things). Its world transform is used as given. */
  addDynamic(obj: THREE.Object3D): void {
    if (this.finalized) {
      this.root.add(obj);
      return;
    }
    this.dynamic.push(obj);
  }

  private bake(mesh: THREE.Mesh, opts: AddOpts): void {
    const material = mesh.material as THREE.Material;
    const cast = opts.cast ?? mesh.castShadow;
    const receive = opts.receive ?? mesh.receiveShadow;
    const src = mesh.geometry;
    const g = src.clone();
    const wantColor = (material as THREE.MeshStandardMaterial).vertexColors === true;

    // keep only what the merged batch needs
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
      const white = new Float32Array(count * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(white, 3));
    }
    if (!g.index) {
      const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    g.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) {
      const index = g.index!;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, a);
      }
    }

    const tile = (material.userData?.tile as number | undefined) ?? 0;
    if (tile > 0 && (src.type === 'BoxGeometry' || src.type === 'PlaneGeometry') && mesh.userData.worldUV !== false) {
      projectWorldUV(g, tile);
    }

    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    const b = this.world.bounds;
    const cx = Math.floor((c.x - b.minX) / CHUNK);
    const cz = Math.floor((c.z - b.minZ) / CHUNK);
    const key = `${materialSignature(material)}|${cast ? 1 : 0}${receive ? 1 : 0}|${cx},${cz}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { material, cast, receive, geos: [] };
      this.batches.set(key, batch);
    }
    batch.geos.push(g);
    this.stats.bakedMeshes++;
  }

  /**
   * Repeated single-mesh props. Call once per placement with the same `key`; geometry/material of the first
   * call win. Instances are split into spatial chunks so they cull and shadow-cull properly.
   */
  instanced(key: string, geometry: THREE.BufferGeometry, material: THREE.Material, opts: AddOpts = {}): InstanceSet {
    let def = this.instDefs.get(key);
    if (!def) {
      def = { geometry, material, cast: opts.cast ?? true, receive: opts.receive ?? true, matrices: [] };
      this.instDefs.set(key, def);
    }
    const d = def;
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const tmpP = new THREE.Vector3();
    const tmpS = new THREE.Vector3();
    return {
      add: (x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx) => {
        tmpE.set(0, rotY, 0);
        tmpQ.setFromEuler(tmpE);
        tmpP.set(x, y, z);
        tmpS.set(sx, sy, sz);
        d.matrices.push(new THREE.Matrix4().compose(tmpP, tmpQ, tmpS));
      },
      addMatrix: (m) => {
        d.matrices.push(m.clone());
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // gameplay hooks
  // ---------------------------------------------------------------------------------------------

  collide(spec: ColliderSpec): BoxCollider {
    return this.world.add(spec);
  }

  /** Convenience: axis-aligned (or rotated) box collider from centre + full size. `h` is the top height. */
  collideBox(x: number, z: number, w: number, d: number, h: number, opts: Partial<ColliderSpec> = {}): BoxCollider {
    return this.world.add({ x, z, hx: w / 2, hz: d / 2, y1: h, ...opts });
  }

  /** Register a lamp for the dynamic light pool (optionally with a glow sprite and ground light pool). */
  light(spec: LampSpec): void {
    this.lights.push(spec);
    if (spec.glow && spec.glow > 0) {
      this.glows.push({
        x: spec.x,
        y: spec.y,
        z: spec.z,
        color: spec.color,
        size: spec.glow,
        intensity: 2.2,
        mode: spec.mode === 'blink' ? 'blink' : spec.mode === 'pulse' ? 'pulse' : spec.mode === 'flicker' || spec.mode === 'fail' ? 'flicker' : 'steady',
        period: spec.period,
        duty: spec.duty,
        phase: spec.phase,
      });
    }
  }

  /** Static glow / beacon sprite with no dynamic light. */
  glow(spec: GlowSpec): void {
    this.glows.push(spec);
  }

  tick(fn: TickFn): void {
    this.ticks.push(fn);
  }

  // ---------------------------------------------------------------------------------------------
  // finalize
  // ---------------------------------------------------------------------------------------------

  /** Merge all batches and create instanced meshes. Must be called once, after all content is added. */
  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;

    for (const batch of this.batches.values()) {
      const merged = batch.geos.length === 1 ? batch.geos[0]! : mergeGeometries(batch.geos, false);
      if (!merged) {
        console.warn('LevelBuilder: merge failed for material', batch.material.name || batch.material.uuid);
        continue;
      }
      if (batch.geos.length > 1) for (const g of batch.geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, batch.material);
      mesh.castShadow = batch.cast;
      mesh.receiveShadow = batch.receive;
      mesh.matrixAutoUpdate = false;
      if (batch.material.transparent) mesh.renderOrder = 1;
      this.root.add(mesh);
      this.stats.staticDrawCalls++;
      this.stats.triangles += (merged.index ? merged.index.count : merged.attributes.position!.count) / 3;
    }
    this.batches.clear();

    // instanced props, split into spatial chunks
    const b = this.world.bounds;
    for (const [key, def] of this.instDefs) {
      const chunks = new Map<string, THREE.Matrix4[]>();
      const p = new THREE.Vector3();
      for (const m of def.matrices) {
        p.setFromMatrixPosition(m);
        const k = `${Math.floor((p.x - b.minX) / CHUNK)},${Math.floor((p.z - b.minZ) / CHUNK)}`;
        let list = chunks.get(k);
        if (!list) {
          list = [];
          chunks.set(k, list);
        }
        list.push(m);
      }
      for (const list of chunks.values()) {
        const im = new THREE.InstancedMesh(def.geometry, def.material, list.length);
        for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]!);
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = def.cast;
        im.receiveShadow = def.receive;
        im.computeBoundingSphere();
        im.name = `inst:${key}`;
        this.root.add(im);
        this.stats.instancedMeshes++;
        this.stats.triangles +=
          ((def.geometry.index ? def.geometry.index.count : def.geometry.attributes.position!.count) / 3) * list.length;
      }
    }
    this.instDefs.clear();

    for (const obj of this.dynamic) {
      if (obj.parent !== this.root) this.root.add(obj);
    }
    this.dynamic.length = 0;

    // ground light pools (one merged additive mesh)
    const pools = this.lights.filter((l) => (l.pool ?? 0) > 0);
    if (pools.length > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const c = new THREE.Color();
      pools.forEach((l, i) => {
        const r = l.pool!;
        const y = 0.045;
        positions.push(l.x - r, y, l.z - r, l.x + r, y, l.z - r, l.x + r, y, l.z + r, l.x - r, y, l.z + r);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        c.set(l.color);
        const k = Math.min(1, l.intensity / 260) * 0.55;
        for (let v = 0; v < 4; v++) colors.push(c.r * k, c.g * k, c.b * k);
        const o = i * 4;
        indices.push(o, o + 2, o + 1, o, o + 3, o + 2);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        map: this.mats.lightPoolTexture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.name = 'LightPools';
      this.root.add(mesh);
    }

    if (this.glows.length > 0) {
      this.glowField = new GlowField(this.glows);
      this.root.add(this.glowField.points);
    }
  }
}

/** Project UVs from world-space position & normal: horizontal faces use (x, z), vertical faces (tangent, y). */
export function projectWorldUV(g: THREE.BufferGeometry, tile: number): void {
  const pos = g.attributes.position!;
  const nor = g.attributes.normal!;
  const uv = g.attributes.uv!;
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (Math.abs(ny) > 0.7) {
      uv.setXY(i, px * inv, pz * inv);
    } else {
      const l = Math.hypot(nx, nz) || 1;
      const tx = nz / l;
      const tz = -nx / l;
      uv.setXY(i, (px * tx + pz * tz) * inv, py * inv);
    }
  }
  uv.needsUpdate = true;
}

const texId = (t: THREE.Texture | null | undefined): string => (t ? t.uuid : '-');

/**
 * Identity of a material for batching: two material INSTANCES with identical parameters and textures render identically,
 * so their geometry can share one merged draw call. Custom shader materials fall back to their own uuid.
 */
export function materialSignature(m: THREE.Material): string {
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return m.uuid;
  const s = m as THREE.MeshStandardMaterial;
  return [
    m.type,
    s.color ? s.color.getHexString() : '',
    s.roughness,
    s.metalness,
    s.emissive ? s.emissive.getHexString() : '',
    s.emissiveIntensity,
    texId(s.map),
    texId(s.normalMap),
    texId(s.roughnessMap),
    texId(s.metalnessMap),
    texId(s.emissiveMap),
    texId(s.alphaMap),
    texId(s.aoMap),
    m.transparent ? 1 : 0,
    m.opacity,
    m.side,
    s.vertexColors ? 1 : 0,
    m.alphaTest,
    m.depthWrite ? 1 : 0,
    m.polygonOffset ? 1 : 0,
    m.polygonOffsetFactor,
    m.polygonOffsetUnits,
    m.blending,
    s.flatShading ? 1 : 0,
    s.normalScale ? s.normalScale.x : 1,
    (m.userData?.tile as number | undefined) ?? 0,
  ].join('|');
}
