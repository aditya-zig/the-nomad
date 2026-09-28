/**
 * PS-12 pump shotgun viewmodel: blued receiver, ghost-ring rear sight, bead/blade front sight, tube magazine, sliding
 * ribbed forend with action bars, side-saddle shells and a synthetic stock.
 *
 * Gun space: origin = centre of the ghost-ring aperture (sight point), +X right, +Y up, -Z forward (f = -z).
 * The bore axis sits YB below the origin.
 */
import * as THREE from 'three';
import type { ViewmodelPose } from '../viewmodelTypes';
import { MuzzleFlash } from './flash';
import { GloveHand, HAND_POSES, clonePose, lerpPose, type HandPose } from './hand';
import { PartBuilder } from './kit';
import { RigMaterials, type SharedTextures } from './materials';
import { Anchor, BaseRig, GunMotion, HandDriver, Target, sampleHandKeys, type GunTuning, type HandKey } from './rigBase';
import { bump, clamp01, damp, keys, smooth } from './util';

const YB = -0.049;
const Y = (yp: number): number => YB + yp;
const F = (f: number): number => -f;
const PUMP_STROKE = 0.088;
const PUMP_CYCLE_KEYS = [0, 0, 0.18, 0, 0.42, 1, 0.5, 1, 0.74, 0, 1, 0] as const;
const PUMP_PHASE_KEYS = [0, 0, 0.26, 0, 0.46, 1, 0.52, 1, 0.74, 0, 1, 0] as const;
const UV = { grip: 30, polymer: 26, olive: 12, metal: 9, blued: 9, steel: 9, rubber: 12, shellRed: 12 };

const TUNE: GunTuning = {
  hipPos: [0.152, -0.056, -0.45],
  hipRot: [0.04, 0.07, 0.03],
  adsPos: [0, 0, -0.32],
  adsRot: [0, 0, 0],
  sprintPos: [0.1, -0.065, -0.4],
  sprintRot: [-0.34, 0.6, 0.28],
  pivot: [0, YB, 0.2],
  bob: { y: 0.0075, x: 0.0085, roll: 0.022 },
  sway: { pos: 0.0046, rot: 0.0078 },
  kick: { z: 0.06, pitch: 0.15, yaw: 0.02, roll: 0.05, freq: 8, zeta: 0.5, adsMul: 0.62 },
};

export class ShotgunRig extends BaseRig {
  readonly id = 'shotgun' as const;
  private readonly motion = new GunMotion(TUNE);
  private readonly flash: MuzzleFlash;
  private readonly pump: THREE.Group;
  private readonly shell: THREE.Group;
  private readonly saddle: THREE.Group;
  private readonly rh: GloveHand;
  private readonly lh: GloveHand;
  private readonly rhDrv: HandDriver;
  private readonly lhDrv: HandDriver;
  private readonly aRH = new Anchor(0.0325, Y(-0.1), F(-0.205), -0.48, 0, -Math.PI / 2);
  private readonly aFore = new Anchor(-0.008, Y(-0.056), F(0.235), 0, -1.35, 0.4);
  private readonly aPort = new Anchor(-0.05, Y(-0.06), F(0.06), 0.15, -1.25, 0.9);
  private readonly aSaddle = new Anchor(-0.066, Y(0.012), F(-0.012), 0.1, -1.3, 0.9);
  private readonly aPortNear = new Anchor(-0.05, Y(-0.055), F(0.045), 0.15, -1.25, 0.9);
  private readonly aPortPush = new Anchor(-0.036, Y(-0.05), F(0.034), 0.15, -1.25, 0.9);
  private readonly aForeBack = new Anchor(0, 0, 0);
  private readonly tFore = new Target(this.aFore);
  private readonly tPort = new Target(this.aPort);
  private readonly tSaddle = new Target(this.aSaddle);
  private readonly tPortNear = new Target(this.aPortNear);
  private readonly tPortPush = new Target(this.aPortPush);
  private readonly tForeBack = new Target(this.aForeBack);
  private readonly tRest = new Target(null);
  private readonly keysStart: HandKey[];
  private readonly keysLoad: HandKey[];
  private readonly keysEnd: HandKey[];
  private readonly keysPump: HandKey[];
  private readonly outPos = new THREE.Vector3();
  private readonly outQuat = new THREE.Quaternion();
  private readonly outPose: HandPose = clonePose(HAND_POSES.cup);
  private readonly tmpPose: HandPose = clonePose(HAND_POSES.gripR);
  private readonly tmpM = new THREE.Matrix4();
  private lb = 0; // 0 = ready, 1 = canted for loading
  private lastAds = 0;
  private trig = 0;
  private readonly elbowR = new THREE.Vector3(0.28, -0.5, 0.3);
  private readonly elbowL = new THREE.Vector3(-0.4, -0.6, 0.3);

