/**
 * UI harness: renders a mock blue-hour 3D backdrop and drives the real HUD / menus with animated mock state.
 *   window.scenario('combat' | 'station' | 'defense' | 'extraction' | 'hazard' | 'boss' | 'map' | 'title' | 'pause'
 *                   | 'resume' | 'victory' | 'defeat' | 'error' | 'loading', settleMs?) -> Promise
 *   window.fire(event)      push a HudEvent
 *   window.freeze(bool)     stop the mock clock (state stays put, canvases still redraw)
 *   window.__calls          array of menu callbacks that fired
 */
import * as THREE from 'three';
import { DEFAULT_SETTINGS, QUALITY, WEAPONS } from '../src/config';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import type { BestRun, MissionStats, Settings } from '../src/types';
import { createHud } from '../src/ui/hud';
import type {
  HudEvent,
  HudObjective,
  HudState,
  HudWeaponInfo,
  MapData,
  MapDynamic,
  MapFootprint,
  MapMarker,
} from '../src/ui/hudTypes';
import { createMenus } from '../src/ui/menus';

// ---------------------------------------------------------------------------------------------
// mock 3D backdrop (only so the translucent UI is judged against a game-like image)
// ---------------------------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.6;
const rig = setupBlueHour(scene, 40);
rig.setShadowQuality(true, QUALITY.medium.shadowMapSize);
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.06, 420);

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, emissive = 0, rough = 0.85, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.2, emissive, emissiveIntensity: emissive ? 1.4 : 0 }),
  );
  m.position.set(x, y + h / 2, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.55 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // road markings
  for (let i = -8; i < 12; i++) box(0.25, 0.02, 3, 0, 0.01, -i * 6, 0xbcbfb0);
  // containers
  const cols = [0x7a2e26, 0x2d4a6e, 0x3a5a3a, 0x555c3a, 0x7a4a2c];
  for (let i = 0; i < 9; i++) box(12, 2.6, 2.4, 20 + (i % 3) * 3, i < 3 ? 0 : 2.6, -18 - Math.floor(i / 3) * 6 * 0 - (i % 3) * 5, cols[i % cols.length]!, 0, 0.7, 0.05 * i);
  for (let i = 0; i < 6; i++) box(4.4, 1.5, 1.8, -10 - i * 7, 0, -6 - (i % 2) * 4, [0x3b4046, 0x6a2a24, 0x2a3346][i % 3]!, 0, 0.4, 0.3 * i);
  // buildings
  box(18, 14, 12, -30, 0, -42, 0x4a4d4e);
  box(26, 8, 16, 42, 0, -46, 0x3e4244);
  box(10, 22, 10, -8, 0, -60, 0x353a3c);
  // the spire with a green core and red beacons
  box(3, 60, 3, 70, 0, -90, 0x252a2c, 0x0a3a1c);
  box(1.4, 6, 1.4, 70, 60, -90, 0x40ff90, 0x40ff90);
  const beacon = box(0.8, 0.8, 0.8, 70, 66, -90, 0xff2a1a, 0xff2010);
  beacon.castShadow = false;
  // street lamps
  for (let i = 0; i < 6; i++) {
    box(0.18, 7, 0.18, 8, 0, -i * 14, 0x22262a);
    box(0.7, 0.2, 0.4, 7.4, 7, -i * 14, 0xffd9a0, 0xffb060);
    const l = new THREE.PointLight(0xffc27a, 90, 22, 2);
    l.position.set(7.4, 6.8, -i * 14);
    scene.add(l);
  }
}
camera.position.set(0, 1.7, 0);
const yaw0 = -0.62;
camera.rotation.set(0.02, yaw0, 0, 'YXZ');

