/**
 * VX-9 service pistol viewmodel: polymer frame, steel slide with serrations, 3-dot sights, two-handed grip.
 *
 * Gun space: origin = centre of the rear sight notch (sight point), +X right, +Y up, -Z forward (f = -z).
 * The slide, sights and slide serrations are one animated group that cycles back on each shot.
 */
import * as THREE from 'three';
import type { ViewmodelPose } from '../viewmodelTypes';
import { MuzzleFlash } from './flash';
import { GloveHand, HAND_POSES, clonePose, lerpPose, type HandPose } from './hand';
import { PartBuilder } from './kit';
import { MagReloader } from './magReload';
import { RigMaterials, type SharedTextures } from './materials';
import { Anchor, BaseRig, GunMotion, HandDriver, Target, type GunTuning, type HandKey } from './rigBase';
import { bump, clamp01, keys, smooth } from './util';

const F = (f: number): number => -f;
const BORE = -0.0255;
const SLIDE_STROKE = 0.031;
const UV = { grip: 34, polymer: 26, steel: 9, blued: 9, metal: 9, rubber: 14 };

const TUNE: GunTuning = {
  hipPos: [0.112, -0.078, -0.36],
  hipRot: [0.08, 0.06, 0.0],
  adsPos: [0, 0, -0.42],
  adsRot: [0, 0, 0],
  sprintPos: [0.07, -0.115, -0.36],
  sprintRot: [-0.4, 0.66, 0.36],
  pivot: [0, -0.09, 0.1],
  bob: { y: 0.007, x: 0.008, roll: 0.022 },
  sway: { pos: 0.0046, rot: 0.008 },
  kick: { z: 0.03, pitch: 0.08, yaw: 0.012, roll: 0.03, freq: 12, zeta: 0.52, adsMul: 0.6 },
};

const TILT_KEYS = [0, 0, 0.1, 1, 0.55, 0.85, 0.8, 0.3, 1, 0] as const;

// mag axis (down and back along the grip)
const MAG_DIR = new THREE.Vector3(0, -0.951, 0.31).normalize();
const MAG_TILT = -0.309;

export class PistolRig extends BaseRig {
  readonly id = 'pistol' as const;
  private readonly motion = new GunMotion(TUNE);
  private readonly flash: MuzzleFlash;
  private readonly slide: THREE.Group;
  private readonly trigger: THREE.Group;
  private readonly magGroup: THREE.Group;
  private readonly dropMag: THREE.Group;
  private readonly rh: GloveHand;
  private readonly lh: GloveHand;
  private readonly rhDrv: HandDriver;
  private readonly lhDrv: HandDriver;
  private readonly aRH = new Anchor(0.0335, -0.07, F(-0.056), -0.3, 0, -Math.PI / 2);
  private readonly aLH = new Anchor(-0.0345, -0.102, F(-0.064), -0.3, 0, Math.PI / 2);
  private readonly aGrab = new Anchor(-0.05, -0.178, F(-0.05), -0.5, 0.2, Math.PI / 2);
  private readonly aOut = new Anchor(0, 0, 0);
  private readonly aReady = new Anchor(0, 0, 0);
  private readonly aSlap = new Anchor(0, 0, 0);
  private readonly aSlide = new Anchor(-0.04, -0.02, F(-0.062), 0, 0.1, Math.PI / 2);
  private readonly aSlideBack = new Anchor(-0.04, -0.02, F(-0.098), 0, 0.1, Math.PI / 2);
  private readonly tRH = new Target(this.aRH);
  private readonly tLH = new Target(this.aLH);
  private readonly tGrab = new Target(this.aGrab);
  private readonly tOut = new Target(this.aOut);
  private readonly tReady = new Target(this.aReady);
  private readonly tSlap = new Target(this.aSlap);
  private readonly tSlide = new Target(this.aSlide);
  private readonly tSlideBack = new Target(this.aSlideBack);
  private readonly tPouch = new Target(null, -0.14, -0.42, -0.3, 0, 0, Math.PI / 2);
  private readonly tPouch2 = new Target(null, -0.11, -0.4, -0.27, 0, 0, Math.PI / 2);
  private readonly reloader: MagReloader;
  private readonly tmpPose: HandPose = clonePose(HAND_POSES.gripR);
  private readonly magInHand = new THREE.Matrix4();
  private lastAds = 0;
  private trig = 0;
  private readonly elbowR = new THREE.Vector3(0.22, -0.4, 0.3);
  private readonly elbowL = new THREE.Vector3(-0.22, -0.42, 0.3);

