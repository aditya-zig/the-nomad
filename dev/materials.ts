/**
 * Materials / procedural textures harness.
 *   window.showView(name)  name: gallery0 | gallery1 | gallery2 | street | street2 | walls0..walls3 | containers | props
 *                                | decals | decals2 | close:<materialName>
 *   window.setCam(x,y,z, tx,ty,tz)
 *   window.__timings / window.__genTotalMs / window.__ready
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RENDER } from '../src/config';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import { projectWorldUV as builderProjectWorldUV } from '../src/world/builder';
import { heightToNormal } from '../src/world/textures/core';
import { DECAL_INFO, DECAL_NAMES, MATERIAL_NAMES, type MaterialName, createMaterialLib } from '../src/world/materials';

const info = document.getElementById('info')!;

/**
 * World-projected UVs like LevelBuilder's, but with the vertical-face tangent oriented so U increases toward the viewer's
 * right (builder.ts currently uses the opposite tangent, mirroring asymmetric textures such as crate stencils).
 */
function projectWorldUV(g: THREE.BufferGeometry, tile: number): void {
  if (new URLSearchParams(location.search).get('builderuv') === '1') {
    builderProjectWorldUV(g, tile);
    return;
  }
  const pos = g.attributes.position!;
  const nor = g.attributes.normal!;
  const uv = g.attributes.uv!;
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    if (Math.abs(ny) > 0.7) {
      uv.setXY(i, px * inv, pz * inv);
    } else {
      const l = Math.hypot(nx, nz) || 1;
      uv.setXY(i, (px * (nz / l) + pz * (-nx / l)) * inv, py * inv);
    }
  }
  uv.needsUpdate = true;
}
const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.7;
const rig = setupBlueHour(scene, 48);
rig.moon.shadow.mapSize.set(2048, 2048);
const blueLight = {
  hemi: rig.hemi.color.clone(),
  ground: rig.hemi.groundColor.clone(),
  hemiI: rig.hemi.intensity,
  moonC: rig.moon.color.clone(),
  moonI: rig.moon.intensity,
  fillI: rig.fill.intensity,
  env: scene.environmentIntensity,
};
/** 'neutral' = near-white lighting to judge true albedo colours; 'blue' = the game's blue-hour lighting. */
function setLight(mode: 'neutral' | 'blue'): void {
  if (mode === 'neutral') {
    rig.hemi.color.set(0xffffff);
    rig.hemi.groundColor.set(0x777777);
    rig.hemi.intensity = 2.6;
    rig.moon.color.set(0xfff6ee);
    rig.moon.intensity = 3.4;
    rig.fill.intensity = 0.4;
    scene.environmentIntensity = 0.45;
  } else {
    rig.hemi.color.copy(blueLight.hemi);
    rig.hemi.groundColor.copy(blueLight.ground);
    rig.hemi.intensity = blueLight.hemiI;
    rig.moon.color.copy(blueLight.moonC);
    rig.moon.intensity = blueLight.moonI;
    rig.fill.intensity = blueLight.fillI;
    scene.environmentIntensity = blueLight.env;
  }
}

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(0, 1.7, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;

const lib = createMaterialLib();
const t0 = performance.now();
const mats = new Map<string, THREE.MeshStandardMaterial>();
for (const n of MATERIAL_NAMES) mats.set(n, lib.get(n));
const decalMats = new Map<string, THREE.MeshStandardMaterial>();
for (const n of DECAL_NAMES) decalMats.set(n, lib.decal(n));
const genTotal = performance.now() - t0;
(window as unknown as Record<string, unknown>).__timings = lib.timings();
(window as unknown as Record<string, unknown>).__genTotalMs = genTotal;

const tim = lib.timings();
const slow = Object.entries(tim)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 14)
  .map(([k, v]) => `${k}: ${v.toFixed(0)}ms`)
  .join('\n');
