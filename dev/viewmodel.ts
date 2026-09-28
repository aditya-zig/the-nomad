/**
 * Viewmodel harness. Renders a small world backdrop (sky, ground, fog) and the viewmodel pass (depth cleared) exactly like
 * the game: PerspectiveCamera(fov 52 @16:9, near 0.02, far 6) at the origin looking -Z.
 *
 * Scripted control (all deterministic; live mode is off unless window.live(true)):
 *   select(id)            'rifle' | 'pistol' | 'shotgun' | 'grenade' | 'plate'
 *   setPose(partial)      merge into the pose object, then re-render (one tiny step)
 *   step(seconds)         advance the rig with 1/60 s sub-steps
 *   fire()                onFire + cycle restart (weapon fire interval from config)
 *   scrub(kind, t)        'mag' | 'shellStart' | 'shellLoad' | 'shellEnd' | 'pump' | 'throw' | 'plate' | 'draw' | 'cycle'
 *   tier(n)               0..2
 *   debugCam(x,y,z,tx,ty,tz,fov)   free camera (viewmodel only, dark backdrop);  gameCam() returns to the game camera
 *   project()             NDC of the gun origin (sight point) with the game camera
 *   handLab(rightPose,leftPose)    isolated pair of hands
 */
import * as THREE from 'three';
import { WEAPONS } from '../src/config';
import { createEnvironment, createRenderer, createSkyDome } from '../src/render/stage';
import { GloveHand, HAND_POSES, type HandPoseName } from '../src/weapons/viewmodel/hand';
import { RigMaterials, acquireTextures } from '../src/weapons/viewmodel/materials';
import { createViewmodels } from '../src/weapons/viewmodels';
import type { ViewmodelPose, ViewmodelRig, ViewmodelSet } from '../src/weapons/viewmodelTypes';
import { REFERENCE_VIEWMODEL_FOV } from '../src/weapons/viewmodelTypes';

const renderer = createRenderer();
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

// ---- world backdrop --------------------------------------------------------------------------
const world = new THREE.Scene();
const sky = createSkyDome();
world.add(sky);
world.fog = new THREE.FogExp2(0x3b4c62, 0.0105);
world.add(new THREE.HemisphereLight(0x6f93c4, 0x3a4550, 3.2));
const moon = new THREE.DirectionalLight(0xa9c4ee, 3.4);
moon.position.set(-20, 40, -30);
world.add(moon);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2d3238, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
world.add(ground);
for (let i = 0; i < 9; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 12), new THREE.MeshStandardMaterial({ color: [0x7a2e26, 0x2d4a6e, 0x555c3a][i % 3]!, roughness: 0.7, metalness: 0.3 }));
  b.position.set(-30 + i * 9, 1.3, -40 - (i % 3) * 8);
  world.add(b);
}
const worldCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.06, 420);
worldCam.position.set(0, 1.68, 0);

// ---- viewmodel scene -------------------------------------------------------------------------
const view = new THREE.Scene();
const envTex = createEnvironment(renderer);
view.environment = envTex;
view.environmentIntensity = 1.0;
view.add(new THREE.HemisphereLight(0x6f93c4, 0x3a4550, 2.6));
const key = new THREE.DirectionalLight(0xbdd0f0, 3.0);
key.position.set(-0.6, 1.0, 0.5);
view.add(key);
const warm = new THREE.PointLight(0xffa860, 1.6, 6, 2);
warm.position.set(-1.2, 0.5, 0.6);
view.add(warm);

const viewCam = new THREE.PerspectiveCamera(REFERENCE_VIEWMODEL_FOV, 16 / 9, 0.02, 6);
const dbgCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.004, 20);
let useDebug = false;