function fitRenderer(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
fitRenderer();
window.addEventListener('resize', fitRenderer);

// ---------------------------------------------------------------------------------------------
// mock level data
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMapData(): MapData {
  const rnd = mulberry32(7);
  const fp: MapFootprint[] = [];
  const add = (kind: MapFootprint['kind'], x: number, z: number, hx: number, hz: number, rot = 0): void => {
    fp.push({ kind, x, z, hx, hz, rot });
  };
  // perimeter walls
  add('wall', 0, -51, 66, 1);
  add('wall', 0, 51, 66, 1);
  add('wall', -65, 0, 1, 52);
  add('wall', 65, 0, 1, 52);
  // low-threat blocks
  add('building', -55.5, 12, 7, 6);
  add('building', -42, 12, 3, 6);
  add('building', -22, 35, 7, 6);
  add('building', -9, 38, 3, 8);
  add('building', -36, 46, 3, 3);
  for (let i = 0; i < 9; i++) add('vehicle', -28 + (i % 5) * 4.6, 10 + Math.floor(i / 5) * 6, 2.3, 0.9, i % 2 ? 0 : Math.PI);
  add('tank', -56, 44, 0.9, 0.9);
  add('prop', -58, 36, 3, 4.5); // command tent
  add('prop', -46, 47, 1.6, 2);
  add('vehicle', -45, 33, 3.4, 1.4, 0.3); // apc
  for (let i = 0; i < 7; i++) add('prop', -62 + i * 1.6, 28.5, 0.8, 0.35); // sandbags
  add('fence', -50, 26.5, 12, 0.05);
  // LZ area
  add('vehicle', -52, -10, 5, 1.3);
  add('vehicle', -27, -20, 5.5, 1.3, 0.4);
  for (let i = 0; i < 5; i++) add('prop', -30 + i * 3.4, -8, 1.5, 0.4);
  add('building', -40, -42, 8, 6);
  add('building', -20, -44, 5, 5);
  add('building', -56, -44, 5, 5);
  // depot: container yard
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 1) continue; // open relay pad
      const vertical = (r + c) % 2 === 0;
      add('container', 15 + c * 12, 13 + r * 10.5, vertical ? 1.2 : 6, vertical ? 6 : 1.2);
    }
  }
  add('building', 52, 39, 12, 11); // warehouse
  add('prop', 52, 27.5, 10, 1); // loading dock
  add('tank', 46, 14, 3.5, 3.5);
  add('tank', 54, 14, 3.5, 3.5);
  add('tank', 62, 14, 2.5, 2.5);
  add('vehicle', 48, 22, 4, 1.3);
  add('vehicle', 56, 22, 4, 1.3, 0.2);
  add('fence', 8, 30, 0.05, 20);
  add('fence', 36, 8, 28, 0.05);
  // compound
  add('wall', 9, -30, 0.8, 20); // west wall
  add('wall', 36, -9, 12, 0.8);
  add('wall', 58, -9, 7, 0.8);
  add('building', 30, -38, 14, 8); // lab
  add('tank', 50, -26, 4.5, 4.5); // dome
  add('prop', 46, -24, 2, 2); // spire base
  for (let i = 0; i < 8; i++) add('container', 14 + (i % 4) * 3, -24 - Math.floor(i / 4) * 5, 1.2, 2.4, rnd() > 0.5 ? 0 : 0.2);
  add('vehicle', 22, -16, 3.8, 1.5); // decon truck
  add('prop', 38, -18, 3.5, 2.2); // tent
  // random props / cars along roads
  for (let i = 0; i < 12; i++) add('vehicle', -60 + rnd() * 120, rnd() > 0.5 ? -2 : 2, 2.2, 0.9, rnd() > 0.5 ? 0 : Math.PI);
  for (let i = 0; i < 6; i++) add('vehicle', rnd() > 0.5 ? -2 : 2, -48 + rnd() * 96, 0.9, 2.2, rnd() > 0.5 ? 0 : Math.PI);
  for (let i = 0; i < 14; i++) add('prop', -60 + rnd() * 120, -48 + rnd() * 96, 0.5 + rnd() * 0.5, 0.5 + rnd() * 0.5, rnd() * 3);
  return {
    bounds: { minX: -66, maxX: 66, minZ: -52, maxZ: 52 },
    roads: [
      { x0: -66, z0: -5, x1: 66, z1: 5, name: 'Route 9' },
      { x0: -5, z0: -52, x1: 5, z1: 52, name: 'Depot Road' },
      { x0: -66, z0: 19, x1: -5, z1: 27, name: 'South Street' },
      { x0: -38, z0: 5, x1: -30, z1: 52, name: 'West Avenue' },
      { x0: -66, z0: -35, x1: -5, z1: -27, name: 'North Road' },
    ],
    regions: [
      { region: 'high', x0: 6, z0: -52, x1: 66, z1: -8 },
      { region: 'medium', x0: 6, z0: -8, x1: 66, z1: 52 },
    ],
    footprints: fp,
    labels: [
      { text: 'Insertion', x: -50, z: 40 },
      { text: 'Apartments', x: -52, z: 12, size: 0.85 },
      { text: 'Corner store', x: -22, z: 42, size: 0.85 },
      { text: 'LZ Echo', x: -42, z: -18 },
      { text: 'Container depot', x: 24, z: 30 },
      { text: 'Warehouse', x: 52, z: 45, size: 0.85 },
      { text: 'Fuel tanks', x: 54, z: 9, size: 0.8 },
      { text: 'Research compound', x: 36, z: -24, size: 1.1 },
    ],
  };
}

