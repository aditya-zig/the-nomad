/** Builds the HUD state and map overlays from the live game. */
import { PLAYER, REGIONS } from '../config';
import type { Zombie } from '../enemies/zombie';
import type { HudState, MapDynamic, MapMarker } from '../ui/hudTypes';
import type { GameCtx } from './ctx';
import type { InteractionOutput } from './interaction';
import type { MissionRuntime } from './missionRuntime';

export function buildHudState(ctx: GameCtx, mission: MissionRuntime, io: InteractionOutput, fps: number | null): HudState {
  const s = ctx.session;
  const inv = s.inv;
  const w = ctx.weapons;
  const region = ctx.playerRegion();
  const def = REGIONS[region];
  const cur = w.hudInfo(inv.activeSlot);
  const other = w.hudInfo(inv.activeSlot === 0 ? 1 : 0);
  const { timer, subTimer } = mission.timers();
  const boss = ctx.zombies.boss;
  const bossVisible = boss && boss.alive && s.hunt.identified && s.hunt.status === 'active';
  const spread = w.currentSpread();
  const lowAmmo = !!cur && cur.mag <= Math.max(2, Math.floor(cur.magSize * 0.25)) && !cur.reloading;
  const outOfAmmo = !!cur && cur.mag === 0 && cur.reserve === 0;
  const hp = s.vitals.health;
  return {
    nomad: s.nomad,
    health: s.vitals.health,
    maxHealth: PLAYER.maxHealth,
    armor: s.vitals.armor,
    maxArmor: PLAYER.maxArmor,
    plates: inv.plates,
    maxPlates: PLAYER.maxPlates,
    stamina: ctx.player.stamina / PLAYER.maxStamina,
    staminaExhausted: ctx.player.staminaExhausted,
    cash: inv.cash,
    grenades: inv.grenades,
    maxGrenades: 4,
    weapon: cur,
    otherWeapon: other,
    activeSlot: inv.activeSlot,
    region,
    regionName: def.name,
    regionColor: def.color,
    timer,
    subTimer,
    objectives: mission.objectives(),
    prompt: io.prompt,
    panel: io.panel,
    crosshair: {
      spread,
      ads: w.adsAmount > 0.5,
      hidden: !ctx.playerAlive() || ctx.player.sprinting || w.applyingPlate || (w.adsAmount > 0.5 && (cur?.id === 'rifle' || cur?.id === 'pistol')),
    },
    plateProgress: w.plateProgress,
    lowAmmo,
    outOfAmmo,
    hazard: {
      active: mission.hazardRadiusNow > 0,
      inside: mission.insideHazard,
      message: mission.hazardRadiusNow > 0 ? (mission.insideHazard ? 'TOXIC EXPOSURE - LEAVE THE ZONE' : 'CONTAMINATION SURGE - REACH EXTRACTION') : null,
    },
    boss: bossVisible ? { name: 'THE WARDEN', fraction: Math.max(0, boss!.hp / boss!.maxHp), enraged: boss!.enraged } : null,
    fps,
    compassYaw: ctx.player.yaw,
    vignette: hp < 40 ? Math.min(1, (40 - hp) / 40) : 0,
    toxic: mission.insideHazard ? 1 : 0,
  };
}

export function buildMapDynamic(ctx: GameCtx, mission: MissionRuntime, markers: MapMarker[]): MapDynamic {
  const p = ctx.player;
  const enemies: MapDynamic['enemies'] = [];
  for (const z of ctx.zombies.zombies as Zombie[]) {
    if (!z.alive || z.dormant) continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    if (dx * dx + dz * dz > 48 * 48) continue;
    enemies.push({ x: z.x, z: z.z, type: z.type, alerted: z.chasing });
  }
  mission.markers(markers);
  const h = ctx.level.data.hazardCenter;
  return {
    player: { x: p.x, z: p.z, yaw: p.yaw },
    enemies,
    markers,
    hazard: mission.hazardRadiusNow > 0 ? { x: h.x, z: h.z, radius: mission.hazardRadiusNow } : null,
  };
}
