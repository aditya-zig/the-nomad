/**
 * Dev harness for src/world/models.ts: every dynamic model on a plate under the game's blue-hour lighting.
 *   http://127.0.0.1:5307/dev/models.html?view=heliSide
 * Scripted control: window.view(name), window.setCam(x,y,z, tx,ty,tz), window.set(name, patch), window.advance(seconds), window.info()
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RENDER } from '../src/config';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import { createMaterialLib } from '../src/world/materials';
import {
  createAreaMarker,
  createContaminationWall,
  createExtractionTerminal,
  createFlareModel,
  createGrenadeModel,
  createHelicopter,
  createLootCrate,
  createObjectiveBeam,
  createPickupModel,
  createStationModel,
  type AreaMarker,
  type ContaminationWall,
  type CrateModel,
  type HelicopterRig,
  type HelicopterState,
  type StationModel,
  type TerminalModel,
} from '../src/world/models';

const params = new URLSearchParams(location.search);
const bloom = params.get('bloom') !== '0';

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.7;
const rig = setupBlueHour(scene, 40);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(0, 3, -12);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);

let composer: EffectComposer | null = null;
if (bloom) {
  const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), RENDER.bloomStrength, RENDER.bloomRadius, RENDER.bloomThreshold));
  composer.addPass(new OutputPass());
}

const mats = createMaterialLib();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mats.get('asphalt'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// tiled test pad so scale is readable (1 m grid lines)
const grid = new THREE.GridHelper(60, 60, 0x445566, 0x2a333d);
grid.position.set(10, 0.02, 0);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.25;
scene.add(grid);

function safe<T>(name: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    console.error(`[harness] ${name} failed:`, e);
    return null;
  }
}

const place = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number, rotY = 0): T => {
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  scene.add(obj);
  return obj;
};

// ---- models ----
const heli: HelicopterRig | null = safe('helicopter', () => {
  const h = createHelicopter(mats);
  place(h.root, 0, 0, -26);
  return h;
});
const heliState: HelicopterState = { rotor: 0, lights: true, doorOpen: 0 };

const buy: StationModel | null = safe('buy', () => {
  const s = createStationModel('buy', mats);
  place(s.root, -9, 0, 0);
  return s;
});
const upgrade: StationModel | null = safe('upgrade', () => {
  const s = createStationModel('upgrade', mats);
  place(s.root, -4.5, 0, 0);
  return s;
});
const crates: Record<string, CrateModel | null> = {};
(['low', 'medium', 'high'] as const).forEach((r, i) => {
  crates[r] = safe(`crate-${r}`, () => {
    const c = createLootCrate(r, mats);
    place(c.root, 0.6 + i * 1.9, 0, 0);
    return c;
  });
});
for (const [i, kind] of (['ammo', 'plate', 'grenade'] as const).entries()) {
  safe(`pickup-${kind}`, () => place(createPickupModel(kind, mats), 6.8 + i * 1.0, 0.0, 0));
}
const terminal: TerminalModel | null = safe('terminal', () => {
  const t = createExtractionTerminal(mats);
  place(t.root, 12, 0, 0);
  return t;
});
safe('grenade', () => place(createGrenadeModel(mats), 14.2, 0.09, 0));
safe('flare', () => place(createFlareModel(mats), 15.2, 0, 0));
const marker: AreaMarker | null = safe('marker', () => {
  const m = createAreaMarker(4, 0x4fe0ff);
  place(m.root, 24, 0, 0);
  m.setRadius(4);
  m.setProgress(0.62);
  m.setActive(true);
  return m;
});
safe('beam', () => place(createObjectiveBeam(0xff9a3a), 34, 0, 0));
const wall: ContaminationWall | null = safe('wall', () => {
  const w = createContaminationWall();
  scene.add(w.root);
  w.setCenter(0, -160);
  w.setRadius(45);
  w.setIntensity(1);
  return w;
});

// ---- views ----
const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  overview: [4, 6, -18, 6, 1, 0],
  heliSide: [16, 3.2, -26, 0, 2.3, -26],
  heliDoor: [5.5, 1.6, -22.5, 1.3, 1.5, -26.8],
  heliFront: [-6, 2.4, -36, 0, 2.4, -26],
  heliRear: [7, 3.5, -12, 0, 2.6, -26],
  heliTop: [0, 24, -16, 0, 0, -26],
  heliLow: [-4, 0.8, -32, 0, 2.2, -26],
  stations: [-6.7, 2.2, -7.5, -6.7, 1.2, 0],
  buyFront: [-9, 1.7, -4.2, -9, 1.5, 0],
  buy3q: [-12.4, 2.0, -4.2, -9, 1.3, 0],
  upFront: [-4.5, 1.7, -4.2, -4.5, 1.3, 0],
  up3q: [-1.2, 2.0, -4.2, -4.5, 1.2, 0],
  crates: [2.5, 1.5, -3.6, 2.5, 0.35, 0],
  cratesOpen: [2.5, 1.9, -3.0, 2.5, 0.3, 0],
  pickups: [7.8, 1.0, -2.2, 7.8, 0.15, 0],
  terminal: [12, 1.7, -4.4, 12, 1.2, 0],
  small: [14.7, 0.5, -1.6, 14.7, 0.05, 0],
  marker: [24, 3.6, -9, 24, 0.3, 0],
  beam: [34, 4, -14, 34, 8, 0],
  wallOutside: [0, 4, -70, 0, 5, -160],
  wallEdge: [0, 2.2, -108, 0, 5, -160],
  wallInside: [0, 1.7, -160, 0, 3, -205],
  wallInsideNear: [0, 1.7, -190, 0, 3.5, -205],
};
const setCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number): void => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};
const view = (name: string): void => {
  const v = VIEWS[name];
  if (v) setCam(...v);
};
if (params.get('view')) view(params.get('view')!);

// ---- time ----
let time = 0;
let paused = false;
function stepAll(dt: number): void {
  time += dt;
  heli?.update(dt, heliState);
  buy?.update(dt, time);
  upgrade?.update(dt, time);
  for (const c of Object.values(crates)) c?.update(dt, time);
  terminal?.update(dt, time);
  marker?.update(dt, time);
  wall?.update(dt, time, camera);
}

interface Api {
  view: (n: string) => void;
  setCam: typeof setCam;
  advance: (sec: number) => void;
  set: (what: string, patch: Record<string, unknown>) => void;
  info: () => unknown;
  time: () => number;
  count: (name: string) => { meshes: number; triangles: number; parts: number[] };
  stress: () => unknown;
  pause: (v: boolean) => void;
}
const api: Api = {
  view,
  setCam,
  advance(sec: number) {
    const n = Math.round(sec * 60);
    for (let i = 0; i < n; i++) stepAll(1 / 60);
  },
  set(what, patch) {
    if (what === 'heli') Object.assign(heliState, patch);
    else if (what === 'buy') buy?.setState(patch.state as 'idle' | 'near' | 'used' | 'denied');
    else if (what === 'upgrade') upgrade?.setState(patch.state as 'idle' | 'near' | 'used' | 'denied');
    else if (what === 'crate') {
      const c = crates[patch.region as string];
      if (c) {
        if (patch.open !== undefined) c.setOpen(patch.open as number);
        if (patch.looted !== undefined) c.setLooted(patch.looted as boolean);
      }
    } else if (what === 'terminal') terminal?.setState(patch.state as 'idle' | 'called' | 'done');
    else if (what === 'marker') {
      if (patch.radius !== undefined) marker?.setRadius(patch.radius as number);
      if (patch.progress !== undefined) marker?.setProgress(patch.progress as number);
      if (patch.active !== undefined) marker?.setActive(patch.active as boolean);
      if (patch.color !== undefined) marker?.setColor(patch.color as number);
    } else if (what === 'wall') {
      if (patch.radius !== undefined) wall?.setRadius(patch.radius as number);
      if (patch.intensity !== undefined) wall?.setIntensity(patch.intensity as number);
      if (patch.cx !== undefined || patch.cz !== undefined) wall?.setCenter((patch.cx as number) ?? 0, (patch.cz as number) ?? -160);
    }
  },
  info() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  },
  time: () => time,
  pause(v: boolean) {
    paused = v;
  },
  stress() {
    // create + dispose every model type repeatedly; GPU-side counts must return to baseline
    const before = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    for (let i = 0; i < 6; i++) {
      const hs = createHelicopter(mats);
      const st = [createStationModel('buy', mats), createStationModel('upgrade', mats)];
      const cr = (['low', 'medium', 'high'] as const).map((r) => createLootCrate(r, mats));
      const tm = createExtractionTerminal(mats);
      const mk = createAreaMarker(5, 0x44ddff);
      const cw = createContaminationWall();
      for (const o of [hs.root, ...st.map((x) => x.root), ...cr.map((x) => x.root), tm.root, mk.root, cw.root]) scene.add(o);
      renderer.render(scene, camera);
      for (const o of [hs.root, ...st.map((x) => x.root), ...cr.map((x) => x.root), tm.root, mk.root, cw.root]) scene.remove(o);
      hs.dispose();
      st.forEach((x) => x.dispose());
      cr.forEach((x) => x.dispose());
      tm.dispose();
      mk.dispose();
      cw.dispose();
    }
    renderer.render(scene, camera);
    const after = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    return { before, after };
  },
  count(name: string) {
    const target: THREE.Object3D | undefined = name === 'heli' ? heli?.root : name === 'buy' ? buy?.root : name === 'upgrade' ? upgrade?.root : name === 'terminal' ? terminal?.root : name === 'crate' ? crates.low?.root : undefined;
    let meshes = 0;
    let triangles = 0;
    const parts: number[] = [];
    target?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        meshes++;
        const g = m.geometry;
        const t = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
        triangles += t;
        parts.push(Math.round(t));
      }
    });
    return { meshes, triangles: Math.round(triangles), parts };
  },
};
(window as unknown as { H: Api }).H = api;
Object.assign(window, { view, setCam });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

const hud = document.getElementById('hud')!;
let last = performance.now();
let frames = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) stepAll(dt);
  controls.update();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig.focusShadow(controls.target);
  if (composer) composer.render();
  else renderer.render(scene, camera);
  frames++;
  if (frames % 20 === 0 && params.get('hud') === '1') {
    const i = api.info() as { calls: number; triangles: number };
    hud.textContent = `calls ${i.calls}  tris ${i.triangles}`;
  }
  (window as unknown as { __ready: boolean }).__ready = frames > 3;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