const tCreate0 = performance.now();
let set: ViewmodelSet = createViewmodels();
const createMs = performance.now() - tCreate0;
const rigs: Record<string, ViewmodelRig> = { rifle: set.rifle, pistol: set.pistol, shotgun: set.shotgun, grenade: set.grenade, plate: set.plate };
const mountAll = () => {
  rigs.rifle = set.rifle;
  rigs.pistol = set.pistol;
  rigs.shotgun = set.shotgun;
  rigs.grenade = set.grenade;
  rigs.plate = set.plate;
  for (const r of Object.values(rigs)) view.add(r.root);
};
for (const r of Object.values(rigs)) view.add(r.root);

const pose: ViewmodelPose = {
  time: 0,
  ads: 0,
  sprint: 0,
  move: 0,
  bobPhase: 0,
  crouch: 0,
  air: 0,
  landing: 0,
  lookYaw: 0,
  lookPitch: 0,
  raise: 1,
  reloadPhase: 'none',
  reloadT: 0,
  reloadEmpty: false,
  cycle: 1,
  ammo: 30,
  magSize: 30,
  action: 0,
  reducedMotion: false,
};
let current: ViewmodelRig = set.rifle;
let firedAt = -10;
let live = false;
let sheetMode = false;

// ---- hand lab --------------------------------------------------------------------------------
const labGroup = new THREE.Group();
labGroup.visible = false;
view.add(labGroup);
let labHands: GloveHand[] = [];
const labMats = new RigMaterials(acquireTextures());

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  renderer.setSize(w, h);
  worldCam.aspect = aspect;
  worldCam.fov = (2 * Math.atan(Math.tan(Math.PI / 4) / aspect) * 180) / Math.PI; // 90 deg horizontal
  worldCam.updateProjectionMatrix();
  // keep the horizontal viewmodel FOV constant: reference is 52 deg vertical at 16:9
  const hRef = Math.tan((REFERENCE_VIEWMODEL_FOV * Math.PI) / 360) * (16 / 9);
  viewCam.aspect = aspect;
  viewCam.fov = (2 * Math.atan(hRef / aspect) * 180) / Math.PI;
  viewCam.updateProjectionMatrix();
  dbgCam.aspect = aspect;
  dbgCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function updateRig(dt: number) {
  pose.time += dt;
  // fire cycle progress from the last shot
  const id = current.id;
  if (id === 'rifle' || id === 'pistol' || id === 'shotgun') {
    const interval = WEAPONS[id].fireInterval;
    pose.cycle = Math.min(1, (pose.time - firedAt) / interval);
  }
  current.update(pose, dt);
  set.rifle.root.visible = current === set.rifle && current.root.visible;
}

function render() {
  const cam = useDebug ? dbgCam : viewCam;
  renderer.clear();
  if (!useDebug) {
    sky.position.copy(worldCam.position);
    renderer.render(world, worldCam);
    renderer.clearDepth();
    view.background = null;
  } else {
    view.background = new THREE.Color(0x232a31);
  }
  renderer.render(view, cam);
}

function frame(now: number) {
  if (live) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    updateRig(dt);
  }
  lastT = now;
  if (!sheetMode) render();
  (window as unknown as { __ready: boolean }).__ready = true;
  // ---- audits -------------------------------------------------------------------------------------
const NEAR = 0.02;

/** Count near-plane clipping hits: triangle edges that cross depth=NEAR inside the near-plane rectangle. */
function auditNear(root: THREE.Object3D, cam: THREE.PerspectiveCamera): number {
  root.updateMatrixWorld(true);
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const tanH = tanV * cam.aspect;
  const p = new THREE.Vector3();
  const tri: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let hits = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let vis = true;
    for (let a: THREE.Object3D | null = m; a; a = a.parent) if (!a.visible) vis = false;
    if (!vis) return;
    const geo = m.geometry;
    const pos = geo.attributes.position!;
    const idx = geo.index;
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh;
    const count = idx ? idx.count : pos.count;
    const getV = (vi: number, out: THREE.Vector3) => {
      if (skinned) (m as THREE.SkinnedMesh).getVertexPosition(vi, out);
      else out.fromBufferAttribute(pos, vi);
      out.applyMatrix4(m.matrixWorld);
    };
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) getV(idx ? idx.getX(i + k) : i + k, tri[k]!);
      for (let k = 0; k < 3; k++) {
        const a = tri[k]!;
        const b = tri[(k + 1) % 3]!;
        const da = -a.z;
        const db = -b.z;
        if ((da < NEAR && db > NEAR) || (db < NEAR && da > NEAR)) {
          const t = (NEAR - da) / (db - da);
          p.lerpVectors(a, b, t);
          if (Math.abs(p.x) <= NEAR * tanH && Math.abs(p.y) <= NEAR * tanV) hits++;
        }
      }
    }
  });
  return hits;
}

