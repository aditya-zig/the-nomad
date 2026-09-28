/**
 * Bounded particle engine.
 *
 * A `ParticleBatch` owns ONE fixed-capacity structure-of-arrays simulation and ONE draw call: an instanced
 * camera-facing quad with a custom ShaderMaterial (soft analytic sprites, stretched streaks for sparks / splinters,
 * fog-aware blending). Two batches exist in the game: alpha-blended (smoke, dust, blood, mist - depth sorted with a
 * counting sort) and additive (fire, sparks, embers, glows - HDR colours so they bloom).
 *
 * Each batch is split into named `Pool`s (combat / ambient / ...) that behave as independent ring buffers, so a burst
 * of gunfire can never evict a burning flare's smoke and vice versa. Emission overwrites the oldest slot of a pool:
 * nothing is ever allocated after construction.
 *
 * Instanced quads are used instead of `THREE.Points` because gl_PointSize is clamped by hardware (large close smoke
 * would shrink) and point sprites vanish when their centre leaves the screen; quads have neither problem.
 */
import * as THREE from 'three';
import type { Rng } from './rng';

export const KIND = { SMOKE: 0, SOFT: 1, SPARK: 2, CHIP: 3, DROP: 4 } as const;
export const GROUND = { NONE: 0, SETTLE: 1, BOUNCE: 2, DIE: 3 } as const;

/** Mutable spawn description (scratch object owned by a batch; call `begin()` then fill fields then `emit`). */
export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Lifetime in seconds. */
  life: number;
  /** Diameter (m). For stretched kinds this is the thickness. */
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  a0: number;
  r1: number;
  g1: number;
  b1: number;
  a1: number;
  /** Velocity damping per second. */
  drag: number;
  /** Downward acceleration (negative = buoyant). */
  grav: number;
  /** Wind influence 0..1+. */
  wind: number;
  /** Lateral turbulence acceleration amplitude (m/s^2). */
  turb: number;
  rot: number;
  /** Spin (rad/s). */
  spin: number;
  kind: number;
  /** Seconds of travel added to the length of a streak (0 = camera-facing round sprite). */
  stretch: number;
  /** Seconds to ramp alpha in. */
  fadeIn: number;
  ground: number;
  seed: number;
}

export interface Pool {
  readonly name: string;
  readonly start: number;
  readonly size: number;
  limit: number;
  cursor: number;
  live: number;
}

export interface PoolDef {
  name: string;
  size: number;
}

export interface GroundHit {
  x: number;
  z: number;
  /** Speed at impact, for sizing splats. */
  s: number;
}

