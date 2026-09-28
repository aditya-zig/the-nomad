/**
 * Architecture helpers: walls with door / window openings, enterable buildings with interiors, solid facade blocks,
 * ground slabs and decals. Everything registers matching colliders through the LevelBuilder.
 *
 * Conventions: a wall runs from (x0, z0) to (x1, z1); openings are positioned by `at` = distance from the start point
 * to the opening CENTRE. Buildings are axis-aligned; side names: N = -Z, S = +Z, E = +X, W = -X.
 */
import * as THREE from 'three';
import type { LevelBuilder } from './builder';
import type { MapKind } from './collision';
import type { DecalName, MaterialName } from './materials';

export type MatRef = MaterialName | THREE.Material;

function resolve(b: LevelBuilder, m: MatRef): THREE.Material {
  return typeof m === 'string' ? b.mats.get(m) : m;
}

export interface BoxOpts {
  cast?: boolean;
  receive?: boolean;
}

/** Add a visual box (centre + full size) rotated about Y. */
export function addBox(
  b: LevelBuilder,
  mat: MatRef,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  rotY = 0,
  opts: BoxOpts = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), resolve(b, mat));
  mesh.position.set(cx, cy, cz);
  mesh.rotation.y = rotY;
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  b.add(mesh);
  return mesh;
}

/** Horizontal rectangle lying on the ground (roads, pads, floors). Faces up. */
export function groundRect(b: LevelBuilder, mat: MatRef, x0: number, z0: number, x1: number, z1: number, y = 0.01, facing: 'up' | 'down' = 'up'): void {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), resolve(b, mat));
  mesh.rotation.x = facing === 'up' ? -Math.PI / 2 : Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  b.add(mesh);
}

/** Decal quad lying flat on the ground (uses a library decal; the whole texture maps to the quad). */
export function groundDecal(b: LevelBuilder, decal: DecalName | THREE.Material, x: number, z: number, w: number, d: number, rotY = 0, y = 0.03): void {
  const mat = typeof decal === 'string' ? b.mats.decal(decal) : decal;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = rotY;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  b.add(mesh);
}

/** Vertical decal / sign quad. `yaw` = direction the quad FACES (same convention as rotation.y; 0 faces +Z / south). */
export function wallDecal(b: LevelBuilder, decal: DecalName | THREE.Material, x: number, y: number, z: number, w: number, h: number, yaw: number): void {
  const mat = typeof decal === 'string' ? b.mats.decal(decal) : decal;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.y = yaw;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;
  b.add(mesh);
}

export interface Opening {
  /** Distance from the wall start to the opening centre. */
  at: number;
  width: number;
  /** Doors / gates: clear height. Windows: window height above `sill`. */
  height: number;
  /** Window sill height (windows only). */
  sill?: number;
  kind: 'door' | 'window' | 'gate';
  frame?: MaterialName;
  /** Window glows warm from inside. */
  lit?: boolean;
}

export interface WallSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  height: number;
  thickness: number;
  material: MaterialName;
  openings?: Opening[];
  y0?: number;
  mapKind?: MapKind;
  /** Also cast shadows (default true). */
  cast?: boolean;
  tag?: string;
}

export interface WallInfo {
  /** World positions of door centres along this wall. */
  doors: { x: number; z: number; width: number }[];
}

