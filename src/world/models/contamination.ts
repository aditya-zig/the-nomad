/**
 * Contamination front: a tall churning toxic-fog wall at the surge radius, a dark toxic haze + bright base ring on the
 * ground inside the radius, and nested camera-centred fog shells that make the INTERIOR read as toxic air (only enabled
 * while the camera is inside the zone). All shaders use premultiplied alpha so they can both darken and glow.
 */
import * as THREE from 'three';
import type { ContaminationWall } from '../models';
import { acquire, getNoiseTexture, release } from './util';

const WALL_HEIGHT = 14;

const WALL_VERT = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vH = uv.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform sampler2D uNoise; uniform float uTime; uniform float uIntensity; uniform vec3 uCam;
  varying vec3 vW; varying vec3 vN; varying float vH;
  void main() {
    vec3 N = normalize(vN);
    vec3 toCam = uCam - vW;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 0.001);
    float ndv = abs(dot(N, V));
    float wx = abs(N.x); float wz = abs(N.z);
    float bw = wx / (wx + wz + 1e-4);
    float t = uTime;
    vec2 a1 = vec2(vW.z * 0.045 + t * 0.012, vW.y * 0.075 - t * 0.05);
    vec2 a2 = vec2(vW.x * 0.045 - t * 0.010, vW.y * 0.075 - t * 0.05);
    vec4 n1 = mix(texture2D(uNoise, a2), texture2D(uNoise, a1), bw);
    vec2 b1 = vec2(vW.z * 0.11 - t * 0.02, vW.y * 0.16 - t * 0.09);
    vec2 b2 = vec2(vW.x * 0.11 + t * 0.017, vW.y * 0.16 - t * 0.09);
    vec4 n2 = mix(texture2D(uNoise, b2), texture2D(uNoise, b1), bw);

    float dens = clamp(n1.r * 0.75 + (n1.g * 0.6 + n2.g * 0.4) * 0.55 - 0.15, 0.0, 1.0);
    float h = vH;
    float topN = 0.6 + 0.38 * n1.b;
    float prof = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(topN - 0.38, topN, h));
    prof *= mix(1.0, 0.62, smoothstep(0.0, 0.5, h));
    float vein = pow(clamp(1.0 - abs(2.0 * n1.a * 2.0 - 1.0), 0.0, 1.0), 3.0) * smoothstep(0.3, 0.7, dens) * 0.6;
    float pulse = 0.85 + 0.15 * sin(t * 0.8 + vW.x * 0.02 + vW.z * 0.03);
    float edge = smoothstep(0.0, 0.45, ndv);
    float nearFade = smoothstep(0.6, 7.0, dist);
    float alpha = (0.15 + 0.55 * dens) * prof * edge * nearFade * exp(-dist * 0.0022) * uIntensity;
    vec3 dark = vec3(0.025, 0.065, 0.02);
    vec3 mid = vec3(0.09, 0.26, 0.06);
    vec3 glow = vec3(0.6, 0.95, 0.28);
    vec3 base = mix(dark, mid, dens);
    float baseGlow = (1.0 - smoothstep(0.0, 0.14, h)) * 0.7;
    vec3 rgb = base * alpha + glow * (vein * 0.9 + baseGlow * (0.35 + dens * 0.6)) * alpha * pulse;
    gl_FragColor = vec4(rgb, alpha);
  }
`;

const HAZE_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const HAZE_FRAG = /* glsl */ `
  uniform sampler2D uNoise; uniform vec2 uC; uniform float uR; uniform float uTime; uniform float uIntensity;
  varying vec3 vW;
  void main() {
    float d = length(vW.xz - uC);
    float e = uR - d;
    vec2 nu = vW.xz * 0.04;
    float n = texture2D(uNoise, nu + vec2(uTime * 0.006, -uTime * 0.004)).r * 0.6 + texture2D(uNoise, nu * 2.7 - vec2(uTime * 0.01, 0.0)).g * 0.4;
    float inside = smoothstep(-0.3, 4.0, e);
    float hazeA = inside * (0.2 + 0.26 * n) * uIntensity;
    vec3 hazeC = vec3(0.02, 0.07, 0.02);
    float ring = exp(-pow(e / 0.32, 2.0));
    float outer = exp(-max(-e, 0.0) * 1.1) * 0.3 * step(e, 0.0);
    float glowIn = exp(-max(e, 0.0) * 0.45) * inside * 0.16;
    float pulse = 0.8 + 0.2 * sin(uTime * 1.6 - d * 0.08);
    vec3 glow = vec3(0.5, 0.95, 0.25);
    vec3 rgb = hazeC * hazeA + glow * (ring * 1.5 + outer * 0.7 + glowIn * (0.4 + n * 0.6)) * pulse * uIntensity;
    float a = hazeA;
    if (rgb.r + rgb.g + rgb.b + a < 0.003) discard;
    gl_FragColor = vec4(rgb, a);
  }
