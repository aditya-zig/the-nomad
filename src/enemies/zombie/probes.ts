/**
 * Ground-contact probes derived from the real mesh: for every bone, the extreme vertices (14 directions: 6 axes and
 * 8 corners) among vertices rigidly weighted to it, stored in bone-local space. Forward kinematics of these points
 * gives the lowest point of the animated body without CPU-skinning the whole mesh, so feet, knees, hands, backs and
 * faces rest exactly on the ground in every pose.
 */
import * as THREE from 'three';
import { B, NB } from './dims';

const DIRS: THREE.Vector3[] = [];
for (const s of [-1, 1]) {
  DIRS.push(new THREE.Vector3(s, 0, 0), new THREE.Vector3(0, s, 0), new THREE.Vector3(0, 0, s));
}
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) DIRS.push(new THREE.Vector3(sx, sy, sz).normalize());

export interface ProbeSets {
  /** Packed [bone, x, y, z] quadruples used while upright (feet, knees). */
  stand: Float32Array;
  /** Packed quadruples over every bone (used for death / anything lying down). */
  full: Float32Array;
}

export function computeProbes(geo: THREE.BufferGeometry, rest: { x: number; y: number; z: number }[]): ProbeSets {
  const pos = geo.attributes.position!;
  const si = geo.attributes.skinIndex!;
  const sw = geo.attributes.skinWeight!;
  const best: number[][] = Array.from({ length: NB }, () => new Array<number>(DIRS.length).fill(-Infinity));
  const bestIdx: number[][] = Array.from({ length: NB }, () => new Array<number>(DIRS.length).fill(-1));
  for (let i = 0; i < pos.count; i++) {
    const w0 = sw.getX(i);
    const w1 = sw.getY(i);
    const bone = w0 >= w1 ? si.getX(i) : si.getY(i);
    const w = Math.max(w0, w1);
    if (w < 0.6) continue;
    const lx = pos.getX(i) - rest[bone]!.x;
    const ly = pos.getY(i) - rest[bone]!.y;
    const lz = pos.getZ(i) - rest[bone]!.z;
    for (let d = 0; d < DIRS.length; d++) {
      const dir = DIRS[d]!;
      const dot = lx * dir.x + ly * dir.y + lz * dir.z;
      if (dot > best[bone]![d]!) {
        best[bone]![d] = dot;
        bestIdx[bone]![d] = i;
      }
    }
  }
  const fullList: number[] = [];
  const standList: number[] = [];
  const standBones = new Set<number>([B.anL, B.anR, B.knL, B.knR]);
  for (let b = 0; b < NB; b++) {
    const seen = new Set<number>();
    for (let d = 0; d < DIRS.length; d++) {
      const idx = bestIdx[b]![d]!;
      if (idx < 0 || seen.has(idx)) continue;
      seen.add(idx);
      const q = [b, pos.getX(idx) - rest[b]!.x, pos.getY(idx) - rest[b]!.y, pos.getZ(idx) - rest[b]!.z];
      fullList.push(...q);
      if (standBones.has(b)) standList.push(...q);
    }
  }
  return { stand: new Float32Array(standList), full: new Float32Array(fullList) };
}
