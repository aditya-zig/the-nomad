/**
 * Shared machinery for the weapon rigs: pose layering (ADS, sprint, bob, sway, breathing, landing, crouch, raise),
 * recoil springs, hand driving and tier-visibility bookkeeping.
 *
 * Gun space: the gun group's origin is the SIGHT POINT (centre of the optic window / rear aperture); +X right, +Y up,
 * -Z forward. At ADS the gun sits at (0, 0, -eyeRelief) with no rotation, so the sight point projects exactly to the
 * centre of the screen.
 */
import * as THREE from 'three';
import type { ViewmodelId, ViewmodelPose, ViewmodelRig } from '../viewmodelTypes';
import { HAND_POSES, lerpPose, type GloveHand, type HandPose, type HandPoseName } from './hand';
import type { RigMaterials } from './materials';
import { clamp, damp, lerp, mulberry32, smooth, Spring } from './util';

export interface GunTuning {
  hipPos: [number, number, number];
  hipRot: [number, number, number];
  adsPos: [number, number, number];
  adsRot: [number, number, number];
  sprintPos: [number, number, number];
  sprintRot: [number, number, number];
  /** Gun-local pivot for animation rotations (roughly the shoulder / rear of the gun). */
  pivot: [number, number, number];
  bob: { y: number; x: number; roll: number };
  sway: { pos: number; rot: number };
  kick: { z: number; pitch: number; yaw: number; roll: number; freq: number; zeta: number; adsMul: number };
}

export interface MotionOut {
  /** Extra rotation about the pivot (radians) that rigs may add to before `apply`. */
  dRot: THREE.Euler;
  /** Extra position (view space) rigs may add to before `apply`. */
  dPos: THREE.Vector3;
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _ea = new THREE.Euler();
const _va = new THREE.Vector3();
const _pivot = new THREE.Vector3();

export class GunMotion {
  readonly pos = new THREE.Vector3();
  readonly baseRot = new THREE.Euler(0, 0, 0, 'YXZ');
  readonly out: MotionOut = { dRot: new THREE.Euler(0, 0, 0, 'YXZ'), dPos: new THREE.Vector3() };
  private readonly kz: Spring;
  private readonly kp: Spring;
  private readonly ky: Spring;
  private readonly kr: Spring;
  private swayX = 0;
  private swayY = 0;
  private swayRy = 0;
  private swayRx = 0;
  private walkBlend = 0;
  private readonly rand = mulberry32(99);
  private readonly pivot: THREE.Vector3;

  constructor(readonly tune: GunTuning) {
    const k = tune.kick;
    this.kz = new Spring(k.freq, k.zeta);
    this.kp = new Spring(k.freq * 1.05, k.zeta);
    this.ky = new Spring(k.freq * 0.9, k.zeta);
    this.kr = new Spring(k.freq * 0.95, k.zeta);
    this.pivot = new THREE.Vector3(...tune.pivot);
  }

  kick(strength: number, ads: number): void {
    const k = this.tune.kick;
    const m = strength * (1 - (1 - k.adsMul) * ads);
    const w = k.freq * Math.PI * 2 * Math.E * 0.9;
    this.kz.kick(k.z * m * w);
    this.kp.kick(k.pitch * m * w);
    this.ky.kick((this.rand() - 0.5) * 2 * k.yaw * m * w);
    this.kr.kick((this.rand() - 0.5) * 2 * k.roll * m * w);
  }

  reset(): void {
    this.kz.reset();
    this.kp.reset();
    this.ky.reset();
    this.kr.reset();
    this.swayX = this.swayY = this.swayRy = this.swayRx = 0;
    this.walkBlend = 0;
  }

  /** Recoil displacement (0..~1) for animation of secondary parts. */
  get recoilAmount(): number {
    return clamp(this.kz.x / Math.max(1e-6, this.tune.kick.z), 0, 2);
  }

