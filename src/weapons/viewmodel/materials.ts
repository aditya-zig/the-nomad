/**
 * Shared textures and per-rig materials for the viewmodels. Textures are generated once and reference counted;
 * each rig owns its own material instances so tier changes (finish, emissive accents, reticle colour) never leak
 * between weapons.
 */
import * as THREE from 'three';
import {
  makeCeramicSet,
  makeFabricSet,
  makeGlowSprite,
  makeGripSet,
  makeLabelTexture,
  makeMetalSet,
  makePolymerSet,
  makeReticleSprite,
  makeStarSprite,
  makeStreakSprite,
  type PbrSet,
} from './textures';
import type { MatKey } from './kit';

export interface SharedTextures {
  metal: PbrSet;
  polymer: PbrSet;
  grip: PbrSet;
  glove: PbrSet;
  sleeve: PbrSet;
  ceramic: PbrSet;
  glow: THREE.CanvasTexture;
  starA: THREE.CanvasTexture;
  starB: THREE.CanvasTexture;
  streak: THREE.CanvasTexture;
  reticleRing: THREE.CanvasTexture;
  reticleDot: THREE.CanvasTexture;
  plateLabel: THREE.CanvasTexture;
}

let shared: SharedTextures | null = null;
let refs = 0;

export function acquireTextures(): SharedTextures {
  if (!shared) {
    shared = {
      metal: makeMetalSet(),
      polymer: makePolymerSet(),
      grip: makeGripSet(),
      glove: makeFabricSet(41, 4, 0.07),
      sleeve: makeFabricSet(42, 6, 0.12),
      ceramic: makeCeramicSet(),
      glow: makeGlowSprite(),
      starA: makeStarSprite(3, 256, 7),
      starB: makeStarSprite(9, 256, 9),
      streak: makeStreakSprite(),
      reticleRing: makeReticleSprite('ring'),
      reticleDot: makeReticleSprite('dot'),
      plateLabel: makeLabelTexture(['ARMOR PLATE', 'STRIKE FACE'], 512, 128, '#d9d2b0', 'rgba(0,0,0,0)'),
    };
  }
  refs++;
  return shared;
}

export function releaseTextures(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    const dispose = (s: PbrSet) => {
      s.map.dispose();
      s.normalMap.dispose();
      s.orm?.dispose();
    };
    dispose(shared.metal);
    dispose(shared.polymer);
    dispose(shared.grip);
    dispose(shared.glove);
    dispose(shared.sleeve);
    dispose(shared.ceramic);
    shared.glow.dispose();
    shared.starA.dispose();
    shared.starB.dispose();
    shared.streak.dispose();
    shared.reticleRing.dispose();
    shared.reticleDot.dispose();
    shared.plateLabel.dispose();
    shared = null;
  }
}

/** Per-tier colours: accent A (amber) and accent B (cyan), flash tint, reticle tint. */
export const TIER_COLORS = {
  flash: [new THREE.Color(1.0, 0.82, 0.45), new THREE.Color(1.0, 0.55, 0.16), new THREE.Color(0.45, 0.9, 1.0)],
  reticle: [new THREE.Color(1.0, 0.12, 0.06), new THREE.Color(1.0, 0.62, 0.1), new THREE.Color(0.2, 0.95, 1.0)],
};

export class RigMaterials {
  private readonly mats = new Map<MatKey, THREE.Material>();
  readonly tex: SharedTextures;
  private tier = 0;
  private readonly time = { v: 0 };

  constructor(tex: SharedTextures) {
    this.tex = tex;
  }