const MAP = buildMapData();

const baseMarkers = (): MapMarker[] => [
  { id: 'start', kind: 'start', x: -50, z: 40, label: 'Insertion', visible: true },
  { id: 'buy1', kind: 'buy', x: -47, z: 37, label: 'Supply cage', visible: true },
  { id: 'buy2', kind: 'buy', x: 12, z: 24, label: 'Fwd supply', visible: true },
  { id: 'buy3', kind: 'buy', x: -24, z: -13, label: 'LZ cache', visible: true },
  { id: 'up1', kind: 'upgrade', x: 46, z: 44, label: 'Armory bench', visible: true },
  { id: 'gate1', kind: 'gate', x: 9, z: -31, label: 'West gate', visible: true },
  { id: 'gate2', kind: 'gate', x: 28, z: -8, label: 'South gate', visible: true },
  { id: 'spire', kind: 'landmark', x: 46, z: -24, label: 'Spire', visible: true },
  ...(
    [
      [-59, 47],
      [-13.5, 46],
      [-20, 39],
      [-47, 10],
      [-30, -44],
      [44, 46],
      [58, 32],
      [12, 46],
      [20, -20],
      [54, -14],
    ] as [number, number][]
  ).map(
    ([x, z], i): MapMarker => ({ id: `crate${i}`, kind: 'crate', x, z, visible: i !== 2 && i !== 6 }),
  ),
];

// ---------------------------------------------------------------------------------------------
// mock state
// ---------------------------------------------------------------------------------------------

type Scenario =
  | 'combat'
  | 'station'
  | 'defense'
  | 'extraction'
  | 'hazard'
  | 'boss'
  | 'map'
  | 'title'
  | 'pause'
  | 'resume'
  | 'victory'
  | 'defeat'
  | 'error'
  | 'loading';

const rifle = (mag: number, reloading = false, rp = 0): HudWeaponInfo => ({
  id: 'rifle',
  name: WEAPONS.rifle.name,
  short: WEAPONS.rifle.short,
  tier: 1,
  tierLabel: 'MK II',
  mag,
  magSize: 42,
  reserve: 118,
  reloading,
  reloadProgress: rp,
  auto: true,
});
const pistol: HudWeaponInfo = {
  id: 'pistol',
  name: WEAPONS.pistol.name,
  short: WEAPONS.pistol.short,
  tier: 0,
  tierLabel: '',
  mag: 13,
  magSize: 13,
  reserve: 78,
  reloading: false,
  reloadProgress: 0,
  auto: false,
};

