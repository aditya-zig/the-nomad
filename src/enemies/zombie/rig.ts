/**
 * ZombieRigImpl: one skinned mesh + skeleton per zombie, procedural pose from `anim.ts`, forward-kinematics based
 * ground contact (the pelvis height is derived from probe points so feet, knees, hands and corpses touch the ground
 * instead of floating or sinking), and allocation-free head / chest / hand queries for hit detection.
 */
import * as THREE from 'three';
import type { ZombieType } from '../../types';
import type { ZombieAnimState, ZombieRig } from '../zombieRigTypes';
import { PO, type RigAnimState, evalPose, makeRigAnimState } from './anim';
import { B, BONE_NAMES, BONE_PARENT, type Dims, NB, restPositions } from './dims';
import { type ProbeSets, computeProbes } from './probes';
import { mulberry32 } from './prng';
import { VARIANT_COUNT, buildVariant, dimsFor } from './variants';

export interface TypeAssets {
  type: ZombieType;
  D: Dims;
  rest: ReturnType<typeof restPositions>;
  inverses: THREE.Matrix4[] | null;
  variants: (THREE.BufferGeometry | null)[];
  probes: (ProbeSets | null)[];
  legLen: number;
  boundSphere: THREE.Sphere;
}

export function makeTypeAssets(type: ZombieType): TypeAssets {
  const D = dimsFor(type);
  return {
    type,
    D,
    rest: restPositions(D),
    inverses: null,
    variants: new Array<THREE.BufferGeometry | null>(VARIANT_COUNT[type]).fill(null),
    probes: new Array<ProbeSets | null>(VARIANT_COUNT[type]).fill(null),
    legLen: D.hipY,
    boundSphere: new THREE.Sphere(new THREE.Vector3(0, D.H * 0.5, 0), D.H * 1.0),
  };
}

export function variantGeometry(a: TypeAssets, index: number): THREE.BufferGeometry {
  const i = index % a.variants.length;
  let g = a.variants[i];
  if (!g) {
    g = buildVariant(a.type, i);
    a.variants[i] = g;
    a.probes[i] = computeProbes(g, a.rest);
  }
  return g;
}

export function variantProbes(a: TypeAssets, index: number): ProbeSets {
  variantGeometry(a, index);
  return a.probes[index % a.probes.length]!;
}

// ---- scratch objects for forward kinematics (single threaded) ----
const FKM: THREE.Matrix4[] = Array.from({ length: NB }, () => new THREE.Matrix4());
const LM = new THREE.Matrix4();
const ZERO = new THREE.Vector3();
const V1 = new THREE.Vector3();
const EUL = new THREE.Euler(0, 0, 0, 'XYZ');
const IDLE: ZombieAnimState = { mode: 'idle', speed: 0, time: 0, actionT: 0, staggerT: 0, deathT: 0, aggro: 0, hitKick: 0, deathStyle: 0, headshotDeath: false, enraged: false };

export class ZombieRigImpl implements ZombieRig {
  readonly type: ZombieType;
  readonly root = new THREE.Group();
  readonly radius: number;
  readonly height: number;
  readonly headRadius: number;

  private readonly assets: TypeAssets;
  private readonly bones: THREE.Bone[] = [];
  private readonly skeleton: THREE.Skeleton;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly R: RigAnimState;
  private readonly headLocal = new THREE.Vector3();
  private readonly chestLocal = new THREE.Vector3();
  private readonly handLocal = new THREE.Vector3();
  private settled = false;
  private probes: ProbeSets;
  private dying = false;

  constructor(assets: TypeAssets, material: THREE.Material, dims: { radius: number; height: number; headRadius: number }, seed: number) {
    this.assets = assets;
    this.type = assets.type;
    this.radius = dims.radius;
    this.height = dims.height;
    this.headRadius = dims.headRadius;
    this.root.name = `Zombie:${assets.type}`;
    const rest = assets.rest;
    for (let i = 0; i < NB; i++) {
      const b = new THREE.Bone();
      b.name = BONE_NAMES[i]!;
      const p = rest[i]!;
      const par = BONE_PARENT[i]!;
      if (par < 0) b.position.set(p.x, p.y, p.z);
      else {
        const pp = rest[par]!;
        b.position.set(p.x - pp.x, p.y - pp.y, p.z - pp.z);
      }
      this.bones.push(b);
      if (par >= 0) this.bones[par]!.add(b);
    }
    const geo = variantGeometry(assets, seed >>> 3);
    this.probes = variantProbes(assets, seed >>> 3);
    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.add(this.bones[0]!);
    this.mesh.name = 'ZombieMesh';
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    if (assets.inverses) this.skeleton = new THREE.Skeleton(this.bones, assets.inverses);
    else {
      this.skeleton = new THREE.Skeleton(this.bones);
      assets.inverses = this.skeleton.boneInverses;
    }
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = assets.boundSphere.clone();
    this.R = makeRigAnimState(assets.type, assets.legLen, assets.D.armAngle);
    this.reset(seed);
  }

