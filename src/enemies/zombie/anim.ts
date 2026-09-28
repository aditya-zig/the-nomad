/**
 * Procedural animation: writes bone Euler angles (XYZ order, bone-local, radians) into a pose array.
 *
 * Bone-local axis conventions (bind pose: +X = character's right, +Y up, model faces -Z):
 *  - spine / chest / neck / head / pelvis:  +X leans BACK, -X leans forward; +Y turns left; +Z tilts toward the left.
 *  - arms hanging down:  +X swings FORWARD; abduction (raise sideways) = +Z for the right arm, -Z for the left arm.
 *  - elbow: +X flexes (forearm comes forward / up).      - hip: +X swings the thigh forward.
 *  - knee: -X flexes (heel toward the buttock).           - ankle: +X lifts the toes.   - jaw: -X opens the mouth.
 */
import type { ZombieType } from '../../types';
import type { ZombieAnimState } from '../zombieRigTypes';
import { B, NB } from './dims';
import { clamp, ihash, lerp, smoothstep } from './prng';

export const POSE_LEN = NB * 3 + 3;
/** Offset of the pelvis translation block inside the pose array. */
export const PO = NB * 3;

export interface Tune {
  leanIdle: number;
  leanWalk: number;
  leanRun: number;
  neckDrop: number;
  headCounter: number;
  armFwdIdle: number;
  armFwdWalk: number;
  armFwdRun: number;
  elbowIdle: number;
  elbowWalk: number;
  elbowRun: number;
  spread: number;
  hip0: number;
  hip1: number;
  hipMin: number;
  hipMax: number;
  kneeWalk: number;
  kneeRun: number;
  armSwing0: number;
  armSwing1: number;
  armSwingMax: number;
  twist: number;
  bounce: number;
  idleSway: number;
  jawIdle: number;
  /** Strength of head twitch events. */
  twitch: number;
  /** Reach of arms when attacking (shoulder flexion at strike). */
  reach: number;
}

export const TUNES: Record<ZombieType, Tune> = {
  shambler: { leanIdle: 0.36, leanWalk: 0.44, leanRun: 0.6, neckDrop: 0.28, headCounter: 0.2, armFwdIdle: 0.55, armFwdWalk: 0.95, armFwdRun: 1.0, elbowIdle: 0.85, elbowWalk: 1.2, elbowRun: 1.2, spread: 0.12, hip0: 0.2, hip1: 0.2, hipMin: 0.15, hipMax: 0.62, kneeWalk: 0.85, kneeRun: 1.2, armSwing0: 0.1, armSwing1: 0.06, armSwingMax: 0.35, twist: 0.1, bounce: 0.0, idleSway: 0.05, jawIdle: 0.42, twitch: 1, reach: 1.45 },
  runner: { leanIdle: 0.4, leanWalk: 0.46, leanRun: 0.7, neckDrop: 0.14, headCounter: 0.28, armFwdIdle: 0.4, armFwdWalk: 0.6, armFwdRun: 0.4, elbowIdle: 0.8, elbowWalk: 1.0, elbowRun: 1.35, spread: 0.1, hip0: 0.3, hip1: 0.13, hipMin: 0.2, hipMax: 1.0, kneeWalk: 0.9, kneeRun: 1.75, armSwing0: 0.3, armSwing1: 0.12, armSwingMax: 1.15, twist: 0.16, bounce: 0.06, idleSway: 0.08, jawIdle: 0.5, twitch: 1.6, reach: 1.6 },
  armored: { leanIdle: 0.16, leanWalk: 0.22, leanRun: 0.34, neckDrop: 0.1, headCounter: 0.12, armFwdIdle: 0.28, armFwdWalk: 0.5, armFwdRun: 0.6, elbowIdle: 0.65, elbowWalk: 0.85, elbowRun: 0.9, spread: 0.2, hip0: 0.18, hip1: 0.18, hipMin: 0.12, hipMax: 0.55, kneeWalk: 0.7, kneeRun: 0.95, armSwing0: 0.08, armSwing1: 0.05, armSwingMax: 0.3, twist: 0.08, bounce: 0.0, idleSway: 0.035, jawIdle: 0.34, twitch: 0.7, reach: 1.35 },
  warden: { leanIdle: 0.4, leanWalk: 0.42, leanRun: 0.8, neckDrop: 0.08, headCounter: 0.12, armFwdIdle: 0.3, armFwdWalk: 0.5, armFwdRun: 0.2, elbowIdle: 0.5, elbowWalk: 0.7, elbowRun: 1.0, spread: 0.3, hip0: 0.22, hip1: 0.14, hipMin: 0.15, hipMax: 0.75, kneeWalk: 0.75, kneeRun: 1.05, armSwing0: 0.2, armSwing1: 0.05, armSwingMax: 0.5, twist: 0.1, bounce: 0.04, idleSway: 0.03, jawIdle: 0.26, twitch: 0.4, reach: 1.3 },
};