w.nearCheck = () => {
  const saved = { ...pose };
  const report: Record<string, { hits: number; worst?: string }> = {};
  const poses: [string, Partial<ViewmodelPose>][] = [];
  const add = (name: string, p: Partial<ViewmodelPose>) => poses.push([name, p]);
  add('idle', {});
  add('ads', { ads: 1 });
  add('ads-crouch', { ads: 1, crouch: 1 });
  add('sprint', { sprint: 1, move: 1 });
  add('air-rising', { air: 1 });
  add('air-falling', { air: -1, landing: 1 });
  add('look-left', { lookYaw: 8, lookPitch: 4 });
  add('look-right', { lookYaw: -8, lookPitch: -4 });
  for (const r of [0, 0.25, 0.5, 0.75]) add(`raise-${r}`, { raise: r });
  for (let t = 0; t <= 1.0001; t += 0.1) add(`mag-${t.toFixed(1)}`, { reloadPhase: 'mag', reloadT: t });
  for (let t = 0; t <= 1.0001; t += 0.1) add(`mag-empty-${t.toFixed(1)}`, { reloadPhase: 'mag', reloadT: t, reloadEmpty: true, ammo: 0 });
  for (const ph of ['shellStart', 'shellLoad', 'shellEnd', 'pump'] as const) for (let t = 0; t <= 1.0001; t += 0.125) add(`${ph}-${t.toFixed(2)}`, { reloadPhase: ph, reloadT: t });
  for (let t = 0; t <= 1.0001; t += 0.05) add(`action-${t.toFixed(2)}`, { action: t });
  for (const c of [0, 0.1, 0.3, 0.5, 0.7]) add(`cycle-${c}`, { cycle: c });
  for (const id of Object.keys(rigs)) {
    (w.select as (id: string) => void)(id);
    let hits = 0;
    let worst = '';
    let worstN = 0;
    for (const [name, extra] of poses) {
      const wasFire = firedAt;
      Object.assign(pose, { ads: 0, sprint: 0, move: 0, crouch: 0, air: 0, landing: 0, lookYaw: 0, lookPitch: 0, raise: 1, reloadPhase: 'none', reloadT: 0, reloadEmpty: false, cycle: 1, action: 0, ammo: id === 'pistol' ? 13 : id === 'shotgun' ? 6 : 30 }, extra);
      if (extra.cycle !== undefined && extra.cycle < 1) firedAt = pose.time - extra.cycle * 0.5;
      (w.step as (s: number) => void)(0.25);
      firedAt = wasFire;
      const n = auditNear(current.root, viewCam);
      hits += n;
      if (n > worstN) {
        worstN = n;
        worst = name;
      }
    }
    report[id] = { hits, worst: worst || undefined };
  }
  Object.assign(pose, saved);
  return report;
};

w.stats = () => {
  const out: Record<string, unknown> = {};
  renderer.info.autoReset = false;
  for (const id of Object.keys(rigs)) {
    (w.select as (id: string) => void)(id);
    (w.step as (s: number) => void)(0.2);
    renderer.info.reset();
    renderer.render(view, viewCam);
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      pose.time += 1 / 60;
      current.update(pose, 1 / 60);
    }
    const us = ((performance.now() - t0) / 600) * 1000;
    out[id] = { drawCalls: calls, triangles: tris, updateMicros: +us.toFixed(1) };
  }
  renderer.info.autoReset = true;
  return out;
};

