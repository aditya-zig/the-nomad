/**
 * Zombie rig harness. Scripted API on `window.__z` (used by scripts/shot.mjs):
 *   show(specs, spacing)   lay out rigs in a row facing the camera
 *   advance(sec)           step animation deterministically (no rendering)
 *   setCam(x,y,z, tx,ty,tz), freeze(bool), wire(bool), bones(bool)
 *   crowd(n)               40-ish mixed rigs in a field
 *   perf(frames)           CPU cost of rig.update for the current rigs
 *   deathReport()          measured lowest / highest skinned vertex for every type and death style
 *   createCost()           time to create rigs after warm-up
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER, ZOMBIES } from '../src/config';
import { createFactoryForHarness } from './zombies-factory';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import type { ZombieType } from '../src/types';
import type { ZombieAnimState, ZombieMode, ZombieRig } from '../src/enemies/zombieRigTypes';

interface Spec {
  type: ZombieType;
  seed?: number;
  mode: ZombieMode;
  speed?: number;
  actionT?: number;
  staggerT?: number;
  deathT?: number;
  deathStyle?: 0 | 1 | 2;
  headshot?: boolean;
  aggro?: number;
  hitKick?: number;
  yaw?: number;
  loop?: boolean;
  enraged?: boolean;
  /** Seconds of simulation before the first render (per rig). */
  preroll?: number;
}

interface Entry {
  rig: ZombieRig;
  spec: Spec;
  state: ZombieAnimState;
  age: number;
}

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const hud = document.getElementById('hud')!;

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.55;
const rig3 = setupBlueHour(scene, 22);
rig3.setShadowQuality(true, 2048);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(0, 1.7, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// ground: dark wet asphalt look (harness only)
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.85, metalness: 0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// height ruler poles every metre for scale checks (1.8 m marker)
const ruler = new THREE.Group();
for (let i = 0; i <= 6; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x55ff99 : 0xffaa33 }));
  m.position.set(-8.6, i * 0.5, 0);
  ruler.add(m);
}
ruler.visible = false;
scene.add(ruler);

const factory = createFactoryForHarness();
const entries: Entry[] = [];
let time = 0;
let frozen = false;
let simSpeed = 1;
let wireOn = false;
let helpers: THREE.SkeletonHelper[] = [];

function clear(): void {
  for (const e of entries) e.rig.dispose();
  entries.length = 0;
  for (const h of helpers) h.removeFromParent();
  helpers = [];
}

function makeState(s: Spec): ZombieAnimState {
  return {
    mode: s.mode,
    speed: s.speed ?? (s.mode === 'run' || s.mode === 'charge' ? ZOMBIES[s.type].speedChase : s.mode === 'walk' ? ZOMBIES[s.type].speedWalk + 0.6 : 0),
    time,
    actionT: s.actionT ?? 0,
    staggerT: s.staggerT ?? 0,
    deathT: s.deathT ?? 0,
    aggro: s.aggro ?? 0,
    hitKick: s.hitKick ?? 0,
    deathStyle: s.deathStyle ?? 0,
    headshotDeath: s.headshot ?? false,
    enraged: s.enraged ?? false,
  };
}

function show(specs: Spec[], spacing = 1.7, z = 0): void {
  clear();
  const n = specs.length;
  specs.forEach((spec, i) => {
    const seed = spec.seed ?? 1000 + i * 37;
    const rig = factory.create(spec.type, seed);
    rig.root.position.set((i - (n - 1) / 2) * spacing, 0, z);
    rig.root.rotation.y = spec.yaw ?? Math.PI;
    scene.add(rig.root);
    const entry: Entry = { rig, spec, state: makeState(spec), age: 0 };
    entries.push(entry);
    for (let t = 0; t < (spec.preroll ?? 0) - 1e-9; t += 1 / 60) {
      time += 1 / 60;
      stepEntry(entry, 1 / 60);
    }
  });
}