/** Build a wall with door/window openings. Returns the door centres. */
export function wall(b: LevelBuilder, s: WallSpec): WallInfo {
  const dx = s.x1 - s.x0;
  const dz = s.z1 - s.z0;
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  const rot = Math.atan2(-dz, dx);
  const y0 = s.y0 ?? 0;
  const H = s.height;
  const t = s.thickness;
  const mapKind = s.mapKind ?? 'wall';
  const doors: WallInfo['doors'] = [];

  const at = (d: number): [number, number] => [s.x0 + ux * d, s.z0 + uz * d];

  const solid = (a: number, bb: number, ya: number, yb: number, kind: MapKind = mapKind, blocksShots = true) => {
    const len = bb - a;
    const h = yb - ya;
    if (len < 0.02 || h < 0.02) return;
    const [cx, cz] = at((a + bb) / 2);
    addBox(b, s.material, cx, ya + h / 2, cz, len, h, t, rot, { cast: s.cast ?? true });
    b.collide({ x: cx, z: cz, hx: len / 2, hz: t / 2, rot, y0: ya, y1: yb, mapKind: kind, blocksShots, surface: 'concrete', tag: s.tag ?? 'wall' });
  };

  const openings = [...(s.openings ?? [])].sort((p, q) => p.at - q.at);
  let cursor = 0;
  for (const o of openings) {
    const a = o.at - o.width / 2;
    const e = o.at + o.width / 2;
    solid(cursor, a, y0, y0 + H);
    if (o.kind === 'window') {
      const sill = o.sill ?? 1.0;
      const top = Math.min(H, sill + o.height);
      solid(a, e, y0, y0 + sill); // under the window
      solid(a, e, y0 + top, y0 + H); // above the window
      // glass pane (blocks movement and shots) + frame
      const [cx, cz] = at(o.at);
      const paneMat: MatRef = o.lit ? 'windowLit' : 'glassDark';
      addBox(b, paneMat, cx, y0 + sill + (top - sill) / 2, cz, o.width - 0.1, top - sill - 0.1, 0.06, rot, { cast: false });
      b.collide({ x: cx, z: cz, hx: o.width / 2, hz: t / 2, rot, y0: y0 + sill, y1: y0 + top, mapKind: 'none', surface: 'glass', tag: 'window' });
      const fm = o.frame ?? 'steelDark';
      const ft = 0.07;
      addBox(b, fm, cx, y0 + sill + ft / 2, cz, o.width, ft, t + 0.06, rot, { cast: false });
      addBox(b, fm, cx, y0 + top - ft / 2, cz, o.width, ft, t + 0.06, rot, { cast: false });
      const [lx, lz] = at(a + ft / 2);
      const [rx, rz] = at(e - ft / 2);
      addBox(b, fm, lx, y0 + sill + (top - sill) / 2, lz, ft, top - sill, t + 0.06, rot, { cast: false });
      addBox(b, fm, rx, y0 + sill + (top - sill) / 2, rz, ft, top - sill, t + 0.06, rot, { cast: false });
      // mullion
      if (o.width > 1.6) addBox(b, fm, cx, y0 + sill + (top - sill) / 2, cz, 0.05, top - sill, t + 0.04, rot, { cast: false });
    } else {
      // door / gate: lintel above the clear height
      if (o.height < H) solid(a, e, y0 + o.height, y0 + H);
      const [cx, cz] = at(o.at);
      doors.push({ x: cx, z: cz, width: o.width });
      const fm = o.frame ?? 'steelDark';
      const ft = 0.1;
      const [lx, lz] = at(a + ft / 2);
      const [rx, rz] = at(e - ft / 2);
      addBox(b, fm, lx, y0 + o.height / 2, lz, ft, o.height, t + 0.08, rot, { cast: false });
      addBox(b, fm, rx, y0 + o.height / 2, rz, ft, o.height, t + 0.08, rot, { cast: false });
      addBox(b, fm, cx, y0 + o.height - ft / 2, cz, o.width, ft, t + 0.08, rot, { cast: false });
    }
    cursor = e;
  }
  solid(cursor, L, y0, y0 + H);
  return { doors };
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

export type Side = 'N' | 'S' | 'E' | 'W';

export interface SideSpec {
  openings?: Opening[];
  material?: MaterialName;
}

export interface Partition {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  openings?: Opening[];
  material?: MaterialName;
  thickness?: number;
}

export interface BuildingSpec {
  x: number;
  z: number;
  /** Footprint along X and Z (outer dimensions). */
  w: number;
  d: number;
  height: number;
  wallMaterial: MaterialName;
  roofMaterial?: MaterialName;
  floorMaterial?: MaterialName;
  ceilingMaterial?: MaterialName;
  thickness?: number;
  sides?: Partial<Record<Side, SideSpec>>;
  partitions?: Partition[];
  /** Roof parapet height (0 = none). */
  parapet?: number;
  /** false leaves the roof off (ruined / open to the sky). */
  roof?: boolean;
  /** Draw the interior ceiling plane (default true when roof is present). */
  ceiling?: boolean;
  tag?: string;
}

export interface BuildingInfo {
  /** Inner clear rectangle. */
  inner: { x0: number; z0: number; x1: number; z1: number };
  doors: { x: number; z: number; width: number; side: Side }[];
  roofY: number;
}

/** Enterable building with walls, floor, ceiling and roof. Colliders make a solid shell with real doorways. */
export function building(b: LevelBuilder, s: BuildingSpec): BuildingInfo {
  const t = s.thickness ?? 0.4;
  const x0 = s.x - s.w / 2;
  const x1 = s.x + s.w / 2;
  const z0 = s.z - s.d / 2;
  const z1 = s.z + s.d / 2;
  const H = s.height;
  const sides = s.sides ?? {};
  const doors: BuildingInfo['doors'] = [];
  const tag = s.tag ?? 'building';

  // walls: N/S run the full width (closing the corners), E/W run between them
  const sideWall = (side: Side, ax: number, az: number, bx: number, bz: number) => {
    const spec = sides[side] ?? {};
    const info = wall(b, {
      x0: ax,
      z0: az,
      x1: bx,
      z1: bz,
      height: H,
      thickness: t,
      material: spec.material ?? s.wallMaterial,
      openings: spec.openings,
      mapKind: 'wall',
      tag,
    });
    for (const d of info.doors) doors.push({ ...d, side });
  };
  // centre lines are inset by t/2 so the outer face sits on the footprint edge
  sideWall('N', x0, z0 + t / 2, x1, z0 + t / 2);
  sideWall('S', x1, z1 - t / 2, x0, z1 - t / 2); // reversed so `at` measures from the east end
  sideWall('E', x1 - t / 2, z0 + t, x1 - t / 2, z1 - t);
  sideWall('W', x0 + t / 2, z1 - t, x0 + t / 2, z0 + t);

  // interior partitions
  for (const p of s.partitions ?? []) {
    wall(b, {
      x0: p.x0,
      z0: p.z0,
      x1: p.x1,
      z1: p.z1,
      height: H - 0.05,
      thickness: p.thickness ?? 0.2,
      material: p.material ?? 'plaster',
      openings: p.openings,
      mapKind: 'wall',
      tag: 'partition',
      cast: false,
    });
  }

  // floor
  const floorMat = s.floorMaterial ?? 'concreteSlab';
  groundRect(b, floorMat, x0 + t, z0 + t, x1 - t, z1 - t, 0.03);

  const hasRoof = s.roof !== false;
  const roofT = 0.4;
  if (hasRoof) {
    const rm = s.roofMaterial ?? 'roof';
    addBox(b, rm, s.x, H + roofT / 2, s.z, s.w + 0.5, roofT, s.d + 0.5, 0);
    b.collide({ x: s.x, z: s.z, hx: (s.w + 0.5) / 2, hz: (s.d + 0.5) / 2, y0: H, y1: H + roofT, mapKind: 'none', tag: 'roof' });
    if ((s.ceiling ?? true) === true) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(s.w - t * 2, s.d - t * 2), b.mats.get(s.ceilingMaterial ?? 'concreteDark'));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(s.x, H - 0.02, s.z);
      ceil.receiveShadow = true;
      b.add(ceil);
    }
    const par = s.parapet ?? 0;
    if (par > 0) {
      const pt = 0.3;
      const ph = H + roofT;
      addBox(b, s.wallMaterial, s.x, ph + par / 2, z0 + pt / 2 - 0.25, s.w + 0.5, par, pt, 0);
      addBox(b, s.wallMaterial, s.x, ph + par / 2, z1 - pt / 2 + 0.25, s.w + 0.5, par, pt, 0);
      addBox(b, s.wallMaterial, x0 + pt / 2 - 0.25, ph + par / 2, s.z, pt, par, s.d - 0.2, 0);
      addBox(b, s.wallMaterial, x1 - pt / 2 + 0.25, ph + par / 2, s.z, pt, par, s.d - 0.2, 0);
    }
  }
  // minimap footprint (non-blocking)
  b.collide({ x: s.x, z: s.z, hx: s.w / 2, hz: s.d / 2, y1: 0.05, blocksMove: false, blocksShots: false, mapKind: 'building', tag: 'footprint' });

  return { inner: { x0: x0 + t, z0: z0 + t, x1: x1 - t, z1: z1 - t }, doors, roofY: H + roofT };
}