  compute(pose: ViewmodelPose, dt: number): void {
    const t = this.tune;
    const ads = clamp(pose.ads, 0, 1);
    const spr = clamp(pose.sprint, 0, 1) * (1 - ads);
    const ms = pose.reducedMotion ? 0.25 : 1;

    // base transform: hip -> ADS, then sprint
    const px = lerp(t.hipPos[0], t.adsPos[0], ads);
    const py = lerp(t.hipPos[1], t.adsPos[1], ads);
    const pz = lerp(t.hipPos[2], t.adsPos[2], ads);
    this.pos.set(
      px + (t.sprintPos[0] - t.hipPos[0]) * spr,
      py + (t.sprintPos[1] - t.hipPos[1]) * spr,
      pz + (t.sprintPos[2] - t.hipPos[2]) * spr,
    );
    this.baseRot.set(
      lerp(t.hipRot[0], t.adsRot[0], ads) + (t.sprintRot[0] - t.hipRot[0]) * spr,
      lerp(t.hipRot[1], t.adsRot[1], ads) + (t.sprintRot[1] - t.hipRot[1]) * spr,
      lerp(t.hipRot[2], t.adsRot[2], ads) + (t.sprintRot[2] - t.hipRot[2]) * spr,
    );

    const d = this.out;
    d.dPos.set(0, 0, 0);
    d.dRot.set(0, 0, 0);

    // movement bob
    const walk = clamp(pose.move, 0, 1) * (1 - 0.85 * ads);
    this.walkBlend += (walk - this.walkBlend) * damp(10, dt);
    const w = this.walkBlend * ms;
    const sprintBoost = 1 + spr * 0.9;
    const bp = pose.bobPhase;
    d.dPos.y += Math.sin(bp * 2) * t.bob.y * w * sprintBoost;
    d.dPos.x += Math.cos(bp) * t.bob.x * w * sprintBoost;
    d.dRot.z += Math.sin(bp) * t.bob.roll * w * sprintBoost;
    d.dRot.x += Math.sin(bp * 2 + 0.6) * t.bob.roll * 0.6 * w;

    // breathing
    const br = (1 - 0.55 * ads) * ms;
    d.dPos.y += Math.sin(pose.time * 1.55) * 0.0011 * br;
    d.dPos.x += Math.sin(pose.time * 0.83 + 1.2) * 0.0007 * br;
    d.dRot.x += Math.sin(pose.time * 1.55 + 0.4) * 0.0018 * br;
    d.dRot.z += Math.sin(pose.time * 0.7) * 0.0014 * br;

    // look sway (weapon lags behind the camera)
    const sw = t.sway;
    const swayScale = (1 - 0.6 * ads) * ms;
    const tx = clamp(-pose.lookYaw * sw.pos, -0.045, 0.045);
    const ty = clamp(-pose.lookPitch * sw.pos, -0.035, 0.035);
    const trY = clamp(-pose.lookYaw * sw.rot, -0.09, 0.09);
    const trX = clamp(pose.lookPitch * sw.rot * 0.8, -0.07, 0.07);
    const a = damp(12, dt);
    this.swayX += (tx - this.swayX) * a;
    this.swayY += (ty - this.swayY) * a;
    this.swayRy += (trY - this.swayRy) * a;
    this.swayRx += (trX - this.swayRx) * a;
    d.dPos.x += this.swayX * swayScale;
    d.dPos.y += this.swayY * swayScale;
    d.dRot.y += this.swayRy * swayScale;
    d.dRot.x += this.swayRx * swayScale;
    d.dRot.z += -this.swayRy * 0.35 * swayScale;

    // crouch, air, landing
    d.dPos.y -= 0.012 * clamp(pose.crouch, 0, 1) * (1 - ads);
    d.dRot.z += 0.03 * clamp(pose.crouch, 0, 1) * (1 - ads);
    d.dPos.y -= 0.02 * clamp(pose.air, -1, 1) * (1 - 0.7 * ads) * ms;
    d.dRot.x += 0.03 * clamp(pose.air, -1, 1) * ms;
    const land = clamp(pose.landing, 0, 1) * ms;
    d.dPos.y -= 0.042 * land;
    d.dRot.x -= 0.1 * land;

    // recoil springs
    this.kz.step(dt);
    this.kp.step(dt);
    this.ky.step(dt);
    this.kr.step(dt);
    const km = pose.reducedMotion ? 0.35 : 1;
    d.dPos.z += this.kz.x * km;
    d.dRot.x += this.kp.x * km;
    d.dRot.y += this.ky.x * km;
    d.dRot.z += this.kr.x * km;

    // draw / holster: rise from below, hands first
    const r = clamp(pose.raise, 0, 1);
    const q = (1 - r) * (1 - r);
    d.dPos.y -= 0.42 * q;
    d.dPos.z += 0.06 * q;
    d.dRot.x -= 0.75 * q;
    d.dRot.z += 0.25 * q;
  }

