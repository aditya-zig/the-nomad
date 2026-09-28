/** Small inline SVG icon set (24x24 grid) and weapon silhouettes. All drawn with `currentColor`. */
import type { WeaponId } from '../types';
import { svgEl } from './dom';

export type IconName =
  | 'cross'
  | 'shield'
  | 'plate'
  | 'grenade'
  | 'lock'
  | 'check'
  | 'x'
  | 'diamond'
  | 'diamondHollow'
  | 'hazard'
  | 'target'
  | 'signal';

interface IconPart {
  d: string;
  mode: 'fill' | 'stroke';
}

const ICONS: Record<IconName, IconPart[]> = {
  cross: [{ d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z', mode: 'fill' }],
  shield: [{ d: 'M12 2 4 5v6c0 5.2 3.4 9.3 8 11 4.6-1.7 8-5.8 8-11V5z', mode: 'fill' }],
  plate: [{ d: 'M7.5 3h9L20 7v11l-3 3H7l-3-3V7z', mode: 'fill' }],
  grenade: [
    { d: 'M12 8.6a6.4 6.4 0 1 0 .001 0z', mode: 'fill' },
    { d: 'M10.4 3h3.2v4h-3.2z', mode: 'fill' },
    { d: 'M14 4.4 19.6 3l.6 1.7-5.6 1.7z', mode: 'fill' },
  ],
  lock: [{ d: 'M7 10V7a5 5 0 0 1 10 0v3h1.5v11h-13V10zm2.2 0h5.6V7a2.8 2.8 0 0 0-5.6 0z', mode: 'fill' }],
  check: [{ d: 'M4.5 12.5l5 5L20 6.5', mode: 'stroke' }],
  x: [{ d: 'M5.5 5.5l13 13M18.5 5.5l-13 13', mode: 'stroke' }],
  diamond: [{ d: 'M12 2.5l9.5 9.5-9.5 9.5L2.5 12z', mode: 'fill' }],
  diamondHollow: [{ d: 'M12 3.5l8.5 8.5-8.5 8.5L3.5 12z', mode: 'stroke' }],
  hazard: [
    { d: 'M12 3.2 21.6 20H2.4z', mode: 'stroke' },
    { d: 'M12 9.5v5.2M12 17.2v.1', mode: 'stroke' },
  ],
  target: [
    { d: 'M12 4.5a7.5 7.5 0 1 0 .001 0z', mode: 'stroke' },
    { d: 'M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4', mode: 'stroke' },
    { d: 'M12 10.6a1.4 1.4 0 1 0 .001 0z', mode: 'fill' },
  ],
  signal: [
    { d: 'M4 20V15M9 20V11M14 20V7M19 20V3', mode: 'stroke' },
  ],
};

export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: `ds-ic ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  for (const part of ICONS[name]) {
    const p = svgEl('path', { d: part.d }, svg);
    if (part.mode === 'fill') {
      p.setAttribute('fill', 'currentColor');
    } else {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
    }
  }
  return svg;
}

/** Simple side-on weapon silhouettes (muzzle to the right), viewBox 0 0 160 50. */
const WEAPON_PATHS: Record<WeaponId, string[]> = {
  rifle: [
    // stock + buffer tube
    'M4 21 30 19 34 30 9 36z',
    // receiver
    'M30 17h50v13H30z',
    // rail + optic
    'M42 11h26v5H42zM46 8h18v3H46z',
    // handguard
    'M80 19h44v9H80z',
    // barrel + muzzle device
    'M124 21h20v5h-20zM144 19h12v9h-12z',
    // pistol grip
    'M50 30h11l-4 15H46z',
    // magazine
    'M64 30h11l-1 17H61z',
    // front sight
    'M112 14h3v5h-3z',
  ],
  pistol: [
    // slide
    'M14 10h70v13H14z',
    // barrel tip / muzzle
    'M84 12h8v9h-8z',
    // sights
    'M18 7h5v3h-5zM78 7h4v3h-4z',
    // frame and trigger guard
    'M14 23h50l-6 8H34v-8z',
    // grip
    'M14 23h22l-7 24H8z',
  ],
  shotgun: [
    // stock
    'M3 20 34 18 38 30 8 38z',
    // receiver
    'M34 16h42v14H34z',
    // barrel
    'M76 17h78v5H76z',
    // magazine tube
    'M76 24h68v4H76z',
    // pump forend
    'M96 23h30v9H96z',
    // trigger guard + grip
    'M44 30h14l-2 6H46zM38 30h8l-4 12h-8z',
    // bead sight
    'M148 13h4v4h-4z',
  ],
};

export function weaponSilhouette(id: WeaponId, cls = ''): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 160 50', class: `ds-wsil ${cls}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  for (const d of WEAPON_PATHS[id]) svgEl('path', { d, fill: 'currentColor' }, svg);
  return svg;
}
