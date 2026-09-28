/**
 * HUD / menu contract. The game builds a plain `HudState` + `MapDynamic` every frame (cheap object reuse is fine) and
 * pushes discrete `HudEvent`s; the UI layer (HTML/CSS + canvas maps) renders them. The UI never reads game internals.
 */
import type { BestRun, MissionStats, Region, Settings, WeaponId } from '../types';

export interface HudWeaponInfo {
  id: WeaponId;
  /** Full name, e.g. "KR-16 Assault Rifle". */
  name: string;
  /** Short name, e.g. "KR-16". */
  short: string;
  /** 0 base, 1 = MK II, 2 = MK III (upgraded weapons are shown with an accent). */
  tier: number;
  tierLabel: string;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  /** 0..1 reload progress. */
  reloadProgress: number;
  auto: boolean;
}

export interface HudObjective {
  id: string;
  title: string;
  /** Dynamic one-line status, e.g. "Reach the relay station (84 m)" or "Hold the area - 43%". */
  detail: string;
  state: 'locked' | 'available' | 'active' | 'complete' | 'failed';
  /** 0..1, or -1 when the objective has no progress meter. */
  progress: number;
  /** The objective the player is currently being guided to (highlighted; its marker is on the compass). */
  tracked: boolean;
  /** Distance to the objective marker in metres, or -1. */
  distance: number;
}

export interface HudPrompt {
  key: string; // e.g. 'E'
  text: string; // e.g. "Open supply cache"
  sub?: string; // e.g. "+ ammo, cash, plates"
  /** 0..1 fill for hold-to-use interactions, -1 for plain presses. */
  hold: number;
  tone: 'normal' | 'good' | 'warn' | 'danger';
}

export interface StationPanelItem {
  key: string; // '1'..'6'
  label: string;
  detail: string;
  cost: number;
  /** ok = purchasable; unaffordable = red cost; full = nothing to buy; owned/maxed = already have; unavailable = locked. */
  state: 'ok' | 'unaffordable' | 'full' | 'owned' | 'maxed' | 'unavailable';
  note?: string;
}

/** Number-key menu shown while standing at a buy / upgrade station (mouse is NOT used; gameplay continues). */
export interface StationPanel {
  title: string;
  subtitle: string;
  items: StationPanelItem[];
  hint: string;
}

export interface HudTimer {
  label: string;
  seconds: number;
  urgent: boolean;
}

export interface HudState {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  plates: number;
  maxPlates: number;
  /** 0..1 sprint stamina; `staminaExhausted` = cannot sprint yet. */
  stamina: number;
  staminaExhausted: boolean;
  cash: number;
  grenades: number;
  maxGrenades: number;

  weapon: HudWeaponInfo | null;
  /** The holstered weapon (small display), or null. */
  otherWeapon: HudWeaponInfo | null;
  /** 0 = primary slot (key 1), 1 = secondary slot (key 2). */
  activeSlot: 0 | 1;

  region: Region;
  regionName: string;
  regionColor: string;

  /** Main mission clock (top centre). */
  timer: HudTimer;
  /** Secondary clock: extraction ETA / boarding window / relay progress countdown. */
  subTimer: HudTimer | null;

  objectives: HudObjective[];
  prompt: HudPrompt | null;
  panel: StationPanel | null;

  crosshair: {
    /** Current spread cone half-angle in degrees (drives the crosshair gap). */
    spread: number;
    ads: boolean;
    /** Hide the crosshair (sprinting, reloading, using stations...). */
    hidden: boolean;
  };

  /** -1 when no armour plate is being applied, else 0..1. */
  plateProgress: number;
  lowAmmo: boolean;
  /** Player has no ammo at all for the equipped weapon. */
  outOfAmmo: boolean;

  hazard: {
    /** Contamination surge is underway. */
    active: boolean;
    /** Player is currently inside the toxic zone. */
    inside: boolean;
    /** e.g. "CONTAMINATION SURGE - REACH EXTRACTION". */
    message: string | null;
  };

  /** Elite target health bar. */
  boss: { name: string; fraction: number; enraged: boolean } | null;

  /** null when FPS display is off. */
  fps: number | null;

  /** Camera yaw in radians (compass). */
  compassYaw: number;
  /** 0..1 low-health / damage vignette strength. */
  vignette: number;
  /** 0..1 toxic overlay strength. */
  toxic: number;
}