/** Per-instance randomisation. */
export interface Inst {
  seed: number;
  phase: number;
  gait: number;
  lean: number;
  headRoll: number;
  headYaw: number;
  armCarry: number;
  limp: number;
  twitchOff: number;
  swayOff: number;
  side: number;
  legScale: number;
  armScale: number;
  flop: number[];
}

export interface RigAnimState {
  type: ZombieType;
  tune: Tune;
  inst: Inst;
  /** Leg length (hip to sole) in metres for cadence matching. */
  legLen: number;
  /** Bind-pose arm abduction (radians) already baked into the mesh. */
  bindArm: number;
  phase: number;
  runK: number;
  chargeK: number;
  spSm: number;
  wAttack: number;
  wStagger: number;
  wRoar: number;
  wSlam: number;
  deathStarted: boolean;
  deathFrom: Float32Array;
  out: Float32Array;
}

export function makeRigAnimState(type: ZombieType, legLen: number, bindArm: number): RigAnimState {
  return {
    type,
    tune: TUNES[type],
    inst: { seed: 0, phase: 0, gait: 1, lean: 0, headRoll: 0, headYaw: 0, armCarry: 0, limp: 0, twitchOff: 0, swayOff: 0, side: 1, legScale: 1, armScale: 1, flop: [0, 0, 0, 0, 0, 0] },
    legLen,
    bindArm,
    phase: 0,
    runK: 0,
    chargeK: 0,
    spSm: 0,
    wAttack: 0,
    wStagger: 0,
    wRoar: 0,
    wSlam: 0,
    deathStarted: false,
    deathFrom: new Float32Array(POSE_LEN),
    out: new Float32Array(POSE_LEN),
  };
}

const BASE = new Float32Array(POSE_LEN);
const MODE = new Float32Array(POSE_LEN);
const FINAL = new Float32Array(POSE_LEN);

const set = (P: Float32Array, b: number, x: number, y: number, z: number): void => {
  P[b * 3] = x;
  P[b * 3 + 1] = y;
  P[b * 3 + 2] = z;
};
const addv = (P: Float32Array, b: number, x: number, y: number, z: number): void => {
  P[b * 3] = P[b * 3]! + x;
  P[b * 3 + 1] = P[b * 3 + 1]! + y;
  P[b * 3 + 2] = P[b * 3 + 2]! + z;
};

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number): number => t * t * (3 - 2 * t);

function twitchEnv(time: number, R: RigAnimState, rate: number): { env: number; dir: number } {
  const tt = time * rate + R.inst.twitchOff;
  const k = Math.floor(tt);
  const f = tt - k;
  const on = ihash(k, R.inst.seed, 3) > 0.55 ? 1 : 0;
  const env = on * Math.exp(-f * 12) * (f < 0.4 ? 1 : 0) * Math.sin(Math.min(1, f * 6) * Math.PI * 0.5);
  return { env, dir: ihash(k, R.inst.seed, 5) > 0.5 ? 1 : -1 };
}

// ---------------------------------------------------------------------------------------------------------
// locomotion (idle / walk / run / charge share one continuous pose)
// ---------------------------------------------------------------------------------------------------------

