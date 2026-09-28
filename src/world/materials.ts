/**
 * Procedural material library.
 *
 * `MaterialLib.get(name)` returns a SHARED THREE.MeshStandardMaterial (never mutate it; clone if you need a variant).
 * Tiling materials carry `material.userData.tile` = metres per texture repeat; `LevelBuilder.add()` projects world-space
 * UVs onto Box / Plane geometry using it so textures never stretch. Materials without `userData.tile` (tire, emissives)
 * are drawn 1:1 on UVs 0..1.
 *
 * Everything is generated procedurally on first use (see `textures/`): albedo + normal + roughness/metalness (ORM) maps
 * from seamless periodic noise, plus emissive maps for the glow family. Textures are 512 px (asphalt 1024, small props 256).
 * Shared maps: all containers share one ribbed normal map, all barrels one, all vehicle paints one, both corrugated sheets one.
 *
 * Decal conventions and natural quad sizes are documented in `textures/decals.ts` (`DECAL_INFO`, re-exported here).
 * Notes on materials that gained a `tile` beyond the original contract (so world-UV projection keeps them unstretched):
 * steel 2, steelDark 2, rust 2, rubber 1.2, burnt 2, paint* 2, glass 2, glassDark 2, canvasOlive/canvasTan 1.2, tarp 2,
 * pallet 1.2, cardboard 0.8, labPanel 1.5. `chainlink` is alpha-tested (alphaTest 0.4, alphaToCoverage, double sided) with a
 * coverage-preserving mip chain; `glass` is transparent (depthWrite off, double sided).
 */
import * as THREE from 'three';

export const MATERIAL_NAMES = [
  // ---- ground (tiling, horizontal) ----
  'asphalt', // dry cracked asphalt, tile 8
  'asphaltWet', // damp asphalt with low-roughness puddled patches, tile 8
  'sidewalk', // concrete slab sidewalk with joints, tile 4
  'concreteSlab', // big industrial pad with expansion joints, tile 6
  'dirt', // packed dirt / gravel patches, tile 6
  'grass', // dead, patchy overgrowth, tile 6
  'gravel', // loose stone, tile 4
  'rubble', // broken concrete chunks for debris, tile 2
  // ---- walls & structure (tiling, vertical) ----
  'concreteWall', // poured concrete with panel joints and stains, tile 4
  'concreteDark', // dirtier / darker concrete, tile 4
  'brick', // dark weathered brick, tile 3
  'plaster', // cracked muted stucco, tile 4
  'corrugated', // galvanised corrugated sheet (vertical ribs), tile 2.4
  'corrugatedRust', // rusted corrugated sheet, tile 2.4
  'metalPanel', // smooth industrial panel siding with seams, tile 3
  'oliveMetal', // military olive-drab painted metal with chipping, tile 3
  'tile', // white / grey tiles (lab walls), tile 2
  'labFloor', // pale lab floor tiles, tile 4
  'wood', // weathered planks, tile 2
  'roof', // tar and gravel roofing, tile 6
  'floorWarehouse', // sealed concrete floor with wear lines, tile 6
  'floorStore', // dirty linoleum tiles, tile 3
  // ---- metals / misc ----
  'steel', // brushed steel
  'steelDark', // dark gunmetal
  'rust', // heavily rusted metal
  'rubber', // matte black rubber
  'grating', // metal grating walkway look, tile 1.5
  'hazard', // yellow/black diagonal hazard stripes, tile 1
  'chainlink', // alpha-tested chain-link fence (double sided), tile 2.4
  'glass', // translucent window glass (transparent, low roughness)
  'glassDark', // dark grimy window (opaque)
  'tire',
  // ---- shipping containers (ribbed, tile 2.4) ----
  'containerRed',
  'containerBlue',
  'containerGreen',
  'containerOlive',
  'containerRust',
  'containerWhite',
  'containerYellow',
  // ---- vehicle paints ----
  'paintOlive',
  'paintWhite',
  'paintBlue',
  'paintRed',
  'paintBlack',
  'paintYellow',
  'paintGrey',
  'burnt', // charred wreck metal
  // ---- soft goods ----
  'canvasOlive',
  'canvasTan',
  'sandbag', // tile 1
  'tarp',
  // ---- crates & wood ----
  'crateWood', // tile 1
  'crateMil', // olive military crate with stencilled marks, tile 1
  'pallet',
  'cardboard',
  // ---- barrels (tile 1) ----
  'barrelBlue',
  'barrelRed',
  'barrelGreen',
  'barrelYellow',
  'barrelBio',
  'barrelRust',
  // ---- lab ----
  'labPanel', // white/grey equipment panels
  // ---- emissive (MeshStandardMaterial with emissive, bloom-friendly) ----
  'lampWarm', // sodium / tungsten
  'lampCool', // fluorescent / LED cool white
  'lampRed', // warning beacon glass
  'emGreen', // contamination glow
  'emBlue', // screens, cryo
  'emAmber', // amber indicator
  'screen', // dim bluish monitor
  'windowLit', // warm lit window
] as const;

