/**
 * Props gallery harness. Query params:
 *   ?zone=containers|vehicles|industrial|military|street|dressing   (default containers)
 *   ?colliders=1   draw collider wireframes
 *   ?stats=0       hide stats overlay
 * Scripted screenshots: `window.setCam(x,y,z, tx,ty,tz)`; `window.__ready` is true once rendering.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER } from '../src/config';
import { LightPool } from '../src/render/lightPool';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import { LevelBuilder } from '../src/world/builder';
import { CollisionWorld } from '../src/world/collision';
import { createMaterialLib } from '../src/world/materials';
import { MEASURE_CASES, buildZone } from './props-zones';

const params = new URLSearchParams(location.search);
const zone = params.get('zone') ?? 'containers';
const showColliders = params.get('colliders') === '1';

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

renderer.toneMappingExposure = Number(params.get('exposure') ?? RENDER.exposure);
const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.7;
const rig = setupBlueHour(scene, Number(params.get('shadow') ?? 46));

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(12, 6, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const mats = createMaterialLib();
const world = new CollisionWorld({ minX: -150, maxX: 150, minZ: -150, maxZ: 150 });
const builder = new LevelBuilder(mats, world);

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mats.get('asphalt'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
builder.add(ground);

const info = buildZone(zone, builder);
builder.finalize();
scene.add(builder.root);

const pool = new LightPool(scene, 5, 5);
pool.setLamps(builder.lights);

if (showColliders) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const colors: Record<string, number> = { vehicle: 0xff5050, container: 0x50a0ff, prop: 0xffd040, fence: 0x50ff90, tank: 0xff80ff, wall: 0xffffff, building: 0xffffff, none: 0x888888 };
  for (const c of world.colliders) {
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: colors[c.mapKind] ?? 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    line.position.set(c.cx, (c.y0 + c.y1) / 2, c.cz);
    line.scale.set(c.hx * 2, c.y1 - c.y0, c.hz * 2);
    line.rotation.y = c.rot;
    line.renderOrder = 999;
    scene.add(line);
  }
}

const w = window as unknown as Record<string, unknown>;
w.setCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};
w.__info = info;
w.__matStats = () => {
  const counts = new Map<string, number>();
  builder.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    const key = (mat.name || mat.type) + ((m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh ? ' [inst]' : '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v}  ${k.slice(0, 70)}`);
};
w.__measure = () => {
  const rows: { name: string; tris: number; meshes: number; draws: number; colliders: number; ms: number }[] = [];
  for (const [name, fn] of MEASURE_CASES) {
    const wd = new CollisionWorld({ minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
    const bd = new LevelBuilder(mats, wd);
    const t0 = performance.now();
    fn(bd);
    bd.finalize();
    const ms = performance.now() - t0;
    rows.push({ name, tris: Math.round(bd.stats.triangles), meshes: bd.stats.bakedMeshes, draws: bd.stats.staticDrawCalls + bd.stats.instancedMeshes, colliders: wd.colliders.length, ms: Math.round(ms * 10) / 10 });
  }
  return rows;
};
w.__stats = () => ({
  calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  builder: builder.stats,
  colliders: world.colliders.length,
  lamps: builder.lights.length,
});
if (info.cam) (w.setCam as (...a: number[]) => void)(...info.cam);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const statsEl = document.getElementById('stats')!;
if (params.get('stats') === '0') statsEl.style.display = 'none';
let last = performance.now();
let frames = 0;
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig.focusShadow(controls.target);
  pool.update(dt, now / 1000, camera.position);
  for (const t of builder.ticks) t(dt, now / 1000);
  builder.glowField?.update(now / 1000, renderer.domElement.height, camera.fov);
  renderer.render(scene, camera);
  frames++;
  acc += dt;
  if (acc > 0.5) {
    const s = renderer.info.render;
    statsEl.textContent = `zone ${zone}\ncalls ${s.calls}  tris ${(s.triangles / 1000).toFixed(1)}k  fps ${(frames / acc).toFixed(0)}\nbaked ${builder.stats.bakedMeshes}  static draws ${builder.stats.staticDrawCalls}  inst ${builder.stats.instancedMeshes}\ncolliders ${world.colliders.length}  lamps ${builder.lights.length}`;
    frames = 0;
    acc = 0;
  }
  w.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