  /** Write the final transform into `gun`. Rotations in `out.dRot` pivot about the tuning pivot. */
  apply(gun: THREE.Object3D): void {
    _ea.copy(this.baseRot);
    _qa.setFromEuler(_ea);
    _ea.copy(this.out.dRot);
    _qb.setFromEuler(_ea);
    _pivot.copy(this.pivot);
    // position = pos + dPos + qa * (pivot - qb * pivot)
    _va.copy(_pivot).applyQuaternion(_qb).multiplyScalar(-1).add(_pivot).applyQuaternion(_qa);
    gun.position.copy(this.pos).add(this.out.dPos).add(_va);
    gun.quaternion.copy(_qa).multiply(_qb);
    gun.updateMatrix();
  }
}

// ---------------------------------------------------------------------------------------------
// Hand driving
// ---------------------------------------------------------------------------------------------

const _hm = new THREE.Matrix4();
const _hp = new THREE.Vector3();
const _hs = new THREE.Vector3();
const _pm = new THREE.Matrix4();

/** A hand attachment: a transform in gun space. */
export class Anchor {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  constructor(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.set(x, y, z, rx, ry, rz);
  }

  set(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    this.pos.set(x, y, z);
    _ea.set(rx, ry, rz, 'YXZ');
    this.quat.setFromEuler(_ea);
    return this;
  }
}

/** Drives a hand's root transform and forearm from anchors (gun space) or free view-space transforms. */
export class HandDriver {
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  constructor(
    readonly hand: GloveHand,
    /** Elbow anchor in view space (far below the screen edge). */
    readonly elbow: THREE.Vector3,
  ) {}

  /** Place the hand at `anchor` in gun space (uses gun.matrix), optionally blended toward a free view-space transform. */
  place(gun: THREE.Object3D, anchor: Anchor, free?: { pos: THREE.Vector3; quat: THREE.Quaternion; w: number }): void {
    // gun matrix * anchor
    _hm.compose(anchor.pos, anchor.quat, _hs.set(1, 1, 1));
    _pm.copy(gun.matrix).multiply(_hm);
    _pm.decompose(this.p, this.q, _hs);
    if (free && free.w > 0) {
      const w = clamp(free.w, 0, 1);
      this.p.lerp(free.pos, w);
      this.q.slerp(free.quat, w);
    }
    this.commit();
  }

  /** Place the hand at a free view-space transform. */
  placeFree(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.p.copy(pos);
    this.q.copy(quat);
    this.commit();
  }

  private commit(): void {
    const r = this.hand.root;
    r.position.copy(this.p);
    r.quaternion.copy(this.q);
    r.updateMatrix();
    // elbow in hand-local space (respects the mirror scale of the left hand)
    _hp.copy(this.elbow).applyMatrix4(_pm.copy(r.matrix).invert());
    this.hand.aimForearm(_hp.x, _hp.y, _hp.z);
  }
}

// ---------------------------------------------------------------------------------------------
// Base rig
// ---------------------------------------------------------------------------------------------

export interface TierPart {
  obj: THREE.Object3D;
  min: number;
}

export abstract class BaseRig implements ViewmodelRig {
  abstract readonly id: ViewmodelId;
  readonly root = new THREE.Group();
  /** Origin = sight point. Parts and (via anchors) hands are positioned relative to this. */
  readonly gun = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly ejectPort = new THREE.Object3D();
  protected readonly tierParts: TierPart[] = [];
  protected tier = 0;
  protected readonly disposables: { dispose(): void }[] = [];
  protected time = 0;

