/**
 * Gloved hand + sleeved forearm.
 *
 * Hand frame (right hand): origin at the wrist centre, fingers extend toward -Z, the back of the hand faces +Y and the
 * thumb sits toward -X. The left hand is the same geometry mirrored with scale.x = -1. Each hand is TWO skinned meshes
 * (fabric glove with vertex colours, hard knuckle guards) sharing one skeleton (palm + 3 bones per finger + thumb),
 * plus a rigid sleeved forearm that can be aimed at an elbow target.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assignBoxUV } from './kit';
import type { RigMaterials } from './materials';
import { clamp01, lerp } from './util';

export type Side = 'right' | 'left';

export interface FingerPose {
  /** Curl (radians, positive = toward the palm) of the three joints. */
  c: [number, number, number];
  /** Side splay in radians (positive = away from the middle finger). */
  splay: number;
}

export interface HandPose {
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
  /** Thumb base rotation (x pitch toward palm, y yaw outward, z roll) and two joint curls. */
  thumb: { bx: number; by: number; bz: number; c1: number; c2: number };
}

const f = (a: number, b: number, c: number, splay = 0): FingerPose => ({ c: [a, b, c], splay });

/** Named finger poses (values tuned by eye in the harness). */
export const HAND_POSES = {
  relaxed: {
    index: f(0.25, 0.3, 0.2, 0.02),
    middle: f(0.32, 0.36, 0.22),
    ring: f(0.4, 0.4, 0.25, -0.015),
    pinky: f(0.5, 0.42, 0.25, -0.04),
    thumb: { bx: 0.15, by: 0.1, bz: 0, c1: 0.15, c2: 0.15 },
  },
  open: {
    index: f(0.05, 0.05, 0.03, 0.1),
    middle: f(0.05, 0.05, 0.03),
    ring: f(0.05, 0.05, 0.03, -0.08),
    pinky: f(0.08, 0.06, 0.03, -0.18),
    thumb: { bx: 0.0, by: -0.15, bz: 0, c1: 0.05, c2: 0.05 },
  },
  /** Right hand on a pistol grip: trigger finger extended, the others wrapped. */
  gripR: {
    index: f(0.18, 0.2, 0.12, 0.0),
    middle: f(1.15, 1.35, 0.9),
    ring: f(1.2, 1.4, 0.95, -0.02),
    pinky: f(1.25, 1.4, 0.9, -0.04),
    thumb: { bx: 0.35, by: 0.05, bz: 0.1, c1: 0.2, c2: 0.1 },
  },
  /** Trigger finger pulled. */
  gripRFire: {
    index: f(0.62, 0.7, 0.4, 0.0),
    middle: f(1.15, 1.35, 0.9),
    ring: f(1.2, 1.4, 0.95, -0.02),
    pinky: f(1.25, 1.4, 0.9, -0.04),
    thumb: { bx: 0.35, by: 0.05, bz: 0.1, c1: 0.2, c2: 0.1 },
  },
  /** Support hand cupping a handguard / pump from below (C-clamp). */
  cup: {
    index: f(0.75, 0.95, 0.55, 0.02),
    middle: f(0.85, 1.0, 0.6),
    ring: f(0.9, 1.05, 0.62, -0.03),
    pinky: f(0.95, 1.05, 0.6, -0.06),
    thumb: { bx: 0.15, by: 0.55, bz: 0.15, c1: 0.15, c2: 0.1 },
  },
  /** Fingers wrapped around a vertical foregrip. */
  grip: {
    index: f(1.0, 1.25, 0.8, 0.0),
    middle: f(1.1, 1.3, 0.85),
    ring: f(1.15, 1.35, 0.85, -0.02),
    pinky: f(1.2, 1.35, 0.85, -0.05),
    thumb: { bx: 0.45, by: 0.15, bz: 0.15, c1: 0.3, c2: 0.2 },
  },
  /** Holding a magazine or small object with all fingers. */
  hold: {
    index: f(0.9, 1.0, 0.7, 0.0),
    middle: f(1.0, 1.1, 0.7),
    ring: f(1.05, 1.15, 0.75, -0.02),
    pinky: f(1.1, 1.15, 0.75, -0.04),
    thumb: { bx: 0.45, by: 0.35, bz: 0.15, c1: 0.35, c2: 0.25 },
  },
  /** Pinch grip (grenade / pin ring). */
  pinch: {
    index: f(0.7, 0.75, 0.5, 0.0),
    middle: f(0.95, 1.05, 0.7),
    ring: f(1.05, 1.1, 0.75, -0.02),
    pinky: f(1.1, 1.1, 0.75, -0.04),
    thumb: { bx: 0.5, by: 0.45, bz: 0.2, c1: 0.3, c2: 0.2 },
  },
  fist: {
    index: f(1.35, 1.55, 1.0),
    middle: f(1.4, 1.6, 1.0),
    ring: f(1.45, 1.6, 1.0, -0.02),
    pinky: f(1.5, 1.6, 1.0, -0.04),
    thumb: { bx: 0.4, by: 0.3, bz: 0.2, c1: 0.5, c2: 0.5 },
  },
  flat: {
    index: f(0.02, 0.02, 0.02, 0.04),
    middle: f(0.02, 0.02, 0.02),
    ring: f(0.02, 0.02, 0.02, -0.03),
    pinky: f(0.04, 0.03, 0.02, -0.08),
    thumb: { bx: 0.0, by: 0.1, bz: 0, c1: 0.05, c2: 0.05 },
  },
} satisfies Record<string, HandPose>;