export type MaterialName = (typeof MATERIAL_NAMES)[number];

export const DECAL_NAMES = [
  // ---- road markings ----
  'laneDash',
  'laneSolid',
  'laneYellow', // double yellow centre line
  'crosswalk',
  'stopLine',
  'arrow',
  // ---- ground grime ----
  'oilStain',
  'dirtPatch',
  'crackLarge',
  'puddle', // dark reflective puddle patch
  'skid',
  'bloodOld0',
  'bloodOld1',
  'bloodOld2',
  'bloodDrag',
  'scorchOld',
  // ---- wall grime ----
  'rustStain',
  'grime',
  'mold',
  // ---- stencils ----
  'stencilH', // helipad H
  'stencilRing', // helipad ring
  'biohazard',
  'stencilQuarantine',
  'stencilDanger',
  'stencilRestricted',
  'stencilKeepOut',
  'stencilDepot',
  'stencilLZ',
  'chevrons', // hazard chevrons
] as const;

export type DecalName = (typeof DECAL_NAMES)[number];

export interface StencilOptions {
  /** CSS colour of the text / symbol. */
  color?: string;
  /** Background: 'transparent' (spray-paint look) or a CSS colour (sign board). */
  background?: string;
  /** Width/height ratio of the produced quad (default 3). */
  aspect?: number;
  /** 'stencil' military stencil face, 'sans' road-sign face, 'mono' terminal face. */
  font?: 'stencil' | 'sans' | 'mono';
  /** Adds worn / peeling paint. */
  worn?: boolean;
  emissive?: boolean;
}

export interface MaterialLib {
  /** Shared standard material. */
  get(name: MaterialName): THREE.MeshStandardMaterial;
  /** Shared transparent decal material (map + alpha). Use on planes; depthWrite is off and polygonOffset is set. */
  decal(name: DecalName): THREE.MeshStandardMaterial;
  /** Cached custom text decal / sign board material (`text` may contain \n). */
  stencil(text: string, opts?: StencilOptions): THREE.MeshStandardMaterial;
  /** Soft round white radial-gradient texture (for glow sprites / points). */
  readonly glowTexture: THREE.Texture;
  /** Soft warm-white radial gradient used for ground light pools (additive). */
  readonly lightPoolTexture: THREE.Texture;
  dispose(): void;
}