let current: Scenario = 'combat';
let frozen = false;
let clock = 0;
let settings: Settings = { ...DEFAULT_SETTINGS };
const calls: string[] = [];
(window as unknown as { __calls: string[] }).__calls = calls;
const perf = { updateMs: 0, frames: 0, maxMs: 0 };
(window as unknown as { __perf: typeof perf }).__perf = perf;

const hud = createHud();
const menus = createMenus({
  onDeploy: () => calls.push('deploy'),
  onResume: () => calls.push('resume'),
  onRestart: () => calls.push('restart'),
  onQuitToTitle: () => calls.push('title'),
  onSettingsChange: (s) => {
    settings = s;
    calls.push(`settings:${JSON.stringify(s)}`);
  },
});
const uiRoot = document.getElementById('ui-root') as HTMLElement;
hud.mount(uiRoot);
menus.mount(uiRoot);
hud.setMapData(MAP);
menus.setSettings(settings);

const objectives = (over: Partial<Record<'a' | 'b' | 'c', Partial<HudObjective>>> = {}): HudObjective[] => [
  {
    id: 'defense',
    title: 'RESTORE THE RELAY',
    detail: 'Reach the relay station in the depot',
    state: 'active',
    progress: -1,
    tracked: true,
    distance: 84,
    ...over.a,
  },
  {
    id: 'hunt',
    title: 'ELIMINATE THE WARDEN',
    detail: 'Search the research compound',
    state: 'available',
    progress: -1,
    tracked: false,
    distance: 132,
    ...over.b,
  },
  {
    id: 'extract',
    title: 'EXTRACT AT LZ ECHO',
    detail: 'Complete both contracts first',
    state: 'locked',
    progress: -1,
    tracked: false,
    distance: -1,
    ...over.c,
  },
];

function baseState(t: number): HudState {
  const burst = (t % 3) < 1.1;
  const spread = burst ? 2.6 + Math.sin(t * 20) * 0.5 : 1.1 + Math.abs(Math.sin(t)) * 0.6;
  const reloading = t % 9 > 6.8;
  const mag = reloading ? 0 : Math.max(0, 42 - Math.floor((t % 9) * 4));
  return {
    health: 76,
    maxHealth: 100,
    armor: 50,
    maxArmor: 100,
    plates: 2,
    maxPlates: 3,
    stamina: 0.78,
    staminaExhausted: false,
    cash: 1250,
    grenades: 2,
    maxGrenades: 4,
    weapon: rifle(mag, reloading, reloading ? (t % 9 - 6.8) / 2.2 : 0),
    otherWeapon: pistol,
    activeSlot: 0,
    region: 'medium',
    regionName: 'MEDIUM THREAT',
    regionColor: '#f2c14e',
    timer: { label: 'MISSION CLOCK', seconds: 452 - t, urgent: false },
    subTimer: null,
    objectives: objectives(),
    prompt: null,
    panel: null,
    crosshair: { spread, ads: false, hidden: false },
    plateProgress: -1,
    lowAmmo: mag > 0 && mag <= 10,
    outOfAmmo: false,
    hazard: { active: false, inside: false, message: null },
    boss: null,
    fps: settings.showFps ? 60 : null,
    compassYaw: yaw0 + Math.sin(t * 0.3) * 0.5,
    vignette: 0,
    toxic: 0,
  };
}

function baseMap(t: number, yawOverride?: number): MapDynamic {
  const yaw = yawOverride ?? yaw0 + Math.sin(t * 0.3) * 0.5;
  const p = { x: 20 + Math.sin(t * 0.2) * 3, z: 28 + Math.cos(t * 0.2) * 3, yaw };
  const enemies: MapDynamic['enemies'] = [];
  const rnd = mulberry32(3);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 8 + rnd() * 40;
    enemies.push({
      x: p.x + Math.cos(a + t * 0.05 * (i % 3)) * r,
      z: p.z + Math.sin(a + t * 0.05 * (i % 3)) * r,
      type: (['shambler', 'runner', 'armored'] as const)[i % 3]!,
      alerted: i % 2 === 0,
    });
  }
  const markers = baseMarkers();
  markers.push({ id: 'relay', kind: 'transmitter', x: 24, z: 30, label: 'Relay', radius: 10, visible: true, compass: true, pulse: true, color: '#e2b04a' });
  markers.push({ id: 'hunt', kind: 'hunt', x: 30, z: -38, label: 'Search area', radius: 26, visible: true, compass: true, color: '#ff5a4d' });
  markers.push({ id: 'lz', kind: 'lz', x: -42, z: -16, label: 'LZ Echo', visible: true, compass: true, dim: true });
  return { player: p, enemies, markers, hazard: null };
}