  constructor(tex: SharedTextures) {
    super(new RigMaterials(tex));
    const mats = this.mats;
    const mk = (k: string) => mats.get(k);

    // ---- receiver, barrel, tube, sights, stock (static) ----------------------------------------
    const body = new PartBuilder();
    buildBody(body);
    this.gun.add(body.build(mk, UV));
    this.disposables.push(body);

    // ---- pump forend + action bars (animated) --------------------------------------------------
    const pb = new PartBuilder();
    buildPump(pb);
    this.pump = pb.build(mk, UV);
    this.gun.add(this.pump);
    this.disposables.push(pb);

    // ---- side saddle shells (static) ---------------------------------------------------------
    const sd = new PartBuilder();
    buildSaddle(sd);
    this.saddle = sd.build(mk, UV);
    this.gun.add(this.saddle);
    this.disposables.push(sd);

    // ---- loose shell used during reload -----------------------------------------------------
    const sh = new PartBuilder();
    buildShell(sh, 0, 0, 0);
    this.shell = sh.build(mk, UV);
    this.shell.visible = false;
    this.disposables.push(sh);

    // ---- tier accents -----------------------------------------------------------------------
    const tA = new PartBuilder();
    const tB = new PartBuilder();
    buildAccents(tA, tB);
    const accA = tA.build(mk, UV);
    const accB = tB.build(mk, UV);
    this.gun.add(accA, accB);
    this.addTierPart(accA, 1);
    this.addTierPart(accB, 2);
    this.disposables.push(tA, tB);

    this.muzzle.position.set(0, YB, F(0.612));
    this.ejectPort.position.set(0.02, Y(0.014), F(-0.03));
    this.flash = new MuzzleFlash(mats.tex, 0.26, 0.42);
    this.muzzle.add(this.flash.group);
    this.disposables.push(this.flash);

    // ---- hands ----------------------------------------------------------------------------
    this.rh = new GloveHand({ side: 'right', seed: 23 }, mats);
    this.lh = new GloveHand({ side: 'left', watch: true, seed: 25 }, mats);
    this.root.add(this.rh.root, this.lh.root);
    this.lh.root.add(this.shell);
    this.shell.position.set(0.004, -0.028, -0.085);
    this.shell.rotation.set(0.0, 0.0, 1.45);
    this.disposables.push(this.rh, this.lh);
    this.rhDrv = new HandDriver(this.rh, this.elbowR);
    this.lhDrv = new HandDriver(this.lh, this.elbowL);

    this.aForeBack.pos.copy(this.aFore.pos);
    this.aForeBack.pos.z += PUMP_STROKE;
    this.aForeBack.quat.copy(this.aFore.quat);

    const K = (t: number, target: Target, pose: HandKey['pose']): HandKey => ({ t, target, pose });
    this.keysStart = [K(0, this.tFore, 'cup'), K(0.55, this.tPort, 'open'), K(1, this.tPort, 'open')];
    this.keysLoad = [
      K(0, this.tPort, 'open'),
      K(0.22, this.tSaddle, 'open'),
      K(0.3, this.tSaddle, 'pinch'),
      K(0.55, this.tPortNear, 'pinch'),
      K(0.72, this.tPortPush, 'pinch'),
      K(0.82, this.tPortPush, 'open'),
      K(1, this.tPort, 'open'),
    ];
    this.keysEnd = [K(0, this.tPort, 'open'), K(0.6, this.tFore, 'cup'), K(1, this.tFore, 'cup')];
    this.keysPump = [
      K(0, this.tRest, 'open'),
      K(0.18, this.tFore, 'cup'),
      K(0.26, this.tFore, 'cup'),
      K(0.46, this.tForeBack, 'cup'),
      K(0.52, this.tForeBack, 'cup'),
      K(0.74, this.tFore, 'cup'),
      K(0.86, this.tFore, 'cup'),
      K(1, this.tRest, 'open'),
    ];
    this.setTier(0);
  }

  onFire(tier: number, strength = 1): void {
    this.motion.kick(strength, this.lastAds);
    this.flash.trigger(tier, strength);
  }