/** Peak gun displacement while bobbing, with and without reduced motion (checks the ~25% scaling). */
w.bobAmp = () => {
  const res: Record<string, { normal: number; reduced: number; ratio: number }> = {};
  for (const id of ['rifle', 'pistol', 'shotgun']) {
    (w.select as (id: string) => void)(id);
    const measure = (reduced: boolean) => {
      Object.assign(pose, { move: 1, reducedMotion: reduced, lookYaw: 2, lookPitch: 1 });
      const gun = current.root.children[0] as THREE.Object3D;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 240; i++) {
        pose.bobPhase += 0.12;
        pose.time += 1 / 60;
        current.update(pose, 1 / 60);
        const y = gun.position.y;
        min = Math.min(min, y);
        max = Math.max(max, y);
      }
      return max - min;
    };
    const normal = measure(false);
    const reduced = measure(true);
    Object.assign(pose, { move: 0, reducedMotion: false, lookYaw: 0, lookPitch: 0 });
    res[id] = { normal: +normal.toFixed(5), reduced: +reduced.toFixed(5), ratio: +(reduced / normal).toFixed(3) };
  }
  return res;
};

w.perf = () => ({ createMs: +createMs.toFixed(1) });

/** ADS alignment: NDC position of the sight point at ads = 1 for each firearm. */
w.adsCheck = () => {
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of ['rifle', 'pistol', 'shotgun']) {
    (w.select as (id: string) => void)(id);
    Object.assign(pose, { ads: 1, move: 0, lookYaw: 0, lookPitch: 0, reducedMotion: true, cycle: 1 });
    (w.step as (s: number) => void)(1.0);
    out[id] = (w.project as () => { x: number; y: number })();
    Object.assign(pose, { ads: 0, reducedMotion: false });
  }
  return out;
};

/** Sustained fire: peak gun displacement and rotation while firing repeatedly (springs must stay bounded). */
w.autoFire = (id: string, shots: number, interval: number) => {
  (w.select as (id: string) => void)(id);
  const gun = current.root.children[0] as THREE.Object3D;
  let zMin = Infinity;
  let zMax = -Infinity;
  let pMax = -Infinity;
  for (let s = 0; s < shots; s++) {
    (w.fire as () => void)();
    const n = Math.round(interval * 60);
    for (let i = 0; i < n; i++) {
      pose.time += 1 / 60;
      const id2 = current.id;
      pose.cycle = Math.min(1, (pose.time - firedAt) / WEAPONS[id2 as 'rifle'].fireInterval);
      current.update(pose, 1 / 60);
      zMin = Math.min(zMin, gun.position.z);
      zMax = Math.max(zMax, gun.position.z);
      pMax = Math.max(pMax, gun.rotation.x);
    }
  }
  // let it settle
  for (let i = 0; i < 120; i++) {
    pose.time += 1 / 60;
    pose.cycle = 1;
    current.update(pose, 1 / 60);
  }
  return { zMin: +zMin.toFixed(4), zMax: +zMax.toFixed(4), pitchMax: +pMax.toFixed(4), settledZ: +gun.position.z.toFixed(4) };
};

/** Dispose the whole set, recreate it and compare GPU resource counts. */
w.leakTest = () => {
  const mem = () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
  (w.select as (id: string) => void)('rifle');
  render();
  const before = mem();
  for (const r of Object.values(rigs)) view.remove(r.root);
  set.dispose();
  const t0 = performance.now();
  set = createViewmodels();
  const recreateMs = performance.now() - t0;
  mountAll();
  (w.select as (id: string) => void)('rifle');
  render();
  const after = mem();
  return { before, after, recreateMs: +recreateMs.toFixed(1) };
};

requestAnimationFrame(frame);
}
let lastT = performance.now();

type AnyWin = Window & Record<string, unknown>;
const w = window as unknown as AnyWin;