const BUCKETS = 256;
const SORT_MAX_DEPTH = 150;

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec4 iData; // size, rotation, kind, seed
  attribute vec4 iVel;  // world velocity xyz, stretch (seconds)
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vWorldY;
  varying float vSize;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvCenter = modelViewMatrix * vec4(iPos, 1.0);
    float size = iData.x;
    vec2 corner = position.xy;
    vec2 offs;
    if (iVel.w > 0.0) {
      vec3 vv = (modelViewMatrix * vec4(iVel.xyz, 0.0)).xyz;
      float sp2 = length(vv.xy);
      float sp3 = length(vv);
      vec2 dir = sp2 > 1e-4 ? vv.xy / sp2 : vec2(1.0, 0.0);
      float len = size + iVel.w * sp3 * (sp2 / max(sp3, 1e-4));
      vec2 perp = vec2(-dir.y, dir.x);
      // centre the streak so its head sits at +x and the tail trails behind the particle position
      offs = dir * (corner.x * len) + perp * (corner.y * size);
    } else {
      float c = cos(iData.y);
      float s = sin(iData.y);
      offs = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    }
    vec4 mvPosition = mvCenter + vec4(offs, 0.0, 0.0);
    gl_Position = projectionMatrix * mvPosition;
    // world height of this corner (camera up vector = second row of the view rotation): used to fade smoke near the ground
    vWorldY = iPos.y + offs.x * viewMatrix[1][0] + offs.y * viewMatrix[1][1];
    vUv = corner + 0.5;
    vSize = size;
    vColor = iColor;
    vKind = iData.z;
    vSeed = iData.w;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vWorldY;
  varying float vSize;
  #include <fog_pars_fragment>

  uniform sampler2D uNoise;
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    vec3 col = vColor.rgb;
    float a;
    if (vKind < 0.5) {
      // SMOKE: lumpy domain-warped cloud with a radial mask (never a flat disc); noise comes from a tiling texture
      float r2 = dot(p, p);
      float fall = clamp(1.0 - r2, 0.0, 1.0);
      vec2 uv0 = p * 0.3 + vSeed * vec2(7.13, 3.71);
      float n1 = texture2D(uNoise, uv0).r;
      float n2 = texture2D(uNoise, uv0 * 2.1 + vec2(n1 * 0.4 - 0.2)).g;
      float n3 = texture2D(uNoise, uv0 * 4.3 + vec2(n2 * 0.3 - 0.15) + 0.37).b;
      float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
      float dens = smoothstep(0.26, 0.82, n) * fall * (0.55 + 0.75 * fall);
      a = dens * 1.15;
      col *= 0.8 + 0.42 * n - 0.1 * r2;
      // fade the part of a puff that would intersect the ground (no hard clipping line)
      a *= smoothstep(0.0, 0.3 * vSize + 0.02, vWorldY);
    } else if (vKind < 1.5) {
      // SOFT: gaussian glow
      float r2 = dot(p, p);
      a = exp(-r2 * 3.4) * (1.0 - smoothstep(0.75, 1.0, sqrt(r2)));
    } else if (vKind < 2.5) {
      // SPARK: streak, head at +x
      float along = clamp(vUv.x, 0.0, 1.0);
      float across = clamp(abs(p.y), 0.0, 1.0);
      float body = pow(1.0 - across, 2.0);
      float taper = pow(along, 1.6);
      float cap = 1.0 - smoothstep(0.9, 1.0, along);
      a = body * taper * cap;
      col *= mix(0.45, 1.0, along);
    } else if (vKind < 3.5) {
      // CHIP: hard-edged irregular fragment
      float r = length(p);
      float n = texture2D(uNoise, p * 0.5 + vSeed * 13.0).a;
      float m = 0.5 + 0.42 * n;
      a = 1.0 - smoothstep(m - 0.1, m, r);
      col *= 0.62 + 0.55 * (0.5 + 0.5 * p.x * 0.7 - 0.3 * p.y);
    } else {
      // DROP: small round droplet with a soft highlight
      float r = length(p);
      a = 1.0 - smoothstep(0.7, 1.0, r);
      col *= 0.8 + 0.35 * smoothstep(0.7, 0.0, length(p - vec2(-0.32, 0.34)));
    }
    a = clamp(a * vColor.a, 0.0, 1.0);
    a += (hash21(gl_FragCoord.xy) - 0.5) * 0.004;
    if (!(a >= 0.004)) discard; // also rejects NaN
    col = clamp(col, vec3(0.0), vec3(48.0));
    #ifdef ADDITIVE
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        #else
          float fogF = smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        col *= (1.0 - fogF);
      #endif
      gl_FragColor = vec4(col, a);
    #else
      gl_FragColor = vec4(col, a);
      #include <fog_fragment>
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ParticleBatch {
  readonly mesh: THREE.Mesh;
  readonly pools: Pool[] = [];
  readonly total: number;
  readonly spec: Spawn;
  /** Ground contacts recorded by DIE-mode particles during the last update (for splats). */
  readonly groundHits: GroundHit[] = [];
  groundHitCount = 0;

  private readonly additive: boolean;
  private readonly rng: Rng;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  // simulation state (structure of arrays)
  private readonly alive: Uint8Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly col0: Float32Array;
  private readonly col1: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly wind: Float32Array;
  private readonly turb: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly kind: Float32Array;
  private readonly stretch: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly ground: Uint8Array;
  private readonly seed: Float32Array;

  // staging + GPU arrays (compact, only live particles)
  private readonly stagePos: Float32Array;
  private readonly stageCol: Float32Array;
  private readonly stageData: Float32Array;
  private readonly stageVel: Float32Array;
  private readonly gpuPos: Float32Array;
  private readonly gpuCol: Float32Array;
  private readonly gpuData: Float32Array;
  private readonly gpuVel: Float32Array;
  private readonly order: Uint16Array;
  private readonly bucketOf: Uint8Array;
  private readonly bucketStart = new Int32Array(BUCKETS + 1);
  private readonly attrs: THREE.InstancedBufferAttribute[] = [];
  liveCount = 0;

  constructor(additive: boolean, defs: PoolDef[], rng: Rng, noise: THREE.Texture) {
    this.additive = additive;
    this.rng = rng;
    let total = 0;
    for (const d of defs) {
      this.pools.push({ name: d.name, start: total, size: d.size, limit: d.size, cursor: 0, live: 0 });
      total += d.size;
    }
    this.total = total;
    const n = total;
    this.alive = new Uint8Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.col0 = new Float32Array(n * 4);
    this.col1 = new Float32Array(n * 4);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.wind = new Float32Array(n);
    this.turb = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.kind = new Float32Array(n);
    this.stretch = new Float32Array(n);
    this.fadeIn = new Float32Array(n);
    this.ground = new Uint8Array(n);
    this.seed = new Float32Array(n);

    this.stagePos = new Float32Array(n * 3);
    this.stageCol = new Float32Array(n * 4);
    this.stageData = new Float32Array(n * 4);
    this.stageVel = new Float32Array(n * 4);
    if (additive) {
      // additive needs no sorting: stage straight into the GPU arrays
      this.gpuPos = this.stagePos;
      this.gpuCol = this.stageCol;
      this.gpuData = this.stageData;
      this.gpuVel = this.stageVel;
    } else {
      this.gpuPos = new Float32Array(n * 3);
      this.gpuCol = new Float32Array(n * 4);
      this.gpuData = new Float32Array(n * 4);
      this.gpuVel = new Float32Array(n * 4);
    }
    this.order = new Uint16Array(n);
    this.bucketOf = new Uint8Array(n);

    for (let i = 0; i < 16; i++) this.groundHits.push({ x: 0, z: 0, s: 0 });

    this.spec = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.1, size1: 0.1,
      r0: 1, g0: 1, b0: 1, a0: 1, r1: 1, g1: 1, b1: 1, a1: 0,
      drag: 0, grav: 0, wind: 0, turb: 0, rot: 0, spin: 0, kind: 0, stretch: 0, fadeIn: 0.03, ground: 0, seed: 0,
    };

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name: string, arr: Float32Array, size: number) => {
      const attr = new THREE.InstancedBufferAttribute(arr, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
      this.attrs.push(attr);
    };
    mk('iPos', this.gpuPos, 3);
    mk('iColor', this.gpuCol, 4);
    mk('iData', this.gpuData, 4);
    mk('iVel', this.gpuVel, 4);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNoise: { value: null } }]),
      defines: additive ? { ADDITIVE: '' } : {},
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    // merge() clones textures; point the uniform back at the shared original so nothing leaks on dispose
    this.material.uniforms.uNoise!.value = noise;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 21 : 20;
    this.mesh.name = additive ? 'FxParticlesAdditive' : 'FxParticlesNormal';
    this.mesh.visible = false;
  }

  pool(name: string): Pool {
    const p = this.pools.find((q) => q.name === name);
    if (!p) throw new Error(`ParticleBatch: no pool ${name}`);
    return p;
  }

  /** Reset the scratch spawn description to defaults and return it. */
  begin(): Spawn {
    const s = this.spec;
    s.x = 0; s.y = 0; s.z = 0; s.vx = 0; s.vy = 0; s.vz = 0;
    s.life = 1; s.size0 = 0.1; s.size1 = 0.1;
    s.r0 = 1; s.g0 = 1; s.b0 = 1; s.a0 = 1;
    s.r1 = 1; s.g1 = 1; s.b1 = 1; s.a1 = 0;
    s.drag = 0; s.grav = 0; s.wind = 0; s.turb = 0; s.rot = this.rng.next() * 6.2832; s.spin = 0;
    s.kind = 0; s.stretch = 0; s.fadeIn = 0.03; s.ground = 0; s.seed = this.rng.next();
    return s;
  }

  /** Write the scratch spawn into the oldest slot of `pool`. Returns the slot or -1 when the pool is disabled. */
  emit(pool: Pool): number {
    if (pool.limit <= 0) return -1;
    const i = pool.start + pool.cursor;
    pool.cursor++;
    if (pool.cursor >= pool.limit) pool.cursor = 0;
    this.emitAt(i);
    return i;
  }

  /** Write the scratch spawn into a specific slot (used for persistent particles such as dust motes). */
  emitAt(i: number): void {
    const s = this.spec;
    this.alive[i] = 1;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.px[i] = s.x; this.py[i] = s.y; this.pz[i] = s.z;
    this.vx[i] = s.vx; this.vy[i] = s.vy; this.vz[i] = s.vz;
    this.size0[i] = s.size0; this.size1[i] = s.size1;
    const c = i * 4;
    this.col0[c] = s.r0; this.col0[c + 1] = s.g0; this.col0[c + 2] = s.b0; this.col0[c + 3] = s.a0;
    this.col1[c] = s.r1; this.col1[c + 1] = s.g1; this.col1[c + 2] = s.b1; this.col1[c + 3] = s.a1;
    this.drag[i] = s.drag; this.grav[i] = s.grav; this.wind[i] = s.wind; this.turb[i] = s.turb;
    this.rot[i] = s.rot; this.spin[i] = s.spin;
    this.kind[i] = s.kind; this.stretch[i] = s.stretch; this.fadeIn[i] = s.fadeIn;
    this.ground[i] = s.ground; this.seed[i] = s.seed;
  }

  isAlive(i: number): boolean {
    return this.alive[i] !== 0;
  }

  /** Direct access for persistent particles (motes) that are repositioned by the owner every frame. */
  setPosition(i: number, x: number, y: number, z: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
  }

  setAlpha(i: number, a: number): void {
    this.col0[i * 4 + 3] = a;
    this.col1[i * 4 + 3] = a;
  }

  resetAge(i: number): void {
    this.age[i] = 0;
  }

  getPosition(i: number, out: { x: number; y: number; z: number }): void {
    out.x = this.px[i];
    out.y = this.py[i];
    out.z = this.pz[i];
  }

  setPoolLimit(pool: Pool, limit: number): void {
    const n = Math.max(0, Math.min(pool.size, Math.floor(limit)));
    for (let i = pool.start + n; i < pool.start + pool.size; i++) this.alive[i] = 0;
    pool.limit = n;
    pool.cursor = n > 0 ? pool.cursor % n : 0;
  }

  clearPool(pool: Pool): void {
    for (let i = pool.start; i < pool.start + pool.size; i++) this.alive[i] = 0;
    pool.cursor = 0;
    pool.live = 0;
  }

  clear(): void {
    for (const p of this.pools) this.clearPool(p);
    this.liveCount = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  /**
   * Integrate all live particles and rebuild the GPU instance arrays. `fx/fy/fz` is the camera forward vector
   * (for depth sorting of the alpha batch).
   */
  update(
    dt: number,
    camX: number,
    camY: number,
    camZ: number,
    fx: number,
    fy: number,
    fz: number,
    windX: number,
    windZ: number,
  ): void {
    let k = 0;
    this.groundHitCount = 0;
    const sortNeeded = !this.additive;
    const depthScale = (BUCKETS - 1) / SORT_MAX_DEPTH;
    for (let pi = 0; pi < this.pools.length; pi++) {
      const pool = this.pools[pi]!;
      let live = 0;
      const end = pool.start + pool.limit;
      for (let i = pool.start; i < end; i++) {
        if (this.alive[i] === 0) continue;
        const age = this.age[i] + dt;
        const life = this.life[i];
        if (age >= life) {
          this.alive[i] = 0;
          continue;
        }
        this.age[i] = age;

        // ---- integrate ----
        let vx = this.vx[i];
        let vy = this.vy[i];
        let vz = this.vz[i];
        const drag = this.drag[i];
        if (drag > 0) {
          const f = Math.max(0, 1 - drag * dt);
          vx *= f;
          vy *= f;
          vz *= f;
        }
        vy -= this.grav[i] * dt;
        const turb = this.turb[i];
        if (turb > 0) {
          const sd = this.seed[i] * 6.2832;
          vx += Math.sin(age * 2.1 + sd) * turb * dt;
          vz += Math.cos(age * 1.7 + sd * 1.3) * turb * dt;
          vy += Math.sin(age * 1.3 + sd * 0.7) * turb * 0.4 * dt;
        }
        const w = this.wind[i];
        let x = this.px[i] + (vx + windX * w) * dt;
        let y = this.py[i] + vy * dt;
        let z = this.pz[i] + (vz + windZ * w) * dt;

        const t = age / life;
        const ease = 1 - (1 - t) * (1 - t);
        const s0 = this.size0[i];
        const size = s0 + (this.size1[i] - s0) * ease;

        // ---- ground ----
        const gm = this.ground[i];
        if (gm !== 0) {
          if (gm === 1) {
            const floor = size * 0.32 + 0.02;
            if (y < floor) {
              y = floor;
              if (vy < 0) vy = 0;
              const fr = Math.max(0, 1 - 2.5 * dt);
              vx *= fr;
              vz *= fr;
            }
          } else if (y < 0.02) {
            if (gm === 2) {
              y = 0.02;
              if (vy < -0.7) {
                vy = -vy * 0.32;
                vx *= 0.6;
                vz *= 0.6;
              } else {
                vy = 0;
                const fr = Math.max(0, 1 - 6 * dt);
                vx *= fr;
                vz *= fr;
              }
            } else {
              // DIE on contact: record for splat spawning
              if (this.groundHitCount < this.groundHits.length) {
                const gh = this.groundHits[this.groundHitCount++]!;
                gh.x = x;
                gh.z = z;
                gh.s = Math.hypot(vx, vy, vz);
              }
              this.alive[i] = 0;
              continue;
            }
          }
        }

        this.vx[i] = vx;
        this.vy[i] = vy;
        this.vz[i] = vz;
        this.px[i] = x;
        this.py[i] = y;
        this.pz[i] = z;

        // ---- outputs ----
        const c = i * 4;
        let a = this.col0[c + 3] + (this.col1[c + 3] - this.col0[c + 3]) * t;
        const fadeIn = this.fadeIn[i];
        if (fadeIn > 0 && age < fadeIn) a *= age / fadeIn;
        if (t > 0.85) a *= (1 - t) / 0.15;
        if (a <= 0.002) {
          live++;
          continue;
        }
        const o3 = k * 3;
        const o4 = k * 4;
        this.stagePos[o3] = x;
        this.stagePos[o3 + 1] = y;
        this.stagePos[o3 + 2] = z;
        // colour cools faster than alpha fades (ease-out), which reads as heat dissipating
        const ct = ease;
        this.stageCol[o4] = this.col0[c] + (this.col1[c] - this.col0[c]) * ct;
        this.stageCol[o4 + 1] = this.col0[c + 1] + (this.col1[c + 1] - this.col0[c + 1]) * ct;
        this.stageCol[o4 + 2] = this.col0[c + 2] + (this.col1[c + 2] - this.col0[c + 2]) * ct;
        this.stageCol[o4 + 3] = a;
        this.stageData[o4] = size;
        this.stageData[o4 + 1] = this.rot[i] + this.spin[i] * age;
        this.stageData[o4 + 2] = this.kind[i];
        this.stageData[o4 + 3] = this.seed[i];
        this.stageVel[o4] = vx;
        this.stageVel[o4 + 1] = vy;
        this.stageVel[o4 + 2] = vz;
        this.stageVel[o4 + 3] = this.stretch[i];
        if (sortNeeded) {
          let d = (x - camX) * fx + (y - camY) * fy + (z - camZ) * fz;
          if (d < 0) d = 0;
          else if (d > SORT_MAX_DEPTH) d = SORT_MAX_DEPTH;
          this.bucketOf[k] = Math.min(BUCKETS - 1, Math.floor(d * depthScale));
        }
        k++;
        live++;
      }
      pool.live = live;
    }

    if (sortNeeded && k > 1) {
      // counting sort, far -> near (bucket index descending)
      const bs = this.bucketStart;
      bs.fill(0);
      for (let j = 0; j < k; j++) bs[this.bucketOf[j] + 1]++;
      // descending: start offset of bucket b = number of entries in buckets > b
      let acc = 0;
      for (let b = BUCKETS - 1; b >= 0; b--) {
        const cnt = bs[b + 1];
        bs[b + 1] = acc;
        acc += cnt;
      }
      for (let j = 0; j < k; j++) {
        const b = this.bucketOf[j] + 1;
        this.order[bs[b]++] = j;
      }
      for (let n = 0; n < k; n++) {
        const j = this.order[n];
        const a3 = j * 3;
        const b3 = n * 3;
        this.gpuPos[b3] = this.stagePos[a3];
        this.gpuPos[b3 + 1] = this.stagePos[a3 + 1];
        this.gpuPos[b3 + 2] = this.stagePos[a3 + 2];
        const a4 = j * 4;
        const b4 = n * 4;
        this.gpuCol[b4] = this.stageCol[a4];
        this.gpuCol[b4 + 1] = this.stageCol[a4 + 1];
        this.gpuCol[b4 + 2] = this.stageCol[a4 + 2];
        this.gpuCol[b4 + 3] = this.stageCol[a4 + 3];
        this.gpuData[b4] = this.stageData[a4];
        this.gpuData[b4 + 1] = this.stageData[a4 + 1];
        this.gpuData[b4 + 2] = this.stageData[a4 + 2];
        this.gpuData[b4 + 3] = this.stageData[a4 + 3];
        this.gpuVel[b4] = this.stageVel[a4];
        this.gpuVel[b4 + 1] = this.stageVel[a4 + 1];
        this.gpuVel[b4 + 2] = this.stageVel[a4 + 2];
        this.gpuVel[b4 + 3] = this.stageVel[a4 + 3];
      }
    } else if (sortNeeded && k === 1) {
      for (let q = 0; q < 3; q++) this.gpuPos[q] = this.stagePos[q];
      for (let q = 0; q < 4; q++) {
        this.gpuCol[q] = this.stageCol[q];
        this.gpuData[q] = this.stageData[q];
        this.gpuVel[q] = this.stageVel[q];
      }
    }

    this.liveCount = k;
    this.geometry.instanceCount = k;
    this.mesh.visible = k > 0;
    if (k > 0) {
      const sizes = [3, 4, 4, 4];
      for (let q = 0; q < this.attrs.length; q++) {
        const attr = this.attrs[q]!;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, k * sizes[q]!);
        attr.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
