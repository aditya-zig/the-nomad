/**
 * Extraction state machine (pure).
 *
 *  locked --(both contracts complete)--> available --(call at the LZ beacon)--> called
 *  called --(<= visibleAt s to touchdown)--> inbound --(<= landingDuration)--> landing --(touchdown)--> landed
 *  landed --(player boards: alive AND within boarding radius)--> boarding --(cinematic)--> extracted
 *  landed --(boarding window expires)--> failed        any --(fail)--> failed
 *
 * A timer expiring can NEVER produce `extracted`: boarding requires the living player to interact within range.
 */
import { MISSION } from '../config';

export type ExtractionPhase =
  | 'locked'
  | 'available'
  | 'called'
  | 'inbound'
  | 'landing'
  | 'landed'
  | 'boarding'
  | 'extracted'
  | 'failed';

export interface ExtractionState {
  phase: ExtractionPhase;
  /** Seconds until touchdown while called/inbound/landing. */
  countdown: number;
  /** Seconds left in the boarding window while landed. */
  windowLeft: number;
  /** Seconds left in the boarding cinematic. */
  boardLeft: number;
  /** Mission-elapsed time at which the extraction was called. */
  calledAt: number | null;
  failReason: string | null;
}

export type ExtractionEvent = 'heliVisible' | 'landingStart' | 'touchdown' | 'departed' | 'extracted';

export function createExtraction(): ExtractionState {
  return { phase: 'locked', countdown: 0, windowLeft: 0, boardLeft: 0, calledAt: null, failReason: null };
}

export function unlockExtraction(s: ExtractionState, contractsDone: boolean): boolean {
  if (s.phase === 'locked' && contractsDone) {
    s.phase = 'available';
    return true;
  }
  return false;
}

/** The extraction is underway (called ... boarding). */
export function extractionInProgress(s: ExtractionState): boolean {
  return s.phase === 'called' || s.phase === 'inbound' || s.phase === 'landing' || s.phase === 'landed' || s.phase === 'boarding';
}

export function canCall(s: ExtractionState, playerInLz: boolean, playerAlive: boolean): boolean {
  return s.phase === 'available' && playerInLz && playerAlive;
}

export function callExtraction(s: ExtractionState, elapsed: number, playerInLz: boolean, playerAlive: boolean): boolean {
  if (!canCall(s, playerInLz, playerAlive)) return false;
  s.phase = 'called';
  s.countdown = MISSION.extraction.countdown;
  s.calledAt = elapsed;
  return true;
}

export function updateExtraction(s: ExtractionState, dt: number): ExtractionEvent[] {
  const events: ExtractionEvent[] = [];
  const ex = MISSION.extraction;
  switch (s.phase) {
    case 'called':
    case 'inbound':
    case 'landing':
      s.countdown -= dt;
      if (s.phase === 'called' && s.countdown <= ex.visibleAt) {
        s.phase = 'inbound';
        events.push('heliVisible');
      }
      if (s.phase === 'inbound' && s.countdown <= ex.landingDuration) {
        s.phase = 'landing';
        events.push('landingStart');
      }
      if (s.phase === 'landing' && s.countdown <= 0) {
        s.countdown = 0;
        s.phase = 'landed';
        s.windowLeft = ex.boardingWindow;
        events.push('touchdown');
      }
      break;
    case 'landed':
      s.windowLeft -= dt;
      if (s.windowLeft <= 0) {
        s.windowLeft = 0;
        s.phase = 'failed';
        s.failReason = 'The helicopter departed without you';
        events.push('departed');
      }
      break;
    case 'boarding':
      s.boardLeft -= dt;
      if (s.boardLeft <= 0) {
        s.boardLeft = 0;
        s.phase = 'extracted';
        events.push('extracted');
      }
      break;
    default:
      break;
  }
  return events;
}

/** Boarding is only possible once the helicopter has landed, and only for a living player standing at the door. */
export function canBoard(s: ExtractionState, distanceToDoor: number, playerAlive: boolean): boolean {
  return s.phase === 'landed' && playerAlive && distanceToDoor <= MISSION.extraction.boardRadius;
}

export function boardHelicopter(s: ExtractionState, distanceToDoor: number, playerAlive: boolean): boolean {
  if (!canBoard(s, distanceToDoor, playerAlive)) return false;
  s.phase = 'boarding';
  s.boardLeft = MISSION.extraction.boardingCinematic;
  return true;
}

export function failExtraction(s: ExtractionState, reason: string): void {
  if (s.phase === 'extracted' || s.phase === 'failed') return;
  s.phase = 'failed';
  s.failReason = reason;
}