function locomotion(P: Float32Array, R: RigAnimState, s: ZombieAnimState, dt: number): void {
  const T = R.tune;
  const I = R.inst;
  const sp = R.spSm;
  const moveAmt = smoothstep(0.05, 1.2, sp);
  const runK = R.runK;
  const chargeK = R.chargeK;
  const t = s.time + I.phase;

  // ---- gait phase: cadence chosen so stride length matches ground speed ----
  const hipAmp = clamp((T.hip0 + T.hip1 * sp) * I.gait, T.hipMin, T.hipMax) * (0.55 + 0.45 * moveAmt);
  const stepLen = Math.max(0.2, 2 * R.legLen * Math.sin(Math.min(1.3, hipAmp)));
  const stepsPerSec = clamp(sp / stepLen, 0.0, 4.4);
  R.phase += stepsPerSec * Math.PI * dt;
  if (R.phase > 6283.185) R.phase -= 6283.185;
  const phi = R.phase + I.phase;

  // ---- spine posture ----
  const leanBase = lerp(lerp(T.leanIdle, T.leanWalk, moveAmt), T.leanRun, runK);
  const lean = leanBase + I.lean + chargeK * 0.25 + s.aggro * 0.06;
  const sway = T.idleSway * (1 - moveAmt * 0.5);
  const swayX = Math.sin(t * 0.7 + I.swayOff) * sway;
  const swayZ = Math.sin(t * 0.53 + I.swayOff * 1.7) * sway * 0.8;
  const breathe = Math.sin(t * 1.6) * 0.012;
  const twist = T.twist * moveAmt * Math.sin(phi) * (0.6 + 0.4 * runK);
  set(P, B.pelvis, 0, twist, Math.cos(phi) * 0.05 * moveAmt * (1 + Math.abs(I.limp) * 0.6) + swayZ * 0.4);
  set(P, B.spine, -lean * 0.55 + swayX * 0.5 + breathe, -twist * 0.7, -swayZ * 0.5 + I.headRoll * 0.1);
  set(P, B.chest, -lean * 0.5 + swayX * 0.5 - breathe, -twist * 0.5, -swayZ * 0.4 + I.headRoll * 0.1);

  // ---- neck & head: droop, roll, occasional twitch ----
  const tw = twitchEnv(s.time, R, 0.28 + s.aggro * 0.35);
  const drop = T.neckDrop + 0.08 * Math.sin(t * 0.9 + 1.3);
  const headPitch = -(drop * 0.6) + T.headCounter * lean;
  set(P, B.neck, -drop * 0.4 - lean * 0.12, I.headYaw * 0.5 + tw.env * tw.dir * 0.35 * T.twitch, I.headRoll * 0.5 + Math.sin(t * 0.6) * 0.06);
  set(P, B.head, headPitch + tw.env * 0.16 * T.twitch + s.aggro * 0.12, I.headYaw * 0.5 + tw.env * tw.dir * 0.3 * T.twitch + Math.sin(t * 0.37 + 2) * 0.08, I.headRoll * 0.5 + Math.sin(t * 0.8 + 3) * 0.05 + tw.env * tw.dir * 0.12);
  set(P, B.jaw, -(T.jawIdle + 0.06 * Math.sin(t * 2.1) + 0.28 * s.aggro * (0.5 + 0.5 * Math.sin(t * 9)) + 0.15 * runK), 0, 0);

  // ---- arms ----
  const swingAmp = Math.min(T.armSwingMax, T.armSwing0 + T.armSwing1 * sp) * moveAmt * lerp(1, 1.5, runK);
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR;
    const el = side < 0 ? B.elL : B.elR;
    const ha = side < 0 ? B.haL : B.haR;
    // the left arm swings opposite to the left leg (leg phase phi), the right arm with phase phi + pi
    const ph = side < 0 ? phi + Math.PI : phi;
    const swing = swingAmp * Math.sin(ph);
    const fwd = lerp(lerp(T.armFwdIdle, T.armFwdWalk, moveAmt), T.armFwdRun, runK) + I.armCarry + side * 0.12 * I.side - chargeK * 1.4;
    const idleDangle = Math.sin(t * 0.9 + side * 1.3 + I.swayOff) * 0.05 * (1 - moveAmt);
    const elbow = lerp(lerp(T.elbowIdle, T.elbowWalk, moveAmt), T.elbowRun, runK) + 0.28 * Math.max(0, swing) * (1 + runK) + (side * I.side > 0 ? 0.18 : -0.06) + chargeK * 0.3;
    set(P, sh, fwd + swing + idleDangle, 0, side * (T.spread - R.bindArm + 0.06 * Math.abs(swing) + 0.05 * chargeK + 0.03 * Math.sin(t * 1.1 + side)));
    set(P, el, elbow, 0, 0);
    set(P, ha, -0.3 + 0.25 * Math.sin(ph + 1) * moveAmt, side * 0.2, -side * 0.12);
  }

  // ---- legs ----
  const kneeK = lerp(T.kneeWalk, T.kneeRun, runK) * (0.35 + 0.65 * moveAmt);
  for (const side of [-1, 1] as const) {
    const hp = side < 0 ? B.hipL : B.hipR;
    const kn = side < 0 ? B.knL : B.knR;
    const an = side < 0 ? B.anL : B.anR;
    const p = side < 0 ? phi : phi + Math.PI;
    const sn = Math.sin(p);
    const cs = Math.cos(p);
    const dragging = I.limp === side ? 1 : 0;
    const amp = hipAmp * (dragging ? 0.6 : 1);
    const hip = amp * sn * moveAmt + (1 - moveAmt) * (side * 0.03 + 0.03 * Math.sin(t * 0.5 + side));
    const swingPhase = Math.max(0, cs);
    const knee = kneeK * Math.pow(swingPhase, 1.25) * (dragging ? 0.4 : 1) + 0.06 + 0.05 * moveAmt * Math.max(0, -sn);
    const plant = smoothstep(0.25, -0.35, cs);
    const ankle = -(hip - knee) * (0.55 + 0.45 * plant) + (1 - plant) * 0.14 - dragging * (0.32 + 0.2 * Math.max(0, cs)) + runK * 0.12 * (1 - plant);
    set(P, hp, hip, side * 0.02 * moveAmt, side * (0.03 + 0.03 * (1 - runK)));
    set(P, kn, -knee, 0, 0);
    set(P, an, ankle, 0, 0);
  }

  // ---- pelvis translation (ground contact supplies the vertical component) ----
  P[PO] = Math.sin(phi) * 0.022 * moveAmt + swayZ * 0.15;
  P[PO + 1] = T.bounce * runK * Math.abs(Math.sin(phi)) * moveAmt;
  P[PO + 2] = -lean * 0.05;
}

