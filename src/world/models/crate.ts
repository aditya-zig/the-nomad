/**
 * Loot crate: military supply crate with a hinged lid, tier-coloured emissive accents and a faint beacon shaft.
 * Geometry, atlas texture and materials are shared between instances (reference counted).
 */
import * as THREE from 'three';
import type { Region } from '../../types';
import type { CrateModel } from '../models';
import {
  GeoBatch,
  acquire,
  canvasTexture,
  createDetailMaterial,
  hdr,
  makeCanvas,
  makeRadialTexture,
  makeDetailUniforms,
  mulberry32,
  release,
  type DetailUniforms,
} from './util';

const TIER_COLOR: Record<Region, number> = { low: 0xb8ffd0, medium: 0xffb23a, high: 0xff5a2a };
const TIER_PIPS: Record<Region, number> = { low: 1, medium: 2, high: 3 };

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rot180?: boolean;
}
const ATLAS = 512;
const R_PLAIN: Rect = { x0: 6, y0: 6, x1: 250, y1: 250 };
const R_SIDE: Rect = { x0: 262, y0: 6, x1: 506, y1: 118 };
const R_LID: Rect = { x0: 6, y0: 262, x1: 326, y1: 466, rot180: true };

type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const FACE_INDEX: Record<FaceKey, number> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/** BoxGeometry whose faces sample regions of the crate atlas (default: plain paint). */
function atlasBox(w: number, h: number, d: number, rects: Partial<Record<FaceKey, Rect>> = {}): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv!;
  for (const key of Object.keys(FACE_INDEX) as FaceKey[]) {
    const r = rects[key] ?? R_PLAIN;
    let u0 = r.x0 / ATLAS;
    let u1 = r.x1 / ATLAS;
    let vTop = 1 - r.y0 / ATLAS;
    let vBot = 1 - r.y1 / ATLAS;
    if (r.rot180) {
      [u0, u1] = [u1, u0];
      [vTop, vBot] = [vBot, vTop];
    }
    const base = FACE_INDEX[key] * 4;
    for (let k = 0; k < 4; k++) {
      const ix = k % 2;
      const iy = Math.floor(k / 2);
      uv.setXY(base + k, u0 + (u1 - u0) * ix, vTop + (vBot - vTop) * iy);
    }
  }
  return g;
}