  constructor(tex: SharedTextures) {
    super(new RigMaterials(tex));
    const mats = this.mats;
    const mk = (k: string) => mats.get(k);

    // ---- frame (static) ----------------------------------------------------------------------
    const fr = new PartBuilder();
    buildFrame(fr);
    this.gun.add(fr.build(mk, UV));
    this.disposables.push(fr);

    // ---- slide group (cycles) --------------------------------------------------------------
    const sl = new PartBuilder();
    buildSlide(sl);
    this.slide = sl.build(mk, UV);
    this.gun.add(this.slide);
    this.disposables.push(sl);

    // ---- trigger ---------------------------------------------------------------------------
    const tr = new PartBuilder();
    tr.box('steel', 0.006, 0.019, 0.005, 0, 0, 0, 0.001);
    this.trigger = tr.build(mk, UV);
    this.trigger.position.set(0, -0.056, F(0.046));
    this.gun.add(this.trigger);
    this.disposables.push(tr);

    // ---- magazine --------------------------------------------------------------------------
    const mg = new PartBuilder();
    buildMag(mg);
    this.magGroup = mg.build(mk, UV);
    this.gun.add(this.magGroup);
    this.disposables.push(mg);
    this.dropMag = this.magGroup.clone(true);
    this.dropMag.visible = false;
    this.root.add(this.dropMag);
    const seat = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.092, F(-0.004)), new THREE.Quaternion().setFromEuler(new THREE.Euler(MAG_TILT, 0, 0)), new THREE.Vector3(1, 1, 1));
    this.magGroup.matrixAutoUpdate = false;
    this.magGroup.matrix.copy(seat);

    // ---- tier accents ----------------------------------------------------------------------
    const tA = new PartBuilder();
    const tB = new PartBuilder();
    buildAccents(tA, tB);
    const accA = tA.build(mk, UV);
    const accB = tB.build(mk, UV);
    this.gun.add(accA, accB);
    this.addTierPart(accA, 1);
    this.addTierPart(accB, 2);
    this.disposables.push(tA, tB);

    this.muzzle.position.set(0, BORE, F(0.18));
    this.ejectPort.position.set(0.014, -0.02, F(0.03));
    this.flash = new MuzzleFlash(mats.tex, 0.15, 0.22);
    this.muzzle.add(this.flash.group);
    this.disposables.push(this.flash);

    // ---- hands -----------------------------------------------------------------------------
    this.rh = new GloveHand({ side: 'right', seed: 13 }, mats);
    this.lh = new GloveHand({ side: 'left', watch: true, seed: 15 }, mats);
    this.root.add(this.rh.root, this.lh.root);
    this.disposables.push(this.rh, this.lh);
    this.rhDrv = new HandDriver(this.rh, this.elbowR);
    this.lhDrv = new HandDriver(this.lh, this.elbowL);

    // reload anchors derive from the grab anchor along the mag axis
    const shift = (a: Anchor, d: number) => {
      a.pos.copy(this.aGrab.pos).addScaledVector(MAG_DIR, d);
      a.quat.copy(this.aGrab.quat);
    };
    shift(this.aOut, 0.105);
    shift(this.aReady, 0.09);
    shift(this.aSlap, -0.007);
    const grabM = new THREE.Matrix4().compose(this.aGrab.pos, this.aGrab.quat, new THREE.Vector3(1, 1, 1));
    this.magInHand.copy(grabM).invert().multiply(seat);

    const K = (t: number, target: Target, pose: HandKey['pose']): HandKey => ({ t, target, pose });
    const common = [
      K(0.0, this.tLH, 'grip'),
      K(0.09, this.tGrab, 'hold'),
      K(0.18, this.tOut, 'hold'),
      K(0.23, this.tOut, 'open'),
      K(0.32, this.tPouch, 'open'),
      K(0.39, this.tPouch2, 'hold'),
      K(0.49, this.tReady, 'hold'),
      K(0.65, this.tGrab, 'hold'),
      K(0.71, this.tSlap, 'hold'),
      K(0.77, this.tGrab, 'hold'),
    ];
    const keysTactical: HandKey[] = [...common, K(0.9, this.tLH, 'grip'), K(1.0, this.tLH, 'grip')];
    const keysEmpty: HandKey[] = [
      ...common,
      K(0.83, this.tSlide, 'pinch'),
      K(0.87, this.tSlideBack, 'pinch'),
      K(0.91, this.tSlide, 'pinch'),
      K(0.98, this.tLH, 'grip'),
      K(1.0, this.tLH, 'grip'),
    ];
    this.reloader = new MagReloader({
      root: this.root,
      gun: this.gun,
      hand: this.lh,
      driver: this.lhDrv,
      mag: this.magGroup,
      dropMag: this.dropMag,
      magInHand: this.magInHand,
      seat,
      tossTarget: this.tOut,
      keysTactical,
      keysEmpty,
      holdWindows: [
        [0.09, 0.23],
        [0.39, 0.65],
      ],
      hiddenWindow: [0.23, 0.39],
      fallWindow: [0.23, 0.44],
      fallVel: [-0.1, 0.1, 0.06],
      fallGravity: 4.6,
      fallScale: 1.5,
    });
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
    this.reloader.reset();
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

    const reloading = pose.reloadPhase === 'mag';
    const t = reloading ? clamp01(pose.reloadT) : 0;

    // slide cycle: blow back fast, return slower; held open when dry
    const c = clamp01(pose.cycle);
    let slide = c < 0.14 ? smooth(c / 0.14) : 1 - smooth((c - 0.14) / 0.42);
    if (c >= 0.56) slide = 0;
    const dry = reloading ? pose.reloadEmpty : pose.ammo <= 0;
    if (dry) {
      if (reloading) slide = Math.max(slide, t < 0.88 ? 1 : 1 - smooth((t - 0.9) / 0.05));
      else slide = 1;
    }
    this.slide.position.z = slide * SLIDE_STROKE;

    // trigger pull follows the shot
    const trigTarget = c < 0.3 ? 1 : 0;
    this.trig += (trigTarget - this.trig) * (1 - Math.exp(-dt * 45));
    this.trigger.rotation.x = -0.32 * this.trig;

    if (reloading) {
      const tilt = keys(t, TILT_KEYS);
      d.dRot.z += -0.3 * tilt;
      d.dRot.x += 0.14 * tilt;
      d.dRot.y += 0.12 * tilt;
      d.dPos.x -= 0.04 * tilt;
      d.dPos.y += 0.05 * tilt;
      const seat = bump(t, 0.64, 0.76);
      d.dPos.z += 0.01 * seat;
      d.dRot.x -= 0.05 * seat;
    }
    const trem = 1 - clamp01(pose.cycle * 2.5);
    d.dRot.z += Math.sin(pose.time * 90) * 0.005 * trem;

    m.apply(this.gun);

    this.tRH.refresh(this.gun);
    this.tLH.refresh(this.gun);
    this.tGrab.refresh(this.gun);
    this.tOut.refresh(this.gun);
    this.tReady.refresh(this.gun);
    this.tSlap.refresh(this.gun);
    this.tSlide.refresh(this.gun);
    this.tSlideBack.refresh(this.gun);

    lerpPose(HAND_POSES.gripR, HAND_POSES.gripRFire, this.trig, this.tmpPose);
    this.rh.setPose(this.tmpPose);
    this.rhDrv.place(this.gun, this.aRH);

    if (reloading) {
      this.reloader.update(t, pose.reloadEmpty);
    } else {
      this.reloader.idle();
      this.lh.setPose(HAND_POSES.grip);
      this.lhDrv.place(this.gun, this.aLH);
    }

    this.flash.update(dt);
    this.mats.pulse(pose.time);
    this.root.updateMatrixWorld(true);
  }
}