interface Frame {
  state: HudState;
  map: MapDynamic;
}

let overrides: Partial<HudState> = {};

function frame(t: number): Frame {
  const s = baseState(t);
  const m = baseMap(t);
  switch (current) {
    case 'combat':
      break;
    case 'station': {
      s.prompt = null;
      s.panel = {
        title: 'SUPPLY CAGE',
        subtitle: 'FUNDS $1,250',
        hint: '[1-6] PURCHASE   [E] CLOSE',
        items: [
          { key: '1', label: 'AMMO REFILL', detail: 'KR-16 - fill reserve to 300', cost: 250, state: 'ok' },
          { key: '2', label: 'ARMOR PLATE', detail: 'Carry up to 3 plates', cost: 350, state: 'ok', note: '2 / 3' },
          { key: '3', label: 'FRAG GRENADES x2', detail: 'Max 4 carried', cost: 200, state: 'ok' },
          { key: '4', label: 'PS-12 PUMP SHOTGUN', detail: 'Replaces VX-9 Service Pistol', cost: 1200, state: 'unaffordable' },
          { key: '5', label: 'VX-9 SERVICE PISTOL', detail: 'Already carried', cost: 200, state: 'owned' },
          { key: '6', label: 'KR-16 ASSAULT RIFLE', detail: 'Ammo full', cost: 250, state: 'full' },
        ],
      };
      m.player.x = -47;
      m.player.z = 34;
      break;
    }
    case 'defense': {
      const p = Math.min(1, 0.43 + (t % 20) * 0.02);
      s.objectives = objectives({
        a: { detail: `Hold the marked area - ${Math.round(p * 100)}%`, progress: p, distance: 3, state: 'active' },
      });
      s.subTimer = { label: 'UPLINK', seconds: 55 * (1 - p), urgent: false };
      s.prompt = { key: 'E', text: 'Hold to activate transmitter', sub: 'Uplink will attract infected', hold: 0.6, tone: 'warn' };
      s.crosshair.hidden = false;
      m.player.x = 25;
      m.player.z = 33;
      m.markers.find((mk) => mk.id === 'relay')!.pulse = true;
      break;
    }
    case 'extraction': {
      s.timer = { label: 'EXTRACTION', seconds: 34 - (t % 30), urgent: t % 30 > 22 };
      s.subTimer = { label: 'HELICOPTER ETA', seconds: 34 - (t % 30), urgent: false };
      s.timer = { label: 'MISSION CLOCK', seconds: 152, urgent: true };
      s.region = 'low';
      s.regionName = 'LOW THREAT';
      s.regionColor = '#8fd18a';
      s.objectives = objectives({
        a: { state: 'complete', detail: 'Uplink complete', progress: 1, distance: -1, tracked: false },
        b: { state: 'complete', detail: 'The Warden is down', progress: 1, distance: -1, tracked: false },
        c: { state: 'active', detail: 'Hold the LZ - board the helicopter', progress: -1, tracked: true, distance: 14 },
      });
      s.prompt = { key: 'E', text: 'Board helicopter', sub: 'Hold position until it touches down', hold: 0.35, tone: 'good' };
      s.hazard = { active: true, inside: false, message: 'CONTAMINATION SURGE - HOLD FOR EXTRACTION' };
      s.plates = 1;
      s.health = 58;
      s.cash = 8420;
      m.player.x = -40;
      m.player.z = -14;
      m.markers.push({ id: 'heli', kind: 'helicopter', x: -42 + Math.sin(t) * 2, z: -20, label: 'Bird', visible: true, compass: true, pulse: true });
      m.markers.find((mk) => mk.id === 'lz')!.dim = false;
      m.markers.find((mk) => mk.id === 'lz')!.pulse = true;
      m.hazard = { x: 46, z: -24, radius: 70 + t * 0.2 };
      break;
    }
    case 'hazard': {
      s.hazard = { active: true, inside: true, message: 'CONTAMINATION SURGE - REACH EXTRACTION' };
      s.toxic = 0.55 + Math.sin(t * 3) * 0.1;
      s.vignette = 0.45;
      s.health = 34;
      s.armor = 0;
      s.plates = 0;
      s.timer = { label: 'MISSION CLOCK', seconds: 61, urgent: true };
      m.hazard = { x: 46, z: -24, radius: 58 };
      m.player.x = 30;
      m.player.z = 12;
      break;
    }
    case 'boss': {
      s.region = 'high';
      s.regionName = 'HIGH THREAT';
      s.regionColor = '#ff5a4d';
      s.boss = { name: 'THE WARDEN', fraction: 0.62, enraged: true };
      s.vignette = 0.3;
      s.health = 41;
      s.armor = 12;
      s.objectives = objectives({
        a: { state: 'complete', detail: 'Uplink complete', progress: 1, distance: -1, tracked: false },
        b: { state: 'active', detail: 'Eliminate the target', progress: -1, tracked: true, distance: 9 },
      });
      s.crosshair.ads = true;
      m.player.x = 30;
      m.player.z = -30;
      m.enemies.push({ x: 30, z: -38, type: 'warden', alerted: true });
      break;
    }
    case 'map': {
      m.hazard = { x: 46, z: -24, radius: 34 };
      m.player.x = -12;
      m.player.z = 8;
      m.markers.push({ id: 'heli', kind: 'helicopter', x: -44, z: -20, label: 'Extraction bird', visible: true, compass: true });
      break;
    }
    default:
      break;
  }
  Object.assign(s, overrides);
  return { state: s, map: m };
}

