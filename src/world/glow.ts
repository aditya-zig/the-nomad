/**
 * GlowField: every static light glow / warning beacon in the level rendered as ONE additive `THREE.Points`
 * draw call with per-point blink/pulse/flicker computed in the vertex shader.
 */
import * as THREE from 'three';

export type GlowMode = 'steady' | 'blink' | 'pulse' | 'flicker';

export interface GlowSpec {
  x: number;
  y: number;
  z: number;
  /** sRGB hex colour. */
  color: number;
  /** World-space diameter in metres. */
  size: number;
  /** HDR brightness multiplier (values > 1 feed bloom). Default 2. */
  intensity?: number;
  mode?: GlowMode;
  /** Period of blink / pulse in seconds (default 1.2). */
  period?: number;
  /** Fraction of the period a blink stays on (default 0.25). */
  duty?: number;
  /** Time offset in seconds. */
  phase?: number;
}

const MODE_ID: Record<GlowMode, number> = { steady: 0, blink: 1, pulse: 2, flicker: 3 };

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute vec4 aBlink; // x mode, y period, z duty, w phase
  uniform float uTime;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float a = 1.0;
    float t = uTime + aBlink.w;
    if (aBlink.x > 0.5 && aBlink.x < 1.5) {
      float ph = fract(t / aBlink.y);
      a = smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(aBlink.z, aBlink.z + 0.06, ph));
    } else if (aBlink.x > 1.5 && aBlink.x < 2.5) {
      a = 0.6 + 0.4 * sin(6.2831853 * t / aBlink.y);
    } else if (aBlink.x > 2.5) {
      float k = floor(t * 14.0);
      float r = hash(k + aBlink.w * 13.0);
      a = r > 0.86 ? 0.15 : (r > 0.7 ? 0.6 : 1.0);
    }
    vColor = aColor;
    vAlpha = a;
    float px = aSize * uScale / max(-mv.z, 0.2);
    gl_PointSize = clamp(px, 1.5, 180.0);
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float core = exp(-d * d * 7.0);
    float halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.5) * 0.55;
    float a = clamp(core + halo, 0.0, 1.0) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class GlowField {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor(specs: GlowSpec[]) {
    const n = specs.length;
    this.count = n;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const blink = new Float32Array(n * 4);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = specs[i]!;
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      c.set(s.color); // converts sRGB hex to linear working space
      const k = s.intensity ?? 2;
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
      size[i] = s.size;
      blink[i * 4] = MODE_ID[s.mode ?? 'steady'];
      blink[i * 4 + 1] = Math.max(0.05, s.period ?? 1.2);
      blink[i * 4 + 2] = s.duty ?? 0.25;
      blink[i * 4 + 3] = s.phase ?? 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aBlink', new THREE.BufferAttribute(blink, 4));
    geo.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uScale: { value: 700 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'GlowField';
  }

  get size(): number {
    return this.count;
  }

  /** `viewportHeightPx` is the drawing-buffer height, `fovDeg` the vertical FOV of the camera. */
  update(time: number, viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uScale!.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
