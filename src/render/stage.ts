/**
 * Shared "stage" helpers: renderer creation, blue-hour sky dome, image-based environment lighting and the
 * moon/hemisphere lights. The game and every dev preview harness use these so assets are judged under the
 * same lighting they will have in-game.
 */
import * as THREE from 'three';
import { RENDER } from '../config';

export const BLUE_HOUR = {
  zenith: 0x0d1c33,
  midSky: 0x213a5c,
  horizon: 0x4a627d,
  glow: 0xd98a52,
  fog: RENDER.fogColor,
  hemiSky: 0x6f93c4,
  hemiGround: 0x3a4550,
  moonColor: 0xa9c4ee,
  glowFillColor: 0xff9a66,
  /** Direction *toward* the moon (normalised at use). */
  moonDir: new THREE.Vector3(-0.42, 0.72, -0.55),
  /** Direction toward the horizon afterglow (west-south-west). */
  glowDir: new THREE.Vector3(-0.85, 0.12, 0.45),
};

let attenuationPatched = false;

/**
 * Soften physical point-light falloff at close range. Lamp lights sit inches from their own fixtures, and pure 1/d^2 there
 * yields absurd HDR values (thousands) that bloom into a huge halo. Clamping the minimum effective distance to ~1.6 m keeps
 * lights physically plausible beyond that distance and well behaved up close. Must run before the first material compiles.
 */
export function patchLightAttenuation(): void {
  if (attenuationPatched) return;
  attenuationPatched = true;
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  const needle = 'max( pow( lightDistance, decayExponent ), 0.01 )';
  if (chunk.includes(needle)) {
    THREE.ShaderChunk.lights_pars_begin = chunk.replace(needle, 'max( pow( lightDistance, decayExponent ), 2.6 )');
  }
}

export function createRenderer(canvas?: HTMLCanvasElement): THREE.WebGLRenderer {
  patchLightAttenuation();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.99999; // always at the far plane
  }