  reset(seed: number): void {
    const r = mulberry32(seed * 2654435761 + 17);
    const I = this.R.inst;
    const t = this.type;
    I.seed = seed & 0xffff;
    I.phase = r() * Math.PI * 2;
    I.gait = 0.9 + r() * 0.2;
    I.lean = (r() - 0.5) * 0.16;
    I.headRoll = (r() - 0.5) * 0.35;
    I.headYaw = (r() - 0.5) * 0.3;
    I.armCarry = (r() - 0.3) * 0.28;
    I.twitchOff = r() * 50;
    I.swayOff = r() * 6.28;
    I.side = r() < 0.5 ? -1 : 1;
    const lr = r();
    I.limp = t === 'shambler' ? (lr < 0.3 ? -1 : lr < 0.6 ? 1 : 0) : t === 'runner' ? (lr < 0.12 ? 1 : 0) : 0;
    I.legScale = 0.965 + r() * 0.07;
    I.armScale = 0.95 + r() * 0.1;
    for (let i = 0; i < 6; i++) I.flop[i] = (r() - 0.5) * 2;
    if (t === 'warden') {
      I.lean = 0;
      I.limp = 0;
      I.legScale = 1;
    }
    const R = this.R;
    R.phase = 0;
    R.runK = 0;
    R.chargeK = 0;
    R.spSm = 0;
    R.wAttack = R.wStagger = R.wRoar = R.wSlam = 0;
    R.deathStarted = false;
    R.out.fill(0);
    // appearance variant (geometry is shared between rigs)
    const geo = variantGeometry(this.assets, seed >>> 3);
    this.probes = variantProbes(this.assets, seed >>> 3);
    if (this.mesh.geometry !== geo) this.mesh.geometry = geo;
    // per-instance limb lengths
    this.bones[B.hipL]!.scale.set(1, I.legScale, 1);
    this.bones[B.hipR]!.scale.set(1, I.legScale, 1);
    this.bones[B.shL]!.scale.set(1, I.armScale, 1);
    this.bones[B.shR]!.scale.set(1, I.armScale, 1);
    this.settled = false;
    this.root.visible = true;
    IDLE.time = 0;
    this.update(IDLE, 0);
  }

  update(s: ZombieAnimState, dt: number): void {
    if (!(dt >= 0)) dt = 0;
    else if (dt > 0.1) dt = 0.1;
    if (this.settled) {
      if (s.mode === 'death') return;
      this.settled = false;
    }
    this.dying = s.mode === 'death';
    const done = evalPose(this.R, s, dt);
    this.applyPose();
    if (done) this.settled = true;
  }

  private applyPose(): void {
    const P = this.R.out;
    const bones = this.bones;
    for (let b = 0; b < NB; b++) {
      EUL.set(P[b * 3]!, P[b * 3 + 1]!, P[b * 3 + 2]!, 'XYZ');
      bones[b]!.quaternion.setFromEuler(EUL);
    }
    // forward kinematics relative to the pelvis origin
    for (let i = 0; i < NB; i++) {
      const b = bones[i]!;
      if (i === 0) FKM[0]!.compose(ZERO, b.quaternion, b.scale);
      else {
        LM.compose(b.position, b.quaternion, b.scale);
        FKM[i]!.multiplyMatrices(FKM[BONE_PARENT[i]!]!, LM);
      }
    }
    // ground contact: place the pelvis so the lowest mesh extreme touches y = 0
    let need = -Infinity;
    const probes = this.dying ? this.probes.full : this.probes.stand;
    for (let i = 0; i < probes.length; i += 4) {
      V1.set(probes[i + 1]!, probes[i + 2]!, probes[i + 3]!).applyMatrix4(FKM[probes[i]!]!);
      const n = -V1.y;
      if (n > need) need = n;
    }
    const py = need + P[PO + 1]! + (this.dying ? 0.012 : 0);
    const px = P[PO]!;
    const pz = P[PO + 2]!;
    bones[0]!.position.set(px, py, pz);
    // animated key points in root space (used for hit detection)
    const D = this.assets.D;
    this.headLocal.set(0, D.headCenterUp, -0.004 * D.k * D.headS).applyMatrix4(FKM[B.head]!);
    this.headLocal.x += px;
    this.headLocal.y += py;
    this.headLocal.z += pz;
    this.chestLocal.set(0, 0.1 * D.k, 0).applyMatrix4(FKM[B.chest]!);
    this.chestLocal.x += px;
    this.chestLocal.y += py;
    this.chestLocal.z += pz;
    this.handLocal.set(0, -0.1 * D.k, 0).applyMatrix4(FKM[B.haR]!);
    this.handLocal.x += px;
    this.handLocal.y += py;
    this.handLocal.z += pz;
  }

  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    out.set(c * local.x + s * local.z, local.y, -s * local.x + c * local.z);
    out.x += this.root.position.x;
    out.y += this.root.position.y;
    out.z += this.root.position.z;
    return out;
  }

  getHeadWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(this.headLocal, out);
  }

  getChestWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(this.chestLocal, out);
  }

  getHandWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.toWorld(this.handLocal, out);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Debug access (harness). */
  get skinnedMesh(): THREE.SkinnedMesh {
    return this.mesh;
  }

  get skeletonBones(): readonly THREE.Bone[] {
    return this.bones;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.skeleton.dispose();
  }
}
