/**
 * Ejected casings: a fixed ring of physically simulated brass cases / shotgun shells rendered with two InstancedMeshes
 * (brass for rifle+pistol, red-and-brass for shotgun). Arc under gravity, bounce off the ground twice, tumble, settle,
 * shrink away after ~3.5 s.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec3Like, WeaponId } from '../types';
import type { Rng } from './rng';

const LIFE = 3.6;
const SHRINK = 0.55;
const GRAVITY = 9.81;

interface Spec {
  len: number;
  rad: number;
  shell: boolean;
}

const SPECS: Record<WeaponId, Spec> = {
  rifle: { len: 0.045, rad: 0.0058, shell: false },
  pistol: { len: 0.029, rad: 0.0049, shell: false },
  shotgun: { len: 0.07, rad: 0.0105, shell: true },
};

function brassGeometry(): THREE.BufferGeometry {
  // profile: base flange, body, taper to neck, mouth (axis along +Y, length 1, body radius 1)
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(1.1, 0.0),
    new THREE.Vector2(1.1, 0.055),
    new THREE.Vector2(0.97, 0.07),
    new THREE.Vector2(1.0, 0.72),
    new THREE.Vector2(0.8, 0.88),
    new THREE.Vector2(0.76, 1.0),
    new THREE.Vector2(0.0, 0.97),
  ];
  const g = new THREE.LatheGeometry(pts, 10);
  g.rotateZ(-Math.PI / 2);
  g.translate(-0.5, 0, 0);
  return g;
}

function shellGeometry(): THREE.BufferGeometry {
  const hull = new THREE.CylinderGeometry(1, 1, 0.68, 10, 1);
  hull.translate(0, 0.34 + 0.32, 0);
  const base = new THREE.CylinderGeometry(1.04, 1.04, 0.32, 10, 1);
  base.translate(0, 0.16, 0);
  const rim = new THREE.CylinderGeometry(1.12, 1.12, 0.05, 10, 1);
  rim.translate(0, 0.025, 0);
  const paint = (g: THREE.BufferGeometry, r: number, gg: number, b: number) => {
    const n = g.attributes.position!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = r;
      col[i * 3 + 1] = gg;
      col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const merged = mergeGeometries([paint(hull, 0.42, 0.05, 0.045), paint(base, 0.72, 0.46, 0.14), paint(rim, 0.8, 0.55, 0.2)], false);
  if (!merged) throw new Error('shell geometry merge failed');
  merged.rotateZ(-Math.PI / 2);
  merged.translate(-0.5, 0, 0);
  return merged;
}

export class CasingPool {
  readonly brass: THREE.InstancedMesh;
  readonly shells: THREE.InstancedMesh;
  private readonly cap: number;
  private limit: number;
  private cursor = 0;
  private readonly alive: Uint8Array;
  private readonly resting: Uint8Array;
  private readonly bounces: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly yaw: Float32Array;
  private readonly tumble: Float32Array;
  private readonly rate: Float32Array;
  private readonly age: Float32Array;
  private readonly len: Float32Array;
  private readonly rad: Float32Array;
  private readonly rng: Rng;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qTum = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private readonly zero: THREE.Matrix4;
  liveCount = 0;

  constructor(cap: number, rng: Rng) {
    this.cap = cap;
    this.limit = cap;
    this.rng = rng;
    this.alive = new Uint8Array(cap);
    this.resting = new Uint8Array(cap);
    this.bounces = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.yaw = new Float32Array(cap);
    this.tumble = new Float32Array(cap);
    this.rate = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.len = new Float32Array(cap);
    this.rad = new Float32Array(cap);

    const brassGeo = brassGeometry();
    const shellGeo = shellGeometry();
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd8b45a, metalness: 0.8, roughness: 0.34, emissive: 0x1c1407 });
    const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5, emissive: 0x160806 });
    this.geos.push(brassGeo, shellGeo);
    this.mats.push(brassMat, shellMat);
    this.brass = new THREE.InstancedMesh(brassGeo, brassMat, cap);
    this.shells = new THREE.InstancedMesh(shellGeo, shellMat, cap);
    for (const mesh of [this.brass, this.shells]) {
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.brass.name = 'FxBrass';
    this.shells.name = 'FxShells';
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.brass.setMatrixAt(i, this.zero);
      this.shells.setMatrixAt(i, this.zero);
    }
  }

  spawn(p: Vec3Like, vel: Vec3Like, kind: WeaponId): void {
    if (this.limit <= 0) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    // hide whatever mesh previously held this slot
    this.brass.setMatrixAt(i, this.zero);
    this.shells.setMatrixAt(i, this.zero);
    const spec = SPECS[kind];
    this.alive[i] = 1;
    this.resting[i] = 0;
    this.bounces[i] = 0;
    this.kind[i] = spec.shell ? 1 : 0;
    this.px[i] = p.x;
    this.py[i] = p.y;
    this.pz[i] = p.z;
    this.vx[i] = vel.x;
    this.vy[i] = vel.y;
    this.vz[i] = vel.z;
    this.yaw[i] = this.rng.next() * Math.PI * 2;
    this.tumble[i] = this.rng.next() * Math.PI * 2;
    this.rate[i] = (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(14, 38);
    this.age[i] = 0;
    this.len[i] = spec.len;
    this.rad[i] = spec.rad;
  }

  update(dt: number): void {
    let live = 0;
    let brassDirty = false;
    let shellDirty = false;
    for (let i = 0; i < this.limit; i++) {
      if (this.alive[i] === 0) continue;
      const age = this.age[i] + dt;
      this.age[i] = age;
      const mesh = this.kind[i] === 1 ? this.shells : this.brass;
      if (age >= LIFE) {
        this.alive[i] = 0;
        mesh.setMatrixAt(i, this.zero);
        if (this.kind[i] === 1) shellDirty = true;
        else brassDirty = true;
        continue;
      }
      live++;
      const r = this.rad[i];
      if (this.resting[i] === 0) {
        let vy = this.vy[i] - GRAVITY * dt;
        const x = this.px[i] + this.vx[i] * dt;
        let y = this.py[i] + vy * dt;
        const z = this.pz[i] + this.vz[i] * dt;
        this.tumble[i] += this.rate[i] * dt;
        if (y <= r) {
          y = r;
          if (vy < -0.5 && this.bounces[i] < 3) {
            vy = -vy * 0.34;
            this.vx[i] *= 0.58;
            this.vz[i] *= 0.58;
            this.rate[i] *= -0.55;
            this.yaw[i] += this.rng.signed() * 0.6;
            this.bounces[i]++;
          } else {
            vy = 0;
            this.vx[i] = 0;
            this.vz[i] = 0;
            this.resting[i] = 1;
          }
        }
        this.vy[i] = vy;
        this.px[i] = x;
        this.py[i] = y;
        this.pz[i] = z;
      } else {
        // settle to lie flat: tumble -> nearest multiple of PI
        const target = Math.round(this.tumble[i] / Math.PI) * Math.PI;
        this.tumble[i] += (target - this.tumble[i]) * Math.min(1, dt * 16);
      }
      const remaining = LIFE - age;
      const k = remaining < SHRINK ? remaining / SHRINK : 1;
      this.qYaw.setFromAxisAngle(this.axisY, this.yaw[i]);
      this.qTum.setFromAxisAngle(this.axisZ, this.tumble[i]);
      this.qYaw.multiply(this.qTum);
      this.pos.set(this.px[i], this.py[i], this.pz[i]);
      this.scl.set(this.len[i] * k, this.rad[i] * k, this.rad[i] * k);
      this.m.compose(this.pos, this.qYaw, this.scl);
      mesh.setMatrixAt(i, this.m);
      if (this.kind[i] === 1) shellDirty = true;
      else brassDirty = true;
    }
    this.liveCount = live;
    if (brassDirty) this.brass.instanceMatrix.needsUpdate = true;
    if (shellDirty) this.shells.instanceMatrix.needsUpdate = true;
  }

  setLimit(n: number): void {
    const lim = Math.max(0, Math.min(this.cap, Math.floor(n)));
    for (let i = lim; i < this.cap; i++) {
      if (this.alive[i]) {
        this.alive[i] = 0;
        this.brass.setMatrixAt(i, this.zero);
        this.shells.setMatrixAt(i, this.zero);
      }
    }
    this.limit = lim;
    if (lim > 0) this.cursor %= lim;
    else this.cursor = 0;
    this.brass.instanceMatrix.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) {
      this.alive[i] = 0;
      this.brass.setMatrixAt(i, this.zero);
      this.shells.setMatrixAt(i, this.zero);
    }
    this.cursor = 0;
    this.liveCount = 0;
    this.brass.instanceMatrix.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.brass.dispose();
    this.shells.dispose();
  }
}
