/** Mission clock, escalation phases and the contamination front (pure). */
import { MISSION } from '../config';

/** 0 before the first escalation threshold, then 1..3. */
export function escalationPhase(elapsed: number): number {
  let p = 0;
  for (const t of MISSION.phases) if (elapsed >= t) p++;
  return p;
}

/** Elapsed time at which the contamination surge begins. Calling extraction early starts it early. */
export function surgeStartTime(calledAt: number | null): number {
  return calledAt === null ? MISSION.surgeStart : Math.min(MISSION.surgeStart, calledAt);
}

export function surgeActive(elapsed: number, calledAt: number | null): boolean {
  return elapsed >= surgeStartTime(calledAt);
}

/**
 * Radius of the toxic zone around the contamination source, or 0 before the surge.
 * The front reaches the LZ exactly at the mission deadline; once an extraction is underway it stalls short of the LZ.
 */
export function hazardRadius(elapsed: number, calledAt: number | null, extractionActive: boolean, distanceToLz: number): number {
  const start = surgeStartTime(calledAt);
  if (elapsed < start) return 0;
  const span = Math.max(1, MISSION.deadline - start);
  const p = Math.min(1, (elapsed - start) / span);
  const r0 = MISSION.hazard.startRadius;
  const rEnd = distanceToLz + 8;
  let r = r0 + (rEnd - r0) * Math.pow(p, 1.25);
  if (extractionActive) r = Math.min(r, distanceToLz - MISSION.hazard.lzStandoff);
  return Math.max(r0, r);
}

export function isInsideHazard(x: number, z: number, cx: number, cz: number, radius: number): boolean {
  if (radius <= 0) return false;
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < radius * radius;
}

/** Seconds left before the district is sealed (last chance to call extraction). */
export function deadlineRemaining(elapsed: number): number {
  return Math.max(0, MISSION.deadline - elapsed);
}