// ---------------------------------------------------------------------------------------------------------
// overlay modes (absolute poses derived from the base; blended by weight)
// ---------------------------------------------------------------------------------------------------------

function attackPose(P: Float32Array, R: RigAnimState, a: number): void {
  const T = R.tune;
  const I = R.inst;
  // windup [0, .55): rear back, arms up; strike [.55, .72): lunge; recovery [.72, 1]
  const wind = easeOut(clamp(a / 0.55, 0, 1));
  const strike = easeInOut(clamp((a - 0.55) / 0.17, 0, 1));
  const rec = easeInOut(clamp((a - 0.72) / 0.28, 0, 1));
  const lean = lerp(lerp(-0.3 * wind, 0.85, strike), 0, rec);
  const armUp = a < 0.55 ? lerp(0.3, 1.85, wind) : lerp(1.85, T.reach, strike);
  const armPose = lerp(armUp, 0.3, rec);
  const up = a < 0.55 ? wind : 1 - strike;
  const dip = 0.06 * strike * (1 - rec);
  addv(P, B.spine, -lean * 0.5, 0, 0);
  addv(P, B.chest, -lean * 0.55, I.side * 0.15 * strike, 0);
  addv(P, B.neck, -lean * 0.15 + 0.18 * up * (1 - rec), 0, 0);
  addv(P, B.head, 0.1 * up * (1 - rec) - 0.12 * strike, 0, 0);
  set(P, B.jaw, -(0.55 * (0.4 + 0.6 * Math.max(up, strike)) * (1 - rec * 0.7)), 0, 0);
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR;
    const el = side < 0 ? B.elL : B.elR;
    set(P, sh, armPose, 0, side * (0.18 + 0.25 * (1 - strike) - R.bindArm));
    set(P, el, lerp(lerp(1.0, 0.3, strike), P[el * 3]!, rec), 0, 0);
  }
  const front = I.side > 0 ? B.hipL : B.hipR;
  const back = I.side > 0 ? B.hipR : B.hipL;
  addv(P, front, 0.5 * strike * (1 - rec) + 0.1 * wind * (1 - strike), 0, 0);
  addv(P, back, -0.3 * strike * (1 - rec), 0, 0);
  P[PO + 2] = P[PO + 2]! + (0.1 * wind * (1 - strike) - 0.2 * strike) * (1 - rec);
  P[PO + 1] = P[PO + 1]! - dip;
}

