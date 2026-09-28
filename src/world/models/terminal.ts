/**
 * Extraction radio terminal: rugged case on a tripod with a lit screen, mast + guy lines, folding dish, satchel,
 * a ring of ground lights and state-dependent light patterns (idle amber / called red chase / done green).
 */
import * as THREE from 'three';
import type { TerminalModel } from '../models';
import {
  GeoBatch,
  HaloPoints,
  MONO_FONT,
  UI_FONT,
  acquire,
  canvasTexture,
  createDetailMaterial,
  makeCanvas,
  makeDetailUniforms,
  mulberry32,
  release,
  writeRange,
  type VRange,
} from './util';

type State = 'idle' | 'called' | 'done';

const RING_COUNT = 12;
const RING_R = 1.32;

interface Shared {
  bodyMat: THREE.MeshStandardMaterial;
  screenTex: Record<State, THREE.CanvasTexture>;
  screenGeo: THREE.PlaneGeometry;
}

function drawScreen(state: State): HTMLCanvasElement {
  const W = 320;
  const H = 200;
  const { canvas, ctx } = makeCanvas(W, H);
  const pal = {
    idle: { fg: '#ffbd45', dim: '#7a5420', bg: '#160f04' },
    called: { fg: '#ff5a48', dim: '#7a2a22', bg: '#180706' },
    done: { fg: '#62ff9a', dim: '#1f6b3c', bg: '#04140a' },
  }[state];
  const rand = mulberry32(state === 'idle' ? 11 : state === 'called' ? 22 : 33);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  // grid
  ctx.strokeStyle = pal.dim;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // header bar
  ctx.fillStyle = pal.fg;
  ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = pal.bg;
  ctx.font = `700 17px ${UI_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('SIGNAL RELAY  //  LZ ECHO', 10, 14);
  ctx.textAlign = 'right';
  ctx.fillText(state === 'idle' ? 'STBY' : state === 'called' ? 'LIVE' : 'OK', W - 10, 14);
  ctx.textAlign = 'left';
  // main message
  ctx.fillStyle = pal.fg;
  ctx.shadowColor = pal.fg;
  ctx.shadowBlur = 10;
  ctx.font = `800 ${state === 'idle' ? 30 : 27}px ${UI_FONT}`;
  const title = state === 'idle' ? 'AWAITING SIGNAL' : state === 'called' ? 'EXTRACTION INBOUND' : 'EXTRACT CONFIRMED';
  ctx.fillText(title, 14, 64);
  ctx.shadowBlur = 0;
  ctx.font = `600 14px ${MONO_FONT}`;
  const lines =
    state === 'idle'
      ? ['> UPLINK ........ READY', '> HELO ......... ON CALL', '> BEACON ....... NOT LIT', '> ACTIVATE FLARE TO CALL']
      : state === 'called'
        ? ['> BEACON ....... LIT', '> HELO ......... INBOUND', '> LZ ........... HOT', '> HOLD THE PERIMETER']
        : ['> HELO ......... ON GROUND', '> LZ ........... SECURED', '> BOARDING ..... OPEN', '> GET ON THE BIRD'];
  lines.forEach((l, i) => ctx.fillText(l, 14, 96 + i * 20));
  // signal bars
  for (let i = 0; i < 10; i++) {
    const h = state === 'idle' ? 6 + rand() * 14 : 10 + rand() * 40;
    ctx.fillStyle = i < (state === 'idle' ? 3 : 9) ? pal.fg : pal.dim;
    ctx.fillRect(210 + i * 10, H - 12 - h, 7, h);
  }
  // hazard stripes at the bottom for called
  if (state === 'called') {
    ctx.fillStyle = pal.fg;
    for (let x = -20; x < W; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 14, H);
      ctx.lineTo(x + 30, H - 12);
      ctx.lineTo(x + 16, H - 12);
      ctx.closePath();
      ctx.fill();
    }
  }
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  return canvas;
}

function buildBody(): { geo: THREE.BufferGeometry; lights: GeoBatch; ring: VRange[]; leds: VRange[]; tip: VRange; status: VRange } {
  const b = new GeoBatch();
  const STEEL = 0x50565c;
  const DARK = 0x24282c;
  const CASE = 0x3f4638;
  const CASE_LIGHT = 0x555d49;
  const YEL = 0xc9a227;
  // ground mat with hazard rim
  b.cyl(1.02, 1.02, 0.024, 28, 0x1c1f22, { pos: [0, 0.012, 0] });
  b.torus(1.0, 0.018, 3, 36, Math.PI * 2, YEL, { pos: [0, 0.026, 0], rot: [Math.PI / 2, 0, 0] });
  // tripod
  const top: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const tx = Math.cos(a) * 0.21;
    const tz = Math.sin(a) * 0.21;
    const bx = Math.cos(a) * 0.74;
    const bz = Math.sin(a) * 0.74;
    b.strut([tx, 0.95, tz], [bx, 0.03, bz], 0.022, 8, STEEL);
    b.cyl(0.05, 0.06, 0.03, 10, DARK, { pos: [bx, 0.015, bz] });
    b.strut([tx * 0.9, 0.62, tz * 0.9], [tx * 0.9 + (bx - tx) * 0.45, 0.62 - 0.0, tz * 0.9 + (bz - tz) * 0.45], 0.028, 8, YEL);
    top.push([Math.cos(a) * 0.5, 0.42, Math.sin(a) * 0.5]);
  }
  for (let i = 0; i < 3; i++) b.strut(top[i]!, top[(i + 1) % 3]!, 0.01, 6, STEEL);
  b.cyl(0.26, 0.2, 0.05, 10, DARK, { pos: [0, 0.93, 0] }); // tripod head
  // case
  b.rbox(0.78, 0.26, 0.56, 0.035, CASE, { pos: [0, 1.07, 0] });
  b.box(0.8, 0.03, 0.58, DARK, { pos: [0, 0.955, 0] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(0.07, 0.29, 0.07, DARK, { pos: [sx * 0.37, 1.07, sz * 0.26] });
  }
  // latches and handle on the front
  for (const lx of [-0.24, 0.24]) {
    b.box(0.07, 0.09, 0.02, 0x8c9297, { pos: [lx, 1.06, -0.285] });
    b.box(0.05, 0.03, 0.026, DARK, { pos: [lx, 1.1, -0.288] });
  }
  b.torus(0.06, 0.012, 5, 10, Math.PI, DARK, { pos: [0, 1.0, -0.29], rot: [Math.PI, 0, 0] });
  // control deck
  b.box(0.68, 0.012, 0.4, 0x15181a, { pos: [0, 1.206, -0.07] });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) b.box(0.042, 0.014, 0.036, 0x9aa0a4, { pos: [-0.28 + c * 0.055, 1.218, -0.14 + r * 0.05] });
  }
  for (const kx of [0.06, 0.13]) b.cyl(0.022, 0.024, 0.026, 10, 0x2b2f33, { pos: [kx, 1.22, -0.14] });
  for (let i = 0; i < 3; i++) b.box(0.014, 0.03, 0.014, 0xb5babf, { pos: [0.2 + i * 0.05, 1.222, -0.14], rot: [0.5, 0, 0] });
  b.box(0.16, 0.004, 0.09, 0x090b0c, { pos: [0.22, 1.214, -0.02] });
  // open lid (tilted back ~11 degrees), pivoting at the rear top edge
  const lidRot = 0.2;
  const px = 0;
  const py = 1.2;
  const pz = 0.27;
  const local = (x: number, y: number, z: number): [number, number, number] => {
    // rotate about X by lidRot then translate to the pivot
    const cy = Math.cos(lidRot);
    const sy = Math.sin(lidRot);
    return [px + x, py + y * cy - z * sy, pz + y * sy + z * cy];
  };
  b.rbox(0.78, 0.52, 0.07, 0.025, CASE_LIGHT, { pos: local(0, 0.26, 0), rot: [lidRot, 0, 0] });
  // bezel around the screen
  const bez = 0x1a1d20;
  b.box(0.7, 0.03, 0.02, bez, { pos: local(0, 0.485, -0.04), rot: [lidRot, 0, 0] });
  b.box(0.7, 0.03, 0.02, bez, { pos: local(0, 0.05, -0.04), rot: [lidRot, 0, 0] });
  b.box(0.03, 0.44, 0.02, bez, { pos: local(-0.335, 0.267, -0.04), rot: [lidRot, 0, 0] });
  b.box(0.03, 0.44, 0.02, bez, { pos: local(0.335, 0.267, -0.04), rot: [lidRot, 0, 0] });
  for (const sx of [-1, 1]) b.box(0.06, 0.06, 0.09, DARK, { pos: local(sx * 0.36, 0.5, -0.01), rot: [lidRot, 0, 0] });
  // support arms
  for (const sx of [-1, 1]) b.strut([sx * 0.34, 1.2, 0.0], [sx * 0.34, 1.46, 0.235], 0.008, 6, STEEL);
  // mast + guy lines (right rear)
  const mx = 0.33;
  const mz = 0.25;
  b.rbox(0.1, 0.05, 0.1, 0.01, DARK, { pos: [mx, 1.225, mz] });
  const secs: [number, number, number][] = [
    [0.03, 1.22, 1.56],
    [0.024, 1.56, 1.9],
    [0.019, 1.9, 2.14],
    [0.014, 2.14, 2.34],
  ];
  for (const [r, y0, y1] of secs) {
    b.cyl(r, r, y1 - y0, 8, STEEL, { pos: [mx, (y0 + y1) / 2, mz] });
    b.cyl(r * 1.3, r * 1.3, 0.025, 8, DARK, { pos: [mx, y1, mz] });
  }
  for (let i = 0; i < 3; i++) {
    const a = Math.PI * 0.15 + i * ((Math.PI * 2) / 3) + 0.4;
    const sx = mx + Math.cos(a) * 1.15;
    const sz = mz + Math.sin(a) * 1.15;
    b.strut([mx, 1.9, mz], [sx, 0.02, sz], 0.0035, 4, 0x9aa0a4);
    b.cyl(0.012, 0.012, 0.14, 6, YEL, { pos: [sx, 0.07, sz], rot: [0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)] });
  }
  // folding dish (left rear)
  b.strut([-0.34, 1.2, 0.22], [-0.34, 1.62, 0.22], 0.018, 8, STEEL);
  b.add(new THREE.SphereGeometry(0.5, 16, 5, 0, Math.PI * 2, Math.PI - 0.55, 0.55), 0xcfd3d6, { pos: [-0.34, 1.62 + 0.5 - 0.06, 0.22], rot: [0.7, 0, 0] });
  b.strut([-0.34, 1.62, 0.22], [-0.34 + 0.0, 1.9, 0.22 + 0.22], 0.006, 5, STEEL);
  b.cyl(0.02, 0.012, 0.09, 8, DARK, { pos: [-0.34, 1.9, 0.22 + 0.215], rot: [0.7, 0, 0] });
  // satchel and battery with a cable
  b.rbox(0.44, 0.3, 0.2, 0.04, 0x4d5638, { pos: [0.62, 0.16, -0.05], rot: [0.0, 0.5, 0.08] });
  b.rbox(0.44, 0.16, 0.22, 0.04, 0x596442, { pos: [0.62, 0.3, -0.05], rot: [0.0, 0.5, 0.08] });
  b.box(0.05, 0.16, 0.012, 0x2a2d20, { pos: [0.6, 0.2, -0.16], rot: [0.0, 0.5, 0.08] });
  b.rbox(0.28, 0.2, 0.18, 0.02, 0x2f382a, { pos: [-0.62, 0.11, -0.2], rot: [0, -0.4, 0] });
  b.strut([-0.5, 0.06, -0.14], [-0.3, 0.05, 0.0], 0.012, 5, 0x151515);
  b.strut([-0.3, 0.05, 0.0], [-0.12, 0.95, 0.15], 0.012, 5, 0x151515);
  // lights batch (basic material, vertex colours updated every frame)
  const lights = new GeoBatch();
  const ring: VRange[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const a = (i / RING_COUNT) * Math.PI * 2;
    lights.cyl(0.075, 0.085, 0.03, 10, 0x222222, { pos: [Math.cos(a) * RING_R, 0.015, Math.sin(a) * RING_R] });
    ring.push(lights.sphere(0.06, 8, 4, 0xffffff, { pos: [Math.cos(a) * RING_R, 0.03, Math.sin(a) * RING_R], scale: [1, 0.45, 1] }));
  }
  const leds: VRange[] = [];
  for (let i = 0; i < 5; i++) leds.push(lights.box(0.026, 0.012, 0.026, 0xffffff, { pos: [-0.29 + i * 0.045, 1.217, -0.205] }));
  const status = lights.sphere(0.016, 8, 5, 0xffffff, { pos: [0.22, 1.222, 0.0] });
  const tip = lights.sphere(0.02, 8, 6, 0xff2a1a, { pos: [mx, 2.36, mz] });
  return { geo: b.build(), lights, ring, leds, tip, status };
}

export function createTerminalImpl(): TerminalModel {
  const rootShared = acquire(
    'terminal-shared',
    (): Shared => {
      const bodyMat = createDetailMaterial(
        { tag: 'terminal', roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide, panels: { x: 0.35, y: 0.3, z: 0.35, grime: 0.55, wear: 0.6, tint: 0.07 } },
        makeDetailUniforms(),
      ).material;
      const screenTex = {
        idle: canvasTexture(drawScreen('idle'), { aniso: 8 }),
        called: canvasTexture(drawScreen('called'), { aniso: 8 }),
        done: canvasTexture(drawScreen('done'), { aniso: 8 }),
      };
      const screenGeo = new THREE.PlaneGeometry(0.64, 0.4);
      screenGeo.rotateY(Math.PI);
      return { bodyMat, screenTex, screenGeo };
    },
    (s) => {
      s.bodyMat.dispose();
      s.screenGeo.dispose();
      for (const t of Object.values(s.screenTex)) t.dispose();
    },
  );

  const built = buildBody();
  const root = new THREE.Group();
  root.name = 'ExtractionTerminal';
  const body = new THREE.Mesh(built.geo, rootShared.bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // lights mesh
  const lightGeo = built.lights.build();
  const colorAttr = lightGeo.attributes.color as THREE.BufferAttribute;
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const lightMesh = new THREE.Mesh(lightGeo, lightMat);
  root.add(lightMesh);

  // halos: ring lights + leds + status + tip
  const haloItems: { x: number; y: number; z: number; size: number }[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const a = (i / RING_COUNT) * Math.PI * 2;
    haloItems.push({ x: Math.cos(a) * RING_R, y: 0.09, z: Math.sin(a) * RING_R, size: 0.55 });
  }
  haloItems.push({ x: 0.22, y: 1.23, z: 0.0, size: 0.16 });
  haloItems.push({ x: 0.33, y: 2.37, z: 0.25, size: 0.4 });
  const halos = new HaloPoints(haloItems);
  root.add(halos.points);

  // screen (in the tilted lid)
  const lidRot = 0.2;
  const screenMat = new THREE.MeshBasicMaterial({ map: rootShared.screenTex.idle, color: new THREE.Color(1.15, 1.15, 1.15) });
  const screen = new THREE.Mesh(rootShared.screenGeo, screenMat);
  const cy = Math.cos(lidRot);
  const sy = Math.sin(lidRot);
  const off = -0.052;
  screen.position.set(0, 1.2 + 0.27 * cy - off * sy, 0.27 + 0.27 * sy + off * cy);
  screen.rotation.x = lidRot;
  root.add(screen);

  let state: State = 'idle';
  const tmp = new THREE.Color();
  const setColor = (range: VRange, hex: number, k: number): void => {
    tmp.set(hex);
    writeRange(colorAttr, range, tmp.r * k, tmp.g * k, tmp.b * k);
  };
  const AMBER = 0xffb030;
  const RED = 0xff3a2a;
  const GREEN = 0x48ff8a;
  let acc = 0;

  const update = (dt: number, time: number): void => {
    acc += dt;
    const hex = state === 'idle' ? AMBER : state === 'called' ? RED : GREEN;
    for (let i = 0; i < RING_COUNT; i++) {
      let k: number;
      if (state === 'idle') k = 0.18 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(time * 1.4 - i * 0.52), 2);
      else if (state === 'called') {
        const chase = Math.pow(Math.max(0, Math.sin(time * 6.5 - i * ((Math.PI * 2) / RING_COUNT) * 2)), 3);
        const flash = 0.5 + 0.5 * Math.sin(time * 5.2);
        k = 0.12 + chase * 1.5 + flash * 0.35;
      } else k = 0.95 + 0.15 * Math.sin(time * 2 + i);
      setColor(built.ring[i]!, hex, k * 2.2);
      halos.set(i, tmp.r * k * 1.1, tmp.g * k * 1.1, tmp.b * k * 1.1);
    }
    // keypad LEDs
    for (let i = 0; i < built.leds.length; i++) {
      const on = state === 'done' ? 1 : state === 'called' ? (Math.sin(time * 8 + i * 1.7) > 0 ? 1 : 0.15) : Math.sin(time * 1.1 + i * 2.3) > 0.2 ? 0.8 : 0.1;
      setColor(built.leds[i]!, hex, on * 2);
    }
    const blink = state === 'called' ? (Math.sin(time * 9) > 0 ? 1 : 0.1) : 0.5 + 0.5 * Math.sin(time * 2.4);
    setColor(built.status, hex, blink * 3);
    halos.set(RING_COUNT, tmp.r * blink * 0.7, tmp.g * blink * 0.7, tmp.b * blink * 0.7);
    // antenna tip: slow red aircraft-style blink
    const tipOn = (time % 1.6) < 0.16 ? 1 : 0.08;
    setColor(built.tip, 0xff2a1a, tipOn * 3.5);
    halos.set(RING_COUNT + 1, 1.6 * tipOn, 0.12 * tipOn, 0.08 * tipOn);
    colorAttr.needsUpdate = true;
    halos.commit();
    // screen brightness
    const flick = state === 'called' ? 1.05 + 0.25 * Math.sin(time * 5.2) : 1.05 + 0.06 * Math.sin(time * 31 + acc);
    screenMat.color.setScalar(flick);
    void dt;
  };
  update(0, 0);

  return {
    root,
    setState(s: State) {
      state = s;
      screenMat.map = rootShared.screenTex[s];
      screenMat.needsUpdate = true;
    },
    update,
    flareLocal: new THREE.Vector3(0.8, 0.04, -0.75),
    topLocal: new THREE.Vector3(0, 2.3, 0),
    dispose() {
      built.geo.dispose();
      lightGeo.dispose();
      lightMat.dispose();
      screenMat.dispose();
      halos.dispose();
      release('terminal-shared');
    },
  };
}
