/**
 * First-person player controller: frame-rate independent movement with normalised diagonals, gravity, step-up,
 * jumping, crouch with ceiling clearance, sprint stamina, sliding collision against oriented boxes, footstep events.
 * Sub-steps the simulation so collision stays stable across frame rates.
 */
import { PLAYER, RENDER } from '../config';
import type { CollisionWorld } from '../world/collision';

export interface PlayerControl {
  /** -1..1 */
  forward: number;
  strafe: number;
  sprintHeld: boolean;
  jumpPressed: boolean;
  crouchPressed: boolean;
  /** 0..1 aim-down-sights blend (slows movement). */
  ads: number;
  /** Equipped weapon speed multiplier. */
  weaponMoveMul: number;
  /** Player is blocked from sprinting (firing, plate applying, ADS...). */
  noSprint: boolean;
  /** Frozen (cinematics): ignore movement input. */
  frozen: boolean;
}

export interface PlayerEvents {
  onStep?(strength: number, sprinting: boolean, crouching: boolean): void;
  onJump?(): void;
  onLand?(impact: number): void;
}

export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  /** Camera kick offsets in radians (visual + aim), decayed by the weapon system. */
  kickPitch = 0;
  kickYaw = 0;
  onGround = true;
  crouching = false;
  /** 0 standing .. 1 crouched (eye height blend). */
  crouchBlend = 0;
  stamina: number = PLAYER.maxStamina;
  staminaExhausted = false;
  sprinting = false;
  private staminaDelay = 0;
  /** Distance walked since the last footstep. */
  private stepAccum = 0;
  /** Radians advanced with walking; drives weapon bob. */
  bobPhase = 0;
  /** Smoothed horizontal speed / sprint speed (0..1). */
  moveAmount = 0;
  /** Camera y offset from stair stepping / landing (decays). */
  private stepOffset = 0;
  landing = 0;
  horizontalSpeed = 0;
  events: PlayerEvents = {};

  constructor(private readonly world: CollisionWorld) {}

  teleport(x: number, z: number, yaw?: number): void {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vx = this.vy = this.vz = 0;
    this.onGround = true;
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
    this.crouching = false;
    this.crouchBlend = 0;
    this.stepOffset = 0;
  }

  get height(): number {
    return this.crouching ? PLAYER.heightCrouch : PLAYER.heightStand;
  }

  get eyeHeight(): number {
    return PLAYER.eyeStand + (PLAYER.eyeCrouch - PLAYER.eyeStand) * this.crouchBlend;
  }

  /** Camera world position. */
  eyeY(): number {
    return this.y + this.eyeHeight + this.stepOffset;
  }

  /** Apply mouse look (radians). */
  look(dyaw: number, dpitch: number): void {
    this.yaw -= dyaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, this.pitch - dpitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  update(dt: number, c: PlayerControl): void {
    // a zero / invalid delta (first frame after resume) must not divide by zero or poison smoothed values with NaN
    if (!(dt > 1e-6)) return;
    const steps = Math.max(1, Math.ceil(dt / PLAYER.maxSubstep));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, c, i === 0);
    // smooth stair-step / landing offsets and crouch blend
    this.stepOffset += (0 - this.stepOffset) * Math.min(1, dt * 9);
    this.landing = Math.max(0, this.landing - dt * 4);
    const target = this.crouching ? 1 : 0;
    const dBlend = PLAYER.crouchTransition * dt / Math.max(0.3, PLAYER.eyeStand - PLAYER.eyeCrouch);
    if (this.crouchBlend < target) this.crouchBlend = Math.min(target, this.crouchBlend + dBlend);
    else if (this.crouchBlend > target) this.crouchBlend = Math.max(target, this.crouchBlend - dBlend);
    // bob amount smoothing
    const speedNorm = Math.min(1, this.horizontalSpeed / PLAYER.sprintSpeed);
    this.moveAmount += (speedNorm - this.moveAmount) * Math.min(1, dt * 8);
  }

  private step(dt: number, c: PlayerControl, first: boolean): void {
    // ---- crouch toggle ----
    if (first && c.crouchPressed && !c.frozen) {
      if (this.crouching) {
        if (this.canStand()) this.crouching = false;
      } else {
        this.crouching = true;
      }
    }

    // ---- wish direction (normalised diagonals) ----
    let fwd = c.frozen ? 0 : c.forward;
    let str = c.frozen ? 0 : c.strafe;
    const len = Math.hypot(fwd, str);
    if (len > 1) {
      fwd /= len;
      str /= len;
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward = (-sin, -cos); right = (cos, -sin)
    let wx = -sinY * fwd + cosY * str;
    let wz = -cosY * fwd - sinY * str;

    // ---- sprint / stamina ----
    const wantsSprint = c.sprintHeld && fwd > 0.1 && !c.noSprint && !this.crouching && !c.frozen;
    const canSprint = this.stamina > 0 && !this.staminaExhausted;
    this.sprinting = wantsSprint && canSprint && this.onGround;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      this.staminaDelay = PLAYER.staminaRegenDelay;
      if (this.stamina <= 0) this.staminaExhausted = true;
    } else {
      if (this.staminaDelay > 0) this.staminaDelay -= dt;
      else this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
      if (this.staminaExhausted && this.stamina >= PLAYER.staminaResumeAt) this.staminaExhausted = false;
    }

    let speed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    speed *= c.weaponMoveMul * (1 - (1 - PLAYER.adsSpeedMul) * c.ads);

    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 0.001) {
      wx /= wishLen;
      wz /= wishLen;
    }
    const targetVx = wishLen > 0.001 ? wx * speed : 0;
    const targetVz = wishLen > 0.001 ? wz * speed : 0;

    // ---- horizontal acceleration ----
    if (this.onGround) {
      if (wishLen > 0.001) {
        const ax = targetVx - this.vx;
        const az = targetVz - this.vz;
        const al = Math.hypot(ax, az);
        const maxD = PLAYER.groundAccel * dt;
        if (al > maxD) {
          this.vx += (ax / al) * maxD;
          this.vz += (az / al) * maxD;
        } else {
          this.vx = targetVx;
          this.vz = targetVz;
        }
      } else {
        const k = Math.max(0, 1 - PLAYER.groundFriction * dt);
        this.vx *= k;
        this.vz *= k;
        if (Math.hypot(this.vx, this.vz) < 0.05) this.vx = this.vz = 0;
      }
    } else if (wishLen > 0.001) {
      // limited air control
      const ax = targetVx - this.vx;
      const az = targetVz - this.vz;
      const al = Math.hypot(ax, az);
      const maxD = PLAYER.airAccel * dt;
      if (al > maxD) {
        this.vx += (ax / al) * maxD;
        this.vz += (az / al) * maxD;
      } else {
        this.vx = targetVx;
        this.vz = targetVz;
      }
    }

    // ---- jump ----
    if (first && c.jumpPressed && this.onGround && !c.frozen) {
      if (this.crouching && this.canStand()) this.crouching = false;
      if (!this.crouching) {
        this.vy = PLAYER.jumpSpeed;
        this.onGround = false;
        this.events.onJump?.();
      }
    }

    // ---- horizontal movement with sliding collision ----
    const ox = this.x;
    const oz = this.z;
    const body = this.height;
    const p = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
    const yMin = this.y + PLAYER.stepHeight;
    const yMax = this.y + body;
    const hit = this.world.resolveCircle(p, PLAYER.radius, yMin, yMax, 4);
    this.x = p.x;
    this.z = p.z;
    if (hit) {
      // keep velocity consistent with the resolved motion so we do not keep pushing into walls
      this.vx = (this.x - ox) / dt;
      this.vz = (this.z - oz) / dt;
      const sp = Math.hypot(this.vx, this.vz);
      const cap = Math.max(speed, 0.001) * 1.05;
      if (sp > cap) {
        this.vx *= cap / sp;
        this.vz *= cap / sp;
      }
    }
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.horizontalSpeed = dt > 1e-6 ? moved / dt : 0;

    // ---- vertical ----
    this.vy = Math.max(-PLAYER.terminalVelocity, this.vy - PLAYER.gravity * dt);
    let ny = this.y + this.vy * dt;
    const footR = PLAYER.radius * 0.92;
    const groundH = this.world.groundHeight(this.x, this.z, footR, this.y + PLAYER.stepHeight + 0.001);
    if (this.vy <= 0 && ny <= groundH + 0.0005) {
      const rise = groundH - this.y;
      if (rise > 0.03) this.stepOffset -= rise; // stair smoothing (camera lags behind the snap)
      const impact = -this.vy;
      if (!this.onGround && impact > 5) {
        this.events.onLand?.(impact);
        this.landing = Math.min(1, impact / 12);
      }
      ny = groundH;
      this.vy = 0;
      this.onGround = true;
    } else if (this.onGround && this.y - groundH <= 0.25 && this.vy <= 0) {
      // walking down a small drop keeps us grounded
      ny = groundH;
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    // ceiling
    const head = ny + body;
    const ceil = this.world.ceilingHeight(this.x, this.z, footR, this.y + body - 0.05);
    if (head > ceil) {
      ny = ceil - body;
      if (this.vy > 0) this.vy = 0;
    }
    this.y = ny;

    // ---- footsteps ----
    if (this.onGround && moved > 0.0005) {
      const stride = this.crouching ? 1.35 : this.sprinting ? 2.7 : 2.05;
      this.stepAccum += moved;
      this.bobPhase += (moved / stride) * Math.PI;
      if (this.stepAccum >= stride) {
        this.stepAccum -= stride;
        this.events.onStep?.(this.sprinting ? 1 : this.crouching ? 0.35 : 0.65, this.sprinting, this.crouching);
      }
    }
  }

  /** Can the player stand up from a crouch here? */
  canStand(): boolean {
    const ceil = this.world.ceilingHeight(this.x, this.z, PLAYER.radius * 0.92, this.y + PLAYER.heightCrouch - 0.05);
    return ceil >= this.y + PLAYER.heightStand + 0.01;
  }

  /** Safety: push out of any collider we somehow ended up inside (teleports, moving props). */
  unstick(): boolean {
    const p = { x: this.x, z: this.z };
    const moved = this.world.resolveCircle(p, PLAYER.radius, this.y + PLAYER.stepHeight, this.y + this.height, 6);
    if (moved) {
      this.x = p.x;
      this.z = p.z;
    }
    return moved;
  }
}

/** Convert mouse pixels to radians with sensitivity and FOV compensation. */
export function mouseToRadians(px: number, sensitivity: number, zoomScale: number): number {
  return px * RENDER.mouseRadPerPixel * sensitivity * zoomScale;
}