function staggerPose(P: Float32Array, R: RigAnimState, t: number): void {
  const I = R.inst;
  const b = t < 0.25 ? easeOut(t / 0.25) : 1 - easeInOut((t - 0.25) / 0.75);
  addv(P, B.spine, 0.45 * b, 0.25 * b * I.side, 0.1 * b * I.side);
  addv(P, B.chest, 0.25 * b, -0.2 * b * I.side, 0);
  addv(P, B.neck, 0.3 * b, 0, 0);
  addv(P, B.head, 0.35 * b, 0.15 * b * I.side, 0);
  set(P, B.jaw, -0.5 * b, 0, 0);
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR;
    const el = side < 0 ? B.elL : B.elR;
    addv(P, sh, 1.0 * b, 0, side * 0.5 * b);
    addv(P, el, 0.5 * b, 0, 0);
    const hp = side < 0 ? B.hipL : B.hipR;
    const kn = side < 0 ? B.knL : B.knR;
    addv(P, hp, (side * I.side > 0 ? 0.5 : -0.25) * b, 0, 0);
    addv(P, kn, -0.45 * b, 0, 0);
  }
  P[PO + 2] = P[PO + 2]! + 0.16 * b;
}

function roarPose(P: Float32Array, R: RigAnimState, a: number, time: number): void {
  const env = smoothstep(0, 0.22, a) * (1 - smoothstep(0.82, 1, a));
  const shake = Math.sin(time * 70) * 0.025 * env;
  addv(P, B.spine, 0.22 * env, 0, shake);
  addv(P, B.chest, 0.28 * env, 0, -shake);
  addv(P, B.neck, 0.35 * env, 0, 0);
  addv(P, B.head, 0.55 * env + shake, 0, 0);
  set(P, B.jaw, -0.8 * env, 0, 0);
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR;
    const el = side < 0 ? B.elL : B.elR;
    set(P, sh, lerp(P[sh * 3]!, 0.35, env), 0, side * lerp(Math.abs(P[sh * 3 + 2]!), 1.15 - R.bindArm, env));
    set(P, el, lerp(P[el * 3]!, 0.55, env), 0, 0);
  }
  P[PO + 1] = P[PO + 1]! + 0.02 * env;
}