export type HandPoseName = keyof typeof HAND_POSES;

export function clonePose(p: HandPose): HandPose {
  return {
    index: { c: [...p.index.c], splay: p.index.splay },
    middle: { c: [...p.middle.c], splay: p.middle.splay },
    ring: { c: [...p.ring.c], splay: p.ring.splay },
    pinky: { c: [...p.pinky.c], splay: p.pinky.splay },
    thumb: { ...p.thumb },
  };
}

export function lerpPose(a: HandPose, b: HandPose, t: number, out: HandPose): HandPose {
  const k = clamp01(t);
  for (const n of ['index', 'middle', 'ring', 'pinky'] as const) {
    for (let i = 0; i < 3; i++) out[n].c[i] = lerp(a[n].c[i]!, b[n].c[i]!, k);
    out[n].splay = lerp(a[n].splay, b[n].splay, k);
  }
  out.thumb.bx = lerp(a.thumb.bx, b.thumb.bx, k);
  out.thumb.by = lerp(a.thumb.by, b.thumb.by, k);
  out.thumb.bz = lerp(a.thumb.bz, b.thumb.bz, k);
  out.thumb.c1 = lerp(a.thumb.c1, b.thumb.c1, k);
  out.thumb.c2 = lerp(a.thumb.c2, b.thumb.c2, k);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

interface FingerDef {
  name: 'index' | 'middle' | 'ring' | 'pinky';
  x: number;
  y: number;
  z: number;
  seg: [number, number, number];
  r: [number, number, number];
  splay: number;
}

const FINGERS: FingerDef[] = [
  { name: 'index', x: -0.0322, y: 0.003, z: -0.094, seg: [0.04, 0.024, 0.021], r: [0.0099, 0.0093, 0.0086], splay: 0.02 },
  { name: 'middle', x: -0.0105, y: 0.004, z: -0.097, seg: [0.044, 0.028, 0.022], r: [0.0104, 0.0097, 0.009], splay: 0 },
  { name: 'ring', x: 0.0113, y: 0.003, z: -0.093, seg: [0.041, 0.026, 0.021], r: [0.0098, 0.0091, 0.0085], splay: -0.015 },
  { name: 'pinky', x: 0.0318, y: 0.0, z: -0.084, seg: [0.033, 0.019, 0.019], r: [0.0088, 0.0082, 0.0076], splay: -0.04 },
];

const THUMB = { pos: new THREE.Vector3(-0.031, -0.009, -0.022), yaw: 0.72, pitch: -0.32, seg: [0.04, 0.031, 0.026] as const, r: [0.0148, 0.0132, 0.0118] as const };

const COL = {
  glove: new THREE.Color(0x4a504a),
  gloveDark: new THREE.Color(0x232724),
  tip: new THREE.Color(0x676c64),
  leather: new THREE.Color(0x3c3936),
  cuff: new THREE.Color(0x2b2e2c),
  strap: new THREE.Color(0x36393b),
};

interface SkinPart {
  geo: THREE.BufferGeometry;
  bone: number;
  parent: number;
  blendLen: number;
  bind: THREE.Matrix4;
  color: THREE.Color | ((p: THREE.Vector3) => THREE.Color);
}

class SkinBuilder {
  private readonly parts: SkinPart[] = [];
  add(geo: THREE.BufferGeometry, bone: number, bind: THREE.Matrix4, color: SkinPart['color'], parent = -1, blendLen = 0): void {
    this.parts.push({ geo, bone, parent, blendLen, bind, color });
  }

  build(): THREE.BufferGeometry {
    const geos: THREE.BufferGeometry[] = [];
    const p = new THREE.Vector3();
    for (const part of this.parts) {
      const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      }
      const pos = g.attributes.position!;
      const n = pos.count;
      const col = new Float32Array(n * 3);
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        const c = typeof part.color === 'function' ? part.color(p) : part.color;
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        si[i * 4] = part.bone;
        sw[i * 4] = 1;
        if (part.parent >= 0 && part.blendLen > 0) {
          const u = clamp01(-p.z / part.blendLen); // 0 at the joint -> 1 past blendLen
          const w = (1 - u) * (1 - u) * 0.5;
          si[i * 4] = part.bone;
          sw[i * 4] = 1 - w;
          si[i * 4 + 1] = part.parent;
          sw[i * 4 + 1] = w;
        }
      }
      g.applyMatrix4(part.bind);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) throw new Error('hand geometry merge failed');
    assignBoxUV(merged, 6);
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Tapered tube along -Z from z=0 (radius r0) to z=-len (radius r1). */
function tube(r0: number, r1: number, len: number, seg = 10, flatten = 0.92): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -len / 2);
  g.scale(1, flatten, 1);
  return g;
}