// -------------------------------------------------------------------------------------------------
// Geometry
// -------------------------------------------------------------------------------------------------

function buildSlide(b: PartBuilder): void {
  // slide body
  b.box('blued', 0.0262, 0.028, 0.194, 0, -0.024, F(0.073), 0.0028);
  // top flat + chamfers read as a lighter strip
  b.box('metal', 0.016, 0.0016, 0.19, 0, -0.0098, F(0.073), 0.0004);
  // serrations (rear and front) on both flanks
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      b.box('rubber', 0.0018, 0.019, 0.0018, sx * 0.0133, -0.0225, F(-0.017 + i * 0.0038), 0.0003);
    }
    for (let i = 0; i < 5; i++) {
      b.box('rubber', 0.0018, 0.019, 0.0018, sx * 0.0133, -0.0225, F(0.132 + i * 0.0038), 0.0003);
    }
  }
  // ejection port (dark slot on the top-right)
  b.box('blued', 0.011, 0.0018, 0.036, 0.0055, -0.0092, F(0.052), 0.0004);
  // rear sight: two posts + notch floor, with dots
  b.box('rubber', 0.0042, 0.0135, 0.007, -0.0047, -0.0033, F(0.0), 0.0006);
  b.box('rubber', 0.0042, 0.0135, 0.007, 0.0047, -0.0033, F(0.0), 0.0006);
  b.box('rubber', 0.0055, 0.0065, 0.007, 0, -0.0067, F(0.0), 0.0006);
  b.cyl('whiteDot', 0.0013, 0.0013, 0.0008, -0.0047, 0.0008, F(-0.0038), 'z', 8);
  b.cyl('whiteDot', 0.0013, 0.0013, 0.0008, 0.0047, 0.0008, F(-0.0038), 'z', 8);
  // front sight post + dot
  b.box('rubber', 0.0034, 0.0102, 0.0065, 0, -0.0049, F(0.158), 0.0006);
  b.cyl('whiteDot', 0.0015, 0.0015, 0.0008, 0, -0.0035, F(0.1545), 'z', 8);
  // muzzle opening ring
  b.cyl('blued', 0.0088, 0.0088, 0.004, 0, BORE, F(0.168), 'z', 14);
}