function slamPose(P: Float32Array, R: RigAnimState, a: number): void {
  const wind = easeOut(clamp(a / 0.55, 0, 1));
  const strike = easeInOut(clamp((a - 0.55) / 0.17, 0, 1));
  const rec = easeInOut(clamp((a - 0.78) / 0.22, 0, 1));
  const arms = a < 0.55 ? lerp(0.3, 2.9, wind) : lerp(2.9, 0.35, strike);
  const lean = a < 0.55 ? lerp(0, -0.35, wind) : lerp(-0.35, 0.95, strike);
  const crouch = a < 0.55 ? 0.15 * wind : lerp(0.15, 0.6, strike);
  const shudder = a > 0.72 ? Math.exp(-(a - 0.72) * 14) * Math.sin((a - 0.72) * 90) * 0.06 : 0;
  const k = 1 - rec;
  addv(P, B.spine, -lean * 0.5 * k + shudder, 0, 0);
  addv(P, B.chest, -lean * 0.5 * k - shudder, 0, 0);
  addv(P, B.neck, -lean * 0.12 * k, 0, 0);
  addv(P, B.head, (a < 0.55 ? 0.3 * wind : -0.3 * strike) * k, 0, 0);
  set(P, B.jaw, -0.7 * Math.min(1, wind + strike) * k, 0, 0);
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR;
    const el = side < 0 ? B.elL : B.elR;
    set(P, sh, lerp(P[sh * 3]!, arms, k), 0, side * lerp(Math.abs(P[sh * 3 + 2]!), 0.32 - R.bindArm, k));
    set(P, el, lerp(P[el * 3]!, 0.35 + 0.4 * (1 - strike), k), 0, 0);
    const hp = side < 0 ? B.hipL : B.hipR;
    const kn = side < 0 ? B.knL : B.knR;
    addv(P, hp, crouch * 0.9 * k, 0, side * 0.12 * k);
    addv(P, kn, -crouch * 1.5 * k, 0, 0);
  }
  P[PO + 2] = P[PO + 2]! + (a < 0.55 ? 0.12 * wind : lerp(0.12, -0.25, strike)) * k;
}

// ---------------------------------------------------------------------------------------------------------
// death
// ---------------------------------------------------------------------------------------------------------