function capsuleSegment(r0: number, r1: number, len: number, flatten = 0.92): THREE.BufferGeometry[] {
  const tubeG = tube(r0, r1, len, 9, flatten);
  const cap = new THREE.SphereGeometry(r1, 9, 6);
  cap.scale(1, flatten, 1);
  cap.translate(0, 0, -len);
  return [tubeG, cap];
}

const _bind = new THREE.Matrix4();

export interface HandOptions {
  side: Side;
  /** Adds a tactical wrist watch (left hand). */
  watch?: boolean;
  /** Reserved for future appearance variation. */
  seed?: number;
}

export class GloveHand {
  readonly side: Side;
  /** Wrist at the origin; parent this under the rig and drive its position / rotation. */
  readonly root = new THREE.Group();
  /** Rigid sleeved forearm, parented to `root`. Use `aimForearm`. */
  readonly forearm = new THREE.Group();
  private readonly bones: THREE.Bone[] = [];
  private readonly fingerBones: Record<string, THREE.Bone[]> = {};
  private thumbBones: THREE.Bone[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private thumbBind = new THREE.Quaternion();
  private readonly fingerBind: Record<string, THREE.Quaternion> = {};

  constructor(opts: HandOptions, mats: RigMaterials) {
    this.side = opts.side;
    this.buildHand(mats);
    this.buildForearm(mats, opts.watch === true);
    if (opts.side === 'left') this.root.scale.x = -1;
    this.root.add(this.forearm);
  }

  // -- construction ----------------------------------------------------------------------------

  private newBone(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    this.bones.push(b);
    return b;
  }

  private buildHand(mats: RigMaterials): void {
    const palm = this.newBone('palm', this.root, 0, 0, 0);
    const chains: Record<string, THREE.Bone[]> = {};

    // finger bones
    for (const d of FINGERS) {
      const b0 = this.newBone(`${d.name}0`, palm, d.x, d.y, d.z);
      b0.rotation.y = d.splay;
      const b1 = this.newBone(`${d.name}1`, b0, 0, 0, -d.seg[0]);
      const b2 = this.newBone(`${d.name}2`, b1, 0, 0, -d.seg[1]);
      chains[d.name] = [b0, b1, b2];
      this.fingerBind[d.name] = b0.quaternion.clone();
    }
    // thumb bones
    const t0 = this.newBone('thumb0', palm, THUMB.pos.x, THUMB.pos.y, THUMB.pos.z);
    t0.rotation.set(THUMB.pitch, THUMB.yaw, 0, 'YXZ');
    this.thumbBind.copy(t0.quaternion);
    const t1 = this.newBone('thumb1', t0, 0, 0, -THUMB.seg[0]);
    const t2 = this.newBone('thumb2', t1, 0, 0, -THUMB.seg[1]);
    this.thumbBones = [t0, t1, t2];
    Object.assign(this.fingerBones, chains);

    this.root.updateMatrixWorld(true);
    const boneIndex = (b: THREE.Bone) => this.bones.indexOf(b);
    const bindOf = (b: THREE.Bone) => _bind.copy(b.matrixWorld).clone();

    const glove = new SkinBuilder();
    const guard = new SkinBuilder();

    // ---- palm ----
    const palmG = new RoundedBoxGeometry(0.088, 0.032, 0.1, 3, 0.0125);
    palmG.translate(0, -0.002, -0.05);
    {
      const pos = palmG.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const t = clamp01(-z / 0.1);
        let x = pos.getX(i);
        let y = pos.getY(i);
        x *= lerp(0.7, 1.0, t);
        if (y > 0) y += 0.006 * (1 - Math.pow(Math.abs(x) / 0.046, 2)) * (0.5 + t * 0.5);
        y *= lerp(0.88, 1.0, t);
        pos.setXYZ(i, x, y, z);
      }
      palmG.computeVertexNormals();
    }
    const palmColor = (p: THREE.Vector3): THREE.Color => (p.y < -0.008 ? COL.leather : COL.glove);
    glove.add(palmG, boneIndex(palm), bindOf(palm), palmColor);
    // finger-base webbing so there are no gaps between fingers
    for (let i = 0; i < 3; i++) {
      const a = FINGERS[i]!;
      const b = FINGERS[i + 1]!;
      const web = new RoundedBoxGeometry(0.02, 0.017, 0.03, 1, 0.007);
      web.translate((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.001, (a.z + b.z) / 2 - 0.003);
      glove.add(web, boneIndex(palm), bindOf(palm), COL.glove);
    }
    // thenar pad (thumb muscle)
    const thenar = new THREE.SphereGeometry(0.0225, 12, 10);
    thenar.scale(0.95, 0.75, 1.5);
    thenar.rotateY(0.35);
    thenar.translate(-0.031, -0.011, -0.03);
    glove.add(thenar, boneIndex(palm), bindOf(palm), (p) => (p.y < -0.014 ? COL.leather : COL.glove));
    // wrist cuff + joint ball
    const ball = new THREE.SphereGeometry(0.031, 14, 10);
    ball.scale(1, 0.92, 1);
    glove.add(ball, boneIndex(palm), bindOf(palm), COL.cuff);
    const cuff = new THREE.CylinderGeometry(0.0318, 0.0305, 0.034, 18, 1);
    cuff.rotateX(Math.PI / 2);
    cuff.translate(0, 0, 0.014);
    glove.add(cuff, boneIndex(palm), bindOf(palm), COL.cuff);
    const strap = new THREE.CylinderGeometry(0.0332, 0.0332, 0.012, 20, 1);
    strap.rotateX(Math.PI / 2);
    strap.translate(0, 0, 0.018);
    glove.add(strap, boneIndex(palm), bindOf(palm), COL.strap);
    const tab = new RoundedBoxGeometry(0.018, 0.005, 0.02, 1, 0.002);
    tab.translate(0.006, 0.0345, 0.02);
    glove.add(tab, boneIndex(palm), bindOf(palm), COL.gloveDark);

    // ---- fingers ----
    for (const d of FINGERS) {
      const chain = chains[d.name]!;
      for (let s = 0; s < 3; s++) {
        const bone = chain[s]!;
        const parentIdx = s === 0 ? boneIndex(palm) : boneIndex(chain[s - 1]!);
        const len = d.seg[s]!;
        const r0 = d.r[s]!;
        const r1 = s < 2 ? d.r[s + 1]! * 1.02 : d.r[2]! * 0.92;
        const parts = capsuleSegment(r0, r1, len);
        const colorFn = (p: THREE.Vector3): THREE.Color => {
          const u = clamp01(-p.z / len);
          const crease = Math.max(0, 1 - u / 0.12) + Math.max(0, (u - 0.88) / 0.12);
          const base = s === 2 && u > 0.55 ? COL.tip : COL.glove;
          const dark = base.clone().lerp(COL.gloveDark, clamp01(crease) * 0.6);
          if (p.y < -r0 * 0.55) dark.lerp(COL.leather, 0.6); // palm side
          return dark;
        };
        for (const g of parts) glove.add(g, boneIndex(bone), bindOf(bone), colorFn, parentIdx, len * 0.35);
        // knuckle-guard plates on the proximal and middle phalanges
        if (s < 2) {
          const plate = new RoundedBoxGeometry(r0 * 1.15, 0.0026, len * (s === 0 ? 0.5 : 0.42), 1, 0.0011);
          plate.translate(0, r0 * 0.93 + 0.0004, -len * 0.5);
          guard.add(plate, boneIndex(bone), bindOf(bone), new THREE.Color(0xffffff));
        }
      }
    }

    // ---- thumb ----
    for (let s = 0; s < 3; s++) {
      const bone = this.thumbBones[s]!;
      const parentIdx = s === 0 ? boneIndex(palm) : boneIndex(this.thumbBones[s - 1]!);
      const len = THUMB.seg[s]!;
      const r0 = THUMB.r[s]!;
      const r1 = s < 2 ? THUMB.r[s + 1]! : THUMB.r[2]! * 0.9;
      const parts = capsuleSegment(r0, r1, len, 0.88);
      const colorFn = (p: THREE.Vector3): THREE.Color => {
        const u = clamp01(-p.z / len);
        const crease = Math.max(0, 1 - u / 0.12) + Math.max(0, (u - 0.88) / 0.12);
        const base = s === 2 && u > 0.5 ? COL.tip : COL.glove;
        return base.clone().lerp(COL.gloveDark, clamp01(crease) * 0.55);
      };
      for (const g of parts) glove.add(g, boneIndex(bone), bindOf(bone), colorFn, parentIdx, len * 0.35);
      if (s === 1) {
        const plate = new RoundedBoxGeometry(r0 * 1.1, 0.0026, len * 0.45, 1, 0.0011);
        plate.translate(0, r0 * 0.9, -len * 0.5);
        guard.add(plate, boneIndex(bone), bindOf(bone), new THREE.Color(0xffffff));
      }
    }

    // ---- back-of-hand guard shell (compact, curved, sits on the knuckles) ----
    const shell = new RoundedBoxGeometry(0.05, 0.0038, 0.024, 2, 0.0018);
    {
      const pos = shell.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setY(i, pos.getY(i) + 0.0045 * (1 - Math.pow(Math.abs(x) / 0.027, 2)) - 0.0035 * Math.pow(Math.abs(x) / 0.027, 2));
      }
      shell.computeVertexNormals();
    }
    shell.translate(-0.002, 0.0215, -0.082);
    guard.add(shell, boneIndex(palm), bindOf(palm), new THREE.Color(0xffffff));
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.BoxGeometry(0.0026, 0.0024, 0.02);
      rib.translate(-0.0195 + i * 0.013, 0.0245 - Math.abs(i - 1.5) * 0.0008, -0.082);
      guard.add(rib, boneIndex(palm), bindOf(palm), new THREE.Color(0xffffff));
    }

