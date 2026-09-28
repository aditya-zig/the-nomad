/**
 * Frag grenade throw viewmodel. `pose.action` timeline: hands rise (0-0.14), the support hand hooks the pin ring and
 * pulls the pin (0.14-0.32), the throwing hand winds back (0.32-0.44), swings up and releases (~0.5, the grenade
 * disappears - the game spawns the live projectile), follow-through and withdraw (0.5-1).
 */
import * as THREE from 'three';
import type { ViewmodelPose } from '../viewmodelTypes';
import { GloveHand, HAND_POSES, clonePose, lerpPose, type HandPose } from './hand';
import { PartBuilder } from './kit';
import { RigMaterials, type SharedTextures } from './materials';
import { UtilityRig } from './rigBase';
import { clamp01 } from './util';

/**
 * Monotone cubic (PCHIP) sampling through timed rows [t, v0, v1, ...]: smooth velocity through fast swings, exactly zero
 * velocity on hold segments (equal neighbours) and no overshoot.
 */
export function sampleRows(rows: readonly (readonly number[])[], t: number, out: number[]): void {
  const n = rows.length;
  const cols = rows[0]!.length - 1;
  if (t <= rows[0]![0]!) {
    for (let c = 0; c < cols; c++) out[c] = rows[0]![c + 1]!;
    return;
  }
  if (t >= rows[n - 1]![0]!) {
    for (let c = 0; c < cols; c++) out[c] = rows[n - 1]![c + 1]!;
    return;
  }
  let i = 0;
  while (i < n - 2 && t > rows[i + 1]![0]!) i++;
  const r0 = rows[i]!;
  const r1 = rows[i + 1]!;
  const dt = r1[0]! - r0[0]!;
  const u = (t - r0[0]!) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const slope = (a: readonly number[], b: readonly number[], c: number): number => (b[c]! - a[c]!) / (b[0]! - a[0]!);
  for (let c = 1; c <= cols; c++) {
    const dCur = slope(r0, r1, c);
    let m0 = 0;
    let m1 = 0;
    if (i > 0) {
      const dPrev = slope(rows[i - 1]!, r0, c);
      m0 = dPrev * dCur > 0 ? (2 * dPrev * dCur) / (dPrev + dCur) : 0;
    }
    if (i + 1 < n - 1) {
      const dNext = slope(r1, rows[i + 2]!, c);
      m1 = dCur * dNext > 0 ? (2 * dCur * dNext) / (dCur + dNext) : 0;
    }
    out[c - 1] = h00 * r0[c]! + h10 * m0 * dt + h01 * r1[c]! + h11 * m1 * dt;
  }
}

const PI = Math.PI;
// throwing hand (right): t, x, y, z, rx, ry, rz, curl(0..1)
const RH_ROWS: number[][] = [
  [0.0, 0.14, -0.5, -0.24, 0.3, 0.3, PI - 0.3, 0.5],
  [0.14, 0.09, -0.16, -0.31, -0.15, 0.4, PI - 0.4, 1.0],
  [0.34, 0.09, -0.16, -0.31, -0.15, 0.4, PI - 0.4, 1.0],
  [0.44, 0.19, -0.27, -0.22, 0.3, 0.25, PI - 0.15, 1.0],
  [0.5, 0.075, -0.12, -0.44, 0.85, 0.12, PI, 0.9],
  [0.6, 0.03, -0.03, -0.6, 1.25, 0.0, PI, 0.05],
  [0.78, 0.07, -0.28, -0.45, 0.7, 0.15, PI - 0.2, 0.15],
  [1.0, 0.13, -0.55, -0.3, 0.4, 0.25, PI - 0.3, 0.25],
];
// support hand (left) offsets from the ring, in view space: t, x, y, z, ry(yaw of fingers), rz, pose weight (0 open,1 hook)
const HOOK_POSE: HandPose = {
  index: { c: [0.55, 0.85, 0.5], splay: 0.02 },
  middle: { c: [1.3, 1.5, 1.0], splay: 0 },
  ring: { c: [1.35, 1.5, 1.0], splay: -0.02 },
  pinky: { c: [1.4, 1.5, 1.0], splay: -0.04 },
  thumb: { bx: 0.4, by: 0.3, bz: 0.2, c1: 0.4, c2: 0.4 },
};
const LH_ROWS: number[][] = [
  [0.0, -0.3, -0.5, -0.2, 0.0, 0.25],
  [0.1, -0.2, -0.28, -0.26, 0.0, 0.25],
  [0.16, 0.0, 0.0, 0.0, 1.0, 0.0],
  [0.32, -0.11, -0.02, 0.06, 1.0, 0.0],
  [0.4, -0.22, -0.2, 0.0, 0.5, 0.0],
  [0.5, -0.35, -0.5, -0.2, 0.2, 0.25],
];