info.textContent = `materials+decals generated in ${genTotal.toFixed(0)} ms (${MATERIAL_NAMES.length} materials, ${DECAL_NAMES.length} decals)\nslowest:\n${slow}`;
console.log(`GEN_TOTAL_MS ${genTotal.toFixed(0)}`);
console.log('TIMINGS ' + JSON.stringify(Object.fromEntries(Object.entries(tim).map(([k, v]) => [k, Math.round(v)]))));

// ---------------------------------------------------------------------------------------------
// seam check: mean colour step across the wrap edge vs. the typical step between neighbouring texels
// ---------------------------------------------------------------------------------------------
function seamRatio(t: THREE.Texture): { x: number; y: number } | null {
  const img = t.image as { data?: Uint8Array | Uint8ClampedArray; width: number; height: number } | undefined;
  if (!img || !img.data) return null;
  const { data, width: w, height: h } = img;
  const px = (x: number, y: number, c: number): number => data[(y * w + x) * 4 + c]!;
  let wrapX = 0;
  let intX = 0;
  let wrapY = 0;
  let intY = 0;
  let nInt = 0;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) wrapX += Math.abs(px(w - 1, y, c) - px(0, y, c));
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) wrapY += Math.abs(px(x, h - 1, c) - px(x, 0, c));
  }
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 1; x += 3) {
      for (let c = 0; c < 3; c++) {
        intX += Math.abs(px(x, y, c) - px(x + 1, y, c));
        intY += Math.abs(px(x, y, c) - px(x, y + 1, c));
      }
      nInt++;
    }
  }
  const wx = wrapX / (h * 3);
  const wy = wrapY / (w * 3);
  const ix = intX / (nInt * 3) || 1;
  const iy = intY / (nInt * 3) || 1;
  return { x: wx / ix, y: wy / iy };
}
{
  const report: Record<string, { x: number; y: number }> = {};
  for (const [n, m] of mats) {
    if (!m.map) continue;
    const r = seamRatio(m.map);
    if (r) report[n] = { x: +r.x.toFixed(2), y: +r.y.toFixed(2) };
  }
  (window as unknown as Record<string, unknown>).__seams = report;
  const bad = Object.entries(report).filter(([, r]) => r.x > 2 || r.y > 2);
  console.log('SEAMS_OVER_2 ' + JSON.stringify(bad));
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function worldBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rotY = 0): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  m.updateMatrixWorld(true);
  const tile = (mat.userData?.tile as number | undefined) ?? 0;
  if (tile > 0) {
    // bake world-projected UVs exactly like LevelBuilder does
    g.applyMatrix4(m.matrixWorld);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.updateMatrixWorld(true);
    projectWorldUV(g, tile);
  }
  return m;
}

function groundPlane(w: number, d: number, x: number, z: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  const tile = (mat.userData?.tile as number | undefined) ?? 0;
  if (tile > 0) projectWorldUV(g, tile);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function label(text: string, x: number, y: number, z: number, size = 0.32): void {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, 512, 96);
  g.font = 'bold 44px Menlo, monospace';
  g.fillStyle = '#e6f3ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, fog: false }));
  s.scale.set(size * (512 / 96), size, 1);
  s.position.set(x, y, z);
  s.renderOrder = 999;
  scene.add(s);
}

// ---------------------------------------------------------------------------------------------
// 1. gallery: vertical swatch boards (2 m) facing north so the moon lights them, 12 columns x 6 rows
// ---------------------------------------------------------------------------------------------