export type HudEvent =
  | { type: 'hit'; head: boolean; kill: boolean }
  /** `angle` = direction the damage came from relative to the player's facing, radians: 0 = ahead, +PI/2 = right, PI = behind. Omit for all-around (toxin). */
  | { type: 'damage'; angle?: number; amount: number; toxic?: boolean }
  | { type: 'banner'; title: string; subtitle?: string; tone: 'info' | 'good' | 'warn' | 'danger'; duration?: number }
  /** Small log line, e.g. "+$160  Armored Infected" / "+1 ARMOR PLATE". */
  | { type: 'feed'; text: string; tone?: 'normal' | 'good' | 'warn' | 'danger' }
  /** Radio subtitle line. */
  | { type: 'radio'; speaker: string; text: string; duration?: number }
  | { type: 'flash'; color: string; strength: number }
  /** Cash gained/spent floating next to the cash counter. */
  | { type: 'cash'; amount: number };

export type MapMarkerKind =
  | 'objective'
  | 'buy'
  | 'upgrade'
  | 'crate'
  | 'lz'
  | 'start'
  | 'hunt'
  | 'helicopter'
  | 'transmitter'
  | 'gate'
  | 'landmark';

export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  x: number;
  z: number;
  label?: string;
  /** CSS colour override. */
  color?: string;
  /** World radius in metres: draw an area circle (defense zone, search area). */
  radius?: number;
  /** false hides the marker (e.g. opened crates). */
  visible: boolean;
  /** Also show on the compass bar. */
  compass?: boolean;
  /** Emphasise (pulse). */
  pulse?: boolean;
  /** Dim (completed / inactive). */
  dim?: boolean;
}

export type MapFootprintKind = 'building' | 'wall' | 'container' | 'vehicle' | 'prop' | 'fence' | 'tank';

export interface MapFootprint {
  x: number;
  z: number;
  /** Half extents along the local axes and yaw (same convention as colliders / THREE rotation.y). */
  hx: number;
  hz: number;
  rot: number;
  kind: MapFootprintKind;
}

/** Static level description used to render the minimap and tactical map (built once from the real level). */
export interface MapData {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Road rectangles (axis-aligned) with a display name for labelling. */
  roads: { x0: number; z0: number; x1: number; z1: number; name?: string }[];
  /** Threat region rectangles (checked in order; the first match wins; anything unmatched is 'low'). */
  regions: { region: Region; x0: number; z0: number; x1: number; z1: number }[];
  footprints: MapFootprint[];
  /** Place labels for the tactical map (e.g. "INSERTION", "DEPOT", "RESEARCH COMPOUND"). */
  labels: { text: string; x: number; z: number; size?: number }[];
}

export interface MapDynamic {
  player: { x: number; z: number; yaw: number };
  /** Nearby infected for the minimap "motion tracker" (only alerted ones are shown on the minimap). */
  enemies: { x: number; z: number; type: 'shambler' | 'runner' | 'armored' | 'warden'; alerted: boolean }[];
  markers: MapMarker[];
  /** Contamination zone (a filled circle: everything inside is toxic), or null before the surge. */
  hazard: { x: number; z: number; radius: number } | null;
}

export interface HudApi {
  /** Create DOM under `root` (idempotent). */
  mount(root: HTMLElement): void;
  setMapData(data: MapData): void;
  /** Per-frame update. Must diff internally and only touch changed DOM / canvas regions. */
  update(state: HudState, map: MapDynamic, dt: number): void;
  event(e: HudEvent): void;
  setVisible(visible: boolean): void;
  /** Toggle the full-screen tactical map (M). Returns whether it is now open. */
  toggleTacticalMap(force?: boolean): boolean;
  readonly tacticalMapOpen: boolean;
  /** Clear transient elements (feed, banners, hit markers, damage indicators). */
  reset(): void;
  dispose(): void;
}

export interface MenuCallbacks {
  /** Called synchronously from the click handler (a user gesture): the game requests pointer lock / starts audio here. */
  onDeploy(): void;
  /** Resume from pause / lost pointer lock (also inside a click handler). */
  onResume(): void;
  onRestart(): void;
  onQuitToTitle(): void;
  onSettingsChange(settings: Settings): void;
}

export interface MenusApi {
  mount(root: HTMLElement): void;
  /** Title screen over the live 3D scene (transparent background with gradient framing). */
  showTitle(best: BestRun | null): void;
  /** Pause menu: resume, settings, restart, quit to title, controls list. */
  showPause(): void;
  /** Small "click to resume" overlay after pointer lock was lost without an explicit pause. */
  showResumePrompt(reason: string): void;
  /** Victory / defeat results with real mission data. */
  showResults(stats: MissionStats, best: BestRun | null, isNewBest: boolean): void;
  showLoading(fraction: number, text: string): void;
  hideLoading(): void;
  showError(title: string, message: string, details?: string): void;
  hide(): void;
  setSettings(settings: Settings): void;
  readonly visible: boolean;
  dispose(): void;
}