export class GrenadeRig extends UtilityRig {
  readonly id = 'grenade' as const;
  private readonly rh: GloveHand;
  private readonly lh: GloveHand;
  private readonly grenade: THREE.Group;
  private readonly pin: THREE.Group;
  private readonly lever: THREE.Group;
  private readonly tmp = [0, 0, 0, 0, 0, 0, 0];
  private readonly tmpL = [0, 0, 0, 0, 0, 0];
  private readonly qA = new THREE.Quaternion();
  private readonly eA = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly mA = new THREE.Matrix4();
  private readonly poseA: HandPose = clonePose(HAND_POSES.hold);
  private readonly poseB: HandPose = clonePose(HAND_POSES.hold);
  private readonly ringLocal = new THREE.Vector3(-0.0265, 0.052, 0);
  private readonly tipLocal = new THREE.Vector3(-0.032, 0.0, -0.176);
  private readonly elbowR = new THREE.Vector3(0.3, -0.6, 0.3);
  private readonly elbowL = new THREE.Vector3(-0.3, -0.6, 0.3);
  private pinParent: 'grenade' | 'hand' = 'grenade';

  constructor(tex: SharedTextures) {
    super(new RigMaterials(tex));
    const mats = this.mats;
    const mk = (k: string) => mats.get(k);
    this.rh = new GloveHand({ side: 'right', seed: 33 }, mats);
    this.lh = new GloveHand({ side: 'left', watch: true, seed: 35 }, mats);
    this.root.add(this.rh.root, this.lh.root);
    this.disposables.push(this.rh, this.lh);

    // ---- grenade body ---------------------------------------------------------------------
    const gb = new PartBuilder();
    buildGrenade(gb);
    this.grenade = gb.build(mk, { oliveMetal: 30, steel: 9, blued: 9, yellow: 20 });
    this.disposables.push(gb);
    // ball rests in the palm (hand-local -Y is the palm side) with the fuse pointing away from the palm
    this.grenade.position.set(0, -0.049, -0.052);
    this.grenade.rotation.set(0, 0, PI);
    this.rh.root.add(this.grenade);

    const lv = new PartBuilder();
    buildLever(lv);
    this.lever = lv.build(mk, { steel: 9 });
    this.grenade.add(this.lever);
    this.disposables.push(lv);

    const pn = new PartBuilder();
    buildPin(pn);
    this.pin = pn.build(mk, { steel: 9 });
    this.pin.position.copy(this.ringLocal);
    this.grenade.add(this.pin);
    this.disposables.push(pn);
    this.setTier(0);
  }

  reset(): void {
    this.setPinParent('grenade');
  }

  private setPinParent(p: 'grenade' | 'hand'): void {
    if (p === this.pinParent) return;
    this.pinParent = p;
    if (p === 'grenade') {
      this.grenade.add(this.pin);
      this.pin.position.copy(this.ringLocal);
      this.pin.quaternion.identity();
    } else {
      this.lh.root.add(this.pin);
      this.pin.position.copy(this.tipLocal);
      this.pin.quaternion.identity();
    }
  }