const GX = 300;
const GZ = 300;
const cols = 12;
const spacing = 2.3;
const rowsG = 6;
const swatchMat = (n: string): THREE.MeshStandardMaterial => mats.get(n)!;
// neutral backdrop wall
{
  const g = new THREE.BoxGeometry(cols * spacing + 4, rowsG * spacing + 3, 0.4);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.9 }));
  m.position.set(GX - (cols - 1) * spacing * 0.5, (rowsG * spacing) / 2, GZ + 0.5);
  m.receiveShadow = true;
  scene.add(m);
}
groundPlane(80, 60, GX + 10, GZ - 10, mats.get('asphalt')!);
MATERIAL_NAMES.forEach((name, i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const cx = GX - col * spacing;
  const cy = 1.2 + (rowsG - 1 - row) * spacing;
  const cz = GZ;
  const mat = swatchMat(name);
  if (name === 'chainlink' || name === 'glass') {
    worldBox(1.9, 1.9, 0.1, cx, cy, cz + 0.15, mats.get('concreteDark')!);
    const g = new THREE.PlaneGeometry(1.9, 1.9);
    g.translate(cx, cy, cz - 0.1);
    g.rotateY(0);
    g.computeVertexNormals();
    const tile = (mat.userData?.tile as number | undefined) ?? 0;
    if (tile > 0) projectWorldUV(g, tile);
    const m = new THREE.Mesh(g, mat);
    scene.add(m);
  } else if (name.startsWith('barrel') || name === 'tire') {
    worldBox(1.9, 1.9, 0.1, cx, cy, cz + 0.15, new THREE.MeshStandardMaterial({ color: 0x555b60, roughness: 0.9 }));
    const g = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 36);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, cy, cz - 0.4);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  } else {
    worldBox(1.9, 1.9, 0.12, cx, cy, cz, mat);
  }
  label(name, cx, cy - 1.05, cz - 0.3, 0.2);
});

// normal-map orientation test (?view=normaltest): a raised square lit from the NW and above.
// Expected: the square's TOP edge and its WEST edge are bright, its bottom / east edges dark.
{
  const n = 256;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = x > 88 && x < 168 && y > 88 && y < 168 ? 1 : 0;
  const data = heightToNormal(h, n, 6);
  const tex = new THREE.DataTexture(new Uint8Array(data.buffer), n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9, normalMap: tex });
  const g = new THREE.PlaneGeometry(3, 3);
  g.translate(GX + 8, 2, GZ - 0.2);
  const mesh = new THREE.Mesh(g, m);
  scene.add(mesh);
  // faces -Z (toward the camera at -Z looking +Z)
  mesh.rotation.y = Math.PI;
  mesh.position.set(2 * (GX + 8), 0, 2 * (GZ - 0.2));
}

// ---------------------------------------------------------------------------------------------
// 2. street scene at game scale
// ---------------------------------------------------------------------------------------------