w.select = (id: string) => {
  const r = rigs[id];
  if (!r) throw new Error(`unknown rig ${id}`);
  for (const [k, v] of Object.entries(rigs)) v.root.visible = k === id ? v.root.visible : false;
  current = r;
  labGroup.visible = false;
  pose.raise = 1;
  pose.ammo = pose.magSize = id === 'pistol' ? 13 : id === 'shotgun' ? 6 : 30;
  r.reset();
  (w.step as (s: number) => void)(0.5);
  return id;
};
w.setPose = (p: Partial<ViewmodelPose>) => {
  Object.assign(pose, p);
  updateRig(1 / 120);
  return pose;
};
w.step = (sec: number) => {
  const n = Math.max(1, Math.ceil(sec * 60));
  for (let i = 0; i < n; i++) updateRig(sec / n);
  return pose.time;
};
w.fire = () => {
  firedAt = pose.time;
  pose.cycle = 0;
  if (pose.ammo > 0) pose.ammo -= 1;
  current.onFire(currentTier, 1);
  updateRig(1 / 120);
};
let currentTier = 0;
w.tier = (n: number) => {
  currentTier = n;
  for (const r of Object.values(rigs)) r.setTier(n);
  return n;
};
w.scrub = (kind: string, t: number) => {
  const p = pose;
  p.reloadPhase = 'none';
  p.action = 0;
  switch (kind) {
    case 'mag':
      p.reloadPhase = 'mag';
      p.reloadT = t;
      break;
    case 'shellStart':
    case 'shellLoad':
    case 'shellEnd':
    case 'pump':
      p.reloadPhase = kind;
      p.reloadT = t;
      break;
    case 'throw':
    case 'plate':
      p.action = t;
      break;
    case 'draw':
      p.raise = t;
      break;
    case 'cycle':
      firedAt = p.time - t * WEAPONS[(current.id === 'grenade' || current.id === 'plate' ? 'rifle' : current.id)].fireInterval;
      break;
    default:
      throw new Error(`unknown scrub ${kind}`);
  }
  (w.step as (s: number) => void)(0.12);
  return { kind, t };
};
w.debugCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number, fov = 40) => {
  useDebug = true;
  dbgCam.fov = fov;
  dbgCam.position.set(x, y, z);
  dbgCam.lookAt(tx, ty, tz);
  dbgCam.updateProjectionMatrix();
};
w.gameCam = () => {
  useDebug = false;
};
w.live = (v: boolean) => {
  live = v;
  lastT = performance.now();
};
w.project = () => {
  current.root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const gun = current.root.children[0] as THREE.Object3D;
  gun.getWorldPosition(v);
  v.project(viewCam);
  return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) };
};
w.pose = pose;
/**
 * Contact sheet: scrub `kind` through `times` and render each frame into a grid cell of one screenshot.
 * `extra` = partial pose applied before each frame (e.g. {reloadEmpty:true}).
 */
