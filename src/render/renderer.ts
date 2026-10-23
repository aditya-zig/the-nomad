/**
 * Game renderer: WebGL renderer, world + viewmodel scenes, blue-hour lighting, dynamic light pool, sky, and the
 * post-processing chain (MSAA render target -> world pass -> viewmodel pass (depth cleared) -> restrained bloom -> output).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { QUALITY, RENDER } from '../config';
import type { QualityLevel } from '../types';
import { LightPool } from './lightPool';
import { type BlueHourRig, createEnvironment, createRenderer, createSkyDome, setupBlueHour, type SkyDome } from './stage';
import { REFERENCE_VIEWMODEL_FOV } from '../weapons/viewmodelTypes';

export interface CapabilityReport {
  ok: boolean;
  problems: string[];
}

/** Check the browser features the game needs and describe what is missing. */
export function checkCapabilities(): CapabilityReport {
  const problems: string[] = [];
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) problems.push('WebGL 2 is not available. Enable hardware acceleration or use a current Chrome, Edge, Firefox or Safari.');
  } catch {
    problems.push('WebGL 2 could not be initialised.');
  }
  if (typeof document.documentElement.requestPointerLock !== 'function') {
    problems.push('The Pointer Lock API is not available in this browser, so mouse look cannot work.');
  }
  return { ok: problems.length === 0, problems };
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly sky: SkyDome;
  readonly light: BlueHourRig;
  readonly lightPool: LightPool;
  /** Cross-fading real lights for transient effects (muzzle flash, explosion, flare). */
  readonly flashLight: THREE.PointLight;
  readonly explosionLight: THREE.PointLight;
  readonly flareLight: THREE.PointLight;
  /** Point light inside the viewmodel scene for the muzzle flash. */
  readonly viewFlash: THREE.PointLight;
  readonly viewLamp: THREE.PointLight;
  readonly viewSun: THREE.DirectionalLight;
  private readonly viewHemi: THREE.HemisphereLight;
  /** 0 outdoors .. 1 fully indoors (smoothed); interiors are lit by their own lamps, not by the sky. */
  private indoor = 0;
  private indoorTarget = 0;
  quality: QualityLevel = 'medium';

  private composer: EffectComposer | null = null;
  private worldPass: RenderPass | null = null;
  private viewPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private width = 1;
  private height = 1;
  /** Base horizontal FOV (degrees) chosen in settings. */
  hFov = 90;
  /** ADS zoom multiplier applied to tan(fov/2) (1 = no zoom). */
  zoom = 1;
  private readonly refViewHFov: number;
  private readonly tmpV = new THREE.Vector3();
  time = 0;
  /** Dynamic-resolution multiplier (0.6..1) applied on top of the quality preset's pixel-ratio cap. */
  renderScale = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, RENDER.near, RENDER.far);
    this.camera.rotation.order = 'YXZ';
    this.viewCamera = new THREE.PerspectiveCamera(REFERENCE_VIEWMODEL_FOV, 16 / 9, 0.02, 6);
    this.refViewHFov = 2 * Math.atan(Math.tan((REFERENCE_VIEWMODEL_FOV * Math.PI) / 360) * (16 / 9));

    // ---- world ----
    this.sky = createSkyDome();
    this.scene.add(this.sky);
    const env = createEnvironment(this.renderer);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.light = setupBlueHour(this.scene, 46);
    this.lightPool = new LightPool(this.scene, QUALITY.high.lightPool, QUALITY.medium.lightPool);
    this.scene.add(this.camera);

    this.flashLight = new THREE.PointLight(0xffc27a, 0, 16, 2);
    this.explosionLight = new THREE.PointLight(0xff8a3a, 0, 40, 2);
    this.flareLight = new THREE.PointLight(0xff3a22, 0, 30, 2);
    this.scene.add(this.flashLight, this.explosionLight, this.flareLight);

    // ---- viewmodel scene (lit to match the world) ----
    this.viewScene.environment = env;
    this.viewScene.environmentIntensity = 0.85;
    this.viewHemi = new THREE.HemisphereLight(0xb5b7a3, 0x504b40, 2.6);
    this.viewScene.add(this.viewHemi);
    this.viewSun = new THREE.DirectionalLight(0xffe1a3, 2.4);
    this.viewSun.position.set(-0.6, 1, 0.5);
    this.viewScene.add(this.viewSun);
    this.viewLamp = new THREE.PointLight(0xffb060, 0.0, 6, 2);
    this.viewLamp.position.set(0.3, 0.2, 0.2);
    this.viewScene.add(this.viewLamp);
    this.viewFlash = new THREE.PointLight(0xffc27a, 0, 4, 2);
    this.viewFlash.position.set(0.15, -0.05, -0.7);
    this.viewScene.add(this.viewFlash);
    this.viewScene.add(this.viewCamera);
  }

  /** Tell the renderer whether the camera is inside a roofed building (blends sky lighting down). */
  setIndoor(indoor: boolean): void {
    this.indoorTarget = indoor ? 1 : 0;
  }

  private applyIndoor(dt: number): void {
    const k = this.indoor + (this.indoorTarget - this.indoor) * Math.min(1, dt * 4);
    if (Math.abs(k - this.indoor) < 0.0005 && k === this.indoorTarget) return;
    this.indoor = k;
    const lerp = (a: number, b: number): number => a + (b - a) * k;
    this.light.hemi.intensity = lerp(4.4, 1.15);
    this.light.moon.intensity = lerp(4.2, 0.25);
    this.light.fill.intensity = lerp(1.1, 0.05);
    this.scene.environmentIntensity = lerp(0.5, 0.11);
    this.viewHemi.intensity = lerp(2.6, 1.1);
    this.viewSun.intensity = lerp(2.4, 0.25);
    this.viewScene.environmentIntensity = lerp(0.85, 0.15);
    this.viewLamp.intensity = lerp(0, 1.4);
  }

  /** Apply a quality preset (pixel ratio cap, shadows, bloom, MSAA, light pool). */
  setQuality(level: QualityLevel): void {
    this.quality = level;
    const q = QUALITY[level];
    this.renderer.shadowMap.enabled = q.shadows;
    this.light.setShadowQuality(q.shadows, q.shadowMapSize);
    this.lightPool.setActiveCount(q.lightPool);
    this.rebuildComposer();
    this.resize();
  }

  private rebuildComposer(): void {
    const q = QUALITY[this.quality];
    this.composer?.dispose();
    this.composer = null;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap) * this.renderScale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * pr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * pr));
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.msaaSamples });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(1);
    composer.setSize(w, h);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.worldPass.clear = true;
    this.viewPass = new RenderPass(this.viewScene, this.viewCamera);
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    composer.addPass(this.worldPass);
    composer.addPass(this.viewPass);
    if (q.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), RENDER.bloomStrength, RENDER.bloomRadius, RENDER.bloomThreshold);
      composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }
    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);
    this.composer = composer;
  }

  resize(): void {
    const q = QUALITY[this.quality];
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap) * this.renderScale;
    const cw = Math.max(1, this.canvas.clientWidth);
    const ch = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(cw, ch, false);
    this.width = cw;
    this.height = ch;
    const aspect = cw / ch;
    this.camera.aspect = aspect;
    this.viewCamera.aspect = aspect;
    this.updateFov();
    this.viewCamera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(this.refViewHFov / 2) / aspect) * 180) / Math.PI, 28, 78);
    this.viewCamera.updateProjectionMatrix();
    if (this.composer) {
      const w = Math.floor(cw * pr);
      const h = Math.floor(ch * pr);
      this.composer.setSize(w, h);
      this.bloomPass?.setSize(w, h);
    }
  }

  /** Change the dynamic-resolution scale and resize the render targets. */
  setRenderScale(scale: number): void {
    const v = Math.max(0.6, Math.min(1, scale));
    if (Math.abs(v - this.renderScale) < 0.001) return;
    this.renderScale = v;
    this.resize();
  }

  /** Vertical FOV in degrees for the current settings, aspect and zoom. */
  updateFov(): number {
    const aspect = this.camera.aspect;
    const h = (this.hFov * Math.PI) / 180;
    const vHalf = Math.atan(Math.tan(h / 2) / aspect);
    // clamp for extreme aspect ratios (ultrawide / portrait)
    const clamped = THREE.MathUtils.clamp(vHalf * 2, (35 * Math.PI) / 180, (100 * Math.PI) / 180);
    const zoomed = 2 * Math.atan(Math.tan(clamped / 2) * this.zoom);
    const deg = (zoomed * 180) / Math.PI;
    if (Math.abs(this.camera.fov - deg) > 0.001) {
      this.camera.fov = deg;
      this.camera.updateProjectionMatrix();
    }
    return deg;
  }

  get viewportWidth(): number {
    return this.width * this.renderer.getPixelRatio();
  }

  get viewportHeight(): number {
    return this.height * this.renderer.getPixelRatio();
  }

  render(dt: number, time: number): void {
    this.time = time;
    this.renderer.info.reset();
    this.applyIndoor(dt);
    this.sky.position.copy(this.camera.position);
    (this.sky.userData.uniforms.uTime as THREE.IUniform).value = time;
    this.camera.getWorldPosition(this.tmpV);
    this.light.focusShadow(this.tmpV);
    this.lightPool.update(dt, time, this.tmpV);
    this.camera.updateMatrixWorld();
    if (this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
    }
  }

  dispose(): void {
    this.composer?.dispose();
    this.lightPool.dispose();
    this.renderer.dispose();
  }
}