function makeAtlas(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(ATLAS, ATLAS);
  const rand = mulberry32(31337);
  ctx.fillStyle = '#5b6540';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // paint mottling and speckle
  for (let i = 0; i < 260; i++) {
    const x = rand() * ATLAS;
    const y = rand() * ATLAS;
    const r = 6 + rand() * 38;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.55;
    g.addColorStop(0, dark ? 'rgba(20,24,14,0.16)' : 'rgba(120,128,90,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 6000; i++) {
    const v = rand();
    ctx.fillStyle = v < 0.5 ? 'rgba(15,18,10,0.22)' : 'rgba(150,158,120,0.14)';
    ctx.fillRect(rand() * ATLAS, rand() * ATLAS, 1 + rand() * 2, 1 + rand() * 2);
  }

  // stencil layer (drawn separately so it can be scuffed)
  const st = makeCanvas(ATLAS, ATLAS);
  const s = st.ctx;
  s.fillStyle = '#e6dca4';
  s.textBaseline = 'middle';
  s.textAlign = 'center';
  const font = (px: number) => `900 ${px}px "Arial Narrow", "Bahnschrift", Impact, "Helvetica Neue", sans-serif`;
  const spaced = (txt: string, cx: number, cy: number, px: number, spacing: number) => {
    s.font = font(px);
    (s as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
    s.fillText(txt, cx, cy);
  };
  // lid top (R_LID)
  const lcx = (R_LID.x0 + R_LID.x1) / 2;
  const lcy = (R_LID.y0 + R_LID.y1) / 2;
  spaced('SUPPLY', lcx, lcy - 30, 66, 10);
  spaced('CACHE', lcx, lcy + 24, 66, 10);
  s.fillRect(R_LID.x0 + 22, lcy - 78, R_LID.x1 - R_LID.x0 - 44, 4);
  s.fillRect(R_LID.x0 + 22, lcy + 68, R_LID.x1 - R_LID.x0 - 44, 4);
  spaced('LOT 7431-B  //  RESTRICTED', lcx, lcy + 88, 15, 3);
  // arrows in corners
  for (const [ax, ay] of [
    [R_LID.x0 + 30, R_LID.y0 + 26],
    [R_LID.x1 - 30, R_LID.y0 + 26],
  ] as const) {
    s.beginPath();
    s.moveTo(ax, ay - 12);
    s.lineTo(ax + 12, ay + 10);
    s.lineTo(ax - 12, ay + 10);
    s.closePath();
    s.fill();
  }
  // side face (R_SIDE)
  const scx = (R_SIDE.x0 + R_SIDE.x1) / 2;
  const scy = (R_SIDE.y0 + R_SIDE.y1) / 2;
  spaced('AMMO / ARMOR / MED', scx, scy - 14, 21, 2);
  spaced('KEEP DRY - DO NOT DROP', scx, scy + 16, 13, 2);
  s.fillRect(R_SIDE.x0 + 16, scy + 40, 60, 5);
  s.fillRect(R_SIDE.x0 + 88, scy + 40, 30, 5);
  // scuff the stencils
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 380; i++) {
    s.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.6})`;
    s.fillRect(rand() * ATLAS, rand() * ATLAS, 1 + rand() * 5, 1 + rand() * 2);
  }
  for (let i = 0; i < 40; i++) {
    s.strokeStyle = 'rgba(0,0,0,0.7)';
    s.lineWidth = 1 + rand() * 1.5;
    s.beginPath();
    const x = rand() * ATLAS;
    const y = rand() * ATLAS;
    s.moveTo(x, y);
    s.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 30);
    s.stroke();
  }
  ctx.drawImage(st.canvas, 0, 0);

  // edge scratches revealing lighter metal on all regions
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(190,190,170,${0.06 + rand() * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = rand() * ATLAS;
    const y = rand() * ATLAS;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 12);
    ctx.stroke();
  }
  const tex = canvasTexture(canvas, { aniso: 8 });
  tex.generateMipmaps = true;
  return tex;
}

interface CrateGeo {
  base: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  contents: THREE.BufferGeometry;
}

const OLIVE = 0xdfe3d0;
const OLIVE_DARK = 0xa7ad92;
const STEEL = 0x3c4046;
const BRASS = 0xc9a24a;

function buildCrateGeo(region: Region): CrateGeo {
  const tier = new THREE.Color(TIER_COLOR[region]);
  const accent = hdr(TIER_COLOR[region], 2.4);
  const base = new GeoBatch();
  const W = 1.1;
  const D = 0.7;
  const H = 0.5;
  const t = 0.04;
  // tray
  base.add(atlasBox(W, t, D), 0xb8bda4, { pos: [0, t / 2, 0] });
  base.add(atlasBox(W, H - t, t, { nz: R_SIDE, pz: R_PLAIN }), OLIVE, { pos: [0, t + (H - t) / 2, -(D - t) / 2] });
  base.add(atlasBox(W, H - t, t), OLIVE, { pos: [0, t + (H - t) / 2, (D - t) / 2] });
  base.add(atlasBox(t, H - t, D - 2 * t), OLIVE, { pos: [-(W - t) / 2, t + (H - t) / 2, 0] });
  base.add(atlasBox(t, H - t, D - 2 * t), OLIVE, { pos: [(W - t) / 2, t + (H - t) / 2, 0] });
  // inner floor liner and lip
  base.box(W - 2 * t, 0.01, D - 2 * t, 0x3a3f2c, { pos: [0, t + 0.005, 0] });
  base.box(W + 0.03, 0.025, 0.03, STEEL, { pos: [0, H - 0.0125, -(D + 0.03) / 2 + 0.015] });
  base.box(W + 0.03, 0.025, 0.03, STEEL, { pos: [0, H - 0.0125, (D + 0.03) / 2 - 0.015] });
  base.box(0.03, 0.025, D, STEEL, { pos: [-(W + 0.03) / 2 + 0.015, H - 0.0125, 0] });
  base.box(0.03, 0.025, D, STEEL, { pos: [(W + 0.03) / 2 - 0.015, H - 0.0125, 0] });
  // vertical ribs on the long sides and ends
  for (const side of [-1, 1]) {
    for (const rx of [-0.36, 0, 0.36]) {
      base.box(0.035, H - 0.08, 0.014, OLIVE_DARK, { pos: [rx, 0.27, side * (D / 2 + 0.006)] });
    }
    base.box(0.014, H - 0.08, 0.05, OLIVE_DARK, { pos: [side * (W / 2 + 0.006), 0.27, 0] });
  }
  // corner brackets
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      base.box(0.07, 0.3, 0.02, STEEL, { pos: [sx * (W / 2 - 0.03), 0.22, sz * (D / 2 + 0.008)] });
      base.box(0.02, 0.3, 0.07, STEEL, { pos: [sx * (W / 2 + 0.008), 0.22, sz * (D / 2 - 0.03)] });
      base.box(0.08, 0.05, 0.08, STEEL, { pos: [sx * (W / 2 - 0.02), 0.03, sz * (D / 2 - 0.02)] });
    }
  }
  // skids
  base.box(0.07, 0.05, D + 0.02, 0x3b3226, { pos: [-0.4, -0.02, 0] });
  base.box(0.07, 0.05, D + 0.02, 0x3b3226, { pos: [0.4, -0.02, 0] });
  // rope handles on the ends
  const rope = 0xb39b68;
  for (const sx of [-1, 1]) {
    base.torus(0.075, 0.013, 6, 12, Math.PI, rope, { pos: [sx * (W / 2 + 0.02), 0.34, 0], rot: [0, Math.PI / 2, 0] });
    base.box(0.04, 0.03, 0.03, STEEL, { pos: [sx * (W / 2 + 0.012), 0.34, 0.075] });
    base.box(0.04, 0.03, 0.03, STEEL, { pos: [sx * (W / 2 + 0.012), 0.34, -0.075] });
  }
  // front latches
  for (const lx of [-0.34, 0.34]) {
    base.box(0.1, 0.11, 0.025, STEEL, { pos: [lx, 0.44, -D / 2 - 0.014] });
    base.box(0.05, 0.06, 0.02, 0x6b7076, { pos: [lx, 0.43, -D / 2 - 0.03] });
  }
  // emissive corner pips on the front-left brackets (tier count)
  for (let i = 0; i < TIER_PIPS[region]; i++) {
    base.box(0.028, 0.028, 0.012, accent, { pos: [-W / 2 + 0.07 + i * 0.045, 0.06, -D / 2 - 0.012] }, accent);
  }

  // lid: origin on the hinge line (x = 0, y = H, z = +D/2), extends toward -z
  const lid = new GeoBatch();
  lid.add(atlasBox(W, 0.05, D, { py: R_LID }), OLIVE, { pos: [0, 0.155, -D / 2] });
  lid.add(atlasBox(W + 0.03, 0.13, 0.035), OLIVE, { pos: [0, 0.075, -D + 0.0025] });
  lid.add(atlasBox(W + 0.03, 0.13, 0.035), OLIVE, { pos: [0, 0.075, -0.0175] });
  lid.add(atlasBox(0.035, 0.13, D), OLIVE, { pos: [-(W + 0.03) / 2 + 0.0175, 0.075, -D / 2] });
  lid.add(atlasBox(0.035, 0.13, D), OLIVE, { pos: [(W + 0.03) / 2 - 0.0175, 0.075, -D / 2] });
  lid.box(W - 0.02, 0.012, 0.025, OLIVE_DARK, { pos: [0, 0.186, -0.1] });
  lid.box(W - 0.02, 0.012, 0.025, OLIVE_DARK, { pos: [0, 0.186, -D + 0.1] });
  lid.box(0.03, 0.012, D - 0.04, OLIVE_DARK, { pos: [-0.3, 0.186, -D / 2] });
  lid.box(0.03, 0.012, D - 0.04, OLIVE_DARK, { pos: [0.3, 0.186, -D / 2] });
  for (const lx of [-0.34, 0.34]) {
    lid.box(0.09, 0.05, 0.03, STEEL, { pos: [lx, 0.1, -D - 0.005] });
  }
  for (const hx of [-0.35, 0.35]) lid.cyl(0.02, 0.02, 0.1, 8, STEEL, { pos: [hx, 0.0, 0.01], rot: [0, 0, Math.PI / 2] });
  // tier accent strip along the lid's front face + top corner lights
  lid.box(0.8, 0.026, 0.014, accent, { pos: [0, 0.032, -D - 0.024] }, accent);
  lid.box(0.05, 0.05, 0.02, tier, { pos: [-0.5, 0.155, -D + 0.05] }, accent);
  lid.box(0.05, 0.05, 0.02, tier, { pos: [0.5, 0.155, -D + 0.05] }, accent);

  // visible contents (glowing loot heaped above the rim so it reads from a standing view)
  const contents = new GeoBatch();
  const loot = hdr(TIER_COLOR[region], 1.6);
  const glowFloor = hdr(TIER_COLOR[region], 0.55);
  contents.box(W - 0.1, 0.012, D - 0.1, 0x2a2e20, { pos: [0, 0.075, 0] }, glowFloor);
  // two layers of ammo cans
  for (const [x, z, y, r] of [
    [-0.32, -0.15, 0.13, 0.15],
    [-0.32, 0.14, 0.13, -0.12],
    [-0.02, -0.16, 0.13, -0.08],
    [-0.3, 0.0, 0.27, 0.22],
  ] as const) {
    contents.rbox(0.26, 0.14, 0.16, 0.012, 0x59623f, { pos: [x, y, z], rot: [0, r, 0] });
    contents.box(0.16, 0.05, 0.004, 0xd7c25a, { pos: [x, y, z - 0.082], rot: [0, r, 0] });
    contents.box(0.2, 0.012, 0.02, BRASS, { pos: [x, y + 0.078, z], rot: [0, r, 0] }, loot);
  }
  // armour plates leaning at the back
  contents.box(0.3, 0.34, 0.03, 0x767b80, { pos: [0.2, 0.24, 0.2], rot: [-0.25, 0.1, 0.0] });
  contents.box(0.29, 0.02, 0.032, 0xffb030, { pos: [0.2, 0.395, 0.145], rot: [-0.25, 0.1, 0.0] }, hdr(0xffb030, 1.8));
  // grenades / ordnance in front-right
  contents.cyl(0.03, 0.03, 0.11, 8, 0x4c5537, { pos: [0.38, 0.12, -0.16] });
  contents.cyl(0.03, 0.03, 0.11, 8, 0x4c5537, { pos: [0.3, 0.12, -0.2] });
  contents.rbox(0.2, 0.1, 0.14, 0.02, 0x3c5a3a, { pos: [0.28, 0.13, -0.02] }, loot);
  // the tier core: a small glowing cube on top of the pile
  contents.box(0.1, 0.1, 0.1, TIER_COLOR[region], { pos: [0.02, 0.4, 0.02], rot: [0.4, 0.6, 0.2] }, hdr(TIER_COLOR[region], 3.2));

  return { base: base.build(), lid: lid.build(), contents: contents.build() };
}

interface Shared {
  glowTex: THREE.CanvasTexture;
  glowGeo: THREE.PlaneGeometry;
  atlas: THREE.CanvasTexture;
  live: THREE.MeshStandardMaterial;
  dead: THREE.MeshStandardMaterial;
  uniforms: DetailUniforms;
  beaconGeo: THREE.CylinderGeometry;
}

const BEACON_VERT = /* glsl */ `
  varying vec3 vW; varying float vH; varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vH = uv.y; vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const BEACON_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uTime;
  varying vec3 vW; varying float vH; varying vec3 vN;
  void main() {
    vec3 v = normalize(cameraPosition - vW);
    float edge = pow(abs(dot(normalize(vN), v)), 1.4);
    float pulse = 0.5 + 0.5 * sin(uTime * 2.2 + vW.x * 0.9 + vW.z * 1.7);
    float a = pow(max(1.0 - vH, 0.0), 1.9) * edge * (0.07 + 0.06 * pulse);
    float dist = length(cameraPosition - vW);
    a *= exp(-dist * 0.018);
    gl_FragColor = vec4(uColor * (1.4 + pulse * 0.6), a);
  }
`;

const beaconMats = new Map<Region, THREE.ShaderMaterial>();
const beaconTime = { value: 0 };

function beaconMaterial(region: Region): THREE.ShaderMaterial {
  let m = beaconMats.get(region);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      uniforms: { uColor: { value: new THREE.Color(TIER_COLOR[region]) }, uTime: beaconTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    beaconMats.set(region, m);
  }
  return m;
}

function getShared(): Shared {
  return acquire(
    'crate-shared',
    () => {
      const atlas = makeAtlas();
      const uniforms = makeDetailUniforms();
      uniforms.pulse.value = 0.4;
      const opts = { roughness: 0.74, metalness: 0.22, panels: { x: 0.55, y: 0.5, z: 0.55, grime: 0.55, wear: 0.6, tint: 0.06 }, emis: true } as const;
      const live = createDetailMaterial({ tag: 'crate', ...opts }, uniforms).material;
      live.map = atlas;
      const deadU = makeDetailUniforms();
      deadU.emisGain.value = 0;
      const dead = createDetailMaterial({ tag: 'crate', ...opts }, deadU).material;
      dead.map = atlas;
      dead.color.setScalar(0.72);
      const beaconGeo = new THREE.CylinderGeometry(0.24, 0.17, 1.6, 16, 1, true);
      beaconGeo.translate(0, 1.4, 0);
      const glowTex = makeRadialTexture(128, [[0, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
      const glowGeo = new THREE.PlaneGeometry(1.0, 0.62);
      glowGeo.rotateX(-Math.PI / 2);
      return { glowTex, glowGeo, atlas, live, dead, uniforms, beaconGeo };
    },
    (s) => {
      s.glowTex.dispose();
      s.glowGeo.dispose();
      s.atlas.dispose();
      s.live.dispose();
      s.dead.dispose();
      s.beaconGeo.dispose();
      for (const m of beaconMats.values()) m.dispose();
      beaconMats.clear();
    },
  );
}

export function createLootCrateImpl(region: Region): CrateModel {
  const shared = getShared();
  const geo = acquire(`crate-geo-${region}`, () => buildCrateGeo(region), (g) => {
    g.base.dispose();
    g.lid.dispose();
    g.contents.dispose();
  });
  const root = new THREE.Group();
  root.name = `LootCrate:${region}`;

  const base = new THREE.Mesh(geo.base, shared.live);
  base.castShadow = true;
  base.receiveShadow = true;
  const contents = new THREE.Mesh(geo.contents, shared.live);
  contents.castShadow = false;
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.5, 0.35);
  const lid = new THREE.Mesh(geo.lid, shared.live);
  lid.castShadow = true;
  lid.receiveShadow = true;
  lidPivot.add(lid);
  const beacon = new THREE.Mesh(shared.beaconGeo, beaconMaterial(region));
  beacon.frustumCulled = false;
  beacon.renderOrder = 4;
  // the skids sit slightly below the crate body; lift the inner group so the crate rests on the ground
  const inner = new THREE.Group();
  inner.position.y = 0.05;
  const glowMat = new THREE.MeshBasicMaterial({
    map: shared.glowTex,
    color: new THREE.Color(TIER_COLOR[region]),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lootGlow = new THREE.Mesh(shared.glowGeo, glowMat);
  lootGlow.position.set(0, 0.47, 0);
  lootGlow.renderOrder = 4;
  lootGlow.visible = false;
  inner.add(base, contents, lidPivot, beacon, lootGlow);
  root.add(inner);

  let looted = false;
  const setMaterials = () => {
    const m = looted ? shared.dead : shared.live;
    base.material = m;
    lid.material = m;
    contents.material = m;
    contents.visible = !looted;
    beacon.visible = !looted;
    lootGlow.visible = !looted && glowMat.opacity > 0.01;
  };

  return {
    root,
    setOpen(t: number) {
      const k = Math.max(0, Math.min(1, t));
      const eased = 1 - Math.pow(1 - k, 2.2);
      lidPivot.rotation.x = eased * 1.96;
      glowMat.opacity = eased * 0.75;
      lootGlow.visible = !looted && glowMat.opacity > 0.01;
    },
    setLooted(v: boolean) {
      if (looted === v) return;
      looted = v;
      setMaterials();
    },
    update(_dt: number, time: number) {
      shared.uniforms.time.value = time;
      beaconTime.value = time;
    },
    topLocal: new THREE.Vector3(0, 1.15, 0),
    dispose() {
      glowMat.dispose();
      release(`crate-geo-${region}`);
      release('crate-shared');
    },
  };
}
