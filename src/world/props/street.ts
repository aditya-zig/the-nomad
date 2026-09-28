/** Street furniture: lamps, signs, traffic lights, utility poles, cones, benches, shelters, hydrants. */
import * as THREE from 'three';
import { type LampSpec, type LevelBuilder } from '../builder';
import { lampIntensityMul } from '../../render/lightPool';
import type { Place } from './types';
import { GeoBuilder, Parts, cachedMat, collideLocal, placeMatrix, plainMat, rngFor, toWorld, stencil } from './util';

// ---------------------------------------------------------------------------------------------
// street lamps
// ---------------------------------------------------------------------------------------------

function lensMat(color: number, intensity: number): THREE.MeshStandardMaterial {
  return cachedMat(
    `lens:${color}:${intensity}`,
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.3), emissive: color, emissiveIntensity: intensity, roughness: 0.3 }),
  );
}

/** Street lamp: pole, arm, lamp head with emissive lens. Registers dynamic lamp(s) with glow + ground pool. `armDir` = yaw the arm points to (default: `rot`). */
export function streetLamp(
  b: LevelBuilder,
  o: Place & { style?: 'cobra' | 'double' | 'short'; on?: boolean; mode?: 'steady' | 'flicker' | 'fail'; color?: number; armDir?: number },
): void {
  const style = o.style ?? 'cobra';
  const on = o.on ?? true;
  const mode = o.mode ?? 'steady';
  const color = o.color ?? 0xffb45a;
  const rng = rngFor(o, 131);
  const p = new Parts(o);
  const steel = b.mats.get('steel');
  const dark = b.mats.get('steelDark');
  const base = b.mats.get('concreteDark');
  const armRel = (o.armDir ?? o.rot ?? 0) - (o.rot ?? 0);
  const ca = Math.cos(armRel);
  const sa = Math.sin(armRel);
  const H = style === 'short' ? 4.2 : 6.4;

  // lens material: shared for steady lamps, per-lamp clone (animated) for unstable ones
  const spec0 = { mode, phase: rng.range(0, 20), period: 1, duty: 1 } as LampSpec;
  const baseInt = on ? 2.6 : 0;
  const animated = on && mode !== 'steady';
  const lens: THREE.Material = !on
    ? b.mats.get('glassDark')
    : animated
      ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.3), emissive: color, emissiveIntensity: baseInt, roughness: 0.3 })
      : lensMat(color, baseInt);

  // pole
  p.cyl(base, 0.17, 0.2, 0.9, 8, 0, 0.45, 0);
  p.box(dark, 0.14, 0.32, 0.02, 0.0, 0.5, 0.185, { cast: false });
  p.cyl(steel, style === 'short' ? 0.055 : 0.075, style === 'short' ? 0.08 : 0.115, H - 0.8, 8, 0, 0.9 + (H - 0.8) / 2, 0);
  p.cyl(dark, 0.12, 0.12, 0.06, 8, 0, 0.92, 0);

  const armPt = (x: number, y: number, z: number): [number, number, number] => [x * ca + z * sa, y, -x * sa + z * ca];
  const lamps: { x: number; y: number; z: number }[] = [];

  const cobraArm = (dir: 1 | -1): void => {
    const pts: [number, number][] = [
      [0, H - 0.35],
      [0.18, H + 0.1],
      [0.65, H + 0.36],
      [1.25, H + 0.44],
      [1.75, H + 0.4],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = armPt(dir * pts[i]![0], pts[i]![1], 0);
      const c = armPt(dir * pts[i + 1]![0], pts[i + 1]![1], 0);
      p.tube(steel, a[0], a[1], a[2], c[0], c[1], c[2], 0.05, 6);
    }
    const hc = armPt(dir * 1.95, H + 0.33, 0);
    // lamp head: housing, visor, lens underside
    p.bevelBox(dark, 0.95, 0.15, 0.36, 0.05, hc[0], hc[1] + 0.06, hc[2], { ry: armRel + (dir < 0 ? Math.PI : 0) });
    p.box(dark, 0.3, 0.1, 0.22, ...armPt(dir * 1.5, H + 0.42, 0), { ry: armRel });
    p.box(lens, 0.72, 0.03, 0.28, hc[0], hc[1] - 0.03, hc[2], { ry: armRel + (dir < 0 ? Math.PI : 0), cast: false });
    lamps.push({ x: o.x, y: 0, z: 0 });
    const w = toWorld(o, hc[0], hc[2]);
    lamps[lamps.length - 1] = { x: w.x, y: (o.y ?? 0) + hc[1] - 0.1, z: w.z };
  };

  if (style === 'short') {
    p.cyl(dark, 0.2, 0.14, 0.12, 8, 0, H + 0.05, 0);
    p.cyl(lens, 0.17, 0.17, 0.42, 10, 0, H + 0.3, 0, 'y', { cast: false });
    p.cyl(dark, 0.06, 0.24, 0.16, 8, 0, H + 0.58, 0);
    const w = toWorld(o, 0, 0);
    lamps.push({ x: w.x, y: (o.y ?? 0) + H + 0.3, z: w.z });
  } else {
    cobraArm(1);
    if (style === 'double') cobraArm(-1);
  }
  p.flush(b);
  b.collide({ x: o.x, z: o.z, hx: 0.16, hz: 0.16, y0: o.y ?? 0, y1: (o.y ?? 0) + H, surface: 'metal', mapKind: 'prop', tag: 'lamp' });

  if (on) {
    const inten = style === 'short' ? 95 : style === 'double' ? 120 : rng.range(150, 200);
    for (const l of lamps) {
      const spec: LampSpec = {
        x: l.x,
        y: l.y,
        z: l.z,
        color,
        intensity: inten,
        distance: style === 'short' ? 16 : rng.range(22, 26),
        mode,
        phase: spec0.phase,
        weight: 1,
        glow: style === 'short' ? 0.9 : 1.6,
        pool: mode === 'fail' ? 0 : style === 'short' ? 4.5 : mode === 'flicker' ? 5.5 : 7,
      };
      b.light(spec);
      if (animated) {
        const m = lens as THREE.MeshStandardMaterial;
        b.tick((_dt, t) => {
          m.emissiveIntensity = baseInt * (0.06 + 0.94 * lampIntensityMul(spec, t));
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// signs
// ---------------------------------------------------------------------------------------------

const SIGN_STYLE = {
  warning: { bg: '#e2b91c', fg: '#15130c', w: 1.0, h: 0.75, font: 'sans' },
  info: { bg: '#1f4f8f', fg: '#f0f0ea', w: 1.1, h: 0.7, font: 'sans' },
  stop: { bg: '#a6151c', fg: '#f4f0e6', w: 0.8, h: 0.8, font: 'sans' },
  quarantine: { bg: '#ece8dc', fg: '#a3121a', w: 1.2, h: 0.85, font: 'stencil' },
  route: { bg: '#1d5d3a', fg: '#f2f2ea', w: 1.5, h: 0.75, font: 'sans' },
  depot: { bg: '#2c333b', fg: '#e6e1cf', w: 1.6, h: 0.9, font: 'stencil' },
} as const;

/** Road / warning sign on a pole with readable text. The sign face looks toward local +Z (rot = 0 faces south; rot = PI/2 faces east). */
export function roadSign(
  b: LevelBuilder,
  o: Place & { lines: string[]; kind?: 'warning' | 'info' | 'stop' | 'quarantine' | 'route' | 'depot'; poleHeight?: number },
): void {
  const kind = o.kind ?? 'warning';
  const st = SIGN_STYLE[kind];
  const H = o.poleHeight ?? 2.6;
  const p = new Parts(o);
  const steel = b.mats.get('steel');
  const dark = b.mats.get('steelDark');
  const text = kind === 'stop' && o.lines.length === 0 ? 'STOP' : o.lines.join('\n');
  const mat = stencil(b.mats, text, { color: st.fg, background: st.bg, aspect: st.w / st.h, font: st.font, worn: true });
  p.cyl(steel, 0.04, 0.045, H, 6, 0, H / 2, 0);
  const cy = H - st.h / 2 + 0.1;
  if (kind === 'stop') {
    p.geo(dark, new THREE.CircleGeometry(st.w / 2 + 0.015, 8), 0, cy, 0.033, { rz: Math.PI / 8, worldUV: false });
    p.geo(mat, new THREE.CircleGeometry(st.w / 2, 8), 0, cy, 0.046, { rz: Math.PI / 8, cast: false, worldUV: false });
  } else {
    p.bevelBox(dark, st.w + 0.04, st.h + 0.04, 0.03, 0.006, 0, cy, 0.0);
    p.plane(mat, st.w, st.h, 0, cy, 0.018, { cast: false });
    p.box(steel, 0.05, st.h * 0.8, 0.02, -st.w * 0.3, cy, -0.03);
  }
  p.box(steel, 0.08, 0.05, 0.06, 0, cy + st.h * 0.3, -0.045);
  p.box(steel, 0.08, 0.05, 0.06, 0, cy - st.h * 0.3, -0.045);
  p.flush(b);
  b.collide({ x: o.x, z: o.z, hx: 0.07, hz: 0.07, y0: o.y ?? 0, y1: (o.y ?? 0) + H, surface: 'metal', mapKind: 'prop', tag: 'sign' });
}

// ---------------------------------------------------------------------------------------------
// traffic light
// ---------------------------------------------------------------------------------------------

/** Signal on a pole with a mast arm reaching toward local +X. `dead` = dark, `red` = red lens lit (dim), `flash` = blinking amber. */
export function trafficLight(b: LevelBuilder, o: Place & { mode?: 'dead' | 'red' | 'flash' }): void {
  const mode = o.mode ?? 'dead';
  const p = new Parts(o);
  const steel = b.mats.get('steel');
  const dark = b.mats.get('steelDark');
  const yellow = plainMat(0x2b2b1e, 0.6, 0.3);
  const lensDark = b.mats.get('glassDark');
  const H = 5.0;
  p.cyl(steel, 0.09, 0.13, H, 8, 0, H / 2, 0);
  p.cyl(dark, 0.19, 0.19, 0.5, 8, 0, 0.25, 0);
  p.strut(steel, 0, H - 0.3, 0, 3.2, H + 0.15, 0, 0.09);
  p.strut(dark, 0, H - 1.0, 0, 1.6, H + 0.02, 0, 0.05);
  const head = (x: number, y: number, ry: number): void => {
    p.bevelBox(yellow, 0.34, 1.0, 0.3, 0.03, x, y, 0, { ry });
    for (let i = 0; i < 3; i++) {
      const ly = y + 0.32 - i * 0.32;
      const lx = x + Math.sin(ry) * 0.16;
      const lz = Math.cos(ry) * 0.16;
      const lit = (mode === 'red' && i === 0) || (mode === 'flash' && i === 1);
      const m = lit ? (mode === 'red' ? cachedMat('tl:red', () => new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0xff2010, emissiveIntensity: 0.9 })) : cachedMat('tl:amber', () => new THREE.MeshStandardMaterial({ color: 0x402808, emissive: 0xffa010, emissiveIntensity: 1.1 }))) : lensDark;
      p.cyl(m, 0.11, 0.11, 0.04, 10, lx, ly, lz, 'z', { ry, cast: false });
      p.box(dark, 0.3, 0.02, 0.2, x + Math.sin(ry) * 0.2, ly + 0.11, Math.cos(ry) * 0.2, { ry }); // visor
    }
  };
  head(2.6, H - 0.35, 0);
  head(1.0, H - 0.9, 0);
  p.flush(b);
  const w = toWorld(o, 2.6, 0.2);
  if (mode === 'red') b.glow({ x: w.x, y: (o.y ?? 0) + H + 0.0, z: w.z, color: 0xff2a1a, size: 0.55, intensity: 1.6 });
  if (mode === 'flash') b.glow({ x: w.x, y: (o.y ?? 0) + H - 0.35, z: w.z, color: 0xffa020, size: 0.6, intensity: 2, mode: 'blink', period: 1.1, duty: 0.5, phase: rngFor(o, 141).range(0, 5) });
  b.collide({ x: o.x, z: o.z, hx: 0.14, hz: 0.14, y0: o.y ?? 0, y1: (o.y ?? 0) + H, surface: 'metal', mapKind: 'prop', tag: 'signal' });
}

// ---------------------------------------------------------------------------------------------
// utility pole
// ---------------------------------------------------------------------------------------------

/** Wooden utility pole with crossarms and a transformer; optional sagging wires to other poles (assumed to share this pole's yaw); `leaning` radians of tilt toward local +X. */
export function utilityPole(b: LevelBuilder, o: Place & { wireTo?: { x: number; z: number }[]; leaning?: number }): void {
  const H = 9;
  const lean = o.leaning ?? 0;
  const wood = b.mats.get('wood');
  const steel = b.mats.get('steel');
  const dark = b.mats.get('steelDark');
  const insul = plainMat(0x8b93a0, 0.35, 0.2);
  const p = new Parts(o);
  const tilt = new THREE.Matrix4().makeRotationZ(-lean);
  p.setBase(placeMatrix(o).multiply(tilt));
  p.cyl(wood, 0.11, 0.17, H, 8, 0, H / 2, 0);
  const arms = [H - 0.4, H - 1.25];
  for (const y of arms) {
    p.box(wood, 0.12, 0.12, 2.1, 0, y, 0);
    p.strut(wood, 0, y - 0.6, 0.05, 0, y, 0.85, 0.05);
    p.strut(wood, 0, y - 0.6, -0.05, 0, y, -0.85, 0.05);
    for (const z of [-0.85, 0, 0.85]) p.cyl(insul, 0.035, 0.05, 0.16, 6, 0, y + 0.13, z, 'y');
  }
  p.cyl(dark, 0.27, 0.27, 0.75, 10, 0.32, H - 2.3, 0, 'y');
  p.cyl(steel, 0.2, 0.2, 0.06, 10, 0.32, H - 1.9, 0, 'y');
  p.cyl(dark, 0.03, 0.03, 0.4, 5, 0.32, H - 1.7, 0, 'y');
  p.flush(b);

  if (o.wireTo && o.wireTo.length > 0) {
    const wp = new Parts(o);
    const wire = b.mats.get('steelDark');
    const r = o.rot ?? 0;
    const c = Math.cos(r);
    const s = Math.sin(r);
    for (const t of o.wireTo) {
      const dx = t.x - o.x;
      const dz = t.z - o.z;
      const lx = c * dx - s * dz;
      const lz = s * dx + c * dz;
      const span = Math.hypot(lx, lz);
      for (const y of arms) {
        for (const az of [-0.85, 0, 0.85]) {
          const sx0 = Math.sin(lean) * (y + 0.13) * 1;
          const a: [number, number, number] = [sx0 * Math.cos(0), (y + 0.13) * Math.cos(lean), az];
          const e: [number, number, number] = [lx, y + 0.13, lz + az];
          const N = 8;
          const sag = 0.25 + span * 0.02;
          let prev = a;
          for (let i = 1; i <= N; i++) {
            const u = i / N;
            const pt: [number, number, number] = [a[0] + (e[0] - a[0]) * u, a[1] + (e[1] - a[1]) * u - 4 * sag * u * (1 - u), a[2] + (e[2] - a[2]) * u];
            wp.tube(wire, prev[0], prev[1], prev[2], pt[0], pt[1], pt[2], 0.012, 4, { cast: false });
            prev = pt;
          }
        }
      }
    }
    wp.flush(b);
  }
  b.collide({ x: o.x, z: o.z, hx: 0.15, hz: 0.15, y0: o.y ?? 0, y1: (o.y ?? 0) + H, surface: 'wood', mapKind: 'prop', tag: 'pole' });
}

// ---------------------------------------------------------------------------------------------
// cones
// ---------------------------------------------------------------------------------------------

let coneGeoCache: THREE.BufferGeometry | null = null;
function coneGeo(): THREE.BufferGeometry {
  if (coneGeoCache) return coneGeoCache;
  const g = new GeoBuilder();
  g.box(0.38, 0.035, 0.38, 0, 0.0175, 0, { color: 0x14161a });
  g.cyl(0.03, 0.13, 0.66, 10, 0, 0.365, 0, 'y', { color: 0xd8501c });
  g.cyl(0.072, 0.086, 0.09, 10, 0, 0.44, 0, 'y', { color: 0xe6e6de });
  g.cyl(0.092, 0.106, 0.09, 10, 0, 0.29, 0, 'y', { color: 0xe6e6de });
  coneGeoCache = g.build();
  return coneGeoCache;
}
const coneMat = (): THREE.MeshStandardMaterial => cachedMat('coneMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));

export function cone(b: LevelBuilder, o: Place & { fallen?: boolean }): void {
  const set = b.instanced('cone', coneGeo(), coneMat());
  if (!o.fallen) {
    set.add(o.x, o.y ?? 0, o.z, o.rot ?? 0);
  } else {
    const m = new THREE.Matrix4().makeRotationY(o.rot ?? 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.05));
    m.setPosition(o.x, (o.y ?? 0) + 0.15, o.z);
    set.addMatrix(m);
  }
}

export function cones(b: LevelBuilder, o: { x0: number; z0: number; x1: number; z1: number; spacing?: number }): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  const sp = o.spacing ?? 3;
  const n = Math.max(1, Math.floor(len / sp));
  const rng = rngFor({ x: o.x0, z: o.z0 }, 151);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    cone(b, { x: o.x0 + dx * t + rng.range(-0.15, 0.15), z: o.z0 + dz * t + rng.range(-0.15, 0.15), rot: rng.range(0, 6.28), fallen: rng.chance(0.12) });
  }
}

// ---------------------------------------------------------------------------------------------
// bench, bus shelter, hydrant
// ---------------------------------------------------------------------------------------------

/** Park bench (1.8 m long, seat facing local +Z). */
export function bench(b: LevelBuilder, o: Place): void {
  const p = new Parts(o);
  const wood = b.mats.get('wood');
  const iron = b.mats.get('steelDark');
  for (let i = 0; i < 4; i++) p.box(wood, 1.8, 0.04, 0.09, 0, 0.44, -0.18 + i * 0.115);
  for (let i = 0; i < 3; i++) p.box(wood, 1.8, 0.11, 0.035, 0, 0.66 + i * 0.14, -0.24, { rx: -0.12 });
  for (const sx of [-0.8, 0, 0.8]) {
    p.box(iron, 0.05, 0.44, 0.05, sx, 0.22, 0.14);
    p.box(iron, 0.05, 0.44, 0.05, sx, 0.22, -0.22);
    p.box(iron, 0.05, 0.5, 0.05, sx, 0.68, -0.26, { rx: -0.12 });
    p.box(iron, 0.05, 0.05, 0.4, sx, 0.4, -0.05);
  }
  p.flush(b);
  collideLocal(b, o, 0, -0.05, 1.8, 0.55, 0.5, { surface: 'wood', mapKind: 'prop', tag: 'bench' });
}

/** Bus shelter 3.2 x 1.4 m, open toward local +Z, with a backlit notice panel. */
export function busShelter(b: LevelBuilder, o: Place): void {
  const p = new Parts(o);
  const steel = b.mats.get('steelDark');
  const glass = b.mats.get('glassDark');
  const glassClear = b.mats.get('glass');
  const notice = stencil(b.mats, 'NOTICE\nSHELTER IN PLACE\nDO NOT APPROACH THE FENCE', { color: '#1b1b18', background: '#e6e0cc', aspect: 1.0, font: 'sans', worn: true });
  // frame posts, roof, back panels
  for (const sx of [-1.55, 1.55]) {
    p.box(steel, 0.08, 2.5, 0.08, sx, 1.25, -0.65);
    p.box(steel, 0.08, 2.5, 0.08, sx, 1.25, 0.65);
  }
  p.bevelBox(steel, 3.4, 0.1, 1.6, 0.03, 0, 2.55, 0.05);
  p.box(steel, 3.4, 0.16, 0.06, 0, 2.42, 0.8);
  for (let i = 0; i < 3; i++) {
    const x = -1.05 + i * 1.05;
    p.box(i === 1 ? glassClear : glass, 1.0, 2.0, 0.02, x, 1.25, -0.65, { cast: false });
  }
  for (const sx of [-1.55, 1.55]) p.box(glass, 0.02, 2.0, 1.2, sx, 1.25, 0);
  p.plane(notice, 0.9, 0.9, 1.05, 1.35, -0.62, { cast: false });
  // bench inside
  p.box(b.mats.get('wood'), 2.2, 0.05, 0.4, 0, 0.5, -0.4);
  p.box(steel, 0.05, 0.5, 0.35, -1.0, 0.25, -0.4);
  p.box(steel, 0.05, 0.5, 0.35, 1.0, 0.25, -0.4);
  p.flush(b);
  collideLocal(b, o, 0, -0.65, 3.2, 0.1, 2.4, { surface: 'glass', mapKind: 'prop', tag: 'shelter' });
  for (const sx of [-1, 1]) collideLocal(b, o, sx * 1.55, 0, 0.1, 1.3, 2.4, { surface: 'glass', mapKind: 'prop', tag: 'shelter' });
}

/** Fire hydrant (~0.75 m). */
export function hydrant(b: LevelBuilder, o: Place): void {
  const p = new Parts(o);
  const red = b.mats.get('paintRed');
  const dark = b.mats.get('steelDark');
  p.cyl(dark, 0.14, 0.15, 0.08, 8, 0, 0.04, 0);
  p.cyl(red, 0.1, 0.12, 0.5, 10, 0, 0.33, 0);
  p.sphere(red, 0.11, 10, 5, 0, 0.6, 0, { sy: 0.8 });
  p.cyl(dark, 0.04, 0.04, 0.05, 6, 0, 0.72, 0);
  for (const sg of [-1, 1]) {
    p.cyl(red, 0.055, 0.055, 0.14, 8, sg * 0.14, 0.4, 0, 'x');
    p.cyl(dark, 0.05, 0.05, 0.03, 8, sg * 0.22, 0.4, 0, 'x');
  }
  p.cyl(red, 0.05, 0.05, 0.12, 8, 0, 0.4, 0.12, 'z');
  p.flush(b);
  b.collide({ x: o.x, z: o.z, hx: 0.16, hz: 0.16, y0: o.y ?? 0, y1: (o.y ?? 0) + 0.75, surface: 'metal', mapKind: 'prop', tag: 'hydrant' });
}