export interface FacadeSpec {
  /** Window grid: `cols` per side face, `rows` per floor. */
  floors: number;
  floorHeight: number;
  windowW?: number;
  windowH?: number;
  /** Fraction of windows that glow warm (0..1) - most are dark. */
  litFraction?: number;
  seed?: number;
  /** Faces to decorate. */
  faces?: Side[];
}

export interface SolidBlockSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  wallMaterial: MaterialName;
  roofMaterial?: MaterialName;
  facade?: FacadeSpec;
  mapKind?: MapKind;
  tag?: string;
}

/** A closed building mass (not enterable) with a decorated facade: window grid, sills, base band and roof slab. */
export function solidBlock(b: LevelBuilder, s: SolidBlockSpec): void {
  addBox(b, s.wallMaterial, s.x, s.height / 2, s.z, s.w, s.height, s.d, 0);
  b.collide({ x: s.x, z: s.z, hx: s.w / 2, hz: s.d / 2, y1: s.height, mapKind: s.mapKind ?? 'building', surface: 'concrete', tag: s.tag ?? 'block' });
  addBox(b, s.roofMaterial ?? 'roof', s.x, s.height + 0.15, s.z, s.w + 0.4, 0.3, s.d + 0.4, 0);
  // dark plinth band
  addBox(b, 'concreteDark', s.x, 0.45, s.z, s.w + 0.12, 0.9, s.d + 0.12, 0, { cast: false });

  const f = s.facade;
  if (!f) return;
  let seed = f.seed ?? 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const ww = f.windowW ?? 1.3;
  const wh = f.windowH ?? 1.5;
  const lit = f.litFraction ?? 0.06;
  const faces = f.faces ?? ['N', 'S', 'E', 'W'];
  const put = (side: Side) => {
    const horizontal = side === 'N' || side === 'S'; // face spans X
    const span = horizontal ? s.w : s.d;
    const n = Math.max(1, Math.floor((span - 1.2) / (ww + 1.6)));
    const gap = span / n;
    const nx = side === 'E' ? 1 : side === 'W' ? -1 : 0;
    const nz = side === 'S' ? 1 : side === 'N' ? -1 : 0;
    const yaw = side === 'S' ? 0 : side === 'N' ? Math.PI : side === 'E' ? Math.PI / 2 : -Math.PI / 2;
    for (let fl = 0; fl < f.floors; fl++) {
      const cy = 1.5 + fl * f.floorHeight + wh / 2;
      if (cy + wh / 2 > s.height - 0.4) break;
      for (let i = 0; i < n; i++) {
        const along = -span / 2 + gap * (i + 0.5);
        const px = s.x + (horizontal ? along : nx * (s.w / 2 + 0.02));
        const pz = s.z + (horizontal ? nz * (s.d / 2 + 0.02) : along);
        const isLit = rand() < lit;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), b.mats.get(isLit ? 'windowLit' : 'glassDark'));
        mesh.position.set(px, cy, pz);
        mesh.rotation.y = yaw;
        b.add(mesh, { cast: false, receive: false });
        // sill + lintel
        const sillX = px + nx * 0.06;
        const sillZ = pz + nz * 0.06;
        const rotY = horizontal ? 0 : Math.PI / 2;
        addBox(b, 'concreteDark', sillX, cy - wh / 2 - 0.05, sillZ, ww + 0.3, 0.1, 0.18, rotY, { cast: false });
        addBox(b, 'concreteDark', sillX, cy + wh / 2 + 0.06, sillZ, ww + 0.2, 0.12, 0.14, rotY, { cast: false });
      }
    }
  };
  for (const face of faces) put(face);
}

/** Fence-like thin wall segment used for perimeter walls with buttresses. */
export function perimeterWall(b: LevelBuilder, x0: number, z0: number, x1: number, z1: number, height = 5, material: MaterialName = 'concreteWall'): void {
  wall(b, { x0, z0, x1, z1, height, thickness: 1.2, material, mapKind: 'wall', tag: 'perimeter' });
  // buttresses every 12 m
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  const rot = Math.atan2(-dz, dx);
  for (let d = 6; d < L - 2; d += 12) {
    const px = x0 + (dx / L) * d;
    const pz = z0 + (dz / L) * d;
    addBox(b, 'concreteDark', px, height / 2, pz, 0.9, height + 0.4, 2.0, rot, { cast: true });
  }
  // cap
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  addBox(b, 'concreteDark', mx, height + 0.1, mz, L, 0.2, 1.5, rot, { cast: false });
}
