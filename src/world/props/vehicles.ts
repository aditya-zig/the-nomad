/** `vehicle()` dispatcher. */
import type { LevelBuilder } from '../builder';
import type { PaintName, Place, VehicleKind } from './types';
import { ambulance, hatch, jeep, pickup, sedan, suv, van } from './cars';
import { apc, boxTruck, bus, semiCab, tanker, trailer } from './trucks';
import { makeCtx } from './vehicleKit';

const DEFAULT_PAINT: Record<VehicleKind, PaintName> = {
  sedan: 'grey',
  hatch: 'blue',
  suv: 'black',
  pickup: 'red',
  van: 'white',
  boxTruck: 'white',
  bus: 'yellow',
  apc: 'olive',
  jeep: 'olive',
  ambulance: 'white',
  tanker: 'grey',
  semiCab: 'red',
  trailer: 'white',
};

/**
 * Abandoned vehicle with believable proportions (sedan ~4.6 x 1.8 x 1.45 m, bus ~11 x 2.5 x 3.1 m, apc ~7 x 2.9 x 2.6 m ...).
 * Front toward local +X. `wrecked` = broken glass, flat tyres, dents, open doors; `burnt` = charred `burnt` material.
 * Collider: body boxes matching the visual silhouette.
 */
export function vehicle(
  b: LevelBuilder,
  o: Place & { kind: VehicleKind; paint?: PaintName; wrecked?: boolean; burnt?: boolean; doorsOpen?: boolean; seed?: number },
): void {
  const c = makeCtx(b, o, DEFAULT_PAINT[o.kind]);
  switch (o.kind) {
    case 'sedan':
      return sedan(c);
    case 'hatch':
      return hatch(c);
    case 'suv':
      return suv(c);
    case 'pickup':
      return pickup(c);
    case 'van':
      return van(c);
    case 'jeep':
      return jeep(c);
    case 'ambulance':
      return ambulance(c);
    case 'boxTruck':
      return boxTruck(c);
    case 'bus':
      return bus(c);
    case 'apc':
      return apc(c);
    case 'tanker':
      return tanker(c);
    case 'semiCab':
      return semiCab(c);
    case 'trailer':
      return trailer(c);
    default:
      return sedan(c);
  }
}