import { releaseCracks } from './textures/cracks';
import {
  type PaintCtx,
  getBank,
  releaseBank,
} from './textures/core';
import { DECAL_INFO, paintCustomStencil, paintDecal } from './textures/decals';
import { paintEmissive } from './textures/emissive';
import {
  paintAsphalt,
  paintConcreteSlab,
  paintDirt,
  paintFloorStore,
  paintFloorWarehouse,
  paintGrass,
  paintGravel,
  paintLabFloor,
  paintRoof,
  paintRubble,
  paintSidewalk,
} from './textures/ground';
import {
  paintBurnt,
  paintChainlink,
  paintContainer,
  paintGlass,
  paintGrating,
  paintHazard,
  paintRubber,
  paintRust,
  paintSteel,
  paintTire,
  paintVehicle,
} from './textures/metals';
import {
  paintBarrel,
  paintCanvas,
  paintCardboard,
  paintCrateMil,
  paintCrateWood,
  paintPallet,
  paintSandbag,
  paintTarp,
} from './textures/propsTex';
import {
  paintBrick,
  paintConcreteWall,
  paintCorrugated,
  paintLabPanel,
  paintMetalPanel,
  paintOliveMetal,
  paintPlaster,
  paintTile,
  paintWood,
} from './textures/walls';

export { DECAL_INFO };

type Recipe = (c: PaintCtx) => THREE.MeshStandardMaterial;

const container = (color: [number, number, number], rust: number, dirt: number, seed: number): Recipe => (c) =>
  paintContainer(c, { color, rust, dirt, seed });
const paint = (color: [number, number, number], seed: number): Recipe => (c) => paintVehicle(c, color, seed);
const barrel = (color: [number, number, number], rust: number, kind: 'plain' | 'bio' | 'chem', seed: number): Recipe => (c) =>
  paintBarrel(c, { color, rust, kind, seed });

const RECIPES: Record<MaterialName, Recipe> = {
  asphalt: (c) => paintAsphalt(c, false),
  asphaltWet: (c) => paintAsphalt(c, true),
  sidewalk: paintSidewalk,
  concreteSlab: paintConcreteSlab,
  dirt: paintDirt,
  grass: paintGrass,
  gravel: paintGravel,
  rubble: paintRubble,
  concreteWall: (c) => paintConcreteWall(c, false),
  concreteDark: (c) => paintConcreteWall(c, true),
  brick: paintBrick,
  plaster: paintPlaster,
  corrugated: (c) => paintCorrugated(c, false),
  corrugatedRust: (c) => paintCorrugated(c, true),
  metalPanel: paintMetalPanel,
  oliveMetal: paintOliveMetal,
  tile: paintTile,
  labFloor: paintLabFloor,
  wood: paintWood,
  roof: paintRoof,
  floorWarehouse: paintFloorWarehouse,
  floorStore: paintFloorStore,
  steel: (c) => paintSteel(c, false),
  steelDark: (c) => paintSteel(c, true),
  rust: paintRust,
  rubber: paintRubber,
  grating: paintGrating,
  hazard: paintHazard,
  chainlink: paintChainlink,
  glass: (c) => paintGlass(c, false),
  glassDark: (c) => paintGlass(c, true),
  tire: paintTire,
  containerRed: container([122, 52, 44], 0.28, 0.35, 1),
  containerBlue: container([52, 76, 106], 0.24, 0.3, 2),
  containerGreen: container([62, 88, 64], 0.26, 0.3, 3),
  containerOlive: container([84, 90, 58], 0.2, 0.3, 4),
  containerRust: container([124, 72, 44], 0.85, 0.5, 5),
  containerWhite: container([178, 182, 184], 0.2, 0.55, 6),
  containerYellow: container([170, 136, 40], 0.3, 0.35, 7),
  paintOlive: paint([72, 82, 54], 1),
  paintWhite: paint([190, 194, 196], 2),
  paintBlue: paint([38, 68, 106], 3),
  paintRed: paint([120, 36, 34], 4),
  paintBlack: paint([26, 28, 30], 5),
  paintYellow: paint([178, 148, 42], 6),
  paintGrey: paint([106, 112, 118], 7),
  burnt: paintBurnt,
  canvasOlive: (c) => paintCanvas(c, false),
  canvasTan: (c) => paintCanvas(c, true),
  sandbag: paintSandbag,
  tarp: paintTarp,
  crateWood: paintCrateWood,
  crateMil: paintCrateMil,
  pallet: paintPallet,
  cardboard: paintCardboard,
  barrelBlue: barrel([44, 72, 114], 0.3, 'chem', 1),
  barrelRed: barrel([132, 42, 36], 0.3, 'chem', 2),
  barrelGreen: barrel([54, 90, 56], 0.3, 'plain', 3),
  barrelYellow: barrel([190, 154, 34], 0.3, 'plain', 4),
  barrelBio: barrel([198, 164, 34], 0.15, 'bio', 5),
  barrelRust: barrel([112, 66, 40], 0.95, 'plain', 6),
  labPanel: paintLabPanel,
  lampWarm: (c) => paintEmissive(c, 'lampWarm'),
  lampCool: (c) => paintEmissive(c, 'lampCool'),
  lampRed: (c) => paintEmissive(c, 'lampRed'),
  emGreen: (c) => paintEmissive(c, 'emGreen'),
  emBlue: (c) => paintEmissive(c, 'emBlue'),
  emAmber: (c) => paintEmissive(c, 'emAmber'),
  screen: (c) => paintEmissive(c, 'screen'),
  windowLit: (c) => paintEmissive(c, 'windowLit'),
};