  constructor(protected readonly mats: RigMaterials) {
    this.root.add(this.gun);
    this.gun.add(this.muzzle, this.ejectPort);
    this.root.visible = false;
  }

  protected addTierPart(obj: THREE.Object3D, min: number): void {
    obj.visible = this.tier >= min;
    this.tierParts.push({ obj, min });
  }

  setTier(tier: number): void {
    this.tier = Math.max(0, Math.min(2, Math.round(tier)));
    for (const p of this.tierParts) p.obj.visible = this.tier >= p.min;
    this.mats.setTier(this.tier);
  }

  abstract update(pose: ViewmodelPose, dt: number): void;
  abstract onFire(tier: number, strength?: number): void;
  abstract reset(): void;

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.mats.dispose();
  }
}


// ---------------------------------------------------------------------------------------------
// Hand keyframing
// ---------------------------------------------------------------------------------------------

/** A hand target in view space. Anchored targets are refreshed from the gun each frame; free ones are constant. */
export class Target {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  private readonly anchor: Anchor | null;
  constructor(anchor: Anchor | null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.anchor = anchor;
    if (!anchor) {
      this.pos.set(x, y, z);
      _ea.set(rx, ry, rz, 'YXZ');
      this.quat.setFromEuler(_ea);
    }
  }

  refresh(gun: THREE.Object3D): void {
    if (!this.anchor) return;
    _hm.compose(this.anchor.pos, this.anchor.quat, _hs.set(1, 1, 1));
    _pm.copy(gun.matrix).multiply(_hm);
    _pm.decompose(this.pos, this.quat, _hs);
  }
}

export interface HandKey {
  t: number;
  target: Target;
  pose: HandPoseName;
}

const _kp = new THREE.Vector3();
const _kq = new THREE.Quaternion();

/**
 * Evaluate a hand keyframe track at `t` (keys sorted by t, smoothstep between). Writes the blended transform into
 * `outPos/outQuat` and the blended finger pose into `outPose`.
 */
export function sampleHandKeys(keys: readonly HandKey[], t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion, outPose: HandPose): void {
  const n = keys.length;
  if (t <= keys[0]!.t) {
    outPos.copy(keys[0]!.target.pos);
    outQuat.copy(keys[0]!.target.quat);
    lerpPose(HAND_POSES[keys[0]!.pose], HAND_POSES[keys[0]!.pose], 0, outPose);
    return;
  }
  if (t >= keys[n - 1]!.t) {
    const k = keys[n - 1]!;
    outPos.copy(k.target.pos);
    outQuat.copy(k.target.quat);
    lerpPose(HAND_POSES[k.pose], HAND_POSES[k.pose], 0, outPose);
    return;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b.t) {
      const u = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
      _kp.copy(a.target.pos);
      outPos.copy(_kp).lerp(b.target.pos, u);
      _kq.copy(a.target.quat);
      outQuat.copy(_kq).slerp(b.target.quat, u);
      lerpPose(HAND_POSES[a.pose], HAND_POSES[b.pose], u, outPose);
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Utility rigs (grenade, plate): no gun, hands drive everything
// ---------------------------------------------------------------------------------------------

export abstract class UtilityRig implements ViewmodelRig {
  abstract readonly id: ViewmodelId;
  readonly root = new THREE.Group();
  protected readonly disposables: { dispose(): void }[] = [];
  protected tier = 0;

  constructor(protected readonly mats: RigMaterials) {
    this.root.visible = false;
  }

  /** Per the contract the muzzle / eject port of utility rigs is the root itself. */
  get muzzle(): THREE.Object3D {
    return this.root;
  }
  get ejectPort(): THREE.Object3D {
    return this.root;
  }

  onFire(): void {}

  setTier(tier: number): void {
    this.tier = Math.max(0, Math.min(2, Math.round(tier)));
    this.mats.setTier(this.tier);
  }

  abstract update(pose: ViewmodelPose, dt: number): void;
  abstract reset(): void;

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.mats.dispose();
  }
}