    // meshes ------------------------------------------------------------------------------------
    const gloveGeo = glove.build();
    const guardGeo = guard.build();
    this.geometries.push(gloveGeo, guardGeo);
    const gloveMat = mats.get('glove') as THREE.Material;
    const guardMat = mats.get('guardShell') as THREE.Material;
    const gloveMesh = new THREE.SkinnedMesh(gloveGeo, gloveMat);
    const guardMesh = new THREE.SkinnedMesh(guardGeo, guardMat);
    for (const m of [gloveMesh, guardMesh]) {
      m.frustumCulled = false;
      this.meshes.push(m);
    }
    gloveMesh.add(palm);
    this.root.add(gloveMesh, guardMesh);
    gloveMesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    gloveMesh.bind(skeleton, gloveMesh.matrixWorld);
    guardMesh.bind(skeleton, gloveMesh.matrixWorld);
    this.setPose(HAND_POSES.relaxed);
  }

  private buildForearm(mats: RigMaterials, watch: boolean): void {
    // sleeve: lathe along +Z from the wrist backward
    const pts: THREE.Vector2[] = [];
    const n = 16;
    const z0 = 0.016;
    const z1 = 0.7;
    const radiusAt = (z: number): number => {
      const u = (z - z0) / (z1 - z0);
      const cuff = 0.0335;
      const mid = 0.0355 + 0.003 * Math.sin(u * 2.4);
      const end = 0.038;
      return u < 0.12 ? lerp(cuff, mid, Math.pow(u / 0.12, 0.8)) : lerp(mid, end, (u - 0.12) / 0.88);
    };
    for (let i = 0; i <= n; i++) {
      const z = lerp(z0, z1, i / n);
      pts.push(new THREE.Vector2(radiusAt(z), z));
    }
    const lathe = new THREE.LatheGeometry(pts, 22);
    lathe.rotateX(Math.PI / 2); // axis Y -> +Z
    {
      const pos = lathe.attributes.position!;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const ang = Math.atan2(y, x);
        const u = clamp01((z - z0) / (z1 - z0));
        // wrinkles: strongest near the cuff, gentle folds along the arm
        const wr = (Math.sin(ang * 5 + z * 60) * 0.0009 + Math.sin(ang * 3 - z * 25) * 0.0012) * (1.2 - u);
        const ring = Math.sin(z * 210) * 0.0006 * (1 - clamp01(u * 5));
        const k = 1 + (wr + ring) / Math.max(0.03, Math.hypot(x, y));
        pos.setXY(i, x * k, y * k);
      }
      lathe.computeVertexNormals();
    }
    assignBoxUV(lathe, 5);
    this.geometries.push(lathe);
    const sleeve = new THREE.Mesh(lathe, mats.get('fabricOlive'));
    sleeve.frustumCulled = false;
    this.forearm.add(sleeve);
    this.meshes.push(sleeve);

    // elastic cuff band at the sleeve end
    const band = new THREE.CylinderGeometry(0.0345, 0.0345, 0.012, 24, 1, true);
    band.rotateX(Math.PI / 2);
    band.translate(0, 0, 0.03);
    this.geometries.push(band);
    const bandMesh = new THREE.Mesh(band, mats.get('webbing'));
    bandMesh.frustumCulled = false;
    this.forearm.add(bandMesh);
    this.meshes.push(bandMesh);

    if (watch) {
      // tactical watch on the back of the left wrist (seen from above the forearm)
      const body = new RoundedBoxGeometry(0.036, 0.011, 0.038, 2, 0.004);
      body.translate(0, 0.0385, 0.088);
      const strapG = new THREE.CylinderGeometry(0.038, 0.038, 0.02, 24, 1, true);
      strapG.rotateX(Math.PI / 2);
      strapG.translate(0, 0, 0.088);
      const nonIndexed = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
      const merged = mergeGeometries([nonIndexed(body), nonIndexed(strapG)], false)!;
      this.geometries.push(merged);
      const wm = new THREE.Mesh(merged, mats.get('polymer'));
      wm.frustumCulled = false;
      this.forearm.add(wm);
      this.meshes.push(wm);
      const face = new THREE.PlaneGeometry(0.027, 0.027);
      face.rotateX(-Math.PI / 2);
      face.translate(0, 0.0447, 0.088);
      this.geometries.push(face);
      const faceMesh = new THREE.Mesh(face, mats.get('screen'));
      faceMesh.frustumCulled = false;
      this.forearm.add(faceMesh);
      this.meshes.push(faceMesh);
    }
  }

  // -- animation --------------------------------------------------------------------------------

  private readonly tmpPose: HandPose = clonePose(HAND_POSES.relaxed);

  setPose(p: HandPose): void {
    for (const d of FINGERS) {
      const fp = p[d.name];
      const chain = this.fingerBones[d.name]!;
      const bind = this.fingerBind[d.name]!;
      // bone 0: keep bind splay then add pose splay about Y and curl about X
      this.e.set(-fp.c[0], fp.splay, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      chain[0]!.quaternion.copy(bind).multiply(this.q);
      chain[1]!.rotation.set(-fp.c[1], 0, 0);
      chain[2]!.rotation.set(-fp.c[2], 0, 0);
    }
    const t = p.thumb;
    this.e.set(-t.bx, t.by, t.bz, 'YXZ');
    this.q.setFromEuler(this.e);
    this.thumbBones[0]!.quaternion.copy(this.thumbBind).multiply(this.q);
    this.thumbBones[1]!.rotation.set(-t.c1, 0, 0);
    this.thumbBones[2]!.rotation.set(-t.c2, 0, 0);
  }

  /** Blend two named poses into the skeleton (no allocation). */
  blend(a: HandPoseName, b: HandPoseName, t: number): void {
    this.setPose(lerpPose(HAND_POSES[a], HAND_POSES[b], t, this.tmpPose));
  }

  private readonly _fa = new THREE.Vector3();
  private readonly _fb = new THREE.Vector3();
  private readonly _fm = new THREE.Matrix4();
  private readonly _fq = new THREE.Quaternion();

  /**
   * Orient the sleeved forearm so it extends from the wrist toward `elbowLocal` (a point in the hand root's local frame).
   * The sleeve is built along +Z (backward), so the direction from the wrist to the elbow must be mostly +Z.
   */
  aimForearm(elbowLocalX: number, elbowLocalY: number, elbowLocalZ: number): void {
    this._fa.set(elbowLocalX, elbowLocalY, elbowLocalZ).normalize();
    // limit the wrist bend: the forearm may deviate from the hand's backward (+Z) axis by at most MAX_BEND
    const cosA = this._fa.z;
    const maxBend = 0.85;
    if (cosA < Math.cos(maxBend)) {
      const px = this._fa.x;
      const py = this._fa.y;
      const pl = Math.hypot(px, py) || 1;
      const sinB = Math.sin(maxBend);
      this._fa.set((px / pl) * sinB, (py / pl) * sinB, Math.cos(maxBend));
    }
    this._fb.set(0, 0, 0);
    this._fm.lookAt(this._fb, this._fa, THREE.Object3D.DEFAULT_UP);
    this._fq.setFromRotationMatrix(this._fm);
    // lookAt aligns -Z with the direction to the target; flip 180deg about Y so +Z aligns instead
    this.forearm.quaternion.copy(this._fq);
    this.forearm.rotateY(Math.PI);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    for (const m of this.meshes) {
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).skeleton?.dispose();
    }
    this.meshes.length = 0;
  }
}