const SX = 0;
const SZ = 0;
// road: dry west half, wet east half
groundPlane(60, 10, SX - 30, SZ, mats.get('asphalt')!, 0);
groundPlane(60, 10, SX + 30, SZ, mats.get('asphaltWet')!, 0);
// sidewalks (raised 0.15)
for (const s of [-1, 1]) {
  const mat = mats.get('sidewalk')!;
  const g = new THREE.BoxGeometry(120, 0.15, 3);
  g.translate(0, 0.075, s * 6.5);
  projectWorldUV(g, 4);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = m.castShadow = true;
  scene.add(m);
}
// ground zones north (z < -8) and south (z > 8), each 30 wide
const zones: MaterialName[] = ['concreteSlab', 'dirt', 'grass', 'gravel'];
zones.forEach((z, i) => groundPlane(30, 40, -45 + i * 30, -30, mats.get(z)!, 0));
groundPlane(140, 40, 0, 32, mats.get('concreteSlab')!, 0);
// wall row (south side, facing the road)
const wallMats: MaterialName[] = ['brick', 'concreteWall', 'concreteDark', 'plaster', 'corrugated', 'corrugatedRust', 'metalPanel', 'oliveMetal'];
wallMats.forEach((n, i) => {
  const x = -36 + i * 8 + 4;
  worldBox(8, 4, 0.4, x, 2, 10, mats.get(n)!);
  label(n, x, 4.5, 9.7, 0.3);
});
// container row (short containers along x, 7 colours) east of the walls
const contNames: MaterialName[] = ['containerRed', 'containerBlue', 'containerGreen', 'containerOlive', 'containerRust', 'containerWhite', 'containerYellow'];
contNames.forEach((n, i) => {
  const x = 6 + i * 6.6;
  worldBox(6.06, 2.59, 2.44, x, 1.295, 10, mats.get(n)!);
  label(n, x, 3.1, 8.6, 0.28);
});
// stacked containers behind
worldBox(12.19, 2.59, 2.44, 22, 3.9, 14, mats.get('containerBlue')!);
worldBox(12.19, 2.59, 2.44, 22, 1.295, 14, mats.get('containerRust')!);
// props in front of the wall row (west): barrels, crates, sandbags, pallets
const barrelNames: MaterialName[] = ['barrelBlue', 'barrelRed', 'barrelGreen', 'barrelYellow', 'barrelBio', 'barrelRust'];
barrelNames.forEach((n, i) => {
  const g = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 32);
  const m = new THREE.Mesh(g, mats.get(n)!);
  m.position.set(-34 + i * 0.75, 0.44 + 0.15, 7.5);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
});
worldBox(1, 1, 1, -28, 0.65, 7.6, mats.get('crateWood')!, 0.2);
worldBox(1, 1, 1, -26.6, 0.65, 7.7, mats.get('crateMil')!, -0.15);
worldBox(0.9, 0.9, 0.9, -27.3, 1.6, 7.6, mats.get('crateMil')!, 0.3);
worldBox(0.5, 0.25, 0.32, -24.5, 0.28, 7.5, mats.get('sandbag')!);
worldBox(0.5, 0.25, 0.32, -24.0, 0.28, 7.5, mats.get('sandbag')!, 0.1);
worldBox(0.5, 0.25, 0.32, -24.3, 0.53, 7.5, mats.get('sandbag')!, 0.05);
worldBox(1.2, 0.14, 1.0, -22, 0.22, 7.6, mats.get('pallet')!);
worldBox(0.7, 0.5, 0.5, -22, 0.55, 7.6, mats.get('cardboard')!);
worldBox(3, 0.05, 2.2, -19, 0.2, 7.6, mats.get('tarp')!);
worldBox(1.6, 1.6, 0.05, -15, 1.0, 7.5, mats.get('hazard')!);
worldBox(1.6, 1.6, 0.05, -13, 1.0, 7.5, mats.get('grating')!);
// a chain-link fence panel and window glass over a dark backing
const fenceG = new THREE.PlaneGeometry(6, 2.4);
fenceG.translate(-8, 1.35, 5.2);
projectWorldUV(fenceG, 2.4);
scene.add(new THREE.Mesh(fenceG, mats.get('chainlink')!));
const glassG = new THREE.PlaneGeometry(2.5, 2);
glassG.translate(-3, 1.6, 7.4);
scene.add(new THREE.Mesh(glassG, mats.get('glass')!));
worldBox(3, 2.4, 0.1, -3, 1.6, 7.7, mats.get('glassDark')!);
// warm sodium street lamp + red beacon for specular checks
const lamp = new THREE.PointLight(0xffb060, 380, 40, 2);
lamp.position.set(-10, 6, 3);
scene.add(lamp);
const lamp2 = new THREE.PointLight(0xffb060, 380, 40, 2);
lamp2.position.set(18, 6, 3);
scene.add(lamp2);

// ---------------------------------------------------------------------------------------------
// 3. decal sheet on dark asphalt
// ---------------------------------------------------------------------------------------------

