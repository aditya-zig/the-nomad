/** Shared prop types (re-exported from `../props`). */

export interface Place {
  x: number;
  z: number;
  rot?: number;
  y?: number;
}

export type ContainerColor = 'red' | 'blue' | 'green' | 'olive' | 'rust' | 'white' | 'yellow';
export type PaintName = 'olive' | 'white' | 'blue' | 'red' | 'black' | 'yellow' | 'grey';
export type BarrelColor = 'blue' | 'red' | 'green' | 'yellow' | 'bio' | 'rust';
export type VehicleKind =
  | 'sedan'
  | 'hatch'
  | 'suv'
  | 'pickup'
  | 'van'
  | 'boxTruck'
  | 'bus'
  | 'apc'
  | 'jeep'
  | 'ambulance'
  | 'tanker'
  | 'semiCab'
  | 'trailer';
