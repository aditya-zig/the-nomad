/** Objective area marker (ground ring + light curtain) and the tall objective beam. Both are additive shader effects. */
import * as THREE from 'three';
import type { AreaMarker } from '../models';
import { acquire, release } from './util';

const CURTAIN_H = 3.2;

const GROUND_VERT = /* glsl */ `
  varying vec2 vP;
  uniform float uScale;
  void main() {
    vP = position.xz * uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform float uR; uniform vec3 uColor; uniform float uProgress; uniform float uActive; uniform float uTime;
  varying vec2 vP;
  void main() {
    float d = length(vP);
    float a = atan(vP.x, -vP.y);
    float f = fract(a / 6.2831853);
    float e = d - uR;
    float ring = 1.0 - smoothstep(0.0, 0.17, abs(e));
    float soft = exp(-abs(e) * 2.6) * 0.32;
    float filled = step(f, uProgress);
    float prog = mix(0.32, 1.0, filled);
    float dashes = (1.0 - smoothstep(0.0, 0.09, abs(e + 0.6))) * step(0.5, fract(f * 90.0 + uTime * 0.1));
    float ticks = (1.0 - smoothstep(0.0, 0.05, abs(e - 0.42))) * step(0.94, fract(f * 24.0 + 0.03));
    float head = exp(-pow((f - uProgress) * 60.0, 2.0)) * (1.0 - smoothstep(0.0, 0.5, abs(e))) * step(0.001, uProgress);
    float fill = (1.0 - smoothstep(0.0, uR, d)) * 0.045 * (0.6 + 0.4 * sin(uTime * 1.4 - d * 0.6));
    float scan = exp(-pow((d - fract(uTime * 0.16) * uR) * 2.4, 2.0)) * 0.12 * step(d, uR);
    vec3 col = uColor * (ring * prog * 1.7 + soft * 0.7 + dashes * 0.9 * filled + dashes * 0.35 + ticks * 0.6 + head * 2.4 + fill + scan) * uActive;
    if (col.r + col.g + col.b < 0.002) discard;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CURTAIN_VERT = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying float vH; varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = uv.y; vXZ = position.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const CURTAIN_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uActive; uniform float uTime; uniform float uProgress;
  varying vec3 vW; varying vec3 vN; varying float vH; varying vec2 vXZ;
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float ndv = pow(abs(dot(normalize(vN), V)), 0.8);
    float h = vH;
    float a = atan(vXZ.x, -vXZ.y);
    float f = fract(a / 6.2831853);
    float bars = smoothstep(0.42, 0.5, abs(fract(f * 64.0) - 0.5) * 2.0);
    float scan = exp(-pow((h - fract(uTime * 0.2)) * 9.0, 2.0)) * 0.3;
    float filled = mix(0.75, 1.0, smoothstep(uProgress + 0.02, uProgress - 0.02, f) * step(0.001, uProgress));
    float alpha = pow(max(1.0 - h, 0.0), 1.5) * (0.07 + 0.07 * bars + scan) * ndv * filled * uActive;
    float dist = length(cameraPosition - vW);
    alpha *= exp(-dist * 0.01);
    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`;

interface MarkerShared {
  ground: THREE.PlaneGeometry;
  curtain: THREE.CylinderGeometry;
}

export function createAreaMarkerImpl(radius: number, color: number): AreaMarker {
  const shared = acquire(
    'marker-shared',
    (): MarkerShared => {
      const ground = new THREE.PlaneGeometry(2, 2);
      ground.rotateX(-Math.PI / 2);
      const curtain = new THREE.CylinderGeometry(1, 1, CURTAIN_H, 96, 1, true);
      curtain.translate(0, CURTAIN_H / 2, 0);
      return { ground, curtain };
    },
    (s) => {
      s.ground.dispose();
      s.curtain.dispose();
    },
  );
  const col = new THREE.Color(color);
  const groundU = {
    uR: { value: radius },
    uScale: { value: radius + 1.3 },
    uColor: { value: col.clone() },
    uProgress: { value: 0 },
    uActive: { value: 1 },
    uTime: { value: 0 },
  };
  const groundMat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: groundU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    fog: false,
  });
  const curtainMat = new THREE.ShaderMaterial({
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    uniforms: { uColor: groundU.uColor, uActive: groundU.uActive, uTime: groundU.uTime, uProgress: groundU.uProgress },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });

  const root = new THREE.Group();
  root.name = 'AreaMarker';
  const ground = new THREE.Mesh(shared.ground, groundMat);
  ground.position.y = 0.06;
  ground.frustumCulled = false;
  ground.renderOrder = 6;
  const curtain = new THREE.Mesh(shared.curtain, curtainMat);
  curtain.frustumCulled = false;
  curtain.renderOrder = 6;
  root.add(ground, curtain);

  let r = radius;
  let active = 1;
  let activeTarget = 1;
  const apply = (): void => {
    ground.scale.set(r + 1.3, 1, r + 1.3);
    curtain.scale.set(r, 1, r);
    groundU.uR.value = r;
    groundU.uScale.value = r + 1.3;
  };
  apply();

  return {
    root,
    setRadius(v: number) {
      r = Math.max(0.5, v);
      apply();
    },
    setColor(hex: number) {
      groundU.uColor.value.set(hex);
    },
    setProgress(p: number) {
      groundU.uProgress.value = Math.max(0, Math.min(1, p));
    },
    setActive(a: boolean) {
      activeTarget = a ? 1 : 0.32;
    },
    update(dt: number, time: number) {
      active += (activeTarget - active) * Math.min(1, dt * 6);
      groundU.uActive.value = active;
      groundU.uTime.value = time;
    },
    dispose() {
      groundMat.dispose();
      curtainMat.dispose();
      release('marker-shared');
    },
  };
}

// ---------------------------------------------------------------------------------------------
// objective beam
// ---------------------------------------------------------------------------------------------

const BEAM_VERT = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = uv.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uTime;
  varying vec3 vW; varying vec3 vN; varying float vH;
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float edge = pow(abs(dot(normalize(vN), V)), 2.6);
    float h = vH;
    float base = pow(max(1.0 - h, 0.0), 1.5);
    float pulse = exp(-pow((fract(h * 1.6 - uTime * 0.22) - 0.5) * 5.0, 2.0)) * 0.35;
    float flick = 0.85 + 0.15 * sin(uTime * 3.0 + h * 12.0);
    float a = (base * 0.55 + pulse * base) * edge * flick;
    gl_FragColor = vec4(uColor * (1.0 + pulse * 1.6), a * 0.42);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(d - 0.62 - 0.05 * sin(uTime * 2.0)));
    float core = exp(-d * d * 5.0);
    float a = (ring * 0.8 + core * 0.9) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(uColor * 1.6, a);
  }
`;

export function createObjectiveBeamImpl(color: number): THREE.Object3D {
  const uniforms = { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } };
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.85, 40, 24, 1, true);
  beamGeo.translate(0, 20, 0);
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const ringGeo = new THREE.PlaneGeometry(4.4, 4.4);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: RING_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const group = new THREE.Group();
  group.name = 'ObjectiveBeam';
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 6;
  beam.onBeforeRender = () => {
    uniforms.uTime.value = performance.now() / 1000;
  };
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.07;
  ring.frustumCulled = false;
  ring.renderOrder = 6;
  group.add(beam, ring);
  group.userData.dispose = () => {
    beamGeo.dispose();
    beamMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
  };
  return group;
}