  private std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial(p);
  }

  private create(key: MatKey): THREE.Material {
    const t = this.tex;
    const nsm = (k: number) => new THREE.Vector2(k, k);
    switch (key) {
      case 'metal':
        return this.std({ color: 0x74767a, map: t.metal.map, normalMap: t.metal.normalMap, normalScale: nsm(0.55), roughnessMap: t.metal.orm, metalnessMap: t.metal.orm, roughness: 1.15, metalness: 0.5, envMapIntensity: 1.3 });
      case 'steel':
        return this.std({ color: 0xa3a5a8, map: t.metal.map, normalMap: t.metal.normalMap, normalScale: nsm(0.4), roughnessMap: t.metal.orm, metalnessMap: t.metal.orm, roughness: 0.9, metalness: 0.7, envMapIntensity: 1.6 });
      case 'blued':
        return this.std({ color: 0x484b50, map: t.metal.map, normalMap: t.metal.normalMap, normalScale: nsm(0.35), roughnessMap: t.metal.orm, metalnessMap: t.metal.orm, roughness: 0.95, metalness: 0.6, envMapIntensity: 1.5 });
      case 'polymer':
        return this.std({ color: 0x393d41, map: t.polymer.map, normalMap: t.polymer.normalMap, normalScale: nsm(0.28), roughness: 0.62, metalness: 0.05, envMapIntensity: 1.3 });
      case 'olive':
        return this.std({ color: 0x4c5339, map: t.polymer.map, normalMap: t.polymer.normalMap, normalScale: nsm(0.22), roughness: 0.6, metalness: 0.03, envMapIntensity: 1.2 });
      case 'grip':
        return this.std({ color: 0x2f3336, map: t.grip.map, normalMap: t.grip.normalMap, normalScale: nsm(1.0), roughness: 0.9, metalness: 0, envMapIntensity: 0.8 });
      case 'rubber':
        return this.std({ color: 0x202224, normalMap: t.polymer.normalMap, normalScale: nsm(0.5), roughness: 0.95, metalness: 0 });
      case 'brass':
        return this.std({ color: 0xc09a48, roughness: 0.28, metalness: 1, envMapIntensity: 1.6 });
      case 'red':
        return this.std({ color: 0x9c2a22, roughness: 0.5, metalness: 0 });
      case 'whiteDot':
        return this.std({ color: 0xe6efe6, emissive: new THREE.Color(0.5, 1.0, 0.6), emissiveIntensity: 0.9, roughness: 0.5 });
      case 'lens':
        return this.std({ color: 0x7db4c8, transparent: true, opacity: 0.1, roughness: 0.03, metalness: 0, envMapIntensity: 3, depthWrite: false });
      case 'lensCoat':
        return this.std({ color: 0x8a7cc0, transparent: true, opacity: 0.18, roughness: 0.02, metalness: 0.4, envMapIntensity: 3, depthWrite: false });
      case 'accentA':
        return this.std({ color: 0x1a1108, emissive: new THREE.Color(1.0, 0.5, 0.08), emissiveIntensity: 2.0, roughness: 0.5, metalness: 0.2 });
      case 'accentB':
        return this.std({ color: 0x06141a, emissive: new THREE.Color(0.1, 0.85, 1.0), emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.2 });
      case 'reticle': {
        const m = new THREE.MeshBasicMaterial({ map: this.tex.reticleRing, color: TIER_COLORS.reticle[0]!.clone().multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
        return m;
      }
      case 'ceramic':
        return this.std({ color: 0x80868a, map: t.ceramic.map, normalMap: t.ceramic.normalMap, normalScale: nsm(0.2), roughness: 0.78, metalness: 0.05 });
      case 'oliveMetal':
        return this.std({ color: 0x4a5136, map: t.metal.map, normalMap: t.metal.normalMap, normalScale: nsm(0.5), roughnessMap: t.metal.orm, roughness: 0.9, metalness: 0.35, envMapIntensity: 0.9 });
      case 'fabricOlive':
        return this.std({ color: 0x484f35, map: t.sleeve.map, normalMap: t.sleeve.normalMap, normalScale: nsm(0.4), roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
      case 'fabricBlack':
        return this.std({ color: 0x1b1d1f, map: t.glove.map, normalMap: t.glove.normalMap, normalScale: nsm(0.9), roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
      case 'webbing':
        return this.std({ color: 0x25281f, map: t.glove.map, normalMap: t.glove.normalMap, normalScale: nsm(1.2), roughness: 0.98, metalness: 0 });
      case 'glove':
        return this.std({ vertexColors: true, map: t.glove.map, normalMap: t.glove.normalMap, normalScale: nsm(0.3), roughness: 0.88, metalness: 0, envMapIntensity: 0.6 });
      case 'guardShell':
        return this.std({ color: 0x25282b, normalMap: t.polymer.normalMap, normalScale: nsm(0.22), roughness: 0.42, metalness: 0.25, envMapIntensity: 1.3 });
      case 'shellRed':
        return this.std({ color: 0x9a2a22, map: t.polymer.map, normalMap: t.polymer.normalMap, normalScale: nsm(0.25), roughness: 0.45, metalness: 0.05, envMapIntensity: 1.2 });
      case 'vestFabric':
        return this.std({ color: 0x3f4834, map: t.glove.map, normalMap: t.glove.normalMap, normalScale: nsm(0.7), roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
      case 'plateLabel':
        return this.std({ map: t.plateLabel, color: 0xffffff, transparent: true, roughness: 0.85, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      case 'yellow':
        return this.std({ color: 0xb59a24, roughness: 0.55, metalness: 0.1 });
      case 'screen':
        return this.std({ color: 0x0b1418, emissive: new THREE.Color(0.12, 0.5, 0.7), emissiveIntensity: 0.32, roughness: 0.3, metalness: 0.1 });
      default:
        return this.std({ color: 0xff00ff });
    }
  }

  get(key: MatKey): THREE.Material {
    let m = this.mats.get(key);
    if (!m) {
      m = this.create(key);
      m.name = key;
      this.mats.set(key, m);
    }
    return m;
  }

  /** Apply upgrade-level finish: fresher, glossier metal and stronger accents. */
  setTier(tier: number): void {
    this.tier = Math.max(0, Math.min(2, Math.round(tier)));
    const metal = this.mats.get('metal') as THREE.MeshStandardMaterial | undefined;
    if (metal) {
      const c = [0x74767a, 0x808289, 0x8d9097][this.tier]!;
      metal.color.setHex(c);
      metal.envMapIntensity = [1.3, 1.7, 2.1][this.tier]!;
    }
    const reticle = this.mats.get('reticle') as THREE.MeshBasicMaterial | undefined;
    if (reticle) reticle.color.copy(TIER_COLORS.reticle[this.tier]!).multiplyScalar(2.2);
  }

  get currentTier(): number {
    return this.tier;
  }

  /** Subtle pulsing of tier accents (called every frame). */
  pulse(time: number): void {
    this.time.v = time;
    const a = this.mats.get('accentA') as THREE.MeshStandardMaterial | undefined;
    const b = this.mats.get('accentB') as THREE.MeshStandardMaterial | undefined;
    if (a) a.emissiveIntensity = (this.tier >= 2 ? 2.4 : 1.7) + Math.sin(time * 2.4) * 0.25;
    if (b) b.emissiveIntensity = 2.6 + Math.sin(time * 3.1 + 1.3) * 0.5;
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