/** Final resting pose for death style 0 (on the back), 1 (face down), 2 (on the side). */
export function deathFinal(P: Float32Array, R: RigAnimState, style: number, headshot: boolean): void {
  const I = R.inst;
  P.fill(0);
  const f = I.flop;
  if (style === 0) {
    set(P, B.pelvis, Math.PI / 2, 0.05 * f[0]!, 0.7 * f[1]!);
    set(P, B.spine, -0.1, 0, 0.05 * f[2]!);
    set(P, B.chest, -0.05, 0.08 * f[3]!, 0);
    set(P, B.neck, headshot ? 0.42 : -0.12, 0, 0.3 * f[4]!);
    set(P, B.head, headshot ? 0.25 : -0.05, 0.25 * f[5]!, 0.25 * f[4]!);
    set(P, B.jaw, -(headshot ? 0.9 : 0.55), 0, 0);
    set(P, B.shR, 0.05 + 0.2 * f[0]!, 0, 0.95 + 0.25 * f[1]!);
    set(P, B.shL, 0.05 + 0.2 * f[2]!, 0, -(0.8 + 0.3 * f[3]!));
    set(P, B.elR, 0.2 + 0.3 * Math.abs(f[4]!), 0, 0);
    set(P, B.elL, 0.15 + 0.3 * Math.abs(f[5]!), 0, 0);
    set(P, B.haR, 0.3, 0.3, 0);
    set(P, B.haL, 0.2, -0.3, 0);
    set(P, B.hipR, 0.55 * Math.abs(f[1]!) + 0.05, 0, 0.16 + 0.12 * f[2]!);
    set(P, B.knR, -0.7 * Math.abs(f[1]!) - 0.05, 0, 0);
    set(P, B.hipL, 0.02, 0, -(0.2 + 0.1 * f[3]!));
    set(P, B.knL, -0.06, 0, 0);
    set(P, B.anR, 0.3, 0, 0);
    set(P, B.anL, 0.1, 0, 0.1);
  } else if (style === 1) {
    set(P, B.pelvis, -Math.PI / 2, 0.04 * f[0]!, 0.6 * f[1]!);
    set(P, B.spine, 0.08, 0, 0.05 * f[2]!);
    set(P, B.chest, 0.05, 0.08 * f[3]!, 0);
    set(P, B.neck, 0.25, 0, 0.3 * f[4]!);
    set(P, B.head, 0.3, 0.7 * f[5]!, 0.15 * f[4]!);
    set(P, B.jaw, -0.4, 0, 0);
    set(P, B.shR, 2.5 + 0.3 * f[0]!, 0, 0.5 + 0.25 * f[1]!);
    set(P, B.shL, 0.15, 0, -(0.75 + 0.3 * f[3]!));
    set(P, B.elR, 0.5, 0, 0);
    set(P, B.elL, 0.3, 0, 0);
    set(P, B.haR, 0.3, 0.2, 0);
    set(P, B.haL, 0.2, -0.2, 0);
    set(P, B.hipR, 0.05, 0, 0.15 + 0.1 * f[2]!);
    set(P, B.knR, -0.08, 0, 0);
    set(P, B.hipL, -0.15, 0, -(0.2 + 0.1 * f[3]!));
    set(P, B.knL, -0.35 * Math.abs(f[4]!), 0, 0);
    set(P, B.anR, -0.2, 0, 0);
    set(P, B.anL, -0.2, 0, 0);
  } else {
    set(P, B.pelvis, 0.2 * f[0]!, 0.3 * f[1]!, (Math.PI / 2) * (I.side > 0 ? 1 : -1));
    set(P, B.spine, -0.25, 0.1 * f[2]!, 0);
    set(P, B.chest, -0.2, 0, 0);
    set(P, B.neck, headshot ? 0.4 : 0.05, 0, 0.2 * f[4]!);
    set(P, B.head, headshot ? 0.3 : 0.1, 0.2 * f[5]!, 0.1);
    set(P, B.jaw, -0.5, 0, 0);
    set(P, B.shR, 0.25 + 0.2 * f[0]!, 0, 0.5);
    set(P, B.shL, 0.55, 0, -0.35);
    set(P, B.elR, 0.35, 0, 0);
    set(P, B.elL, 0.35, 0, 0);
    set(P, B.haR, 0.2, 0.1, 0);
    set(P, B.haL, 0.2, -0.1, 0);
    set(P, B.hipR, 0.8 + 0.2 * f[1]!, 0, 0.1);
    set(P, B.knR, -1.1, 0, 0);
    set(P, B.hipL, 0.2, 0, -0.1);
    set(P, B.knL, -0.4, 0, 0);
    set(P, B.anR, 0.1, 0, 0);
    set(P, B.anL, 0.1, 0, 0);
  }
  P[PO] = 0;
  P[PO + 1] = 0;
  P[PO + 2] = 0;
}

const prog = (t: number, t0: number, dur: number): number => clamp((t - t0) / dur, 0, 1);

function deathPose(P: Float32Array, R: RigAnimState, s: ZombieAnimState): void {
  const t = s.deathT;
  deathFinal(FINAL, R, s.deathStyle, s.headshotDeath);
  const from = R.deathFrom;
  // groups: knees / hips buckle first, torso topples (accelerating), arms flail, head lags
  const ux = prog(t, 0.05, 0.75);
  const topple = prog(t, 0.12, 0.85);
  const eTopple = topple * topple * (3 - 2 * topple) * 0.35 + topple * topple * topple * 0.65;
  const eLimb = easeOut(prog(t, 0.1, 0.8));
  const eHead = easeOut(prog(t, 0.28, 0.9));
  const eArm = easeOut(prog(t, 0.08, 0.7));
  const settle = 1 - smoothstep(1.35, 1.75, t);
  const rebound = t > 0.95 ? Math.sin((t - 0.95) * 20) * Math.exp(-(t - 0.95) * 6) * 0.055 * settle : 0;
  for (let b = 0; b < NB; b++) {
    let e = eLimb;
    if (b === B.pelvis) e = eTopple;
    else if (b === B.spine || b === B.chest) e = lerp(eTopple, eLimb, 0.5);
    else if (b === B.neck || b === B.head || b === B.jaw) e = eHead;
    else if (b === B.shL || b === B.shR || b === B.elL || b === B.elR || b === B.haL || b === B.haR) e = eArm;
    for (let c = 0; c < 3; c++) {
      const i = b * 3 + c;
      P[i] = from[i]! + (FINAL[i]! - from[i]!) * e;
    }
  }
  // buckling knees / forward hip flex while still upright, fading out as the body topples
  const buckle = Math.sin(Math.min(1, ux) * Math.PI) * (1 - eTopple);
  addv(P, B.hipL, 0.55 * buckle, 0, 0);
  addv(P, B.hipR, 0.55 * buckle, 0, 0);
  addv(P, B.knL, -1.0 * buckle, 0, 0);
  addv(P, B.knR, -1.0 * buckle, 0, 0);
  addv(P, B.pelvis, rebound, 0, 0);
  // drift of the body away from the killing blow
  const drift = s.deathStyle === 0 ? 0.32 : s.deathStyle === 1 ? -0.3 : 0;
  P[PO] = s.deathStyle === 2 ? 0.28 * eTopple * (R.inst.side > 0 ? 1 : -1) : 0;
  P[PO + 1] = 0;
  P[PO + 2] = drift * eTopple;
}