function stepEntry(e: Entry, dt: number): void {
  const s = e.state;
  const sp = e.spec;
  e.age += dt;
  s.time = time;
  if (sp.loop) {
    if (sp.mode === 'attack') s.actionT = (e.age % 1.5) / 1.5;
    if (sp.mode === 'stagger') s.staggerT = (e.age % 1.2) / 1.2;
    if (sp.mode === 'slam' || sp.mode === 'roar') s.actionT = (e.age % 2.4) / 2.4;
    if (sp.mode === 'death') s.deathT = e.age % 3.2;
  }
  if (sp.hitKick !== undefined) s.hitKick = sp.hitKick;
  e.rig.update(s, dt);
}

function advance(sec: number, dt = 1 / 60): void {
  let t = 0;
  while (t < sec - 1e-9) {
    const step = Math.min(dt, sec - t);
    time += step;
    for (const e of entries) stepEntry(e, step);
    t += step;
  }
}

/** Preset lineups: `modes` = idle, walk, run, attack x3, stagger x2; `deaths` = three styles at four times each. */
function preset(name: string, type: ZombieType): void {
  const specs: Spec[] = [];
  if (name === 'modes') {
    specs.push({ type, seed: 40, mode: 'idle', preroll: 1 });
    specs.push({ type, seed: 40, mode: 'walk', speed: 1.5, preroll: 1.4 });
    specs.push({ type, seed: 40, mode: 'run', speed: ZOMBIES[type].speedChase, preroll: 1.2 });
    for (const a of [0.3, 0.6, 0.72]) specs.push({ type, seed: 40, mode: 'attack', actionT: a, preroll: 0.6 });
    for (const st of [0.1, 0.3]) specs.push({ type, seed: 40, mode: 'stagger', staggerT: st, preroll: 0.4 });
    if (type === 'warden') {
      specs.push({ type, seed: 40, mode: 'slam', actionT: 0.5, preroll: 0.6 });
      specs.push({ type, seed: 40, mode: 'roar', actionT: 0.5, preroll: 0.6 });
    }
  } else if (name === 'deaths') {
    for (const style of [0, 1, 2] as const) for (const t of [0.3, 0.7, 1.2, 2.0]) specs.push({ type, seed: 40, mode: 'death', deathT: t, deathStyle: style });
  }
  show(specs, name === 'deaths' ? 2.6 : 1.9);
  frozen = true;
  advance(0.05);
}