  reset(): void {
    this.motion.reset();
    this.flash.reset();
    this.trig = 0;
    this.lb = 0;
    this.shell.visible = false;
  }

  update(pose: ViewmodelPose, dt: number): void {
    this.time = pose.time;
    const vis = pose.raise > 0.015;
    this.root.visible = vis;
    if (!vis) return;
    this.lastAds = pose.ads;
    const m = this.motion;
    m.compute(pose, dt);
    const d = m.out;
    const ph = pose.reloadPhase;
    const t = clamp01(pose.reloadT);

    // loading-cant blend: exact within start/end phases, held through load/pump, relaxed otherwise
    if (ph === 'shellStart') this.lb = smooth(t);
    else if (ph === 'shellLoad') this.lb = 1;
    else if (ph === 'shellEnd') this.lb = 1 - smooth(t);
    else if (ph !== 'pump') this.lb += (0 - this.lb) * damp(9, dt);
    const lb = this.lb;
    d.dRot.z += -0.78 * lb;
    d.dRot.x += 0.34 * lb;
    d.dRot.y += 0.24 * lb;
    d.dPos.x += -0.03 * lb;
    d.dPos.y += 0.05 * lb;
    d.dPos.z += 0.03 * lb;
    if (ph === 'shellLoad') {
      // small bump as the shell seats
      const push = bump(t, 0.68, 0.86);
      d.dPos.z += 0.008 * push;
      d.dRot.x -= 0.02 * push;
    }

    // pump: automatic after each shot (cycle) or driven by the pump reload phase
    let pumpU = keys(clamp01(pose.cycle), PUMP_CYCLE_KEYS);
    if (ph === 'pump') pumpU = keys(t, PUMP_PHASE_KEYS);
    if (pose.cycle >= 0.74 && ph !== 'pump') pumpU = 0;
    this.pump.position.z = pumpU * PUMP_STROKE;

    // trigger finger follows the shot
    const trigTarget = pose.cycle < 0.25 ? 1 : 0;
    this.trig += (trigTarget - this.trig) * (1 - Math.exp(-dt * 40));

    m.apply(this.gun);

    this.tFore.refresh(this.gun);
    this.tPort.refresh(this.gun);
    this.tSaddle.refresh(this.gun);
    this.tPortNear.refresh(this.gun);
    this.tPortPush.refresh(this.gun);
    this.tForeBack.refresh(this.gun);
    // blended rest target between forend and loading port
    this.tRest.pos.lerpVectors(this.tFore.pos, this.tPort.pos, lb);
    this.tRest.quat.copy(this.tFore.quat).slerp(this.tPort.quat, lb);

    lerpPose(HAND_POSES.gripR, HAND_POSES.gripRFire, this.trig, this.tmpPose);
    this.rh.setPose(this.tmpPose);
    this.rhDrv.place(this.gun, this.aRH);

    // left hand
    let shellVisible = false;
    if (ph === 'shellStart') {
      sampleHandKeys(this.keysStart, t, this.outPos, this.outQuat, this.outPose);
    } else if (ph === 'shellLoad') {
      sampleHandKeys(this.keysLoad, t, this.outPos, this.outQuat, this.outPose);
      shellVisible = t >= 0.28 && t < 0.8;
    } else if (ph === 'shellEnd') {
      sampleHandKeys(this.keysEnd, t, this.outPos, this.outQuat, this.outPose);
    } else if (ph === 'pump') {
      sampleHandKeys(this.keysPump, t, this.outPos, this.outQuat, this.outPose);
    } else {
      // resting on the (sliding) forend
      this.tmpM.copy(this.gun.matrix);
      this.outPos.copy(this.tFore.pos);
      this.outQuat.copy(this.tFore.quat);
      // follow the forend as it pumps: move along gun +Z
      this.tmpB.set(0, 0, pumpU * PUMP_STROKE).applyMatrix4(this.tmpM).sub(this.tmpV.setFromMatrixPosition(this.tmpM));
      this.outPos.add(this.tmpB);
      lerpPose(HAND_POSES.cup, HAND_POSES.cup, 0, this.outPose);
    }
    this.shell.visible = shellVisible;
    this.lh.setPose(this.outPose);
    this.lhDrv.placeFree(this.outPos, this.outQuat);

    this.flash.update(dt);
    this.mats.pulse(pose.time);
    this.root.updateMatrixWorld(true);
  }

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
}