const DX = -300;
const DZ = 0;
const decalPos = new Map<string, [number, number, number, number]>();
groundPlane(140, 80, DX + 30, DZ + 10, mats.get('asphalt')!);
{
  let cx = 0;
  let cz = 0;
  let rowH = 0;
  const maxW = 46;
  DECAL_NAMES.forEach((name) => {
    const [w, h] = DECAL_INFO[name].size;
    const dw = Math.min(w, 6);
    const dh = Math.min(h, 9.6);
    if (cx + dw > maxW) {
      cx = 0;
      cz += rowH + 1.6;
      rowH = 0;
    }
    const g = new THREE.PlaneGeometry(dw, dh);
    g.rotateX(-Math.PI / 2);
    g.translate(DX + cx + dw / 2, 0.02, DZ + cz + dh / 2);
    decalPos.set(name, [DX + cx + dw / 2, DZ + cz + dh / 2, dw, dh]);
    const m = new THREE.Mesh(g, decalMats.get(name)!);
    m.renderOrder = 2;
    m.receiveShadow = true;
    scene.add(m);
    label(name, DX + cx + dw / 2, 0.15, DZ + cz + dh + 0.35, 0.25);
    cx += dw + 1.2;
    rowH = Math.max(rowH, dh);
  });
}
// custom stencil() signs
{
  const customs: [string, THREE.MeshStandardMaterial, number, number][] = [
    ['BUILDING 7', lib.stencil('BUILDING 7\nNORTH WING', { aspect: 2.2, color: '#e8e6da' }), 4.4, 2],
    ['route', lib.stencil('ROUTE 9\nNORTH', { aspect: 2, background: '#1f5a3a', color: '#ffffff', font: 'sans' }), 3, 1.5],
    ['mono', lib.stencil('SECTOR 7 // HOLD', { aspect: 5, font: 'mono', color: '#7fe8ff', emissive: true }), 5, 1],
    ['worn', lib.stencil('EVAC POINT B', { aspect: 4, worn: true, color: '#f0d060' }), 4, 1],
  ];
  let cx = 0;
  for (const [n, m, w, h] of customs) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    g.translate(DX + cx + w / 2, 0.02, DZ + 40);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 2;
    scene.add(mesh);
    label(n, DX + cx + w / 2, 0.15, DZ + 41.5, 0.25);
    cx += w + 1.2;
  }
}
// decals on a wall too
worldBox(12, 4, 0.4, DX + 70, 2, DZ + 10, mats.get('concreteWall')!);
{
  const mk = (name: (typeof DECAL_NAMES)[number], w: number, h: number, x: number, y: number) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(DX + 70 + x, y, DZ + 10 - 0.22);
    g.rotateY(0);
    const m = new THREE.Mesh(g, decalMats.get(name)!);
    m.rotation.y = Math.PI;
    m.position.set(2 * (DX + 70 + x), 0, 2 * (DZ + 10 - 0.22));
    m.position.set(0, 0, 0);
    scene.add(m);
  };
  void mk;
}

// ---------------------------------------------------------------------------------------------
// camera control
// ---------------------------------------------------------------------------------------------