// ---------------------------------------------------------------------------------------------------------
// main pose evaluation
// ---------------------------------------------------------------------------------------------------------

/** Evaluate the full pose for this frame into `R.out`. Returns true when the pose is a settled corpse (no more updates needed). */
export function evalPose(R: RigAnimState, s: ZombieAnimState, dt: number): boolean {
  const P = R.out;
  if (s.mode === 'death') {
    if (!R.deathStarted) {
      R.deathStarted = true;
      R.deathFrom.set(P);
    }
    deathPose(P, R, s);
    return s.deathT >= 1.85;
  }
  R.deathStarted = false;

  // smoothed control variables
  const moving = s.mode === 'walk' || s.mode === 'run' || s.mode === 'charge';
  R.spSm += ((moving ? s.speed : 0) - R.spSm) * (1 - Math.exp(-dt * 7));
  const runTarget = s.mode === 'run' || s.mode === 'charge' ? 1 : 0;
  R.runK += (runTarget - R.runK) * (1 - Math.exp(-dt * 6));
  R.chargeK += ((s.mode === 'charge' ? 1 : 0) - R.chargeK) * (1 - Math.exp(-dt * 8));
  const tw = (target: boolean, w: number, rate: number): number => w + ((target ? 1 : 0) - w) * (1 - Math.exp(-dt * rate));
  R.wAttack = tw(s.mode === 'attack', R.wAttack, 16);
  R.wStagger = tw(s.mode === 'stagger', R.wStagger, 20);
  R.wRoar = tw(s.mode === 'roar', R.wRoar, 9);
  R.wSlam = tw(s.mode === 'slam', R.wSlam, 14);

  locomotion(BASE, R, s, dt);
  P.set(BASE);

  const apply = (w: number, fn: (tgt: Float32Array) => void): void => {
    if (w < 0.002) return;
    MODE.set(P);
    fn(MODE);
    for (let i = 0; i < POSE_LEN; i++) P[i] = P[i]! + (MODE[i]! - P[i]!) * w;
  };
  apply(R.wAttack, (m) => attackPose(m, R, s.actionT));
  apply(R.wStagger, (m) => staggerPose(m, R, s.staggerT));
  apply(R.wRoar, (m) => roarPose(m, R, s.actionT, s.time));
  apply(R.wSlam, (m) => slamPose(m, R, s.actionT));

  // hit flinch layered on top
  const k = s.hitKick;
  if (k > 0.001) {
    const I = R.inst;
    addv(P, B.spine, 0.28 * k, 0.1 * k * I.side, 0.08 * k * I.side);
    addv(P, B.chest, 0.16 * k, 0, 0);
    addv(P, B.head, 0.3 * k, 0.12 * k * I.side, 0);
    addv(P, B.shL, 0.22 * k, 0, 0);
    addv(P, B.shR, 0.22 * k, 0, 0);
    P[PO + 2] = P[PO + 2]! + 0.05 * k;
  }
  return false;
}
