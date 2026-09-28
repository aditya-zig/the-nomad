/**
 * FX harness. Open http://127.0.0.1:<port>/dev/fx.html
 * Query: ?bloom=0 disables bloom, ?stats=0 hides the overlay, ?paused=1 starts frozen.
 * Console API (window): trigger(name, ...args), freeze(), thaw(), advance(seconds), setCam(x,y,z,tx,ty,tz), stress(seconds), fxStats(), clearFx().
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER, WEAPONS } from '../src/config';
import { createFx } from '../src/fx/fx';
import { Rng } from '../src/fx/rng';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import type { SurfaceKind, Vec3Like } from '../src/types';

const params = new URLSearchParams(location.search);
const useBloom = params.get('bloom') !== '0';

const renderer = createRenderer();
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.6;
const rig = setupBlueHour(scene, 28);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(0, 1.7, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.3, -3);
controls.update();

// ---------------------------------------------------------------------------------------------
// test set: procedural surfaces
// ---------------------------------------------------------------------------------------------

const rng = new Rng(77);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, base: [number, number, number], var_: number, size: number) {
  for (let i = 0; i < n; i++) {
    const k = (rng.next() - 0.5) * var_;
    g.fillStyle = `rgba(${base[0] + k},${base[1] + k},${base[2] + k},${0.08 + rng.next() * 0.25})`;
    const s = 1 + rng.next() * size;
    g.fillRect(rng.next() * w, rng.next() * h, s, s * (0.5 + rng.next()));
  }
}

const concreteTex = canvasTex(1024, 512, (g) => {
  g.fillStyle = '#7d7d79';
  g.fillRect(0, 0, 1024, 512);
  speckle(g, 1024, 512, 9000, [125, 125, 120], 70, 5);
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * 1024;
    const grad = g.createLinearGradient(x, 0, x + rng.range(-10, 10), 512);
    grad.addColorStop(0, 'rgba(30,28,25,0)');
    grad.addColorStop(0.5, `rgba(30,28,25,${0.05 + rng.next() * 0.1})`);
    grad.addColorStop(1, 'rgba(30,28,25,0.02)');
    g.fillStyle = grad;
    g.fillRect(x, 0, rng.range(6, 30), 512);
  }
  g.strokeStyle = 'rgba(30,30,28,0.55)';
  g.lineWidth = 2;
  for (let x = 256; x < 1024; x += 256) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(1024, 256);
  g.stroke();
});

const asphaltTex = canvasTex(512, 512, (g) => {
  g.fillStyle = '#2b2d30';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 14000, [70, 72, 76], 90, 3);
  speckle(g, 512, 512, 900, [140, 140, 138], 60, 2);
}, [24, 24]);

const metalTex = canvasTex(512, 256, (g) => {
  g.fillStyle = '#2e4f76';
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.13)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 16, 256);
  }
  speckle(g, 512, 256, 3500, [120, 90, 70], 80, 4);
});

const woodTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#7a5b3a';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = 'rgba(20,10,4,0.5)';
    g.fillRect(0, y, 256, 2);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${60 + rng.int(60)},${40 + rng.int(40)},${20 + rng.int(20)},0.25)`;
      g.fillRect(rng.next() * 256, y + rng.next() * 30, 40 + rng.next() * 100, 1);
    }
  }
});

const dirtTex = canvasTex(512, 512, (g) => {
  g.fillStyle = '#54442f';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 12000, [110, 88, 62], 90, 5);
}, [3, 3]);

const fabricTex = canvasTex(256, 256, (g) => {
  g.fillStyle = '#7d7654';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    g.fillStyle = `rgba(40,36,20,${0.15 + rng.next() * 0.1})`;
    g.fillRect(0, y, 256, 1);
  }
  speckle(g, 256, 256, 2500, [130, 120, 90], 60, 3);
});

function addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// ground
addMesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.86 }), 0, 0, 0, false).rotation.x = -Math.PI / 2;
// dirt patch (impact surface: dirt), lies flush with the ground
const dirt = addMesh(new THREE.PlaneGeometry(5, 4), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }), 8, 0.012, -1, false);
dirt.rotation.x = -Math.PI / 2;
// concrete wall
addMesh(new THREE.BoxGeometry(14, 4.5, 0.6), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.93 }), -1, 2.25, -6.3);
// metal container face
addMesh(new THREE.BoxGeometry(4.4, 2.5, 2.2), new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.55, metalness: 0.6 }), -9.5, 1.25, -3.6);
// wood crate
addMesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9 }), 5.2, 0.65, -3.4);
// sandbags (fabric)
addMesh(new THREE.BoxGeometry(2.2, 0.9, 0.7), new THREE.MeshStandardMaterial({ map: fabricTex, roughness: 1 }), 2.2, 0.45, -2.2);
// glass pane
addMesh(new THREE.BoxGeometry(2.2, 1.8, 0.05), new THREE.MeshStandardMaterial({ color: 0x9cc2d4, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22 }), -3.6, 1.4, -1.6, false);
// body-height dummy (blood target): capsule torso + head
const dummyMat = new THREE.MeshStandardMaterial({ color: 0x59654a, roughness: 0.95 });
const dummy = new THREE.Group();
dummy.position.set(-6, 0, -0.5);
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 6, 12), dummyMat);
torso.position.y = 1.05;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0x7f8a6a, roughness: 0.8 }));
head.position.y = 1.72;
torso.castShadow = head.castShadow = true;
dummy.add(torso, head);
scene.add(dummy);
const dummy2 = dummy.clone();
dummy2.position.set(-4.6, 0, 0.6);
scene.add(dummy2);

// a warm street lamp lighting the test area
const lamp = new THREE.PointLight(0xffc088, 95, 30, 2);
lamp.position.set(-1, 5.4, -1.2);
scene.add(lamp);
const lamp2 = new THREE.PointLight(0xffc088, 60, 26, 2);
lamp2.position.set(7, 4.5, 2);
scene.add(lamp2);

// ---------------------------------------------------------------------------------------------
// fx
// ---------------------------------------------------------------------------------------------

const tInit = performance.now();
const fx = createFx();
scene.add(fx.root);
(window as unknown as Record<string, unknown>).fxInitMs = +(performance.now() - tInit).toFixed(1);

interface Target {
  surface: SurfaceKind;
  point: (u: number) => Vec3Like;
  normal: Vec3Like;
}

const targets: Record<string, Target> = {
  concrete: { surface: 'concrete', point: (u) => ({ x: -1 + (u - 0.5) * 10, y: 1.3 + rng.signed() * 0.4, z: -6.0 }), normal: { x: 0, y: 0, z: 1 } },
  metal: { surface: 'metal', point: (u) => ({ x: -9.5 + (u - 0.5) * 3.2, y: 1.2 + rng.signed() * 0.3, z: -2.5 }), normal: { x: 0, y: 0, z: 1 } },
  wood: { surface: 'wood', point: (u) => ({ x: 5.2 + (u - 0.5) * 0.9, y: 0.7 + rng.signed() * 0.3, z: -2.75 }), normal: { x: 0, y: 0, z: 1 } },
  dirt: { surface: 'dirt', point: (u) => ({ x: 8 + (u - 0.5) * 3, y: 0.02, z: -1 + rng.signed() }), normal: { x: 0, y: 1, z: 0 } },
  glass: { surface: 'glass', point: (u) => ({ x: -3.6 + (u - 0.5) * 1.6, y: 1.4 + rng.signed() * 0.4, z: -1.57 }), normal: { x: 0, y: 0, z: 1 } },
  fabric: { surface: 'fabric', point: (u) => ({ x: 2.2 + (u - 0.5) * 1.6, y: 0.5 + rng.signed() * 0.2, z: -1.85 }), normal: { x: 0, y: 0, z: 1 } },
  ground: { surface: 'concrete', point: (u) => ({ x: (u - 0.5) * 8, y: 0, z: 1 + rng.signed() }), normal: { x: 0, y: 1, z: 0 } },
};

const tierColor = (t: number) => WEAPONS.rifle.tracerColors[t] ?? 0xffe3a3;

type Api = Record<string, (...a: number[]) => unknown>;
const api: Api = {
  hit(surfaceIdx = 0, u = 0.5, strong = 0) {
    const names = Object.keys(targets);
    const t = targets[names[surfaceIdx % names.length]!]!;
    const p = t.point(u);
    fx.impact(p, t.normal, t.surface, { strong: strong > 0 });
    return names[surfaceIdx % names.length];
  },
  dummy2Visible(v = 1) {
    dummy2.visible = !!v;
  },
  blood(head = 0, kill = 0, which = 0) {
    const d = which ? dummy2 : dummy;
    const y = head ? 1.72 : 1.25;
    fx.blood({ x: d.position.x + 0.1, y, z: d.position.z + 0.28 }, { x: 0.35, y: 0.05, z: -0.9 }, { head: !!head, kill: !!kill });
  },
  explosion(radius = 7.5, x = 2, z = -1) {
    fx.explosion({ x, y: 0.25, z }, radius);
  },
  tracer(tier = 0, dx = 0) {
    fx.tracer({ x: 0.35 + dx, y: 1.35, z: 8.2 }, { x: dx * 1.5, y: 1.4, z: -6 }, tierColor(tier));
  },
  casing(kind = 0) {
    const k = (['rifle', 'pistol', 'shotgun'] as const)[kind % 3]!;
    fx.casing({ x: 0.45 + rng.signed() * 0.05, y: 1.45, z: 8.6 }, { x: 2.1 + rng.signed() * 0.6, y: 1.8 + rng.next(), z: 0.5 + rng.signed() * 0.5 }, k);
  },
  muzzle(strong = 0) {
    fx.muzzleSmoke({ x: 0.3, y: 1.4, z: 8.0 }, { x: 0, y: 0.05, z: -1 }, !!strong);
  },
  flare(x = 4, z = 3) {
    flareHandle?.stop();
    flareHandle = fx.flare({ x, y: 0.05, z });
    return 1;
  },
  flareStop() {
    flareHandle?.stop();
    flareHandle = null;
  },
  downwash(strength = 1) {
    downwashStrength = strength;
  },
  sparkle(hex = 0x66ffcc) {
    fx.sparkle({ x: 0, y: 1, z: 3 }, hex, 14);
  },
  dust(a = 1) {
    fx.dust({ x: 1, y: 0.05, z: 4 }, a);
  },
  emitters() {
    fx.emitter('steam', { x: -3, y: 0.1, z: 2 });
    fx.emitter('toxic', { x: 3, y: 0.05, z: 1 }, { radius: 1.5 });
    fx.emitter('sparks', { x: 0, y: 2.6, z: -4.5 }, { rate: 1.2 });
    fx.emitter('smoke', { x: -7, y: 0.4, z: 3 });
    fx.emitter('embers', { x: 6, y: 0.3, z: 4 });
    fx.emitter('mist', { x: 0, y: 0, z: 0 }, { radius: 7 });
  },
  clear() {
    fx.clear();
    flareHandle = null;
    downwashStrength = 0;
  },
};

let flareHandle: ReturnType<typeof fx.flare> | null = null;
let downwashStrength = 0;

const w = window as unknown as Record<string, unknown>;
w.trigger = (name: string, ...args: number[]) => {
  const fn = api[name];
  if (!fn) throw new Error(`no trigger ${name}`);
  return fn(...args);
};

// ---------------------------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------------------------

let composer: EffectComposer | null = null;
function buildComposer(): void {
  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), RENDER.bloomStrength, RENDER.bloomRadius, RENDER.bloomThreshold));
  composer.addPass(new OutputPass());
}
if (useBloom) buildComposer();

renderer.info.autoReset = false;

function render(): void {
  renderer.info.reset();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = simTime;
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

let simTime = 0;
let frozen = params.get('paused') === '1';
let last = performance.now();
const statsEl = document.getElementById('stats') as HTMLDivElement;
if (params.get('stats') === '0') statsEl.style.display = 'none';
let statsTimer = 0;

function step(dt: number): void {
  simTime += dt;
  if (downwashStrength > 0) fx.downwash({ x: 4, y: 3, z: 3 }, 9, downwashStrength);
  fx.update(dt, camera);
  const lampFlicker = flareHandle ? flareHandle.intensity() : 0;
  lamp2.intensity = 60 + lampFlicker * 0;
}

function updateStats(): void {
  const s = fx.stats();
  statsEl.textContent = `normal ${s.normalParticles}  additive ${s.additiveParticles}  motes ${s.motes}\nholes ${s.bulletHoles}  blood ${s.bloodSplats}  scorch ${s.scorches}\ntracers ${s.tracers}  casings ${s.casings}  emitters ${s.emitters}  flares ${s.flares}\ncalls ${renderer.info.render.calls}`;
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  rig.focusShadow(controls.target);
  if (!frozen) step(dt);
  render();
  statsTimer += dt;
  if (statsTimer > 0.25) {
    statsTimer = 0;
    updateStats();
  }
  w.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

w.freeze = () => {
  frozen = true;
};
w.thaw = () => {
  frozen = false;
  last = performance.now();
};
w.advance = (seconds: number) => {
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) step(1 / 60);
  controls.update();
  rig.focusShadow(controls.target);
  render();
  updateStats();
  return fx.stats();
};
w.setCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};
w.fxStats = () => fx.stats();
w.fxRoot = fx.root;
w.disposeFx = () => {
  fx.dispose();
  return 'disposed';
};
w.sceneRef = scene;
w.clearFx = () => fx.clear();
w.setQuality = (p: number, d: number) => fx.setQuality(p, d);

/** Stress: ~200 impacts/s + tracers + casings + blood for `seconds` of simulated time; reports bounds and update cost. */
w.stress = (seconds = 4) => {
  frozen = true;
  const names = Object.keys(targets);
  const frames = Math.round(seconds * 60);
  let maxNormal = 0;
  let maxAdd = 0;
  let maxHoles = 0;
  let maxBlood = 0;
  let maxCasings = 0;
  let maxTracers = 0;
  let total = 0;
  let worst = 0;
  const heap0 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  let spawned = 0;
  for (let f = 0; f < frames; f++) {
    const n = f % 3 === 0 ? 4 : 3; // ~200/s
    for (let i = 0; i < n; i++) {
      const t = targets[names[(f + i) % names.length]!]!;
      fx.impact(t.point(rng.next()), t.normal, t.surface, { strong: (f + i) % 5 === 0 });
      spawned++;
    }
    if (f % 6 === 0) {
      fx.blood({ x: -6, y: 1.3, z: -0.2 }, { x: 0.3, y: 0, z: -0.9 }, { head: f % 12 === 0, kill: f % 24 === 0 });
      fx.tracer({ x: 0.3, y: 1.4, z: 8 }, { x: rng.signed() * 4, y: 1.3, z: -6 }, 0xffe3a3);
      fx.casing({ x: 0.45, y: 1.45, z: 8.6 }, { x: 2, y: 2, z: 0.4 }, 'rifle');
    }
    if (f % 90 === 0) fx.explosion({ x: rng.signed() * 5, y: 0.3, z: rng.signed() * 3 }, 7.5);
    const t0 = performance.now();
    fx.update(1 / 60, camera);
    const dtMs = performance.now() - t0;
    total += dtMs;
    if (dtMs > worst) worst = dtMs;
    const s = fx.stats();
    maxNormal = Math.max(maxNormal, s.normalParticles);
    maxAdd = Math.max(maxAdd, s.additiveParticles);
    maxHoles = Math.max(maxHoles, s.bulletHoles);
    maxBlood = Math.max(maxBlood, s.bloodSplats);
    maxCasings = Math.max(maxCasings, s.casings);
    maxTracers = Math.max(maxTracers, s.tracers);
  }
  render();
  const heap1 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  const result = {
    simulatedSeconds: seconds,
    impactsSpawned: spawned,
    meanUpdateMs: +(total / frames).toFixed(3),
    worstUpdateMs: +worst.toFixed(3),
    peak: { normal: maxNormal, additive: maxAdd, holes: maxHoles, blood: maxBlood, casings: maxCasings, tracers: maxTracers },
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    heapDeltaKB: Math.round((heap1 - heap0) / 1024),
  };
  w.stressResult = result;
  updateStats();
  return result;
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});
