/**
 * Muzzle flash: additive star bursts facing the camera, a hot core, and two crossed flame streaks along the barrel axis.
 * Lives under the weapon's `muzzle` object. ~0.055 s life; tier changes the colour (warm yellow / orange / cyan-white).
 */
import * as THREE from 'three';
import { TIER_COLORS, type SharedTextures } from './materials';
import { mulberry32 } from './util';

const LIFE = 0.055;

function additive(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });
}

export class MuzzleFlash {
  readonly group = new THREE.Group();
  private t = 0;
  private readonly rand = mulberry32(1337);
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly star1: THREE.Mesh;
  private readonly star2: THREE.Mesh;
  private readonly core: THREE.Mesh;
  private readonly streakV: THREE.Mesh;
  private readonly streakH: THREE.Mesh;
  private readonly tint = new THREE.Color();
  private intensity = 3;

  constructor(
    tex: SharedTextures,
    private readonly size: number,
    private readonly streakLen: number,
  ) {
    const mStar1 = additive(tex.starA);
    const mStar2 = additive(tex.starB);
    const mCore = additive(tex.glow);
    const mStreak = additive(tex.streak);
    this.mats.push(mStar1, mStar2, mCore, mStreak);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geos.push(quad);
    this.star1 = new THREE.Mesh(quad, mStar1);
    this.star2 = new THREE.Mesh(quad, mStar2);
    this.core = new THREE.Mesh(quad, mCore);
    this.group.add(this.star1, this.star2, this.core);

    const sg = new THREE.PlaneGeometry(1, 1);
    sg.translate(0.5, 0, 0); // origin at the left edge
    sg.rotateY(Math.PI / 2); // +X -> -Z (forward)
    this.geos.push(sg);
    this.streakV = new THREE.Mesh(sg, mStreak);
    this.streakH = new THREE.Mesh(sg, mStreak);
    this.streakH.rotation.z = Math.PI / 2;
    this.group.add(this.streakV, this.streakH);

    for (const m of this.group.children) {
      m.frustumCulled = false;
      m.renderOrder = 20;
    }
    // stars and core face the camera at the origin: plane normal +Z already points at it
    this.group.visible = false;
  }

  trigger(tier: number, strength = 1): void {
    this.t = LIFE;
    const k = Math.max(0, Math.min(2, Math.round(tier)));
    this.tint.copy(TIER_COLORS.flash[k]!);
    this.intensity = 2.3 + k * 0.4;
    this.group.scale.setScalar(1);
    const r = this.rand;
    const s = this.size * (0.8 + 0.4 * r()) * (0.8 + 0.3 * strength);
    this.star1.scale.set(s, s, 1);
    this.star1.rotation.z = r() * Math.PI * 2;
    this.star2.scale.set(s * 0.72, s * 0.72, 1);
    this.star2.rotation.z = r() * Math.PI * 2;
    this.core.scale.set(s * 0.55, s * 0.55, 1);
    const len = this.streakLen * (0.75 + 0.5 * r()) * (0.8 + 0.3 * strength);
    this.streakV.scale.set(len, s * 0.34, 1);
    this.streakH.scale.set(len * 0.85, s * 0.28, 1);
    this.streakH.rotation.x = 0;
    this.group.visible = true;
    this.apply(1);
  }

  private apply(k: number): void {
    const a = k * k;
    for (const m of this.mats) {
      m.color.copy(this.tint).multiplyScalar(this.intensity * (0.55 + 0.45 * a));
      m.opacity = Math.min(1, a * 1.4);
    }
  }

  update(dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.group.visible = false;
      return;
    }
    const k = this.t / LIFE;
    this.apply(k);
    const grow = 1 + (1 - k) * 0.25;
    this.group.scale.setScalar(grow);
  }

  reset(): void {
    this.t = 0;
    this.group.visible = false;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}
