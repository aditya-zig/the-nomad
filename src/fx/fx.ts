/**
 * Effects module: bounded particles, decals, tracers, casings and atmosphere behind the `FxApi` contract.
 *
 * Everything lives in fixed-size pools created at construction (see `particles.ts`, `decals.ts`, `tracers.ts`,
 * `casings.ts`); events overwrite the oldest slot of their pool so nothing is allocated in steady state and no effect
 * can outlive its hard lifetime. Draw calls: 2 particle batches + 3 decal families + tracers + 2 casing meshes +
 * up to 3 shock rings.
 */
import * as THREE from 'three';
import { FX } from '../config';
import type { SurfaceKind, Vec3Like, WeaponId } from '../types';
import { CasingPool } from './casings';
import { DecalPool } from './decals';
import type { EmitterKind, FlareHandle, FxApi } from './fxTypes';
import { GROUND, KIND, ParticleBatch, type Pool } from './particles';
import { Rng, coneDir, tmpDir } from './rng';
import {
  BLOOD_VARIANTS,
  HOLE_ROWS,
  HOLE_VARIANTS,
  SCORCH_VARIANTS,
  type HoleSurface,
  makeBloodAtlas,
  makeBulletHoleAtlas,
  makeNoiseTexture,
  makeScorchAtlas,
} from './textures';
import { TracerPool } from './tracers';

// ---------------------------------------------------------------------------------------------
// tuning constants
// ---------------------------------------------------------------------------------------------

const AMBIENT_RANGE = 90;
const MAX_EMITTERS = 96;
const MOTE_BOX = 15;
const MOTE_CAP = 64;
const MAX_FLARES = 2;

type RGB = readonly [number, number, number];

const tmpColor = new THREE.Color();
/** sRGB hex -> linear RGB triple (optionally scaled). */
function lin(hex: number, k = 1): RGB {
  tmpColor.set(hex);
  return [tmpColor.r * k, tmpColor.g * k, tmpColor.b * k];
}

const C_DUST_CONCRETE = lin(0x9a9891);
const C_DUST_DIRT = lin(0x745f47);
const C_DUST_WOOD = lin(0xc3a674);
const C_DUST_FABRIC = lin(0x8a8570);
const C_CHIP_CONCRETE = lin(0xa5a29a);
const C_CLOD = lin(0x5e4d36);
const C_SPLINTER = lin(0xd0ae78);
const C_SHARD = lin(0xcfe2ea);
const C_SMOKE_GREY = lin(0x6d7278);
const C_SMOKE_DARK = lin(0x1f2023);
const C_STEAM = lin(0xcdd6de);
const C_BLOOD = lin(0x4a0b0a);
const C_BLOOD_MIST = lin(0x520e0c);
const C_BLOOD_CHUNK = lin(0x55100e);
const C_DEBRIS = lin(0x77726a);
const C_FLARE_SMOKE_HOT = lin(0xd24a38, 0.55);
const C_FLARE_SMOKE_COOL = lin(0x4a3b3b, 0.8);
const C_DOWNWASH = lin(0x9c9483);
const C_TOXIC = lin(0x33d46a);
const C_MIST = lin(0x6a80a0);
const C_MOTE = lin(0xa9bad0);

// HDR (linear, > 1 so they bloom)
const SPARK_HOT: RGB = [4.6, 2.5, 0.9];
const SPARK_WHITE: RGB = [3.6, 3.2, 2.6];
const SPARK_PALE: RGB = [2.7, 2.35, 1.8];
const FLASH_WARM: RGB = [3.4, 2.5, 1.5];
const FIRE_CORE: RGB = [5.2, 2.9, 1.0];
const FIRE_MID: RGB = [2.6, 0.9, 0.24];
const FIRE_END: RGB = [0.55, 0.11, 0.03];
const EMBER: RGB = [3.4, 1.15, 0.32];
const EMBER_END: RGB = [0.7, 0.13, 0.03];
const FLARE_CORE: RGB = [6.0, 1.15, 0.7];
const FLARE_END: RGB = [1.3, 0.1, 0.05];

// ---------------------------------------------------------------------------------------------
// small structures
// ---------------------------------------------------------------------------------------------

interface Emitter {
  kind: EmitterKind;
  x: number;
  y: number;
  z: number;
  rate: number;
  radius: number;
  height: number;
  acc: number;
  burst: number;
}

interface FlareState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  seed: number;
  accCore: number;
  accSpark: number;
  accSmoke: number;
  accGlow: number;
  order: number;
}

const flareFlicker = (f: FlareState): number => {
  const t = f.age + f.seed * 10;
  const v = 0.8 + 0.13 * Math.sin(t * 23) + 0.09 * Math.sin(t * 57 + 2.1) + 0.05 * Math.sin(t * 91 + 0.7);
  return Math.max(0.45, Math.min(1.15, v));
};

const ringVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ringFragment = /* glsl */ `
  varying vec2 vP;
  uniform float uOpacity;
  uniform vec3 uColor;
  void main() {
    float r = length(vP);
    float band = smoothstep(0.55, 0.93, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float a = band * uOpacity;
    if (!(a > 0.002)) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Soft, dusty expanding shock front along the ground (3 pooled meshes). */
class ShockRings {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];
  private readonly age = new Float32Array(3);
  private readonly maxR = new Float32Array(3);
  private readonly alive = new Uint8Array(3);
  private readonly geo = new THREE.PlaneGeometry(2, 2);
  private cursor = 0;

  constructor() {
    this.geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.8, 0.58) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 15;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(mat);
    }
  }

  spawn(x: number, z: number, radius: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % 3;
    this.alive[i] = 1;
    this.age[i] = 0;
    this.maxR[i] = radius;
    const m = this.meshes[i]!;
    m.position.set(x, 0.07, z);
    m.visible = true;
  }

  update(dt: number): void {
    const LIFE = 0.55;
    for (let i = 0; i < 3; i++) {
      if (!this.alive[i]) continue;
      const age = this.age[i]! + dt;
      this.age[i] = age;
      if (age >= LIFE) {
        this.alive[i] = 0;
        this.meshes[i]!.visible = false;
        continue;
      }
      const t = age / LIFE;
      const e = 1 - (1 - t) * (1 - t);
      const r = 0.5 + (this.maxR[i]! - 0.5) * e;
      this.meshes[i]!.scale.set(r, 1, r);
      this.mats[i]!.uniforms.uOpacity!.value = Math.pow(1 - t, 1.5) * 0.3;
    }
  }

  clear(): void {
    for (let i = 0; i < 3; i++) {
      this.alive[i] = 0;
      this.meshes[i]!.visible = false;
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export interface FxStats {
  normalParticles: number;
  additiveParticles: number;
  bulletHoles: number;
  bloodSplats: number;
  scorches: number;
  tracers: number;
  casings: number;
  emitters: number;
  flares: number;
  motes: number;
}

// ---------------------------------------------------------------------------------------------
// implementation
// ---------------------------------------------------------------------------------------------

class FxImpl implements FxApi {
  readonly root = new THREE.Group();

  private readonly rng = new Rng(0xd15ea5e);
  private readonly normal: ParticleBatch;
  private readonly additive: ParticleBatch;
  private readonly nCombat: Pool;
  private readonly nAmb: Pool;
  private readonly nMotes: Pool;
  private readonly nFlare: Pool;
  private readonly aCombat: Pool;
  private readonly aAmb: Pool;
  private readonly aFlare: Pool;
  private readonly holes: DecalPool;
  private readonly blood_: DecalPool;
  private readonly scorch: DecalPool;
  private readonly tracers: TracerPool;
  private readonly casings: CasingPool;
  private readonly rings = new ShockRings();
  private readonly textures: THREE.Texture[] = [];

  private readonly emitters: Emitter[] = [];
  private readonly flares: FlareState[] = [];
  private flareCounter = 0;
  private readonly motePhase = new Float32Array(MOTE_CAP);

  private particleScale = 1;
  private decalScale = 1;
  private time = 0;
  private dt = 1 / 60;
  private windX = 0.5;
  private windZ = 0.2;
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly tmpMote = { x: 0, y: 0, z: 0 };
  private warnedEmitters = false;

  constructor() {
    const M = FX.maxParticles;
    const nCombat = Math.round(M * 0.36);
    const nAmb = Math.round(M * 0.16);
    const nFlare = Math.round(M * 0.1);
    const aCombat = Math.round(M * 0.22);
    const aAmb = Math.round(M * 0.08);
    const aFlare = M - nCombat - nAmb - nFlare - MOTE_CAP - aCombat - aAmb;
    const noise = makeNoiseTexture();
    this.textures.push(noise);
    this.normal = new ParticleBatch(
      false,
      [
        { name: 'combat', size: nCombat },
        { name: 'ambient', size: nAmb },
        { name: 'flare', size: nFlare },
        { name: 'motes', size: MOTE_CAP },
      ],
      this.rng,
      noise,
    );
    this.additive = new ParticleBatch(
      true,
      [
        { name: 'combat', size: aCombat },
        { name: 'ambient', size: aAmb },
        { name: 'flare', size: aFlare },
      ],
      this.rng,
      noise,
    );
    this.nCombat = this.normal.pool('combat');
    this.nAmb = this.normal.pool('ambient');
    this.nMotes = this.normal.pool('motes');
    this.nFlare = this.normal.pool('flare');
    this.aCombat = this.additive.pool('combat');
    this.aAmb = this.additive.pool('ambient');
    this.aFlare = this.additive.pool('flare');

    const holeAtlas = makeBulletHoleAtlas();
    const bloodAtlas = makeBloodAtlas();
    const scorchAtlas = makeScorchAtlas();
    this.textures.push(holeAtlas, bloodAtlas, scorchAtlas);
    this.holes = new DecalPool({
      name: 'FxBulletHoles',
      cap: FX.maxBulletHoles,
      atlas: holeAtlas,
      cols: HOLE_VARIANTS,
      rows: 6,
      roughness: 1,
      renderOrder: 10,
    });
    this.blood_ = new DecalPool({
      name: 'FxBlood',
      cap: FX.maxBloodSplats,
      atlas: bloodAtlas,
      cols: BLOOD_VARIANTS,
      rows: 1,
      roughness: 0.9,
      renderOrder: 11,
      offset: 1.2,
    });
    this.scorch = new DecalPool({
      name: 'FxScorch',
      cap: FX.maxScorches,
      atlas: scorchAtlas,
      cols: SCORCH_VARIANTS,
      rows: 1,
      roughness: 1,
      renderOrder: 12,
      offset: 1.4,
    });
    this.tracers = new TracerPool(FX.maxTracers);
    this.casings = new CasingPool(FX.maxCasings, this.rng);

    this.root.name = 'Fx';
    this.root.add(
      this.holes.mesh,
      this.blood_.mesh,
      this.scorch.mesh,
      this.rings.group,
      this.normal.mesh,
      this.additive.mesh,
      this.tracers.mesh,
      this.casings.brass,
      this.casings.shells,
    );

    for (let i = 0; i < MAX_FLARES; i++) {
      this.flares.push({ active: false, x: 0, y: 0, z: 0, age: 0, seed: 0, accCore: 0, accSpark: 0, accSmoke: 0, accGlow: 0, order: 0 });
    }
    for (let i = 0; i < MOTE_CAP; i++) this.motePhase[i] = this.rng.next() * 6.283;
  }

  // -------------------------------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------------------------------

  setQuality(particleScale: number, decalScale: number): void {
    this.particleScale = Math.max(0.2, Math.min(1, particleScale));
    this.decalScale = Math.max(0.2, Math.min(1, decalScale));
    const ps = this.particleScale;
    this.normal.setPoolLimit(this.nCombat, this.nCombat.size * ps);
    this.normal.setPoolLimit(this.nAmb, this.nAmb.size * ps);
    this.normal.setPoolLimit(this.nMotes, this.nMotes.size * ps);
    this.additive.setPoolLimit(this.aCombat, this.aCombat.size * ps);
    this.additive.setPoolLimit(this.aAmb, this.aAmb.size * ps);
    this.normal.setPoolLimit(this.nFlare, this.nFlare.size * ps);
    this.additive.setPoolLimit(this.aFlare, this.aFlare.size * ps);
    const ds = this.decalScale;
    this.holes.setLimit(FX.maxBulletHoles * ds);
    this.blood_.setLimit(FX.maxBloodSplats * ds);
    this.scorch.setLimit(Math.max(2, FX.maxScorches * ds));
    this.tracers.setLimit(Math.max(6, FX.maxTracers * ps));
    this.casings.setLimit(Math.max(6, FX.maxCasings * ps));
  }

  // -------------------------------------------------------------------------------------------
  // particle helpers
  // -------------------------------------------------------------------------------------------

  private smoke(
    pool: Pool,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    s0: number,
    s1: number,
    c0: RGB,
    a0: number,
    drag: number,
    grav: number,
    wind = 0.5,
    ground: number = GROUND.NONE,
    c1: RGB = c0,
    turb = 0,
  ): void {
    const b = this.normal;
    const s = b.begin();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = s0; s.size1 = s1;
    s.r0 = c0[0]; s.g0 = c0[1]; s.b0 = c0[2]; s.a0 = a0;
    s.r1 = c1[0]; s.g1 = c1[1]; s.b1 = c1[2]; s.a1 = 0;
    s.drag = drag; s.grav = grav; s.wind = wind; s.turb = turb;
    s.spin = this.rng.signed() * 0.5;
    s.kind = KIND.SMOKE; s.fadeIn = 0.05; s.ground = ground;
    b.emit(pool);
  }

  private soft(
    pool: Pool,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    s0: number,
    s1: number,
    c0: RGB,
    c1: RGB,
    a0: number,
    drag: number,
    grav: number,
    turb = 0,
    wind = 0,
  ): void {
    const b = this.additive;
    const s = b.begin();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = s0; s.size1 = s1;
    s.r0 = c0[0]; s.g0 = c0[1]; s.b0 = c0[2]; s.a0 = a0;
    s.r1 = c1[0]; s.g1 = c1[1]; s.b1 = c1[2]; s.a1 = 0;
    s.drag = drag; s.grav = grav; s.turb = turb; s.wind = wind;
    s.kind = KIND.SOFT; s.fadeIn = 0.015;
    b.emit(pool);
  }

  private spark(
    pool: Pool,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    thick: number,
    stretch: number,
    c: RGB,
    grav: number,
    drag: number,
    ground: number = GROUND.BOUNCE,
  ): void {
    const b = this.additive;
    const s = b.begin();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = thick; s.size1 = thick * 0.5;
    s.r0 = c[0]; s.g0 = c[1]; s.b0 = c[2]; s.a0 = 1;
    s.r1 = c[0] * 0.35; s.g1 = c[1] * 0.2; s.b1 = c[2] * 0.1; s.a1 = 0;
    s.drag = drag; s.grav = grav; s.kind = KIND.SPARK; s.stretch = stretch; s.fadeIn = 0.004; s.ground = ground;
    b.emit(pool);
  }

  private chip(
    pool: Pool,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    c: RGB,
    grav: number,
    ground: number,
    stretch = 0,
    spin = 0,
    a0 = 1,
  ): void {
    const b = this.normal;
    const s = b.begin();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = size; s.size1 = size * 0.75;
    const k = 0.75 + this.rng.next() * 0.4;
    s.r0 = c[0] * k; s.g0 = c[1] * k; s.b0 = c[2] * k; s.a0 = a0;
    s.r1 = c[0] * k; s.g1 = c[1] * k; s.b1 = c[2] * k; s.a1 = a0;
    s.drag = 0.5; s.grav = grav; s.kind = KIND.CHIP; s.stretch = stretch; s.spin = spin; s.fadeIn = 0.005; s.ground = ground;
    b.emit(pool);
  }

  private drop(pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: RGB, a0: number): void {
    const b = this.normal;
    const s = b.begin();
    s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
    s.life = life; s.size0 = size; s.size1 = size * 0.8;
    s.r0 = c[0]; s.g0 = c[1]; s.b0 = c[2]; s.a0 = a0;
    s.r1 = c[0]; s.g1 = c[1]; s.b1 = c[2]; s.a1 = a0;
    s.drag = 0.3; s.grav = 9.8; s.kind = KIND.DROP; s.stretch = 0.006; s.fadeIn = 0.004; s.ground = GROUND.DIE;
    b.emit(pool);
  }

  // -------------------------------------------------------------------------------------------
  // decal helpers
  // -------------------------------------------------------------------------------------------

  private bulletHole(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: HoleSurface, size: number): void {
    const off = 0.012;
    this.holes.add(
      x + nx * off, y + ny * off, z + nz * off, nx, ny, nz, size,
      this.rng.next() * Math.PI * 2, this.rng.int(HOLE_VARIANTS), HOLE_ROWS[surface], 110, 8,
    );
  }

  private splat(x: number, z: number, size: number): void {
    this.blood_.add(x, 0.03, z, 0, 1, 0, size, this.rng.next() * Math.PI * 2, this.rng.int(BLOOD_VARIANTS), 0, 60, 16);
  }

  // -------------------------------------------------------------------------------------------
  // API: impacts
  // -------------------------------------------------------------------------------------------

  impact(p: Vec3Like, n: Vec3Like, surface: SurfaceKind, opts?: { strong?: boolean }): void {
    const rng = this.rng;
    const strong = opts?.strong ?? false;
    const k = strong ? 1.45 : 1;
    if (surface === 'flesh') {
      this.blood(p, { x: -n.x, y: -n.y, z: -n.z }, { amount: strong ? 1.4 : 1 });
      return;
    }
    const ox = p.x + n.x * 0.02;
    const oy = p.y + n.y * 0.02;
    const oz = p.z + n.z * 0.02;
    const pn = this.nCombat;
    const pa = this.aCombat;

    const holeSurface: HoleSurface = surface === 'glass' ? 'glass' : surface === 'metal' ? 'metal' : surface === 'wood' ? 'wood' : surface === 'dirt' ? 'dirt' : surface === 'fabric' ? 'fabric' : 'concrete';
    const holeSize = holeSurface === 'concrete' ? 0.26 : holeSurface === 'glass' ? 0.3 : holeSurface === 'fabric' ? 0.16 : holeSurface === 'dirt' ? 0.24 : 0.2;
    this.bulletHole(p.x, p.y, p.z, n.x, n.y, n.z, holeSurface, holeSize * (strong ? 1.25 : 1) * (0.9 + rng.next() * 0.2));

    switch (surface) {
      case 'concrete': {
        this.soft(pa, ox, oy, oz, n.x * 0.15, n.y * 0.15, n.z * 0.15, 0.05, 0.2 * k, 0.07, [1.8, 1.65, 1.4], [1, 0.9, 0.7], 0.75, 0, 0);
        const puffs = strong ? 4 : 3;
        for (let i = 0; i < puffs; i++) {
          const sp = rng.range(0.9, 2.0);
          this.smoke(pn, ox, oy, oz, n.x * sp + rng.signed() * 0.4, n.y * sp + rng.signed() * 0.3 + 0.3, n.z * sp + rng.signed() * 0.4,
            rng.range(0.6, 1.1), 0.16, rng.range(0.62, 0.9) * k, C_DUST_CONCRETE, 0.5, 2.4, -0.12, 0.45);
        }
        // lingering faint haze
        this.smoke(pn, ox, oy, oz, n.x * 0.5, n.y * 0.5 + 0.2, n.z * 0.5, rng.range(1.1, 1.6), 0.25, 1.15 * k, C_DUST_CONCRETE, 0.2, 1.4, -0.06, 0.5);
        const chips = Math.round(rng.range(5, 8) * k);
        for (let i = 0; i < chips; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.0);
          const sp = rng.range(2.5, 7);
          this.chip(pn, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.4, 0.9), rng.range(0.024, 0.045), C_CHIP_CONCRETE, 9.8, GROUND.BOUNCE, 0.003, rng.signed() * 20);
        }
        for (let i = 0; i < 3; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.15);
          const sp = rng.range(3, 7.5);
          this.spark(pa, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.1, 0.22), 0.013, 0.024, SPARK_PALE, 6, 1.2);
        }
        break;
      }
      case 'metal': {
        this.soft(pa, ox, oy, oz, n.x * 0.2, n.y * 0.2, n.z * 0.2, 0.06, 0.2, 0.06, FLASH_WARM, FLASH_WARM, 0.9, 0, 0);
        const count = Math.round(rng.range(7, 11) * k);
        for (let i = 0; i < count; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.2);
          const sp = rng.range(4, 11.5);
          const hot = rng.next() < 0.7 ? SPARK_HOT : SPARK_WHITE;
          this.spark(pa, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.18, 0.42), 0.016, 0.034, hot, 8, 0.8);
        }
        this.smoke(pn, ox, oy, oz, n.x * 0.6, n.y * 0.6 + 0.3, n.z * 0.6, 0.55, 0.06, 0.26, C_SMOKE_GREY, 0.14, 2.5, -0.2, 0.4);
        break;
      }
      case 'dirt': {
        const puffs = strong ? 4 : 3;
        for (let i = 0; i < puffs; i++) {
          const sp = rng.range(0.6, 1.4);
          this.smoke(pn, ox, oy, oz, n.x * sp + rng.signed() * 0.4, n.y * sp + 0.2, n.z * sp + rng.signed() * 0.4, rng.range(0.6, 1.0), 0.14, rng.range(0.5, 0.7) * k, C_DUST_DIRT, 0.4, 2.6, -0.05, 0.5);
        }
        const clods = Math.round(5 * k);
        for (let i = 0; i < clods; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.05);
          const sp = rng.range(1.5, 4);
          this.chip(pn, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.6, 1.0), rng.range(0.035, 0.06), C_CLOD, 9.8, GROUND.BOUNCE, 0, rng.signed() * 14);
        }
        break;
      }
      case 'wood': {
        for (let i = 0; i < 2; i++) {
          const sp = rng.range(0.6, 1.3);
          this.smoke(pn, ox, oy, oz, n.x * sp + rng.signed() * 0.3, n.y * sp + 0.2, n.z * sp + rng.signed() * 0.3, rng.range(0.4, 0.7), 0.09, rng.range(0.36, 0.5) * k, C_DUST_WOOD, 0.28, 3, -0.1, 0.4);
        }
        const count = Math.round(6 * k);
        for (let i = 0; i < count; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.1);
          const sp = rng.range(2, 6);
          this.chip(pn, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.4, 0.8), rng.range(0.013, 0.022), C_SPLINTER, 9.8, GROUND.BOUNCE, 0.02, 0);
        }
        break;
      }
      case 'glass': {
        for (let i = 0; i < 7; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.2);
          const sp = rng.range(2, 6);
          this.spark(pa, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.2, 0.4), 0.008, 0.016, [2.2, 2.6, 3.0], 6, 1);
        }
        for (let i = 0; i < 4; i++) {
          coneDir(rng, n.x, n.y, n.z, 1.0);
          const sp = rng.range(1.5, 4);
          this.chip(pn, ox, oy, oz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.5, 0.9), rng.range(0.012, 0.02), C_SHARD, 9.8, GROUND.BOUNCE, 0.004, rng.signed() * 25, 0.85);
        }
        this.smoke(pn, ox, oy, oz, n.x * 0.5, n.y * 0.5, n.z * 0.5, 0.4, 0.06, 0.22, [0.7, 0.75, 0.8], 0.12, 3, 0, 0.3);
        break;
      }
      case 'fabric':
      default: {
        for (let i = 0; i < 2; i++) {
          const sp = rng.range(0.5, 1.1);
          this.smoke(pn, ox, oy, oz, n.x * sp + rng.signed() * 0.3, n.y * sp + 0.15, n.z * sp + rng.signed() * 0.3, rng.range(0.4, 0.7), 0.09, rng.range(0.32, 0.46) * k, C_DUST_FABRIC, 0.22, 3, -0.05, 0.4);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // API: blood
  // -------------------------------------------------------------------------------------------

  blood(p: Vec3Like, dir: Vec3Like, opts?: { amount?: number; head?: boolean; kill?: boolean }): void {
    const rng = this.rng;
    const amount = opts?.amount ?? 1;
    const head = opts?.head ?? false;
    const kill = opts?.kill ?? false;
    const mult = amount * (kill ? 1.6 : 1) * (head ? 1.3 : 1);
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl;
    const dy = dir.y / dl;
    const dz = dir.z / dl;
    const pn = this.nCombat;

    // mist
    const mist = Math.max(1, Math.round(2 * mult));
    for (let i = 0; i < mist; i++) {
      const sp = rng.range(1.2, 2.6);
      this.smoke(pn, p.x, p.y, p.z, dx * sp + rng.signed() * 0.6, dy * sp + 0.3 + rng.signed() * 0.5, dz * sp + rng.signed() * 0.6,
        rng.range(0.3, 0.55), 0.07, rng.range(0.24, 0.36) * (kill ? 1.25 : 1), C_BLOOD_MIST, 0.34, 3.6, 0, 0.2);
    }
    // droplets
    const drops = Math.round(6 * mult);
    for (let i = 0; i < drops; i++) {
      coneDir(rng, dx, dy, dz, 0.5);
      const sp = rng.range(3, 8.5);
      this.drop(pn, p.x, p.y, p.z, tmpDir.x * sp, tmpDir.y * sp + 1.0, tmpDir.z * sp, rng.range(0.5, 1.0), rng.range(0.013, 0.03), C_BLOOD, 0.92);
    }
    // heavier chunks on head shots / kills
    if (head || kill) {
      const chunks = head ? 5 : 3;
      for (let i = 0; i < chunks; i++) {
        coneDir(rng, dx, dy, dz, 0.75);
        const sp = rng.range(2, 5.5);
        this.chip(pn, p.x, p.y, p.z, tmpDir.x * sp, tmpDir.y * sp + 0.8, tmpDir.z * sp, rng.range(0.6, 1.0), rng.range(0.03, 0.055), C_BLOOD_CHUNK, 9.8, GROUND.DIE, 0.004, rng.signed() * 15, 0.95);
      }
    }
    // ground splats
    if (kill) {
      this.splat(p.x + dx * 0.35, p.z + dz * 0.35, rng.range(0.7, 1.1));
      this.splat(p.x + dx * rng.range(0.8, 1.6) + rng.signed() * 0.3, p.z + dz * rng.range(0.8, 1.6) + rng.signed() * 0.3, rng.range(0.25, 0.45));
    } else if (rng.next() < 0.1) {
      this.splat(p.x + dx * rng.range(0.6, 1.6), p.z + dz * rng.range(0.6, 1.6), rng.range(0.16, 0.34));
    }
  }

  // -------------------------------------------------------------------------------------------
  // API: explosion
  // -------------------------------------------------------------------------------------------

  explosion(p: Vec3Like, radius: number): void {
    const rng = this.rng;
    const s = Math.max(0.5, Math.min(2.2, radius / 7.5));
    const cx = p.x;
    const cy = Math.max(0.4, p.y);
    const cz = p.z;
    const pn = this.nCombat;
    const pa = this.aCombat;

    // flash
    this.soft(pa, cx, cy, cz, 0, 0, 0, 0.09, 2.3 * s, 4.4 * s, [6, 4.2, 2.2], [2.6, 1.3, 0.5], 1, 0, 0);
    this.soft(pa, cx, cy, cz, 0, 0, 0, 0.14, 1.4 * s, 2.6 * s, [5, 3.0, 1.3], [1.6, 0.7, 0.25], 0.9, 0, 0);

    // fireball
    const fire = Math.round(15 * Math.min(1.4, s));
    for (let i = 0; i < fire; i++) {
      const th = rng.next() * Math.PI * 2;
      const ph = Math.acos(rng.range(-0.35, 1));
      const sp = rng.range(2.5, 6.5) * s;
      const vx = Math.sin(ph) * Math.cos(th) * sp;
      const vz = Math.sin(ph) * Math.sin(th) * sp;
      const vy = Math.abs(Math.cos(ph)) * sp * 0.8 + 1.4 * s;
      this.soft(pa, cx + rng.signed() * 0.4 * s, cy + rng.signed() * 0.3 * s, cz + rng.signed() * 0.4 * s, vx, vy, vz,
        rng.range(0.35, 0.75), rng.range(0.6, 1.0) * s, rng.range(1.9, 2.8) * s, i % 3 === 0 ? FIRE_CORE : FIRE_MID, FIRE_END, 0.9, 3.2, -1.4);
    }

    // smoke plume (warm at first, then dark)
    const plume = Math.round(22 * Math.min(1.3, s));
    for (let i = 0; i < plume; i++) {
      const th = rng.next() * Math.PI * 2;
      const lat = rng.range(0.4, 2.2) * s;
      this.smoke(pn, cx + Math.cos(th) * 0.5 * s, cy + rng.range(0, 0.8) * s, cz + Math.sin(th) * 0.5 * s,
        Math.cos(th) * lat, rng.range(2.2, 5.6) * (0.6 + 0.4 * s), Math.sin(th) * lat,
        rng.range(2.4, 4.2), rng.range(0.9, 1.3) * s, rng.range(3.0, 4.2) * s, [0.1, 0.066, 0.045], 0.8, 0.85, -0.9, 0.9, GROUND.NONE, [0.028, 0.028, 0.032], 0.5);
    }

    // ground dust ring
    const ring = Math.round(18 * Math.min(1.3, s));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + rng.signed() * 0.2;
      const sp = rng.range(5.5, 9) * s;
      this.smoke(pn, cx + Math.cos(a) * 0.6, 0.15, cz + Math.sin(a) * 0.6, Math.cos(a) * sp, rng.range(0.1, 0.9), Math.sin(a) * sp,
        rng.range(0.9, 1.5), 0.6 * s, rng.range(1.8, 2.6) * s, C_DUST_CONCRETE, 0.42, 2.6, 0, 0.2, GROUND.SETTLE, C_DUST_DIRT);
    }

    // sparks
    const sparks = Math.round(30 * Math.min(1.3, s));
    for (let i = 0; i < sparks; i++) {
      coneDir(rng, 0, 1, 0, 1.35);
      const sp = rng.range(8, 21) * s;
      this.spark(pa, cx, cy, cz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.7, 1.4), 0.014, 0.03, rng.next() < 0.7 ? SPARK_HOT : SPARK_WHITE, 9.8, 0.3);
    }

    // debris chunks
    const debris = Math.round(14 * Math.min(1.3, s));
    for (let i = 0; i < debris; i++) {
      coneDir(rng, 0, 1, 0, 1.2);
      const sp = rng.range(6, 15) * s;
      this.chip(pn, cx, cy, cz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(1.2, 2.4), rng.range(0.06, 0.14), C_DEBRIS, 9.8, GROUND.BOUNCE, 0, rng.signed() * 12);
    }

    // embers
    for (let i = 0; i < 12; i++) {
      coneDir(rng, 0, 1, 0, 1.4);
      const sp = rng.range(1, 3.4) * s;
      this.soft(pa, cx, cy, cz, tmpDir.x * sp, tmpDir.y * sp + 1, tmpDir.z * sp, rng.range(1.6, 3.2), rng.range(0.04, 0.07), 0.02, EMBER, EMBER_END, 0.9, 0.5, -0.12, 1.1, 1);
    }

    this.rings.spawn(cx, cz, radius * 0.95);
    const scorchSize = 1.0 + radius * 0.34;
    this.scorch.add(cx, 0.032, cz, 0, 1, 0, scorchSize, rng.next() * Math.PI * 2, rng.int(SCORCH_VARIANTS), 0, 150, 18);
  }

  // -------------------------------------------------------------------------------------------
  // API: small effects
  // -------------------------------------------------------------------------------------------

  tracer(from: Vec3Like, to: Vec3Like, colorHex: number): void {
    this.tracers.add(from, to, colorHex);
  }

  muzzleSmoke(p: Vec3Like, dir: Vec3Like, strong = false): void {
    const rng = this.rng;
    const n = strong ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const sp = rng.range(0.7, 1.6);
      this.smoke(this.nCombat, p.x + dir.x * 0.05 * i, p.y + dir.y * 0.05 * i, p.z + dir.z * 0.05 * i,
        dir.x * sp + rng.signed() * 0.25, dir.y * sp + rng.range(0, 0.35), dir.z * sp + rng.signed() * 0.25,
        rng.range(0.5, 0.85), 0.05, (strong ? 0.32 : 0.22) * rng.range(0.85, 1.2), [0.3, 0.315, 0.345], strong ? 0.15 : 0.1, 2.6, -0.3, 0.6);
    }
  }

  casing(p: Vec3Like, vel: Vec3Like, kind: WeaponId): void {
    this.casings.spawn(p, vel, kind);
  }

  dust(p: Vec3Like, amount: number): void {
    const rng = this.rng;
    const a = Math.max(0.1, Math.min(1, amount));
    const n = 2 + Math.round(3 * a);
    for (let i = 0; i < n; i++) {
      const ang = rng.next() * Math.PI * 2;
      const sp = rng.range(0.4, 1.2) * (0.5 + a);
      this.smoke(this.nCombat, p.x, Math.max(0.08, p.y), p.z, Math.cos(ang) * sp, rng.range(0.15, 0.5), Math.sin(ang) * sp,
        rng.range(0.5, 0.9), 0.14, rng.range(0.45, 0.65), C_DUST_CONCRETE, 0.17 * a + 0.05, 2.2, -0.05, 0.4, GROUND.SETTLE);
    }
  }

  sparkle(p: Vec3Like, colorHex: number, count = 10): void {
    const rng = this.rng;
    const c = lin(colorHex);
    const hot: RGB = [c[0] * 3 + 0.4, c[1] * 3 + 0.4, c[2] * 3 + 0.4];
    const cool: RGB = [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5];
    this.soft(this.aCombat, p.x, p.y, p.z, 0, 0, 0, 0.14, 0.22, 0.5, [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6], cool, 0.55, 0, 0);
    for (let i = 0; i < count; i++) {
      coneDir(rng, 0, 1, 0, 2.6);
      const sp = rng.range(1, 3.5);
      this.soft(this.aCombat, p.x, p.y, p.z, tmpDir.x * sp, tmpDir.y * sp + 0.6, tmpDir.z * sp, rng.range(0.45, 0.9), rng.range(0.035, 0.07), 0.01, hot, cool, 1, 3, 1.2);
    }
    for (let i = 0; i < Math.min(4, Math.round(count / 3)); i++) {
      coneDir(rng, 0, 1, 0, 1.3);
      const sp = rng.range(2, 4.5);
      this.spark(this.aCombat, p.x, p.y, p.z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.3, 0.6), 0.012, 0.03, hot, 5, 1.5, GROUND.NONE);
    }
  }

  // -------------------------------------------------------------------------------------------
  // API: flare
  // -------------------------------------------------------------------------------------------

  flare(p: Vec3Like): FlareHandle {
    let slot = this.flares.find((f) => !f.active);
    if (!slot) {
      slot = this.flares.reduce((a, b) => (a.order <= b.order ? a : b));
    }
    slot.active = true;
    slot.x = p.x;
    slot.y = p.y;
    slot.z = p.z;
    slot.age = 0;
    slot.seed = this.rng.next();
    slot.accCore = slot.accSpark = slot.accSmoke = slot.accGlow = 0;
    slot.order = ++this.flareCounter;
    const state = slot;
    const token = state.order;
    return {
      intensity: () => (state.active && state.order === token ? flareFlicker(state) : 0),
      setPosition: (q: Vec3Like) => {
        if (state.order !== token) return;
        state.x = q.x;
        state.y = q.y;
        state.z = q.z;
      },
      stop: () => {
        if (state.order === token) state.active = false;
      },
    };
  }

  private updateFlares(dt: number): void {
    const rng = this.rng;
    const ps = this.particleScale;
    for (const f of this.flares) {
      if (!f.active) continue;
      f.age += dt;
      const fl = flareFlicker(f);
      const tx = f.x;
      const ty = f.y + 0.14;
      const tz = f.z;
      // flame core
      f.accCore += 58 * ps * dt;
      while (f.accCore >= 1) {
        f.accCore -= 1;
        this.soft(this.aFlare, tx + rng.signed() * 0.012, ty, tz + rng.signed() * 0.012, rng.signed() * 0.16, rng.range(0.9, 1.7), rng.signed() * 0.16,
          rng.range(0.2, 0.36), rng.range(0.14, 0.2) * fl, 0.03, FLARE_CORE, FLARE_END, 0.9, 1.5, -0.6);
      }
      // glow halos (refreshed every frame, short life)
      f.accGlow += 60 * dt;
      while (f.accGlow >= 1) {
        f.accGlow -= 1;
        this.soft(this.aFlare, tx, ty + 0.05, tz, 0, 0, 0, 0.06, (0.75 + 0.3 * fl) * 1.0, 0.7, [2.6, 0.32, 0.2], [2.6, 0.32, 0.2], 0.6 * fl, 0, 0);
        this.soft(this.aFlare, tx, ty + 0.1, tz, 0, 0, 0, 0.06, 2.6 + 0.6 * fl, 2.4, [1.5, 0.13, 0.08], [1.5, 0.13, 0.08], 0.1 * fl, 0, 0);
      }
      // sparks
      f.accSpark += 24 * ps * dt;
      while (f.accSpark >= 1) {
        f.accSpark -= 1;
        coneDir(rng, 0, 1, 0, 0.75);
        const sp = rng.range(2.4, 5.5);
        this.spark(this.aFlare, tx, ty, tz, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.35, 0.85), 0.009, 0.03, [5, 1.6, 0.6], 5, 0.3);
      }
      // smoke plume
      f.accSmoke += 26 * ps * dt;
      while (f.accSmoke >= 1) {
        f.accSmoke -= 1;
        this.smoke(this.nFlare, tx + rng.signed() * 0.03, ty + 0.05, tz + rng.signed() * 0.03, rng.signed() * 0.22, rng.range(1.5, 2.3), rng.signed() * 0.22,
          rng.range(4.2, 6.2), 0.22, rng.range(2.2, 2.8), C_FLARE_SMOKE_HOT, 0.46, 0.5, -0.32, 1.0, GROUND.NONE, C_FLARE_SMOKE_COOL, 0.45);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // API: downwash
  // -------------------------------------------------------------------------------------------

  downwash(center: Vec3Like, radius: number, strength: number): void {
    const rng = this.rng;
    const st = Math.max(0, Math.min(1, strength));
    if (st < 0.02) return;
    const rate = 130 * st * this.particleScale;
    let count = rate * this.dt;
    let n = Math.floor(count);
    if (rng.next() < count - n) n++;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const r0 = radius * rng.range(0.15, 0.55);
      const sp = rng.range(5, 9) * (0.5 + st);
      const swirl = rng.range(2, 4.2) * st;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.smoke(this.nCombat, center.x + ca * r0, 0.15 + rng.next() * 0.35, center.z + sa * r0,
        ca * sp - sa * swirl, rng.range(0.1, 0.7), sa * sp + ca * swirl,
        rng.range(0.9, 1.6), 0.4, rng.range(1.5, 2.4), C_DOWNWASH, 0.3 * st + 0.05, 1.5, 0, 0.3, GROUND.SETTLE, C_DUST_DIRT);
    }
    // debris
    count = 14 * st * this.dt * this.particleScale;
    n = Math.floor(count);
    if (rng.next() < count - n) n++;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const r0 = radius * rng.range(0.1, 0.5);
      const sp = rng.range(4.5, 9) * (0.5 + st);
      this.chip(this.nCombat, center.x + Math.cos(a) * r0, 0.1, center.z + Math.sin(a) * r0, Math.cos(a) * sp, rng.range(1, 3), Math.sin(a) * sp,
        rng.range(0.7, 1.4), rng.range(0.02, 0.05), C_DEBRIS, 9.8, GROUND.BOUNCE, 0.004, rng.signed() * 20);
    }
  }

  // -------------------------------------------------------------------------------------------
  // API: emitters
  // -------------------------------------------------------------------------------------------

  emitter(kind: EmitterKind, p: Vec3Like, opts?: { rate?: number; radius?: number; height?: number }): void {
    if (this.emitters.length >= MAX_EMITTERS) {
      if (!this.warnedEmitters) {
        this.warnedEmitters = true;
        console.warn('Fx: emitter cap reached, ignoring further emitters');
      }
      return;
    }
    const defaults: Record<EmitterKind, { rate: number; radius: number; height: number }> = {
      steam: { rate: 7, radius: 0.15, height: 2.2 },
      toxic: { rate: 4, radius: 0.8, height: 1.6 },
      sparks: { rate: 0.35, radius: 0.1, height: 1 },
      smoke: { rate: 5, radius: 0.4, height: 4 },
      embers: { rate: 4, radius: 0.5, height: 3 },
      mist: { rate: 2.4, radius: 6, height: 1.2 },
    };
    const d = defaults[kind];
    this.emitters.push({
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      rate: opts?.rate ?? d.rate,
      radius: opts?.radius ?? d.radius,
      height: opts?.height ?? d.height,
      acc: this.rng.next(),
      burst: this.rng.range(0.2, 2.5),
    });
  }

  private updateEmitters(dt: number): void {
    const rng = this.rng;
    const cx = this.camPos.x;
    const cy = this.camPos.y;
    const cz = this.camPos.z;
    const R2 = AMBIENT_RANGE * AMBIENT_RANGE;
    const ps = this.particleScale;
    for (let ei = 0; ei < this.emitters.length; ei++) {
      const e = this.emitters[ei]!;
      const dx = e.x - cx;
      const dz = e.z - cz;
      const dy = e.y - cy;
      if (dx * dx + dz * dz + dy * dy > R2) continue;
      if (e.kind === 'sparks') {
        e.burst -= dt;
        if (e.burst <= 0) {
          e.burst = (1 / Math.max(0.02, e.rate)) * rng.range(0.5, 1.6);
          if (ps > 0.3) this.sparkBurst(e);
        }
        continue;
      }
      e.acc += e.rate * ps * dt;
      let guard = 0;
      while (e.acc >= 1 && guard++ < 8) {
        e.acc -= 1;
        this.emitAmbient(e);
      }
      if (e.acc > 4) e.acc = 0;
    }
  }

  private sparkBurst(e: Emitter): void {
    const rng = this.rng;
    this.soft(this.aAmb, e.x, e.y, e.z, 0, 0, 0, 0.08, 0.34, 0.12, [2.8, 2.1, 1.3], [1, 0.6, 0.3], 0.85, 0, 0);
    const n = 9 + rng.int(6);
    for (let i = 0; i < n; i++) {
      coneDir(rng, 0, 1, 0, 1.15);
      const sp = rng.range(2.5, 6.5);
      this.spark(this.aAmb, e.x, e.y, e.z, tmpDir.x * sp, tmpDir.y * sp, tmpDir.z * sp, rng.range(0.5, 1.0), 0.011, 0.028, rng.next() < 0.7 ? SPARK_HOT : SPARK_WHITE, 9.8, 0.4);
    }
  }

  private emitAmbient(e: Emitter): void {
    const rng = this.rng;
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * e.radius;
    const x = e.x + Math.cos(a) * r;
    const z = e.z + Math.sin(a) * r;
    switch (e.kind) {
      case 'steam': {
        const life = rng.range(1.6, 2.6);
        this.smoke(this.nAmb, x, e.y, z, rng.signed() * 0.3, (e.height / life) * rng.range(0.7, 1.15), rng.signed() * 0.3, life, 0.18, 0.6 + e.height * 0.28, C_STEAM, rng.range(0.13, 0.2), 0.6, -0.3, 0.6);
        break;
      }
      case 'toxic': {
        const life = rng.range(3, 5);
        this.smoke(this.nAmb, x, e.y + rng.range(0, 0.4), z, rng.signed() * 0.25, (e.height / life) * rng.range(0.4, 0.9), rng.signed() * 0.25, life, 0.5, rng.range(1.6, 2.4), C_TOXIC, 0.12, 0.4, -0.05, 0.8, GROUND.NONE, lin(0x1c8a4a), 0.4);
        if (rng.next() < 0.3) {
          this.soft(this.aAmb, x, e.y + 0.2, z, rng.signed() * 0.15, rng.range(0.35, 0.9), rng.signed() * 0.15, rng.range(2, 3.5), rng.range(0.035, 0.06), 0.015, [0.2, 1.4, 0.45], [0.03, 0.3, 0.1], 0.85, 0.2, -0.05, 0.5, 0.5);
        }
        break;
      }
      case 'smoke': {
        const life = rng.range(3, 5);
        this.smoke(this.nAmb, x, e.y, z, rng.signed() * 0.3, (e.height / life) * rng.range(0.8, 1.3), rng.signed() * 0.3, life, 0.35, rng.range(1.8, 2.6), C_SMOKE_DARK, rng.range(0.3, 0.42), 0.3, -0.35, 1.2, GROUND.NONE, C_SMOKE_GREY, 0.35);
        break;
      }
      case 'embers': {
        const life = rng.range(2, 4.5);
        this.soft(this.aAmb, x, e.y, z, rng.signed() * 0.3, (e.height / life) * rng.range(0.5, 1.2), rng.signed() * 0.3, life, rng.range(0.03, 0.055), 0.012, EMBER, EMBER_END, 0.95, 0.2, -0.1, 0.9, 1.4);
        break;
      }
      case 'mist': {
        const life = rng.range(6, 9);
        const s0 = rng.range(2.6, 3.6);
        const dir = rng.next() * Math.PI * 2;
        const sp = rng.range(0.12, 0.35);
        this.smoke(this.nAmb, x, e.y + s0 * 0.3 + rng.range(0, e.height * 0.3), z, Math.cos(dir) * sp, 0, Math.sin(dir) * sp, life, s0, s0 * 1.7, C_MIST, 0.07, 0.05, 0, 0.6);
        break;
      }
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // motes: sparse camera-following dust
  // -------------------------------------------------------------------------------------------

  private respawnMote(i: number, spawnAnywhere: boolean): void {
    const rng = this.rng;
    const b = this.normal;
    const s = b.begin();
    const cx = this.camPos.x;
    const cz = this.camPos.z;
    // bias toward the camera so most motes are close enough to be seen as faint specks
    const ang0 = rng.next() * Math.PI * 2;
    const rr0 = MOTE_BOX * Math.pow(rng.next(), 0.75);
    let x = cx + Math.cos(ang0) * rr0;
    let z = cz + Math.sin(ang0) * rr0;
    if (!spawnAnywhere) {
      // re-enter from the edge of the box so respawns are never visible near the camera
      const edge = rng.next() * Math.PI * 2;
      x = cx + Math.cos(edge) * MOTE_BOX * rng.range(0.85, 1);
      z = cz + Math.sin(edge) * MOTE_BOX * rng.range(0.85, 1);
    }
    s.x = x;
    s.y = rng.range(0.4, 5.5);
    s.z = z;
    s.vx = rng.signed() * 0.08;
    s.vy = rng.signed() * 0.05;
    s.vz = rng.signed() * 0.08;
    s.life = 1e9;
    const sz = rng.range(0.02, 0.045);
    s.size0 = sz;
    s.size1 = sz;
    s.r0 = C_MOTE[0]; s.g0 = C_MOTE[1]; s.b0 = C_MOTE[2]; s.a0 = 0.3;
    s.r1 = C_MOTE[0]; s.g1 = C_MOTE[1]; s.b1 = C_MOTE[2]; s.a1 = 0.3;
    s.wind = 0.45;
    s.turb = 0.22;
    s.kind = KIND.SOFT;
    s.fadeIn = 1.5;
    b.emitAt(i);
  }

  private updateMotes(): void {
    const b = this.normal;
    const pool = this.nMotes;
    const cx = this.camPos.x;
    const cz = this.camPos.z;
    const t = this.time;
    for (let i = pool.start; i < pool.start + pool.limit; i++) {
      if (!b.isAlive(i)) {
        this.respawnMote(i, true);
        continue;
      }
      b.getPosition(i, this.tmpMote);
      const dx = this.tmpMote.x - cx;
      const dz = this.tmpMote.z - cz;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d > MOTE_BOX || this.tmpMote.y < 0.15 || this.tmpMote.y > 8) {
        this.respawnMote(i, false);
        b.resetAge(i);
        continue;
      }
      const edgeFade = Math.min(1, (MOTE_BOX - d) / 4);
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + this.motePhase[i - pool.start]);
      b.setAlpha(i, 0.32 * edgeFade * tw * Math.min(1, this.particleScale + 0.3));
    }
  }

  // -------------------------------------------------------------------------------------------
  // frame update
  // -------------------------------------------------------------------------------------------

  update(dt: number, camera: THREE.Camera): void {
    dt = Math.max(0, Math.min(dt, 0.05));
    this.dt = dt;
    this.time += dt;
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.camDir);
    this.windX = 0.55 + 0.3 * Math.sin(this.time * 0.13);
    this.windZ = 0.22 + 0.2 * Math.sin(this.time * 0.11 + 1.7);

    this.updateEmitters(dt);
    this.updateFlares(dt);
    this.updateMotes();

    const c = this.camPos;
    const f = this.camDir;
    this.normal.update(dt, c.x, c.y, c.z, f.x, f.y, f.z, this.windX, this.windZ);
    this.additive.update(dt, c.x, c.y, c.z, f.x, f.y, f.z, this.windX, this.windZ);

    // droplets that hit the ground occasionally leave a small splat
    const hits = Math.min(this.normal.groundHitCount, 2);
    for (let i = 0; i < hits; i++) {
      const gh = this.normal.groundHits[i]!;
      if (this.rng.next() < 0.28) this.splat(gh.x, gh.z, this.rng.range(0.1, 0.22));
    }

    this.holes.update(dt);
    this.blood_.update(dt);
    this.scorch.update(dt);
    this.tracers.update(dt);
    this.casings.update(dt);
    this.rings.update(dt);
  }

  clear(): void {
    this.normal.clearPool(this.nCombat);
    this.additive.clearPool(this.aCombat);
    this.normal.clearPool(this.nFlare);
    this.additive.clearPool(this.aFlare);
    this.holes.clear();
    this.blood_.clear();
    this.scorch.clear();
    this.tracers.clear();
    this.casings.clear();
    this.rings.clear();
    for (const f of this.flares) f.active = false;
  }

  stats(): FxStats {
    return {
      normalParticles: this.normal.liveCount,
      additiveParticles: this.additive.liveCount,
      bulletHoles: this.holes.liveCount,
      bloodSplats: this.blood_.liveCount,
      scorches: this.scorch.liveCount,
      tracers: this.tracers.liveCount,
      casings: this.casings.liveCount,
      emitters: this.emitters.length,
      flares: this.flares.filter((f) => f.active).length,
      motes: this.nMotes.live,
    };
  }

  dispose(): void {
    this.normal.dispose();
    this.additive.dispose();
    this.holes.dispose();
    this.blood_.dispose();
    this.scorch.dispose();
    this.tracers.dispose();
    this.casings.dispose();
    this.rings.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.emitters.length = 0;
  }
}

export function createFx(): FxApi & { stats(): FxStats } {
  return new FxImpl();
}