function buildFrame(b: PartBuilder): void {
  // dust cover / frame under the slide
  b.box('polymer', 0.0248, 0.011, 0.19, 0, -0.0435, F(0.068), 0.002);
  // accessory rail slots on the underside
  for (let i = 0; i < 3; i++) b.box('blued', 0.0252, 0.0014, 0.004, 0, -0.0492, F(0.104 + i * 0.011), 0.0002);
  b.box('polymer', 0.0248, 0.006, 0.03, 0, -0.05, F(0.135), 0.002);
  // barrel end (visible when the slide is back)
  b.cyl('blued', 0.0077, 0.0077, 0.02, 0, BORE, F(0.168), 'z', 14);
  // grip with backstrap swell
  b.side(
    'grip',
    [[0.04, -0.043], [0.036, -0.068], [0.011, -0.136], [-0.052, -0.142], [-0.035, -0.07], [-0.031, -0.046], [-0.04, -0.041], [-0.036, -0.035], [-0.012, -0.036]],
    0.031,
    0,
    0.0014,
    0.6,
    0,
  );
  // trigger guard
  b.box('polymer', 0.0244, 0.004, 0.058, 0, -0.0705, F(0.048), 0.0015);
  b.box('polymer', 0.0244, 0.026, 0.005, 0, -0.058, F(0.0755), 0.0015);
  // slide stop, mag release and takedown on the left side
  b.box('steel', 0.003, 0.005, 0.022, -0.0148, -0.046, F(0.036), 0.0008);
  b.cyl('steel', 0.0042, 0.0042, 0.004, -0.0165, -0.08, F(0.03), 'x', 10);
  b.box('steel', 0.003, 0.006, 0.012, -0.0145, -0.043, F(0.09), 0.0006);
  // base of the grip (magwell flare)
  b.box('polymer', 0.033, 0.006, 0.066, 0, -0.14, F(-0.02), 0.002, { rx: -0.31 });
}

function buildMag(b: PartBuilder): void {
  // local frame: centred, axis along Y (top = +Y)
  b.box('polymer', 0.0225, 0.108, 0.033, 0, 0, 0, 0.0018);
  b.box('steel', 0.0236, 0.008, 0.036, 0, 0.0525, 0, 0.0012);
  for (let i = 0; i < 3; i++) b.cyl('brass', 0.0044, 0.0044, 0.014, 0, 0.06 + i * 0.0006, i === 1 ? 0.007 : -0.006, 'y', 8);
  b.box('rubber', 0.029, 0.008, 0.042, 0, -0.058, 0.0, 0.002);
  // witness holes
  for (let i = 0; i < 5; i++) b.box('blued', 0.0008, 0.006, 0.004, -0.0114, 0.03 - i * 0.017, 0, 0.0002);
}

function buildAccents(a: PartBuilder, c: PartBuilder): void {
  // tier 1: amber slide stripe + grip inlay
  a.box('accentA', 0.0012, 0.0022, 0.14, -0.0132, -0.0128, F(0.075), 0.0004);
  a.box('accentA', 0.0012, 0.05, 0.0022, -0.0161, -0.09, F(-0.006), 0.0004, { rx: 0.3 });
  // tier 2: cyan energy line under the slide, rail and around the muzzle
  c.box('accentB', 0.0012, 0.0016, 0.13, -0.0132, -0.0348, F(0.075), 0.0004);
  c.box('accentB', 0.0248, 0.0014, 0.0016, 0, -0.0492, F(0.12), 0.0004);
  c.cyl('accentB', 0.0092, 0.0092, 0.0018, 0, BORE, F(0.1685), 'z', 14);
  c.box('accentB', 0.0012, 0.06, 0.0016, -0.0161, -0.085, F(0.03), 0.0004, { rx: 0.3 });
}

export function createPistol(tex: SharedTextures): PistolRig {
  return new PistolRig(tex);
}
