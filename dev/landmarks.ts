/**
 * Landmarks & interiors harness. One 132 x 104 m test yard (the game's playable size) with every landmark placed the way the
 * level layout will place them, plus two interior test rooms (store, lab).
 *
 * URL params: ?colliders=1 (collider overlay)  ?fog=0  ?cutaway=1 (no ceilings)  ?t=12.3 (frozen animation clock)  ?dpr=1  ?noindoor=1
 * Console: window.preset('spireFar'), window.setCam(px,py,pz,tx,ty,tz), window.setTime(s), window.freeze(bool), window.__h (handles)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER } from '../src/config';
import { LightPool } from '../src/render/lightPool';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import { LevelBuilder } from '../src/world/builder';
import { CollisionWorld } from '../src/world/collision';
import * as I from '../src/world/interiors';
import * as L from '../src/world/landmarks';
import type { MaterialName } from '../src/world/materials';
import { createMaterialLib } from '../src/world/materials';

const params = new URLSearchParams(location.search);
const showColliders = params.get('colliders') === '1';
const cutaway = params.get('cutaway') === '1';
const noIndoor = params.get('noindoor') === '1';
const bounds = { minX: -66, maxX: 66, minZ: -52, maxZ: 52 };

const renderer = createRenderer();
renderer.setPixelRatio(Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 2)));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.55;
const rig = setupBlueHour(scene, 46);
if (params.get('fog') === '0') scene.fog = null;

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(-50, 1.7, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(46, 30, -26);

const mats = createMaterialLib();
const world = new CollisionWorld(bounds);
const b = new LevelBuilder(mats, world);

// ---------------------------------------------------------------------------------------------
// test yard
// ---------------------------------------------------------------------------------------------
function box(mat: MaterialName, w: number, h: number, d: number, x: number, y: number, z: number, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.get(mat));
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  b.add(m);
  return m;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), mats.get('asphalt'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
b.add(ground);
// perimeter walls
const wallH = 4.5;
const t = 1.2;
const W = bounds.maxX - bounds.minX;
const D = bounds.maxZ - bounds.minZ;
for (const [cx, cz, w, d] of [
  [0, bounds.minZ - t / 2, W + 2 * t, t],
  [0, bounds.maxZ + t / 2, W + 2 * t, t],
  [bounds.minX - t / 2, 0, t, D],
  [bounds.maxX + t / 2, 0, t, D],
] as const) {
  box('concreteWall', w, wallH, d, cx, wallH / 2, cz);
  b.collideBox(cx, cz, w, d, wallH, { mapKind: 'wall' });
}

interface RoomSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  door: '+z' | '-z' | '+x' | '-x';
  floor: MaterialName;
  wall: MaterialName;
}
const rooms: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
function room(r: RoomSpec): void {
  const th = 0.25;
  const doorW = 1.9;
  const doorH = 2.4;
  rooms.push({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 });
  box(r.floor, r.w, 0.1, r.d, r.x, 0.05, r.z, false);
  if (!cutaway) box('concreteDark', r.w + 0.3, 0.25, r.d + 0.3, r.x, r.h + 0.125, r.z);
  const sides: { axis: 'x' | 'z'; sign: number; key: RoomSpec['door'] }[] = [
    { axis: 'z', sign: -1, key: '-z' },
    { axis: 'z', sign: 1, key: '+z' },
    { axis: 'x', sign: -1, key: '-x' },
    { axis: 'x', sign: 1, key: '+x' },
  ];
  for (const s of sides) {
    const along = s.axis === 'z' ? r.w : r.d;
    const cx = s.axis === 'z' ? r.x : r.x + s.sign * (r.w / 2 + th / 2 - th / 2);
    const cz = s.axis === 'z' ? r.z + s.sign * (r.d / 2) : r.z;
    const place = (len: number, off: number, y: number, hh: number, solid: boolean) => {
      const px = s.axis === 'z' ? r.x + off : cx;
      const pz = s.axis === 'z' ? cz : r.z + off;
      const w = s.axis === 'z' ? len : th;
      const d = s.axis === 'z' ? th : len;
      box(r.wall, w, hh, d, px, y + hh / 2, pz);
      if (solid) b.collideBox(px, pz, w, d, y + hh, { mapKind: 'building', y0: y });
    };
    if (s.key === r.door) {
      const side = (along - doorW) / 2;
      place(side, -(doorW / 2 + side / 2), 0, r.h, true);
      place(side, doorW / 2 + side / 2, 0, r.h, true);
      place(doorW, 0, doorH, r.h - doorH, true);
    } else {
      place(along, 0, 0, r.h, true);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// landmarks (positions mirror how the level places them)
// ---------------------------------------------------------------------------------------------
const H = {
  spire: L.spire(b, { x: 46, z: -26, height: 58 }),
  transmitter: L.transmitterSite(b, { x: -26, z: 22, radius: 10 }),
};
L.containmentDome(b, { x: 22, z: -32, radius: 9 });
L.helipad(b, { x: -36, z: -30, radius: 11 });
L.toxicPool(b, { x: 12, z: -8, w: 8, d: 5 });
L.collapsedRoad(b, { x: -8, z: 44, w: 12, d: 8, seed: 3 });
L.overpassRuin(b, { x: 32, z: 45, length: 44 });
L.quarantineGate(b, { x: 0, z: 0, width: 10, open: 0.35 });
L.skylineBackdrop(b, { bounds, seed: 11 });

// ---- store test room ----
room({ x: -52, z: 34, w: 14, d: 10, h: 3.2, door: '-z', floor: 'floorStore', wall: 'plaster' });
{
  const cx = -52;
  const cz = 34;
  for (let i = 0; i < 3; i++) I.storeShelf(b, { x: cx - 2 + 0 * i, z: cz - 1.5 + i * 2.2, length: 4.2, stocked: true, seed: 10 + i, rot: 0 });
  I.storeShelf(b, { x: cx + 4.2, z: cz - 3, length: 2.4, stocked: true, seed: 21, rot: Math.PI / 2 });
  I.checkoutCounter(b, { x: cx + 3.2, z: cz - 3.9, length: 2.6, rot: 0 });
  I.fridgeCase(b, { x: cx - 2, z: cz + 4.4, length: 4, rot: Math.PI });
  I.fridgeCase(b, { x: cx + 3.5, z: cz + 4.4, length: 2, rot: Math.PI });
  I.officeDesk(b, { x: cx + 6, z: cz + 2.2, rot: Math.PI / 2, chair: true });
  const y = 3.15;
  I.ceilingLight(b, { x: cx - 4, z: cz - 2, y, kind: 'tube', mode: 'steady', rot: 0 });
  I.ceilingLight(b, { x: cx, z: cz - 2, y, kind: 'tube', mode: 'flicker', rot: 0 });
  I.ceilingLight(b, { x: cx + 4, z: cz - 2, y, kind: 'tube', mode: 'fail', rot: 0 });
  I.ceilingLight(b, { x: cx - 3, z: cz + 2.5, y, kind: 'tube', mode: 'steady', rot: 0 });
  I.ceilingLight(b, { x: cx + 3, z: cz + 2.5, y, kind: 'tube', mode: 'steady', rot: 0 });
}

// ---- lab test room ----
room({ x: 50, z: 30, w: 16, d: 11, h: 4.2, door: '-x', floor: 'labFloor', wall: 'tile' });
{
  const cx = 50;
  const cz = 30;
  I.labBench(b, { x: cx - 1, z: cz - 1.2, length: 4.4, rot: 0 });
  I.labBench(b, { x: cx - 1, z: cz + 1.6, length: 4.4, rot: 0 });
  I.labTank(b, { x: cx + 5.5, z: cz - 3.2, glow: 'green', radius: 0.9, height: 2.8 });
  I.labTank(b, { x: cx + 5.5, z: cz - 0.6, glow: 'blue', radius: 0.9, height: 2.8 });
  I.labTank(b, { x: cx + 5.5, z: cz + 2.0, glow: 'amber', radius: 0.9, height: 2.8, broken: true });
  I.specimenCage(b, { x: cx - 4.2, z: cz - 3.4, w: 3, d: 3, open: true, rot: -Math.PI / 2 });
  I.serverRack(b, { x: cx - 1.5, z: cz + 4.9, count: 3, rot: Math.PI });
  I.labConsole(b, { x: cx + 2.6, z: cz - 4.6, width: 2.2, rot: 0 });
  I.gurney(b, { x: cx + 1.2, z: cz + 3.0, covered: true, rot: 0.3 });
  I.lockerRow(b, { x: cx - 7.6, z: cz + 2.4, count: 4, rot: Math.PI / 2 });
  const y = 4.15;
  I.ceilingLight(b, { x: cx - 4, z: cz, y, kind: 'panel', mode: 'steady' });
  I.ceilingLight(b, { x: cx + 1, z: cz - 3, y, kind: 'panel', mode: 'flicker' });
  I.ceilingLight(b, { x: cx + 1, z: cz + 3, y, kind: 'panel', mode: 'fail' });
  I.ceilingLight(b, { x: cx + 5, z: cz, y, kind: 'caged', mode: 'steady' });
  I.emergencyLight(b, { x: cx - 7.8, y: 3.4, z: cz - 4.5, period: 1.4 });
  I.emergencyLight(b, { x: cx + 7.8, y: 3.4, z: cz + 4.5, period: 1.4, phase: 0.7 });
  I.pipeRun(b, { x0: cx - 7.8, y0: 3.7, z0: cz - 5.2, x1: cx + 7.8, y1: 3.7, z1: cz - 5.2, radius: 0.09 });
  I.pipeRun(b, { x0: cx + 7.8, y0: 3.4, z0: cz - 5.2, x1: cx + 7.8, y1: 3.4, z1: cz + 5.2, radius: 0.07 });
}

b.finalize();
scene.add(b.root);

// collider overlay
if (showColliders) {
  const g = new THREE.Group();
  for (const c of world.colliders) {
    const h = Math.max(0.02, c.y1 - c.y0);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(c.hx * 2, h, c.hz * 2));
    const col = c.blocksMove && c.blocksShots ? 0xff2bd6 : c.blocksMove ? 0x25e6ff : 0xffa020;
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.85 }));
    line.position.set(c.cx, (c.y0 + c.y1) / 2, c.cz);
    line.rotation.y = c.rot;
    line.renderOrder = 20;
    g.add(line);
  }
  scene.add(g);
}

const pool = new LightPool(scene, 8);
pool.setLamps(b.lights);

// ---------------------------------------------------------------------------------------------
// camera presets / clock
// ---------------------------------------------------------------------------------------------
type Cam = [number, number, number, number, number, number];
const presets: Record<string, Cam> = {
  spireFar: [-56, 1.7, 47, 46, 30, -26],
  spireMid: [4, 1.7, 8, 46, 32, -26],
  spireNear: [56, 2.4, -8, 46, 14, -26],
  spireBase: [52, 1.7, -17, 46, 12, -26],
  spireTop: [30, 34, -6, 46, 47, -26],
  dome: [40, 3.0, -20, 22, 4, -32],
  domeClose: [14, 1.8, -20, 22, 4, -32],
  xmitter: [-14, 3.2, 32, -26, 6, 22],
  xmitterEye: [-16, 1.7, 26, -26, 3, 22],
  xmitterTop: [-26, 30, 40, -26, 8, 22],
  helipad: [-20, 6, -18, -36, 0, -30],
  helipadLow: [-22, 1.7, -22, -36, 1, -30],
  pool: [19, 2.4, -3, 12, 0.5, -8],
  poolLow: [17, 1.7, -3, 12, 0.7, -8],
  collapse: [-8, 2.2, 32, -8, 1.4, 44],
  collapseSide: [-20, 2.6, 36, -8, 1.4, 44],
  overpass: [30, 2.2, 20, 32, 6, 45],
  overpassUnder: [8, 1.7, 45, 44, 4.5, 45],
  gate: [0, 2.0, 16, 0, 2.2, 0],
  gateSide: [12, 2.4, 6, 0, 2, 0],
  skyline: [0, 1.7, 30, 0, 14, -60],
  skylineCorner: [-50, 1.7, 40, 60, 14, -60],
  top: [0, 200, 0.01, 0, 0, 0],
  storeDoor: [-52, 1.65, 27.4, -52, 1.6, 34],
  storeIn: [-58, 1.65, 36, -46, 1.4, 32],
  storeIn2: [-46, 1.65, 37.5, -56, 1.3, 32],
  storeCut: [-52, 12, 40, -52, 0, 33],
  labDoor: [41.5, 1.65, 30, 50, 1.6, 30],
  labIn: [42.5, 1.65, 34, 55, 1.6, 27],
  labIn2: [57, 1.65, 34.5, 46, 1.5, 27.5],
  labCut: [50, 14, 38, 50, 0, 29],
  lockers: [45.6, 1.5, 32.4, 42.4, 1.1, 32.4],
  racks: [48.5, 1.6, 31.2, 48.5, 1.1, 34.9],
  tanks: [50, 1.7, 26.6, 55.5, 1.5, 29.5],
  cage: [47.5, 1.7, 33.5, 45.8, 1.2, 26.6],
  storeFridge: [-52, 1.6, 33, -52, 1.2, 38.4],
};
function setCam(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
  camera.position.set(px, py, pz);
  controls.target.set(tx, ty, tz);
  controls.update();
}
const w = window as unknown as Record<string, unknown>;
w.setCam = setCam;
w.preset = (name: string) => {
  const p = presets[name];
  if (!p) throw new Error(`no preset ${name}`);
  setCam(...p);
};
w.__h = { ...H, camera, controls, builder: b, world, pool, scene, presets };

let simTime = Number(params.get('t') ?? 0);
let frozen = params.has('t');
w.setTime = (v: number) => {
  simTime = v;
};
w.freeze = (v: boolean) => {
  frozen = v;
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const hud = document.getElementById('hud')!;
let last = performance.now();
let frames = 0;
let indoor = 0;
const size = new THREE.Vector2();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!frozen) simTime += dt;
  controls.update();
  for (const tk of b.ticks) tk(dt, simTime);
  renderer.getDrawingBufferSize(size);
  b.glowField?.update(simTime, size.y, camera.fov);
  pool.update(dt, simTime, camera.position);
  // dim skylight indoors the way the game should
  const p = camera.position;
  const inside = !noIndoor && rooms.some((r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ) && !cutaway;
  indoor += ((inside ? 1 : 0) - indoor) * Math.min(1, dt * 6);
  rig.hemi.intensity = 4.4 * (1 - indoor) + 0.55 * indoor;
  rig.moon.intensity = 4.2 * (1 - indoor) + 0.2 * indoor;
  rig.fill.intensity = 1.1 * (1 - indoor) + 0.05 * indoor;
  scene.environmentIntensity = 0.55 * (1 - indoor) + 0.05 * indoor;
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = simTime;
  rig.focusShadow(controls.target);
  renderer.render(scene, camera);
  frames++;
  if (frames === 4) (window as unknown as { __ready: boolean }).__ready = true;
  if (frames % 30 === 0) {
    const info = renderer.info.render;
    hud.textContent = `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  lamps ${b.lights.length}  colliders ${world.colliders.length}\nstatic dc ${b.stats.staticDrawCalls}  inst ${b.stats.instancedMeshes}  baked ${b.stats.bakedMeshes}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