w.sheet = (kind: string, times: number[], cols = 3, extra: Partial<ViewmodelPose> = {}) => {
  sheetMode = true;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rows = Math.ceil(times.length / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  const hRef = Math.tan((REFERENCE_VIEWMODEL_FOV * Math.PI) / 360) * (16 / 9);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();
  times.forEach((t, i) => {
    Object.assign(pose, extra);
    (w.scrub as (k: string, t: number) => void)(kind, t);
    const x = (i % cols) * cw;
    const y = H - (Math.floor(i / cols) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    const asp = cw / ch;
    worldCam.aspect = asp;
    worldCam.fov = (2 * Math.atan(Math.tan(Math.PI / 4) / asp) * 180) / Math.PI;
    worldCam.updateProjectionMatrix();
    viewCam.aspect = asp;
    viewCam.fov = (2 * Math.atan(hRef / asp) * 180) / Math.PI;
    viewCam.updateProjectionMatrix();
    dbgCam.aspect = asp;
    dbgCam.updateProjectionMatrix();
    render();
  });
  renderer.setScissorTest(false);
  return times.length;
};
/** Render one weapon at several tiers side by side; `fire` triggers a muzzle flash in each cell. */
w.tierSheet = (id: string, tiers: number[], cols = 3, fire = false) => {
  sheetMode = true;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rows = Math.ceil(tiers.length / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  const hRef = Math.tan((REFERENCE_VIEWMODEL_FOV * Math.PI) / 360) * (16 / 9);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();
  (w.select as (id: string) => void)(id);
  tiers.forEach((tr, i) => {
    (w.tier as (n: number) => void)(tr);
    if (fire) (w.fire as () => void)();
    else (w.step as (s: number) => void)(0.1);
    const x = (i % cols) * cw;
    const y = H - (Math.floor(i / cols) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    const asp = cw / ch;
    worldCam.aspect = asp;
    worldCam.fov = (2 * Math.atan(Math.tan(Math.PI / 4) / asp) * 180) / Math.PI;
    worldCam.updateProjectionMatrix();
    viewCam.aspect = asp;
    viewCam.fov = (2 * Math.atan(hRef / asp) * 180) / Math.PI;
    viewCam.updateProjectionMatrix();
    dbgCam.aspect = asp;
    dbgCam.updateProjectionMatrix();
    render();
  });
  renderer.setScissorTest(false);
  (w.tier as (n: number) => void)(0);
  return tiers.length;
};
/** Render several rigs side by side with the same extra pose. */
w.weaponSheet = (ids: string[], cols = 3, extra: Partial<ViewmodelPose> = {}) => {
  sheetMode = true;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rows = Math.ceil(ids.length / cols);
  const cw = Math.floor(W / cols);
  const ch = Math.floor(H / rows);
  const hRef = Math.tan((REFERENCE_VIEWMODEL_FOV * Math.PI) / 360) * (16 / 9);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();
  ids.forEach((id, i) => {
    Object.assign(pose, { ads: 0, sprint: 0, move: 0, crouch: 0, air: 0, landing: 0, raise: 1, reloadPhase: 'none', reloadT: 0, cycle: 1, action: 0 }, extra);
    (w.select as (id: string) => void)(id);
    Object.assign(pose, extra);
    (w.step as (s: number) => void)(0.4);
    const x = (i % cols) * cw;
    const y = H - (Math.floor(i / cols) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    const asp = cw / ch;
    worldCam.aspect = asp;
    worldCam.fov = (2 * Math.atan(Math.tan(Math.PI / 4) / asp) * 180) / Math.PI;
    worldCam.updateProjectionMatrix();
    viewCam.aspect = asp;
    viewCam.fov = (2 * Math.atan(hRef / asp) * 180) / Math.PI;
    viewCam.updateProjectionMatrix();
    render();
  });
  renderer.setScissorTest(false);
  return ids.length;
};
w.sheetOff = () => {
  sheetMode = false;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  resize();
};
w.handLab = (rightPose: HandPoseName = 'relaxed', leftPose: HandPoseName = 'relaxed') => {
  for (const r of Object.values(rigs)) r.root.visible = false;
  for (const h of labHands) labGroup.remove(h.root);
  labHands = [new GloveHand({ side: 'right', seed: 1 }, labMats), new GloveHand({ side: 'left', watch: true, seed: 2 }, labMats)];
  labHands[0]!.root.position.set(0.09, 0, 0);
  labHands[1]!.root.position.set(-0.09, 0, 0);
  labHands[0]!.setPose(HAND_POSES[rightPose]);
  labHands[1]!.setPose(HAND_POSES[leftPose]);
  for (const h of labHands) {
    h.aimForearm(0, -0.3, 0.9);
    labGroup.add(h.root);
  }
  labGroup.visible = true;
  return labHands.length;
};
w.labPose = (i: number, name: HandPoseName) => labHands[i]?.setPose(HAND_POSES[name]);
w.labRot = (i: number, x: number, y: number, z: number) => labHands[i]?.root.rotation.set(x, y, z);

requestAnimationFrame(frame);
