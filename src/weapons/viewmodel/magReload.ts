/**
 * Magazine reload choreography shared by the rifle and pistol.
 *
 * The support hand follows a keyframe track (grab -> pull -> toss -> pouch -> fetch -> insert -> slap -> return). The
 * magazine object is re-parented between the gun and the hand at instants where the hand sits exactly on the grab
 * anchor, so the swap is invisible. A second copy of the magazine falls under gravity after the toss.
 */
import * as THREE from 'three';
import type { GloveHand, HandPose } from './hand';
import { HAND_POSES, clonePose } from './hand';
import type { HandDriver, HandKey, Target } from './rigBase';
import { sampleHandKeys } from './rigBase';

export interface MagReloadCfg {
  root: THREE.Object3D;
  gun: THREE.Object3D;
  hand: GloveHand;
  driver: HandDriver;
  /** The magazine (child of the gun while seated) and its falling duplicate. */
  mag: THREE.Object3D;
  dropMag: THREE.Object3D;
  /** Transform of the magazine relative to the hand root (inverse of the grab anchor times the seated transform). */
  magInHand: THREE.Matrix4;
  /** Transform of the magazine relative to the gun when seated. */
  seat: THREE.Matrix4;
  /** Target that positions the hand at the toss point (used to launch the falling magazine). */
  tossTarget: Target;
  keysTactical: HandKey[];
  keysEmpty: HandKey[];
  /** [start, end) reload times during which the magazine is held by the hand. */
  holdWindows: [number, number][];
  /** [start, end) during which the magazine is out of sight (dropped / being fetched). */
  hiddenWindow: [number, number];
  /** [start, end) during which the dropped magazine falls. */
  fallWindow: [number, number];
  /** Fall motion in view space per unit of `tau` (normalised reload time * fallScale). */
  fallVel: [number, number, number];
  fallGravity: number;
  fallScale: number;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

export class MagReloader {
  private parent: 'gun' | 'hand' = 'gun';
  readonly outPos = new THREE.Vector3();
  readonly outQuat = new THREE.Quaternion();
  readonly outPose: HandPose = clonePose(HAND_POSES.grip);

  constructor(private readonly c: MagReloadCfg) {}

  private setParent(p: 'gun' | 'hand'): void {
    if (p === this.parent) return;
    this.parent = p;
    const mag = this.c.mag;
    if (p === 'gun') {
      this.c.gun.add(mag);
      mag.matrixAutoUpdate = false;
      mag.matrix.copy(this.c.seat);
      mag.matrixWorldNeedsUpdate = true;
    } else {
      this.c.hand.root.add(mag);
    }
  }

  reset(): void {
    this.setParent('gun');
    this.c.mag.visible = true;
    this.c.dropMag.visible = false;
  }

  /** Not reloading: mag seated, no falling copy. */
  idle(): void {
    this.setParent('gun');
    this.c.mag.visible = true;
    this.c.dropMag.visible = false;
  }

  /** Drive the support hand and magazine at reload progress `t`. Call after the gun matrix and targets are refreshed. */
  update(t: number, empty: boolean): void {
    const c = this.c;
    sampleHandKeys(empty ? c.keysEmpty : c.keysTactical, t, this.outPos, this.outQuat, this.outPose);
    c.hand.setPose(this.outPose);
    c.driver.placeFree(this.outPos, this.outQuat);

    let held = false;
    for (const [a, b] of c.holdWindows) if (t >= a && t < b) held = true;
    this.setParent(held ? 'hand' : 'gun');
    if (held) {
      c.mag.matrixAutoUpdate = false;
      c.mag.matrix.copy(c.magInHand);
      c.mag.matrixWorldNeedsUpdate = true;
    }
    c.mag.visible = !(t >= c.hiddenWindow[0] && t < c.hiddenWindow[1]);

    const fall = t >= c.fallWindow[0] && t < c.fallWindow[1];
    c.dropMag.visible = fall;
    if (fall) {
      const tau = (t - c.fallWindow[0]) * c.fallScale;
      _m2.compose(c.tossTarget.pos, c.tossTarget.quat, _s);
      _m.copy(_m2).multiply(c.magInHand);
      const e = _m.elements;
      e[12]! += c.fallVel[0] * tau;
      e[13]! += c.fallVel[1] * tau - c.fallGravity * tau * tau;
      e[14]! += c.fallVel[2] * tau;
      c.dropMag.matrixAutoUpdate = false;
      c.dropMag.matrix.copy(_m);
      c.dropMag.matrixWorldNeedsUpdate = true;
    }
  }
}
