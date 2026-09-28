/**
 * Bullet tracers: a fixed pool of additive ribbons. Each tracer is a bright short streak (head brightest, tail
 * fading) that races from the muzzle to the impact point during its very short life, drawn as a camera-facing
 * ribbon between two world points. Width has a minimum proportional to distance so far tracers stay visible.
 */
import * as THREE from 'three';
import type { Vec3Like } from '../types';

const vertexShader = /* glsl */ `
  attribute vec3 tA;
  attribute vec3 tB;
  attribute vec4 tCol;
  attribute float tWidth;
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    vec3 a = (modelViewMatrix * vec4(tA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(tB, 1.0)).xyz;
    float along = position.x + 0.5;
    vec3 c = mix(a, b, along);
    vec2 d = b.xy - a.xy;
    float dl = length(d);
    vec2 dir = dl > 1e-5 ? d / dl : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float w = max(tWidth, 0.0021 * max(-c.z, 0.5));
    c.xy += perp * position.y * w * 2.0;
    gl_Position = projectionMatrix * vec4(c, 1.0);
    vUv = vec2(along, position.y + 0.5);
    vCol = tCol;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    float across = clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0);
    float core = pow(across, 1.6);
    float head = pow(smoothstep(0.0, 1.0, clamp(vUv.x, 0.0, 1.0)), 1.8);
    float a = clamp(core * head * vCol.a, 0.0, 1.0);
    if (!(a >= 0.004)) discard; // also rejects NaN
    vec3 col = vCol.rgb * (0.35 + 1.65 * head);
    // hot white core
    col = mix(col, vec3(max(col.r, max(col.g, col.b))), 0.35 * pow(across, 4.0) * head);
    col = clamp(col, vec3(0.0), vec3(48.0));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const TRACER_LIFE = 0.06;
const STREAK_LENGTH = 7;

export class TracerPool {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private limit: number;
  private cursor = 0;
  private readonly alive: Uint8Array;
  private readonly age: Float32Array;
  private readonly ax: Float32Array;
  private readonly az: Float32Array;
  private readonly ay: Float32Array;
  private readonly bx: Float32Array;
  private readonly by: Float32Array;
  private readonly bz: Float32Array;
  private readonly dist: Float32Array;
  private readonly col: Float32Array;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aWidth: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly tint = new THREE.Color();
  liveCount = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.limit = cap;
    this.alive = new Uint8Array(cap);
    this.age = new Float32Array(cap);
    this.ax = new Float32Array(cap);
    this.ay = new Float32Array(cap);
    this.az = new Float32Array(cap);
    this.bx = new Float32Array(cap);
    this.by = new Float32Array(cap);
    this.bz = new Float32Array(cap);
    this.dist = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name: string, size: number) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
      return attr;
    };
    this.aA = mk('tA', 3);
    this.aB = mk('tB', 3);
    this.aCol = mk('tCol', 4);
    this.aWidth = mk('tWidth', 1);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.name = 'FxTracers';
    this.mesh.visible = false;
  }

  add(from: Vec3Like, to: Vec3Like, colorHex: number): void {
    if (this.limit <= 0) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    this.alive[i] = 1;
    this.age[i] = 0;
    this.ax[i] = from.x;
    this.ay[i] = from.y;
    this.az[i] = from.z;
    this.bx[i] = to.x;
    this.by[i] = to.y;
    this.bz[i] = to.z;
    this.dist[i] = Math.max(0.01, Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
    this.tint.set(colorHex);
    // HDR so tracers bloom
    this.col[i * 3] = this.tint.r * 3.4;
    this.col[i * 3 + 1] = this.tint.g * 3.4;
    this.col[i * 3 + 2] = this.tint.b * 3.4;
  }

  update(dt: number): void {
    let k = 0;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const W = this.aWidth.array as Float32Array;
    for (let i = 0; i < this.limit; i++) {
      if (this.alive[i] === 0) continue;
      const age = this.age[i] + dt;
      this.age[i] = age;
      if (age >= TRACER_LIFE) {
        this.alive[i] = 0;
        continue;
      }
      const t = age / TRACER_LIFE;
      const dist = this.dist[i];
      const head = Math.min(1, t / 0.8);
      const streak = Math.min(0.92, STREAK_LENGTH / dist);
      const tail = Math.max(0, head - streak);
      const ax = this.ax[i];
      const ay = this.ay[i];
      const az = this.az[i];
      const dx = this.bx[i] - ax;
      const dy = this.by[i] - ay;
      const dz = this.bz[i] - az;
      A[k * 3] = ax + dx * tail;
      A[k * 3 + 1] = ay + dy * tail;
      A[k * 3 + 2] = az + dz * tail;
      B[k * 3] = ax + dx * head;
      B[k * 3 + 1] = ay + dy * head;
      B[k * 3 + 2] = az + dz * head;
      C[k * 4] = this.col[i * 3];
      C[k * 4 + 1] = this.col[i * 3 + 1];
      C[k * 4 + 2] = this.col[i * 3 + 2];
      C[k * 4 + 3] = t > 0.72 ? (1 - t) / 0.28 : 1;
      W[k] = 0.015;
      k++;
    }
    this.liveCount = k;
    this.geometry.instanceCount = k;
    this.mesh.visible = k > 0;
    if (k > 0) {
      for (const [attr, size] of [[this.aA, 3], [this.aB, 3], [this.aCol, 4], [this.aWidth, 1]] as const) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, k * size);
        attr.needsUpdate = true;
      }
    }
  }

  setLimit(n: number): void {
    const lim = Math.max(0, Math.min(this.cap, Math.floor(n)));
    for (let i = lim; i < this.cap; i++) this.alive[i] = 0;
    this.limit = lim;
    if (lim > 0) this.cursor %= lim;
    else this.cursor = 0;
  }

  clear(): void {
    this.alive.fill(0);
    this.cursor = 0;
    this.liveCount = 0;
    this.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