type V = [number, number, number];
/** Camera for gallery chunk k: 6 columns x 3 rows, looking south (+z) at the boards. */
function chunkView(k: number): [V, V] {
  const c0 = (k % 2) * 6;
  const r0 = Math.floor(k / 2) * 3;
  const cx = GX - (c0 + 2.5) * spacing;
  const cy = 1.2 + (rowsG - 1 - (r0 + 1)) * spacing;
  return [[cx, cy, GZ - 8.4], [cx, cy, GZ]];
}
const setCam = (p: V, t: V): void => {
  camera.position.set(...p);
  controls.target.set(...t);
  controls.update();
};
const views: Record<string, [V, V]> = {
  gallery0: chunkView(0),
  gallery1: chunkView(1),
  gallery2: chunkView(2),
  gallery3: chunkView(3),
  normaltest: [[GX + 8, 2, GZ - 6], [GX + 8, 2, GZ]],
  street: [[-36, 1.7, -1.5], [20, 1.4, 5]],
  wetstreet: [[26, 1.7, 3.5], [60, 0.4, -1]],
  aerial: [[0, 26, -18], [0, 0, 6]],
  aerialWet: [[46, 22, -16], [46, 0, 4]],
  street2: [[-10, 1.7, -3], [-20, 0.2, -20]],
  street3: [[20, 1.7, -3], [24, 0.2, 10]],
  walls0: [[-30, 1.7, 3], [-24, 2, 10]],
  walls1: [[-14, 1.7, 3], [-8, 2, 10]],
  walls2: [[2, 1.7, 3], [8, 2, 10]],
  containers: [[8, 1.7, 3], [16, 1.6, 10]],
  containers2: [[20, 1.7, 2], [30, 1.6, 10]],
  props: [[-27, 1.6, 4], [-26, 0.7, 7.8]],
  fence: [[-8, 1.6, 1], [-8, 1.3, 6]],
  decals: [[DX + 22, 26, DZ + 26], [DX + 22, 0, DZ + 8]],
  decals2: [[DX + 22, 18, DZ + 12], [DX + 18, 0, DZ + 4]],
  decals3: [[DX + 22, 20, DZ + 28], [DX + 24, 0, DZ + 14]],
  decals4: [[DX + 8, 9, DZ + 46], [DX + 8, 0, DZ + 40]],
};
function showView(name: string): void {
  const params2 = new URLSearchParams(location.search);
  const forced = params2.get('light');
  setLight(forced === 'blue' ? 'blue' : forced === 'neutral' || name.startsWith('gallery') || name.startsWith('close:') ? 'neutral' : 'blue');
  if (name.startsWith('close:')) {
    const n = name.slice(6);
    const i = MATERIAL_NAMES.indexOf(n as MaterialName);
    if (i < 0) return;
    const cx = GX - (i % cols) * spacing;
    const cy = 1.2 + (rowsG - 1 - Math.floor(i / cols)) * spacing;
    setCam([cx, cy, GZ - 2.3], [cx, cy, GZ]);
    return;
  }
  if (name.startsWith('decal:')) {
    const p = decalPos.get(name.slice(6));
    if (p) setCam([p[0], Math.max(1.2, Math.max(p[2], p[3]) * 0.9), p[1] + Math.max(p[3], 1) * 0.7], [p[0], 0, p[1]]);
    return;
  }
  const v = views[name];
  if (v) setCam(v[0], v[1]);
}
const w = window as unknown as Record<string, unknown>;
w.showView = showView;
w.setLight = setLight;
w.setCam = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => setCam([x, y, z], [tx, ty, tz]);
const params = new URLSearchParams(location.search);
showView(params.get('view') ?? 'gallery0');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0;
function frame(now: number): void {
  const tf = performance.now();
  controls.update();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig.focusShadow(controls.target);
  renderer.render(scene, camera);
  if (frames === 0) {
    console.log(`FIRST_RENDER_MS ${(performance.now() - tf).toFixed(0)}`);
    // texture memory estimate (unique textures, RGBA8 + mips)
    const seen = new Set<THREE.Texture>();
    let bytes = 0;
    for (const m of [...mats.values(), ...decalMats.values()]) {
      for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]) {
        if (!t || seen.has(t)) continue;
        seen.add(t);
        const img = t.image as { width: number; height: number } | undefined;
        if (img) bytes += img.width * img.height * 4 * 1.34;
      }
    }
    console.log(`TEXTURES ${seen.size} unique, ~${(bytes / 1048576).toFixed(0)} MB GPU (all ${mats.size} materials + ${decalMats.size} decals)`);
  }
  if (++frames === 3) w.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dispose round trip (must not throw)
{
  const tmp = createMaterialLib();
  tmp.get('brick');
  tmp.get('containerRed');
  tmp.decal('puddle');
  tmp.stencil('TEST', {});
  tmp.dispose();
  console.log('DISPOSE_OK');
}