const w = window as unknown as { __ready: boolean; __z: Record<string, unknown> };
w.__z = {
  preset,
  show,
  advance,
  clear,
  time: () => time,
  setCam(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov?: number) {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    if (fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    controls.update();
  },
  freeze(v: boolean) {
    frozen = v;
  },
  speed(v: number) {
    simSpeed = v;
  },
  ruler(v: boolean) {
    ruler.visible = v;
  },
  wire(v: boolean) {
    wireOn = v;
    factory.material.wireframe = v;
  },
  bones(v: boolean) {
    for (const h of helpers) h.removeFromParent();
    helpers = [];
    if (!v) return;
    for (const e of entries) {
      const sm = (e.rig as unknown as { skinnedMesh?: THREE.SkinnedMesh }).skinnedMesh;
      if (sm) {
        const h = new THREE.SkeletonHelper(sm);
        scene.add(h);
        helpers.push(h);
      }
    }
  },
  crowd(n: number) {
    clear();
    const types: ZombieType[] = ['shambler', 'runner', 'armored', 'warden'];
    const modes: ZombieMode[] = ['idle', 'walk', 'run', 'attack', 'stagger', 'walk'];
    const wts = [0.55, 0.28, 0.14, 0.03];
    let seed = 1;
    for (let i = 0; i < n; i++) {
      let r = (i * 0.6180339) % 1;
      let ti = 0;
      for (; ti < 3; ti++) {
        if (r < wts[ti]!) break;
        r -= wts[ti]!;
      }
      const type = types[ti]!;
      const mode = modes[i % modes.length]!;
      const rig = factory.create(type, seed++ * 7919);
      const cols = 8;
      const x = ((i % cols) - (cols - 1) / 2) * 2.1 + Math.sin(i * 12.9) * 0.5;
      const z = -Math.floor(i / cols) * 2.3 + Math.cos(i * 7.7) * 0.5;
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = Math.PI + Math.sin(i * 3.3) * 0.5;
      scene.add(rig.root);
      const spec: Spec = { type, mode, loop: true, aggro: (i % 3) * 0.3 };
      entries.push({ rig, spec, state: makeState(spec), age: i * 0.37 });
    }
  },
  perf(frames = 300) {
    const n = entries.length;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      time += 1 / 60;
      for (const e of entries) stepEntry(e, 1 / 60);
    }
    const t1 = performance.now();
    // render CPU submission cost
    let rc = 0;
    const R = 60;
    for (let f = 0; f < R; f++) {
      time += 1 / 60;
      for (const e of entries) stepEntry(e, 1 / 60);
      const a = performance.now();
      renderer.render(scene, camera);
      rc += performance.now() - a;
    }
    return { rigs: n, updateMsPerFrame: (t1 - t0) / frames, renderCpuMsPerFrame: rc / R, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
  createCost() {
    // warm-up: variants already baked by prewarm()
    const out: Record<string, number> = {};
    for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
      const rigs: ZombieRig[] = [];
      const t0 = performance.now();
      const N = 20;
      for (let i = 0; i < N; i++) rigs.push(factory.create(type, 500 + i * 13));
      out[type] = (performance.now() - t0) / N;
      for (const r of rigs) r.dispose();
    }
    return out;
  },
  prewarmMs() {
    const t0 = performance.now();
    factory.prewarm();
    return performance.now() - t0;
  },
  deathReport() {
    const res: Record<string, { minY: number; maxY: number; hx: number; hz: number; ext: number }> = {};
    const v = new THREE.Vector3();
    for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
      for (const style of [0, 1, 2] as const) {
        for (const headshot of [false, true]) {
          const rig = factory.create(type, 4242);
          scene.add(rig.root);
          const st: ZombieAnimState = { mode: 'idle', speed: 0, time: 0, actionT: 0, staggerT: 0, deathT: 0, aggro: 0, hitKick: 0, deathStyle: style, headshotDeath: headshot, enraged: false };
          rig.update(st, 1 / 60);
          st.mode = 'death';
          for (let t = 0; t <= 2.2; t += 1 / 60) {
            st.deathT = t;
            rig.update(st, 1 / 60);
          }
          rig.root.updateMatrixWorld(true);
          const sm = (rig as unknown as { skinnedMesh: THREE.SkinnedMesh }).skinnedMesh;
          sm.skeleton.update();
          let minY = Infinity;
          let maxY = -Infinity;
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          const pos = sm.geometry.attributes.position!;
          for (let i = 0; i < pos.count; i++) {
            sm.getVertexPosition(i, v);
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
          }
          res[`${type}/${style}${headshot ? 'h' : ''}`] = { minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), hx: +(maxX - minX).toFixed(2), hz: +(maxZ - minZ).toFixed(2), ext: +Math.max(maxX - minX, maxZ - minZ).toFixed(2) };
          rig.dispose();
        }
      }
    }
    return res;
  },
  headAccuracy() {
    // compare the reported head centre with the actual skinned head vertices (bone 4 = head, 5 = jaw)
    const res: Record<string, unknown> = {};
    const v = new THREE.Vector3();
    const head = new THREE.Vector3();
    const chest = new THREE.Vector3();
    for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
      for (const mode of ['idle', 'walk', 'run', 'attack', 'stagger', 'death'] as ZombieMode[]) {
        const rig = factory.create(type, 3131);
        rig.root.position.set(3, 0, -2);
        rig.root.rotation.y = 1.1;
        scene.add(rig.root);
        const st: ZombieAnimState = { mode, speed: mode === 'run' ? ZOMBIES[type].speedChase : mode === 'walk' ? 1.4 : 0, time: 0, actionT: 0.6, staggerT: 0.3, deathT: 1.0, aggro: 0.5, hitKick: 0, deathStyle: 1, headshotDeath: false, enraged: false };
        for (let f = 0; f < 90; f++) {
          st.time = f / 60;
          rig.update(st, 1 / 60);
        }
        rig.root.updateMatrixWorld(true);
        const sm = (rig as unknown as { skinnedMesh: THREE.SkinnedMesh }).skinnedMesh;
        sm.skeleton.update();
        const pos = sm.geometry.attributes.position!;
        const si = sm.geometry.attributes.skinIndex!;
        const sw = sm.geometry.attributes.skinWeight!;
        const box = new THREE.Box3();
        let n = 0;
        for (let i = 0; i < pos.count; i++) {
          if (si.getX(i) === 4 && sw.getX(i) > 0.99) {
            sm.getVertexPosition(i, v);
            v.applyMatrix4(sm.matrixWorld);
            box.expandByPoint(v);
            n++;
          }
        }
        const c = box.getCenter(new THREE.Vector3());
        rig.getHeadWorld(head);
        rig.getChestWorld(chest);
        let inside = 0;
        for (let i = 0; i < pos.count; i++) {
          if (si.getX(i) === 4 && sw.getX(i) > 0.99) {
            sm.getVertexPosition(i, v);
            v.applyMatrix4(sm.matrixWorld);
            if (v.distanceTo(head) <= rig.headRadius) inside++;
          }
        }
        res[`${type}/${mode}`] = { headVerts: n, centreErr: +c.distanceTo(head).toFixed(3), insideFrac: +(inside / Math.max(1, n)).toFixed(2), headY: +head.y.toFixed(2), chestY: +chest.y.toFixed(2) };
        rig.dispose();
      }
    }
    return res;
  },
  fuzz(frames = 4000) {
    // random rapid mode switching: every bone and the head/chest/hand queries must stay finite and grounded
    const modes: ZombieMode[] = ['idle', 'walk', 'run', 'attack', 'stagger', 'death', 'slam', 'charge', 'roar'];
    const out: Record<string, unknown> = {};
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const hv = new THREE.Vector3();
    for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
      const rig = factory.create(type, 999);
      scene.add(rig.root);
      const bones = (rig as unknown as { skeletonBones: THREE.Bone[] }).skeletonBones;
      let bad = 0;
      let maxPelvis = 0;
      let minPelvis = 99;
      const st: ZombieAnimState = { mode: 'idle', speed: 0, time: 0, actionT: 0, staggerT: 0, deathT: 0, aggro: 0, hitKick: 0, deathStyle: 0, headshotDeath: false, enraged: false };
      let hold = 0;
      for (let f = 0; f < frames; f++) {
        if (hold-- <= 0) {
          st.mode = modes[Math.floor(rnd() * modes.length)]!;
          hold = 1 + Math.floor(rnd() * 90);
          st.speed = rnd() * 8;
          st.actionT = rnd();
          st.staggerT = rnd();
          st.deathT = rnd() * 2.5;
          st.deathStyle = Math.floor(rnd() * 3) as 0 | 1 | 2;
          st.headshotDeath = rnd() < 0.5;
          st.aggro = rnd();
          st.hitKick = rnd() < 0.3 ? rnd() : 0;
          if (rnd() < 0.08) rig.reset(Math.floor(rnd() * 100000));
        }
        st.time += 1 / 60;
        if (st.mode === 'death') st.deathT += 1 / 60;
        else {
          st.actionT = Math.min(1, st.actionT + 1 / 90);
          st.staggerT = Math.min(1, st.staggerT + 1 / 70);
        }
        rig.update(st, rnd() < 0.05 ? 0.05 : 1 / 60);
        for (const b of bones) {
          const p = b.position;
          const q = b.quaternion;
          if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) bad++;
        }
        const py = bones[0]!.position.y;
        maxPelvis = Math.max(maxPelvis, py);
        minPelvis = Math.min(minPelvis, py);
        rig.getHeadWorld(hv);
        if (!Number.isFinite(hv.x + hv.y + hv.z)) bad++;
      }
      out[type] = { nonFinite: bad, pelvisMin: +minPelvis.toFixed(3), pelvisMax: +maxPelvis.toFixed(3) };
      rig.dispose();
    }
    return out;
  },
  standReport() {
    // lowest / highest skinned vertex and head position agreement while standing / walking / running
    const res: Record<string, unknown> = {};
    const v = new THREE.Vector3();
    const head = new THREE.Vector3();
    for (const type of ['shambler', 'runner', 'armored', 'warden'] as ZombieType[]) {
      for (const mode of ['idle', 'walk', 'run', 'attack'] as ZombieMode[]) {
        const rig = factory.create(type, 77);
        scene.add(rig.root);
        const st: ZombieAnimState = { mode, speed: mode === 'run' ? ZOMBIES[type].speedChase : mode === 'walk' ? 1.4 : 0, time: 0, actionT: 0.6, staggerT: 0, deathT: 0, aggro: 0, hitKick: 0, deathStyle: 0, headshotDeath: false, enraged: false };
        let minY = Infinity;
        let maxY = -Infinity;
        let worst = 0;
        for (let f = 0; f < 240; f++) {
          st.time = f / 60;
          rig.update(st, 1 / 60);
          if (f % 12 === 0 && f > 60) {
            rig.root.updateMatrixWorld(true);
            const sm = (rig as unknown as { skinnedMesh: THREE.SkinnedMesh }).skinnedMesh;
            sm.skeleton.update();
            const pos = sm.geometry.attributes.position!;
            for (let i = 0; i < pos.count; i++) {
              sm.getVertexPosition(i, v);
              if (v.y < minY) minY = v.y;
              if (v.y > maxY) maxY = v.y;
            }
            // head bone position vs reported head centre
            rig.getHeadWorld(head);
            const hb = (rig as unknown as { skeletonBones: THREE.Bone[] }).skeletonBones[4]!;
            const hv = new THREE.Vector3();
            hb.getWorldPosition(hv);
            worst = Math.max(worst, head.distanceTo(hv));
          }
        }
        res[`${type}/${mode}`] = { minY: +minY.toFixed(3), maxY: +maxY.toFixed(3), headBoneDist: +worst.toFixed(3) };
        rig.dispose();
      }
    }
    return res;
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsN++;
  if (!frozen) {
    const sdt = dt * simSpeed;
    time += sdt;
    for (const e of entries) stepEntry(e, sdt);
  }
  controls.update();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig3.focusShadow(controls.target);
  renderer.render(scene, camera);
  if (fpsAcc > 0.5) {
    hud.textContent = `rigs ${entries.length}   ${(fpsN / fpsAcc).toFixed(0)} fps   calls ${renderer.info.render.calls}   tris ${renderer.info.render.triangles}${wireOn ? '   wire' : ''}`;
    fpsAcc = 0;
    fpsN = 0;
  }
  w.__ready = true;
  requestAnimationFrame(frame);
}

// URL presets: ?preset=modes&type=shambler  |  ?preset=deaths&type=armored  |  ?preset=crowd
const params = new URLSearchParams(window.location.search);
const presetName = params.get('preset');
const presetType = (params.get('type') ?? 'shambler') as ZombieType;
if (presetName === 'crowd') {
  (w.__z.crowd as (n: number) => void)(40);
} else if (presetName) {
  preset(presetName, presetType);
} else {
// default scene: a line-up of all four types idling
show(
  (['shambler', 'runner', 'armored', 'warden'] as ZombieType[]).map((type, i) => ({ type, seed: 12 + i * 5, mode: 'idle' as ZombieMode })),
  2.0,
);
}
factory.prewarm();
requestAnimationFrame(frame);
