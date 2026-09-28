/**
 * Skeleton layout and body dimensions per zombie type. All positions are in model space (metres, feet at y = 0,
 * model faces -Z, +X is the character's RIGHT). The bind pose has arms hanging with a slight outward angle.
 */
import type { ZombieType } from '../../types';

export const B = {
  pelvis: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  jaw: 5,
  shL: 6,
  elL: 7,
  haL: 8,
  shR: 9,
  elR: 10,
  haR: 11,
  hipL: 12,
  knL: 13,
  anL: 14,
  hipR: 15,
  knR: 16,
  anR: 17,
} as const;

export const NB = 18;

export const BONE_NAMES = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'jaw',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
  'hipL',
  'kneeL',
  'ankleL',
  'hipR',
  'kneeR',
  'ankleR',
] as const;

export const BONE_PARENT: readonly number[] = [
  -1, // pelvis
  B.pelvis, // spine
  B.spine, // chest
  B.chest, // neck
  B.neck, // head
  B.head, // jaw
  B.chest, // shoulderL
  B.shL, // elbowL
  B.elL, // handL
  B.chest, // shoulderR
  B.shR, // elbowR
  B.elR, // handR
  B.pelvis, // hipL
  B.hipL, // kneeL
  B.knL, // ankleL
  B.pelvis, // hipR
  B.hipR, // kneeR
  B.knR, // ankleR
];

export interface Dims {
  type: ZombieType;
  /** Standing height (top of head). */
  H: number;
  /** Uniform scale relative to a 1.8 m human. */
  k: number;
  /** Girth multipliers (1 = average human). */
  torsoW: number;
  torsoD: number;
  armT: number;
  legT: number;
  headS: number;
  /** Joint heights. */
  ankleY: number;
  kneeY: number;
  hipY: number;
  spineY: number;
  chestY: number;
  shY: number;
  neckY: number;
  headY: number;
  /** Half distances of the hip / shoulder joints from the centre line. */
  hipX: number;
  shX: number;
  thigh: number;
  shin: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  /** Bind-pose arm abduction (radians, outward from vertical). */
  armAngle: number;
  /** Head sphere centre relative to the head bone origin. */
  headCenterUp: number;
}

/** Base human proportions at H = 1.8 m; per-type multipliers below. */
export function makeDims(type: ZombieType, H: number): Dims {
  const k = H / 1.8;
  let torsoW = 1;
  let torsoD = 1;
  let armT = 1;
  let legT = 1;
  let headS = 1.08;
  let armLen = 1;
  let armAngle = 0.13;
  let shoulderBroad = 1;
  switch (type) {
    case 'runner':
      torsoW = 0.84;
      torsoD = 0.86;
      armT = 0.82;
      legT = 0.84;
      headS = 1.12;
      armLen = 1.1;
      armAngle = 0.1;
      break;
    case 'armored':
      torsoW = 1.28;
      torsoD = 1.32;
      armT = 1.18;
      legT = 1.16;
      headS = 1.06;
      armAngle = 0.32;
      shoulderBroad = 1.14;
      break;
    case 'warden':
      torsoW = 1.7;
      torsoD = 1.55;
      armT = 1.85;
      legT = 1.6;
      headS = 0.98;
      armLen = 1.12;
      armAngle = 0.36;
      shoulderBroad = 1.3;
      break;
    default:
      break;
  }
  const upperArm = 0.3 * k * armLen;
  const foreArm = 0.27 * k * armLen;
  return {
    type,
    H,
    k,
    torsoW,
    torsoD,
    armT,
    legT,
    headS,
    ankleY: 0.085 * k,
    kneeY: 0.5 * k,
    hipY: 0.93 * k,
    spineY: 1.03 * k,
    chestY: 1.22 * k,
    shY: 1.45 * k,
    neckY: 1.5 * k,
    headY: 1.585 * k,
    hipX: 0.095 * k * (type === 'warden' ? 1.5 : type === 'armored' ? 1.2 : 1),
    shX: 0.195 * k * shoulderBroad * (type === 'warden' ? 1.18 : 1) * (type === 'runner' ? 0.94 : 1),
    thigh: 0.43 * k,
    shin: 0.415 * k,
    upperArm,
    foreArm,
    hand: 0.17 * k,
    armAngle,
    headCenterUp: 0.1 * k * headS,
  };
}

export const NOMINAL_HEIGHT: Record<ZombieType, number> = {
  shambler: 1.8,
  runner: 1.75,
  armored: 1.95,
  warden: 2.55,
};

/** Bone rest positions in model space, used to build skeletons and bind-pose geometry. */
export function restPositions(d: Dims): { x: number; y: number; z: number }[] {
  const sa = Math.sin(d.armAngle);
  const ca = Math.cos(d.armAngle);
  const pos = new Array<{ x: number; y: number; z: number }>(NB);
  pos[B.pelvis] = { x: 0, y: d.hipY, z: 0 };
  pos[B.spine] = { x: 0, y: d.spineY, z: 0 };
  pos[B.chest] = { x: 0, y: d.chestY, z: 0 };
  pos[B.neck] = { x: 0, y: d.neckY, z: 0 };
  pos[B.head] = { x: 0, y: d.headY, z: 0 };
  pos[B.jaw] = { x: 0, y: d.headY + 0.05 * d.k * d.headS, z: 0.035 * d.k * d.headS };
  for (const s of [-1, 1] as const) {
    const sh = s < 0 ? B.shL : B.shR;
    const el = s < 0 ? B.elL : B.elR;
    const ha = s < 0 ? B.haL : B.haR;
    const hip = s < 0 ? B.hipL : B.hipR;
    const kn = s < 0 ? B.knL : B.knR;
    const an = s < 0 ? B.anL : B.anR;
    pos[sh] = { x: s * d.shX, y: d.shY, z: 0 };
    pos[el] = { x: s * (d.shX + sa * d.upperArm), y: d.shY - ca * d.upperArm, z: 0 };
    pos[ha] = { x: s * (d.shX + sa * (d.upperArm + d.foreArm)), y: d.shY - ca * (d.upperArm + d.foreArm), z: 0 };
    pos[hip] = { x: s * d.hipX, y: d.hipY, z: 0 };
    pos[kn] = { x: s * d.hipX, y: d.kneeY, z: 0 };
    pos[an] = { x: s * d.hipX, y: d.ankleY, z: 0 };
  }
  return pos;
}