// ---------------------------------------------------------------------------------------------
// event scripting for the combat scenario
// ---------------------------------------------------------------------------------------------

const events: [number, HudEvent][] = [
  [0.4, { type: 'banner', title: 'ENTERING MEDIUM THREAT', subtitle: 'Industrial depot - armoured infected reported', tone: 'warn', duration: 4 }],
  [0.6, { type: 'radio', speaker: 'OVERWATCH', text: 'Relay tower is dark. Get the uplink online and hold that circle.' }],
  [1.0, { type: 'feed', text: '+$160  ARMORED INFECTED', tone: 'good' }],
  [1.0, { type: 'cash', amount: 160 }],
  [1.4, { type: 'hit', head: false, kill: false }],
  [1.8, { type: 'hit', head: true, kill: false }],
  [2.2, { type: 'hit', head: false, kill: true }],
  [2.6, { type: 'damage', angle: 0.4, amount: 18 }],
  [3.1, { type: 'damage', angle: Math.PI * 0.8, amount: 30 }],
  [3.4, { type: 'feed', text: '+1 ARMOR PLATE', tone: 'good' }],
  [3.6, { type: 'feed', text: 'SUPPLY CACHE OPENED', tone: 'normal' }],
  [4.0, { type: 'feed', text: 'LOW AMMO', tone: 'warn' }],
];
let eventCursor = 0;

// ---------------------------------------------------------------------------------------------
// results / best-run mock data
// ---------------------------------------------------------------------------------------------