`;

const SHELL_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHELL_FRAG = /* glsl */ `
  uniform sampler2D uNoise; uniform float uTime; uniform float uK; uniform float uBase;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    vec2 uv = dir.xz / (abs(dir.y) + 0.55);
    float n = texture2D(uNoise, uv * 0.35 + vec2(uTime * 0.01, uTime * 0.006)).r * 0.65
            + texture2D(uNoise, uv * 0.9 - vec2(uTime * 0.013, 0.0)).g * 0.35;
    float vert = mix(1.0, 0.5, smoothstep(0.0, 0.6, dir.y));
    float a = uBase * uK * (0.5 + 1.0 * n) * vert;
    vec3 c = mix(vec3(0.03, 0.09, 0.02), vec3(0.2, 0.42, 0.08), n);
    gl_FragColor = vec4(c * a, a);
  }
`;

interface Shared {
  wallGeo: THREE.CylinderGeometry;
  hazeGeo: THREE.PlaneGeometry;
  shellGeo: THREE.SphereGeometry;
  noise: THREE.DataTexture;
}

function premultiplied(mat: THREE.ShaderMaterial): THREE.ShaderMaterial {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

export function createContaminationWallImpl(): ContaminationWall {
  const shared = acquire(
    'contamination-shared',
    (): Shared => ({
      wallGeo: (() => {
        const g = new THREE.CylinderGeometry(1, 1, WALL_HEIGHT, 160, 1, true);
        g.translate(0, WALL_HEIGHT / 2, 0);
        return g;
      })(),
      hazeGeo: (() => {
        const g = new THREE.PlaneGeometry(2, 2);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      shellGeo: new THREE.SphereGeometry(1, 20, 12),
      noise: getNoiseTexture(),
    }),
    (s) => {
      s.wallGeo.dispose();
      s.hazeGeo.dispose();
      s.shellGeo.dispose();
      release('noise-tex');
    },
  );

  const uniforms = {
    uNoise: { value: shared.noise },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uCam: { value: new THREE.Vector3() },
  };
  const wallMat = premultiplied(
    new THREE.ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  const hazeUniforms = {
    uNoise: { value: shared.noise },
    uC: { value: new THREE.Vector2() },
    uR: { value: 14 },
    uTime: uniforms.uTime,
    uIntensity: uniforms.uIntensity,
  };
  const hazeMat = premultiplied(
    new THREE.ShaderMaterial({
      vertexShader: HAZE_VERT,
      fragmentShader: HAZE_FRAG,
      uniforms: hazeUniforms,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false,
    }),
  );

  const root = new THREE.Group();
  root.name = 'ContaminationFront';
  const wall = new THREE.Mesh(shared.wallGeo, wallMat);
  wall.frustumCulled = false;
  wall.renderOrder = 8;
  const haze = new THREE.Mesh(shared.hazeGeo, hazeMat);
  haze.frustumCulled = false;
  haze.renderOrder = 7;
  haze.position.y = 0.09;
  root.add(haze, wall);

  // interior fog shells (camera-centred)
  const shellRadii = [7, 16, 30, 52];
  const shellBase = [0.03, 0.035, 0.045, 0.06];
  const shells: THREE.Mesh[] = [];
  const shellMats: THREE.ShaderMaterial[] = [];
  const shellK = { value: 0 };
  shellRadii.forEach((r, i) => {
    const m = premultiplied(
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        uniforms: { uNoise: { value: shared.noise }, uTime: uniforms.uTime, uK: shellK, uBase: { value: shellBase[i]! } },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
      }),
    );
    const mesh = new THREE.Mesh(shared.shellGeo, m);
    mesh.scale.setScalar(r);
    mesh.frustumCulled = false;
    mesh.renderOrder = 9 + i;
    mesh.visible = false;
    root.add(mesh);
    shells.push(mesh);
    shellMats.push(m);
  });

  let cx = 0;
  let cz = 0;
  let radius = 14;
  let intensity = 0;
  let inside = 0;
  const camPos = new THREE.Vector3();
  root.visible = false;

  const apply = (): void => {
    wall.position.set(cx, 0, cz);
    wall.scale.set(radius, 1, radius);
    haze.position.set(cx, 0.09, cz);
    haze.scale.set(radius + 8, 1, radius + 8);
    hazeUniforms.uC.value.set(cx, cz);
    hazeUniforms.uR.value = radius;
    uniforms.uIntensity.value = intensity;
    root.visible = intensity > 0.001;
  };
  apply();

  return {
    root,
    setCenter(x: number, z: number) {
      cx = x;
      cz = z;
      apply();
    },
    setRadius(r: number) {
      radius = Math.max(1, r);
      apply();
    },
    setIntensity(k: number) {
      intensity = Math.max(0, Math.min(1, k));
      apply();
    },
    get insideFactor(): number {
      return inside;
    },
    update(_dt: number, time: number, camera: THREE.Camera) {
      uniforms.uTime.value = time;
      camera.getWorldPosition(camPos);
      uniforms.uCam.value.copy(camPos);
      const dx = camPos.x - cx;
      const dz = camPos.z - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      const t = Math.max(0, Math.min(1, (radius - d + 2) / 12));
      inside = t * t * (3 - 2 * t);
      shellK.value = inside * intensity;
      const show = inside > 0.01 && intensity > 0.001;
      for (const s of shells) {
        s.visible = show;
        if (show) s.position.copy(camPos);
      }
    },
    dispose() {
      wallMat.dispose();
      hazeMat.dispose();
      for (const m of shellMats) m.dispose();
      release('contamination-shared');
    },
  };
}