export interface MaterialLibExtras {
  /** Milliseconds spent generating each material / decal so far (key = name; '(noise bank)' for the shared bank). */
  timings(): Record<string, number>;
  /** Generate the given materials (default: every material) ahead of time, e.g. behind a loading bar. */
  prewarm(names?: MaterialName[]): void;
}

export function createMaterialLib(): MaterialLib & MaterialLibExtras {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const timings: Record<string, number> = {};
  const tracked: THREE.Texture[] = [];
  const shared = new Map<string, THREE.Texture>();
  let ctx: PaintCtx | null = null;

  const getCtx = (): PaintCtx => {
    if (!ctx) {
      const t0 = performance.now();
      const bank = getBank();
      timings['(noise bank)'] = performance.now() - t0;
      ctx = {
        bank,
        shared,
        track: (t) => {
          tracked.push(t);
          return t;
        },
      };
    }
    return ctx;
  };

  const timed = (key: string, fn: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    const t0 = performance.now();
    const m = fn();
    m.name = key;
    timings[key] = performance.now() - t0;
    cache.set(key, m);
    return m;
  };

  const makeGlow = (size: number, stops: [number, string][]): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // soft round glow: gaussian-like power falloff
  const glow = makeGlow(128, [
    [0, 'rgba(255,255,255,1)'],
    [0.08, 'rgba(255,255,255,0.78)'],
    [0.2, 'rgba(255,255,255,0.38)'],
    [0.4, 'rgba(255,255,255,0.12)'],
    [0.7, 'rgba(255,255,255,0.025)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  // very smooth, broad warm-white pool for additive ground light
  const pool = makeGlow(128, [
    [0, 'rgba(255,238,205,1)'],
    [0.15, 'rgba(255,232,196,0.82)'],
    [0.35, 'rgba(255,224,182,0.46)'],
    [0.6, 'rgba(255,214,168,0.16)'],
    [0.85, 'rgba(255,208,160,0.03)'],
    [1, 'rgba(255,208,160,0)'],
  ]);

  return {
    get(name) {
      return cache.get(name) ?? timed(name, () => RECIPES[name](getCtx()));
    },
    decal(name) {
      const key = `decal:${name}`;
      return cache.get(key) ?? timed(key, () => paintDecal(getCtx(), name));
    },
    stencil(text, opts = {}) {
      const key = `stencil:${text}|${JSON.stringify(opts)}`;
      return cache.get(key) ?? timed(key, () => paintCustomStencil(getCtx(), text, opts));
    },
    glowTexture: glow,
    lightPoolTexture: pool,
    timings: () => ({ ...timings }),
    prewarm(names) {
      for (const n of names ?? MATERIAL_NAMES) this.get(n);
    },
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
      for (const t of tracked) t.dispose();
      tracked.length = 0;
      shared.clear();
      glow.dispose();
      pool.dispose();
      ctx = null;
      releaseBank();
      releaseCracks();
    },
  };
}