// -------------------------------------------------------------------------------------------------
// Geometry
// -------------------------------------------------------------------------------------------------

function buildBody(b: PartBuilder): void {
  // receiver: extruded side profile in blued steel + top and bottom plates
  b.side(
    'blued',
    [[-0.135, 0.022], [0.1, 0.022], [0.108, 0.012], [0.108, -0.032], [0.02, -0.03], [-0.02, -0.036], [-0.135, -0.024]].map(([f, y]) => [f!, Y(y!)] as [number, number]),
    0.036,
    0,
    0.0022,
    0.6,
    0,
  );
  b.box('metal', 0.026, 0.0018, 0.2, 0, Y(0.0225), F(-0.02), 0.0006); // top flat
  // loading port (bottom), ejection port (right), carrier latch
  b.box('rubber', 0.02, 0.0022, 0.052, 0, Y(-0.0335), F(0.028), 0.0004);
  b.box('rubber', 0.0022, 0.012, 0.048, 0.0182, Y(0.008), F(-0.01), 0.0004);
  b.box('steel', 0.004, 0.008, 0.016, -0.019, Y(-0.02), F(0.055), 0.001);
  // trigger guard, trigger and cross-bolt safety
  b.box('blued', 0.012, 0.004, 0.09, 0, Y(-0.066), F(-0.03), 0.0015);
  b.box('blued', 0.012, 0.03, 0.005, 0, Y(-0.05), F(0.018), 0.0015);
  b.box('blued', 0.012, 0.03, 0.005, 0, Y(-0.05), F(-0.072), 0.0015);
  b.box('steel', 0.005, 0.02, 0.005, 0, Y(-0.05), F(-0.026), 0.001, { rx: 0.2 });
  b.cyl('red', 0.0042, 0.0042, 0.03, 0, Y(-0.038), F(-0.078), 'x', 10);
  // rear ghost-ring sight (origin = aperture centre): ring, stem and protective ears
  b.lathe('blued', [[0.0055, 0], [0.0085, 0], [0.0085, 0.0055], [0.0055, 0.0055]], 0, 0, 0.0028, 20);
  b.box('blued', 0.006, 0.016, 0.008, 0, -0.0135, F(0.0), 0.001);
  b.box('blued', 0.003, 0.014, 0.009, -0.0135, -0.012, F(0.0), 0.0006);
  b.box('blued', 0.003, 0.014, 0.009, 0.0135, -0.012, F(0.0), 0.0006);
  b.box('blued', 0.03, 0.004, 0.012, 0, -0.0245, F(0.0), 0.001);
  // barrel, vent rib, magazine tube, barrel band, muzzle
  b.cyl('blued', 0.0132, 0.0132, 0.5, 0, YB, F(0.353), 'z', 18);
  b.box('blued', 0.009, 0.0035, 0.46, 0, Y(0.0145), F(0.335), 0.0006);
  for (let i = 0; i < 11; i++) b.box('rubber', 0.006, 0.0022, 0.0055, 0, Y(0.0168), F(0.13 + i * 0.038), 0.0003);
  b.cyl('blued', 0.0122, 0.0122, 0.44, 0, Y(-0.0275), F(0.29), 'z', 16);
  b.cyl('steel', 0.0148, 0.0148, 0.014, 0, Y(-0.0275), F(0.517), 'z', 16); // mag cap
  b.box('blued', 0.03, 0.058, 0.014, 0, Y(-0.0135), F(0.5), 0.003); // barrel band
  b.box('blued', 0.013, 0.016, 0.026, 0, Y(0.0225), F(0.585), 0.0015); // sight ramp
  b.box('rubber', 0.0034, 0.022, 0.0048, 0, Y(0.0335), F(0.585), 0.0005); // front blade
  b.sphere('whiteDot', 0.0024, 0, Y(0.0448), F(0.585), 1, 1, 1, 8);
  b.cyl('steel', 0.0146, 0.0146, 0.006, 0, YB, F(0.606), 'z', 18); // muzzle crown
  // pistol-grip stock (tactical configuration): rear cap, angled grip with stipple, sling stud
  b.box('blued', 0.026, 0.018, 0.03, 0, Y(0.006), F(-0.15), 0.004);
  b.box('polymer', 0.03, 0.022, 0.03, 0, Y(-0.034), F(-0.14), 0.004);
  b.side(
    'grip',
    [[-0.118, -0.036], [-0.146, -0.04], [-0.17, -0.078], [-0.196, -0.136], [-0.186, -0.156], [-0.15, -0.16], [-0.132, -0.11], [-0.116, -0.06]].map(([f, y]) => [f!, Y(y!)] as [number, number]),
    0.034,
    0,
    0.0016,
    0.6,
    0,
  );
  b.box('rubber', 0.036, 0.008, 0.052, 0, Y(-0.16), F(-0.168), 0.002, { rx: 0.36 });
  b.torus('steel', 0.005, 0.0013, 0, Y(-0.02), F(-0.158), { ry: Math.PI / 2 }, 10);
}