  update(pose: ViewmodelPose, dt: number): void {
    void dt;
    const a = clamp01(pose.action);
    const vis = pose.raise > 0.015 && a < 0.999;
    this.root.visible = vis;
    if (!vis) return;

    // ---- throwing hand ----
    sampleRows(RH_ROWS, a, this.tmp);
    const x = this.tmp[0]!;
    const y = this.tmp[1]!;
    const z = this.tmp[2]!;
    const rx = this.tmp[3]!;
    const ry = this.tmp[4]!;
    const rz = this.tmp[5]!;
    const curl = this.tmp[6]!;
    const ms = pose.reducedMotion ? 0.35 : 1;
    const tremor = Math.sin(pose.time * 9) * 0.0015 * ms * (a > 0.14 && a < 0.34 ? 1 : 0);
    this.rh.root.position.set(x + tremor, y, z);
    this.eA.set(rx, ry, rz, 'YXZ');
    this.rh.root.quaternion.setFromEuler(this.eA);
    this.rh.root.updateMatrix();
    this.rh.root.updateMatrixWorld(true);
    lerpPose(HAND_POSES.open, HAND_POSES.hold, clamp01(curl), this.poseA);
    this.rh.setPose(this.poseA);
    this.aim(this.rh, this.elbowR);
    // grenade is only visible until release
    this.grenade.visible = a < 0.505;
    // the lever stays clamped until release (hidden with the grenade)

    // ---- support hand: hook the ring (view-space ring position), pull, retreat ----
    sampleRows(LH_ROWS, a, this.tmpL);
    const ox = this.tmpL[0]!;
    const oy = this.tmpL[1]!;
    const oz = this.tmpL[2]!;
    const hook = this.tmpL[3]!;
    const off = this.tmpL[4]!;
    this.vA.copy(this.ringLocal);
    this.grenade.updateMatrixWorld(true);
    this.grenade.localToWorld(this.vA); // ring in view space (root is at the origin, identity)
    // wrist target so that the index tip (tipLocal rotated by the hand orientation) sits on the ring
    const yaw = -PI / 2 + 0.25;
    this.eA.set(0.1, yaw, PI / 2, 'YXZ');
    this.qA.setFromEuler(this.eA);
    this.vB.copy(this.tipLocal).multiplyScalar(-1);
    // tip in root space when the hand is rotated by qA: wrist = ring - qA*tip
    this.vB.copy(this.tipLocal).applyQuaternion(this.qA).multiplyScalar(-1).add(this.vA);
    this.vB.x += ox;
    this.vB.y += oy;
    this.vB.z += oz;
    this.lh.root.position.copy(this.vB);
    this.lh.root.quaternion.copy(this.qA);
    this.lh.root.updateMatrix();
    this.lh.root.updateMatrixWorld(true);
    // approach/retreat orientation relaxes when far from the ring (off > 0)
    if (off > 0) {
      this.eA.set(0.3 * off, yaw + 0.4 * off, PI / 2 - 0.2 * off, 'YXZ');
      this.lh.root.quaternion.setFromEuler(this.eA);
      this.lh.root.updateMatrix();
    }
    lerpPose(HAND_POSES.open, HOOK_POSE, clamp01(hook + (off > 0 ? 0.0 : 0)) * 0.999 + 0.0, this.poseB);
    if (hook < 0.5) lerpPose(HAND_POSES.relaxed, HOOK_POSE, clamp01(hook * 2), this.poseB);
    this.lh.setPose(this.poseB);
    this.aim(this.lh, this.elbowL);
    this.lh.root.visible = a < 0.5;

    // ---- pin ----
    const pinOnHand = a >= 0.16 && a < 0.34;
    this.setPinParent(pinOnHand ? 'hand' : 'grenade');
    this.pin.visible = a < 0.34 || this.pinParent === 'grenade' ? a < 0.34 : false;
    this.mats.pulse(pose.time);
    this.root.updateMatrixWorld(true);
  }

  private readonly _e = new THREE.Vector3();
  /** Aim the hand's sleeved forearm toward an elbow point given in view space. */
  private aim(hand: GloveHand, elbow: THREE.Vector3): void {
    this.mA.copy(hand.root.matrix).invert();
    this._e.copy(elbow).applyMatrix4(this.mA);
    hand.aimForearm(this._e.x, this._e.y, this._e.z);
  }
}

// -------------------------------------------------------------------------------------------------

function buildGrenade(b: PartBuilder): void {
  // body (slightly egg-shaped)
  b.sphere('oliveMetal', 0.0322, 0, 0, 0, 1, 1.07, 1, 20);
  // latitude grooves and marking band
  b.torus('blued', 0.0296, 0.0011, 0, -0.012, 0, { rx: Math.PI / 2 }, 20);
  b.torus('blued', 0.0296, 0.0011, 0, -0.024, 0, { rx: Math.PI / 2 }, 20);
  b.torus('yellow', 0.0296, 0.0028, 0, 0.012, 0, { rx: Math.PI / 2 }, 22);
  // neck, fuse body, cap
  b.cyl('steel', 0.0135, 0.0165, 0.018, 0, 0.036, 0, 'y', 16);
  b.cyl('blued', 0.0108, 0.0118, 0.026, 0, 0.053, 0, 'y', 16);
  b.cyl('steel', 0.0092, 0.0092, 0.005, 0, 0.0675, 0, 'y', 14);
  // striker groove
  b.torus('steel', 0.0116, 0.0012, 0, 0.045, 0, { rx: Math.PI / 2 }, 16);
}

function buildLever(b: PartBuilder): void {
  // safety lever: hugs the body on the +X side, hinged at the fuse
  b.box('steel', 0.036, 0.0032, 0.017, 0.016, 0.0655, 0, 0.0008);
  b.box('steel', 0.0032, 0.078, 0.017, 0.0335, 0.03, 0, 0.0008, { rz: -0.1 });
  b.box('steel', 0.0032, 0.014, 0.019, 0.0338, -0.012, 0, 0.0008);
}

function buildPin(b: PartBuilder): void {
  // pull ring (torus) with the cotter pin running back through the fuse (+X)
  b.torus('steel', 0.0105, 0.0016, -0.0085, 0, 0, { ry: Math.PI / 2 }, 18);
  b.cyl('steel', 0.0012, 0.0012, 0.034, 0.012, 0, 0, 'x', 6);
}

export function createGrenade(tex: SharedTextures): GrenadeRig {
  return new GrenadeRig(tex);
}