`;

const skyFragment = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uGlowDir;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform float uTime;
  uniform float uHazeStrength;
  uniform vec3 uHazeColor;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float up = clamp(h, 0.0, 1.0);
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, up));
    col = mix(col, uZenith, smoothstep(0.18, 0.85, up));

    // horizon afterglow toward the setting sun
    vec3 gd = normalize(vec3(uGlowDir.x, 0.0, uGlowDir.z));
    float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), gd), 0.0);
    float glow = pow(az, 3.5) * exp(-max(h, 0.0) * 7.0);
    col += uGlow * glow * 0.55;

    // layered clouds, lit warmly from below near the glow
    if (h > 0.02) {
      vec2 cp = d.xz / (h + 0.28) * 1.6;
      float c = fbm(cp * 1.4 + vec2(uTime * 0.004, 0.0));
      c = smoothstep(0.42, 0.78, c) * smoothstep(0.02, 0.22, h) * (1.0 - smoothstep(0.55, 0.95, h));
      vec3 cloudCol = mix(uMid * 0.9, uGlow * 0.55 + uMid * 0.5, glow * 0.8);
      col = mix(col, cloudCol, c * 0.55);
    }

    // faint stars in the upper sky
    float starMask = smoothstep(0.35, 0.8, h);
    vec3 sp = floor(d * 240.0);
    float s = step(0.9985, hash3(sp));
    col += vec3(0.75, 0.85, 1.0) * s * starMask * 0.6;

    // moon disc and halo
    float md = dot(d, normalize(uMoonDir));
    float disc = smoothstep(0.9993, 0.99965, md);
    float halo = pow(max(md, 0.0), 220.0) * 0.5 + pow(max(md, 0.0), 24.0) * 0.08;
    col += uMoonColor * (disc * 2.2 + halo);

    // below the horizon fade into the fog colour so the world blends into the sky
    float below = smoothstep(0.02, -0.25, h);
    col = mix(col, uHazeColor, clamp(below + uHazeStrength * (1.0 - smoothstep(0.0, 0.16, up)), 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyDome extends THREE.Mesh {
  userData: { uniforms: Record<string, THREE.IUniform> };
}

/** Large inside-out dome. Position it on the camera every frame. */
export function createSkyDome(): SkyDome {
  const geo = new THREE.SphereGeometry(300, 40, 20);
  const uniforms = {
    uZenith: { value: new THREE.Color(BLUE_HOUR.zenith) },
    uMid: { value: new THREE.Color(BLUE_HOUR.midSky) },
    uHorizon: { value: new THREE.Color(BLUE_HOUR.horizon) },
    uGlow: { value: new THREE.Color(BLUE_HOUR.glow) },
    uGlowDir: { value: BLUE_HOUR.glowDir.clone().normalize() },
    uMoonDir: { value: BLUE_HOUR.moonDir.clone().normalize() },
    uMoonColor: { value: new THREE.Color(BLUE_HOUR.moonColor) },
    uTime: { value: 0 },
    uHazeStrength: { value: 0.9 },
    uHazeColor: { value: new THREE.Color(BLUE_HOUR.fog) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat) as unknown as SkyDome;
  mesh.userData.uniforms = uniforms;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'SkyDome';
  return mesh;
}

/** Image-based lighting for reflections: a dusk gradient with a few warm/cool light sources. */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const sky = createSkyDome();
  (sky.material as THREE.ShaderMaterial).uniforms.uHazeStrength!.value = 0.6;
  sky.scale.setScalar(0.1);
  envScene.add(sky);
  // sodium-ish street lamps and a cold fill panel so metal picks up highlights
  const lamp = (x: number, y: number, z: number, color: number, s: number, i: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * 0.3, s),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(i) }),
    );
    m.position.set(x, y, z);
    envScene.add(m);
  };
  lamp(6, 9, 4, 0xffc27a, 1.6, 8);
  lamp(-7, 8, -5, 0xffb060, 1.4, 5);
  lamp(2, 6, -9, 0xbfd8ff, 3, 2.2);
  lamp(-3, 12, 2, 0x9fc0ff, 4, 1.4);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  sky.geometry.dispose();
  (sky.material as THREE.Material).dispose();
  return rt.texture;
}

export interface BlueHourRig {
  hemi: THREE.HemisphereLight;
  moon: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  /** Re-centre the moon shadow frustum on `focus` (snapped to shadow texels to avoid shimmering). */
  focusShadow(focus: THREE.Vector3): void;
  setShadowQuality(enabled: boolean, size: number): void;
}

/** Adds fog, hemisphere light, moon key light (with shadows) and a warm horizon fill to `scene`. */
export function setupBlueHour(scene: THREE.Scene, shadowExtent = 46): BlueHourRig {
  scene.fog = new THREE.FogExp2(RENDER.fogColor, RENDER.fogDensity);
  const hemi = new THREE.HemisphereLight(BLUE_HOUR.hemiSky, BLUE_HOUR.hemiGround, 4.4);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(BLUE_HOUR.moonColor, 4.2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const cam = moon.shadow.camera;
  cam.left = -shadowExtent;
  cam.right = shadowExtent;
  cam.top = shadowExtent;
  cam.bottom = -shadowExtent;
  cam.near = 1;
  cam.far = 220;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.05;
  scene.add(moon);
  scene.add(moon.target);

  const fill = new THREE.DirectionalLight(BLUE_HOUR.glowFillColor, 1.1);
  fill.position.copy(BLUE_HOUR.glowDir).multiplyScalar(50);
  scene.add(fill);

  const dir = BLUE_HOUR.moonDir.clone().normalize();
  const snapped = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const focusShadow = (focus: THREE.Vector3) => {
    const size = moon.shadow.mapSize.x;
    const texel = (shadowExtent * 2) / size;
    // snap the focus point in world space to texel-sized steps
    snapped.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
    moon.target.position.copy(snapped);
    tmp.copy(dir).multiplyScalar(110);
    moon.position.copy(snapped).add(tmp);
    moon.target.updateMatrixWorld();
  };
  focusShadow(new THREE.Vector3());

  return {
    hemi,
    moon,
    fill,
    focusShadow,
    setShadowQuality(enabled: boolean, size: number) {
      moon.castShadow = enabled;
      if (moon.shadow.mapSize.x !== size) {
        moon.shadow.mapSize.set(size, size);
        if (moon.shadow.map) {
          moon.shadow.map.dispose();
          moon.shadow.map = null;
        }
      }
    },
  };
}