function buildPump(b: PartBuilder): void {
  // forend body (grip material) with ribs, wrapped around the magazine tube
  b.box('grip', 0.046, 0.05, 0.19, 0, Y(-0.0265), F(0.265), 0.014);
  for (let i = 0; i < 9; i++) b.box('rubber', 0.0475, 0.0014, 0.0034, 0, Y(-0.0505), F(0.185 + i * 0.019), 0.0004);
  for (let i = 0; i < 9; i++) b.box('rubber', 0.0016, 0.0016, 0.0034, -0.0231, Y(-0.02) - (i % 2) * 0.0, F(0.185 + i * 0.019), 0.0004);
  // action bars (drawn into the receiver when pumped)
  b.box('steel', 0.004, 0.005, 0.2, -0.0125, Y(-0.011), F(0.17), 0.0008);
  b.box('steel', 0.004, 0.005, 0.2, 0.0125, Y(-0.011), F(0.17), 0.0008);
}

function buildSaddle(b: PartBuilder): void {
  // elastic shell carrier on the left of the receiver with four shells
  b.box('polymer', 0.004, 0.056, 0.078, -0.0205, Y(0.0), F(-0.02), 0.0012);
  for (let i = 0; i < 4; i++) {
    const zz = -0.02 - 0.0195 + (i % 2) * 0.039;
    const yy = 0.011 - Math.floor(i / 2) * 0.026;
    buildShell(b, -0.0325, Y(yy), F(zz - 0.0), true);
  }
}

/** Shotgun shell: red hull with brass head (axis along Z when `axisZ`, else along Y). */
function buildShell(b: PartBuilder, x: number, y: number, z: number, axisZ = false): void {
  if (axisZ) {
    b.cyl('shellRed', 0.0098, 0.0098, 0.052, x, y, z - 0.0, 'z', 12);
    b.cyl('brass', 0.0101, 0.0101, 0.014, x, y, z + 0.033, 'z', 12);
    b.cyl('steel', 0.0035, 0.0035, 0.0016, x, y, z + 0.0405, 'z', 8);
  } else {
    // loose shell: axis along local Y, brass head at -Y
    b.cyl('shellRed', 0.0098, 0.0098, 0.052, x, y + 0.002, z, 'y', 12);
    b.cyl('brass', 0.0101, 0.0101, 0.014, x, y - 0.031, z, 'y', 12);
    b.cyl('steel', 0.0035, 0.0035, 0.0016, x, y - 0.0385, z, 'y', 8);
  }
}

function buildAccents(a: PartBuilder, c: PartBuilder): void {
  // tier 1: amber inlays on the receiver and forend, amber ring on the barrel band
  a.box('accentA', 0.0012, 0.006, 0.09, -0.0186, Y(0.012), F(-0.02), 0.0004);
  a.box('accentA', 0.0012, 0.004, 0.11, -0.0236, Y(-0.036), F(0.265), 0.0004);
  a.box('accentA', 0.032, 0.0018, 0.0018, 0, Y(-0.0135), F(0.5075), 0.0004);
  // tier 2: cyan energy line on the rib, muzzle rings and tube
  c.box('accentB', 0.0024, 0.0014, 0.44, 0, Y(0.0185), F(0.335), 0.0004);
  c.cyl('accentB', 0.0136, 0.0136, 0.003, 0, YB, F(0.585), 'z', 18);
  c.cyl('accentB', 0.0136, 0.0136, 0.003, 0, YB, F(0.598), 'z', 18);
  c.box('accentB', 0.0012, 0.003, 0.2, -0.0125, Y(-0.0275), F(0.29), 0.0004);
  c.box('accentB', 0.0012, 0.032, 0.0016, -0.0186, Y(-0.006), F(0.09), 0.0004);
}

export function createShotgun(tex: SharedTextures): ShotgunRig {
  return new ShotgunRig(tex);
}