const stats = (win: boolean): MissionStats => ({
  outcome: win ? 'victory' : 'defeat',
  reason: win ? 'Extracted' : 'Killed in action - overrun at the relay',
  kills: 132,
  headshots: 41,
  contractsCompleted: win ? 2 : 1,
  contractsTotal: 2,
  cratesOpened: 9,
  cashEarned: 14020,
  cashSpent: 9350,
  ammoCollected: 340,
  platesCollected: 5,
  timeSurvived: win ? 587 : 331,
  shotsFired: 1904,
  shotsHit: 771,
  highestRegion: 'high',
});
const bestRun: BestRun = { time: 612, kills: 118, headshots: 33, cash: 13210, date: '2026-09-28T14:02:11Z' };

// ---------------------------------------------------------------------------------------------
// scenario switching
// ---------------------------------------------------------------------------------------------

const MENU_SCENARIOS = new Set<Scenario>(['title', 'pause', 'resume', 'victory', 'defeat', 'error', 'loading']);

function applyScenario(name: Scenario): void {
  overrides = {};
  current = name;
  clock = 0;
  eventCursor = 0;
  hud.reset();
  menus.hide();
  menus.hideLoading();
  const isMenu = MENU_SCENARIOS.has(name);
  hud.setVisible(!isMenu || name === 'pause' || name === 'resume');
  hud.toggleTacticalMap(name === 'map');
  switch (name) {
    case 'title':
      hud.setVisible(false);
      menus.showTitle(null);
      break;
    case 'pause':
      menus.showPause();
      break;
    case 'resume':
      menus.showResumePrompt('Pointer lock was released');
      break;
    case 'victory':
      hud.setVisible(false);
      menus.showResults(stats(true), { ...bestRun, time: 587 }, true);
      break;
    case 'defeat':
      hud.setVisible(false);
      menus.showResults(stats(false), bestRun, false);
      break;
    case 'error':
      hud.setVisible(false);
      menus.showError(
        'WebGL 2 is not available',
        'This game needs a browser with WebGL 2 and hardware acceleration. Enable hardware acceleration or try a current version of Chrome, Edge or Firefox.',
        'Error: getContext("webgl2") returned null\n  at createRenderer (stage.ts:23)',
      );
      break;
    case 'loading':
      hud.setVisible(false);
      menus.showTitle(bestRun);
      menus.showLoading(0.62, 'BUILDING DISTRICT GEOMETRY');
      break;
    default:
      break;
  }
}

const w = window as unknown as {
  scenario: (name: Scenario, settleMs?: number) => Promise<string>;
  fire: (e: HudEvent) => void;
  freeze: (v: boolean) => void;
  setSettings: (s: Partial<Settings>) => void;
  override: (p: Partial<HudState>) => void;
  hudRef: typeof hud;
  __ready: boolean;
};
w.scenario = (name, settleMs = 900) => {
  applyScenario(name);
  if (name === 'combat') frozen = false;
  return new Promise((resolve) => setTimeout(() => resolve(name), settleMs));
};
w.fire = (e) => hud.event(e);
w.freeze = (v) => {
  frozen = v;
};
w.setSettings = (s) => {
  settings = { ...settings, ...s };
  menus.setSettings(settings);
};
w.override = (p) => {
  overrides = p;
};
w.hudRef = hud;

// ---------------------------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------------------------

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!frozen) clock += dt;
  camera.rotation.y = yaw0 + Math.sin(clock * 0.3) * 0.5 * (current === 'title' ? 0.2 : 1);
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig.focusShadow(new THREE.Vector3(0, 0, -10));
  renderer.render(scene, camera);

  if (current === 'combat') {
    while (eventCursor < events.length && events[eventCursor]![0] <= clock) hud.event(events[eventCursor++]![1]);
  }
  if (!MENU_SCENARIOS.has(current) || current === 'pause' || current === 'resume') {
    const f = frame(clock);
    const t0 = performance.now();
    hud.update(f.state, f.map, frozen ? 0 : dt);
    perf.updateMs += performance.now() - t0;
    perf.frames++;
    if (performance.now() - t0 > perf.maxMs) perf.maxMs = performance.now() - t0;
  }
  w.__ready = true;
  requestAnimationFrame(loop);
}
applyScenario('combat');
requestAnimationFrame(loop);
