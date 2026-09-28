/**
 * KR-16 assault rifle viewmodel (AR-pattern carbine with red-dot optic, M-LOK handguard, angled foregrip).
 *
 * Gun space: origin = centre of the optic window (sight point), +X right, +Y up, -Z forward (f = -z).
 * The bore axis sits YB below the origin. Helper Y(y') maps a bore-relative height to gun space.
 */
import * as THREE from 'three';
import type { ViewmodelPose } from '../viewmodelTypes';
import { MagReloader } from './magReload';
import { MuzzleFlash } from './flash';
import { GloveHand, HAND_POSES, clonePose, lerpPose, type HandPose } from './hand';
import { PartBuilder } from './kit';
import { RigMaterials, type SharedTextures } from './materials';
import { Anchor, BaseRig, GunMotion, HandDriver, Target, type GunTuning, type HandKey } from './rigBase';
import { bump, clamp01, keys } from './util';

const YB = -0.088; // bore axis height in gun space
const Y = (yp: number): number => YB + yp;
const F = (f: number): number => -f;

const UV_SCALE = { grip: 34, polymer: 26, olive: 26, metal: 9, blued: 9, steel: 9, rubber: 12 };

const TUNE: GunTuning = {
  hipPos: [0.168, -0.066, -0.39],
  hipRot: [0.035, 0.09, 0.02],
  adsPos: [0, 0, -0.325],
  adsRot: [0, 0, 0],
  sprintPos: [0.085, -0.05, -0.3],
  sprintRot: [-0.3, 0.6, 0.28],
  pivot: [0, YB, 0.22],
  bob: { y: 0.0065, x: 0.0075, roll: 0.02 },
  sway: { pos: 0.0042, rot: 0.007 },
  kick: { z: 0.014, pitch: 0.02, yaw: 0.006, roll: 0.012, freq: 10, zeta: 0.62, adsMul: 0.55 },
};

const TILT_KEYS = [0, 0, 0.1, 1, 0.55, 0.85, 0.75, 0.35, 1, 0] as const;

// mag axis in gun space (down and slightly forward)
const MAG_DIR = new THREE.Vector3(0, -0.94, -0.35).normalize();

export class RifleRig extends BaseRig {
  readonly id = 'rifle' as const;
  private readonly motion = new GunMotion(TUNE);
  private readonly flash: MuzzleFlash;
  private readonly magGroup: THREE.Group;
  private readonly dropMag: THREE.Group;
  private readonly charging: THREE.Group;
  private readonly boltCatch: THREE.Group;
  private readonly rh: GloveHand;
  private readonly lh: GloveHand;
  private readonly rhDrv: HandDriver;
  private readonly lhDrv: HandDriver;
  private readonly aRH = new Anchor(0.034, Y(-0.104), F(-0.1), 0.05, 0, -Math.PI / 2);
  private readonly aLF = new Anchor(-0.034, Y(-0.088), F(0.176), 0, 0, Math.PI / 2);
  private readonly aMagGrab = new Anchor(-0.033, Y(-0.128), F(0.03), -0.35, 0, Math.PI / 2);
  private readonly aMagOut = new Anchor(0, 0, 0);
  private readonly aMagReady = new Anchor(0, 0, 0);
  private readonly aMagSlap = new Anchor(0, 0, 0);
  private readonly aBolt = new Anchor(-0.036, Y(0.004), F(0.005), 0, 0.15, Math.PI / 2);
  private readonly tFore = new Target(this.aLF);
  private readonly tMag = new Target(this.aMagGrab);
  private readonly tOut = new Target(this.aMagOut);
  private readonly tReady = new Target(this.aMagReady);
  private readonly tSlap = new Target(this.aMagSlap);
  private readonly tBolt = new Target(this.aBolt);
  private readonly tPouch = new Target(null, -0.11, -0.42, -0.3, 0, 0, Math.PI / 2);
  private readonly tPouch2 = new Target(null, -0.09, -0.4, -0.27, 0, 0, Math.PI / 2);
  private readonly keysTactical: HandKey[];
  private readonly keysEmpty: HandKey[];
  private readonly tmpPose: HandPose = clonePose(HAND_POSES.gripR);
  private readonly magInHand = new THREE.Matrix4();
  private readonly reloader: MagReloader;
  private trig = 0;
  private readonly elbowR = new THREE.Vector3(0.28, -0.55, 0.32);
  private readonly elbowL = new THREE.Vector3(-0.26, -0.6, 0.3);

  constructor(tex: SharedTextures) {
    super(new RigMaterials(tex));
    const mats = this.mats;
    const mk = (k: string) => mats.get(k);

    // ---- static body ----------------------------------------------------------------------
    const body = new PartBuilder();
    buildBody(body);
    const bodyGroup = body.build(mk, UV_SCALE);
    this.gun.add(bodyGroup);
    this.disposables.push(body);

    // ---- optic ----------------------------------------------------------------------------
    const optic = new PartBuilder();
    buildOptic(optic);
    const opticGroup = optic.build(mk, UV_SCALE);
    this.gun.add(opticGroup);
    this.disposables.push(optic);
    const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.019, 0.019), mats.get('reticle'));
    reticle.position.set(0, 0, 0.0);
    reticle.renderOrder = 10;
    reticle.frustumCulled = false;
    this.gun.add(reticle);
    this.disposables.push({ dispose: () => reticle.geometry.dispose() });

    // ---- magazine (own group; child of the gun while seated) ------------------------------
    const mag = new PartBuilder();
    buildMag(mag);
    this.magGroup = mag.build(mk, UV_SCALE);
    this.gun.add(this.magGroup);
    this.disposables.push(mag);
    this.dropMag = this.magGroup.clone(true);
    this.dropMag.visible = false;
    this.root.add(this.dropMag);

    // ---- charging handle -------------------------------------------------------------------
    const ch = new PartBuilder();
    buildCharging(ch);
    this.charging = ch.build(mk, UV_SCALE);
    this.gun.add(this.charging);
    this.disposables.push(ch);

    // ---- bolt catch lever (left side; rises when the bolt is locked back) ------------------------
    const bc = new PartBuilder();
    bc.box('steel', 0.004, 0.018, 0.011, 0, 0.009, 0, 0.001);
    bc.box('steel', 0.005, 0.005, 0.014, 0, 0.0195, 0, 0.0008);
    this.boltCatch = bc.build(mk, UV_SCALE);
    this.boltCatch.position.set(-0.0195, Y(-0.03), F(0.052));
    this.gun.add(this.boltCatch);
    this.disposables.push(bc);

    // ---- tier accents ----------------------------------------------------------------------
    const tA = new PartBuilder();
    const tB = new PartBuilder();
    buildAccents(tA, tB);
    const accA = tA.build(mk, UV_SCALE);
    const accB = tB.build(mk, UV_SCALE);
    this.gun.add(accA, accB);
    this.addTierPart(accA, 1);
    this.addTierPart(accB, 2);
    this.disposables.push(tA, tB);

    // muzzle / eject markers
    this.muzzle.position.set(0, YB, F(0.588));
    this.ejectPort.position.set(0.021, Y(0.016), F(0.03));
    this.flash = new MuzzleFlash(mats.tex, 0.2, 0.3);
    this.muzzle.add(this.flash.group);
    this.disposables.push(this.flash);

    // ---- hands ------------------------------------------------------------------------------
    this.rh = new GloveHand({ side: 'right', seed: 3 }, mats);
    this.lh = new GloveHand({ side: 'left', watch: true, seed: 5 }, mats);
    this.root.add(this.rh.root, this.lh.root);
    this.disposables.push(this.rh, this.lh);
    this.rhDrv = new HandDriver(this.rh, this.elbowR);
    this.lhDrv = new HandDriver(this.lh, this.elbowL);

    // mag-out / ready / slap anchors derive from the grab anchor shifted along the mag axis
    const shift = (a: Anchor, d: number, up = 0) => {
      a.pos.copy(this.aMagGrab.pos).addScaledVector(MAG_DIR, d);
      a.pos.y += up;
      a.quat.copy(this.aMagGrab.quat);
    };
    shift(this.aMagOut, 0.115);
    shift(this.aMagReady, 0.1);
    shift(this.aMagSlap, -0.006);
    // mag in hand = inverse(grab) so that at the grab anchor the mag sits exactly in the well
    this.magInHand.compose(this.aMagGrab.pos, this.aMagGrab.quat, new THREE.Vector3(1, 1, 1)).invert();

    const K = (t: number, target: Target, pose: HandKey['pose']): HandKey => ({ t, target, pose });
    this.keysTactical = [
      K(0.0, this.tFore, 'grip'),
      K(0.11, this.tMag, 'hold'),
      K(0.2, this.tOut, 'hold'),
      K(0.25, this.tOut, 'open'),
      K(0.33, this.tPouch, 'open'),
      K(0.4, this.tPouch2, 'hold'),
      K(0.5, this.tReady, 'hold'),
      K(0.69, this.tMag, 'hold'),
      K(0.75, this.tSlap, 'hold'),
      K(0.82, this.tMag, 'hold'),
      K(0.97, this.tFore, 'grip'),
    ];
    this.keysEmpty = [
      K(0.0, this.tFore, 'grip'),
      K(0.11, this.tMag, 'hold'),
      K(0.2, this.tOut, 'hold'),
      K(0.25, this.tOut, 'open'),
      K(0.33, this.tPouch, 'open'),
      K(0.4, this.tPouch2, 'hold'),
      K(0.5, this.tReady, 'hold'),
      K(0.69, this.tMag, 'hold'),
      K(0.75, this.tSlap, 'hold'),
      K(0.8, this.tBolt, 'flat'),
      K(0.86, this.tBolt, 'flat'),
      K(0.97, this.tFore, 'grip'),
    ];
    this.reloader = new MagReloader({
      root: this.root,
      gun: this.gun,
      hand: this.lh,
      driver: this.lhDrv,
      mag: this.magGroup,
      dropMag: this.dropMag,
      magInHand: this.magInHand,
      seat: new THREE.Matrix4(),
      tossTarget: this.tOut,
      keysTactical: this.keysTactical,
      keysEmpty: this.keysEmpty,
      holdWindows: [
        [0.11, 0.25],
        [0.4, 0.69],
      ],
      hiddenWindow: [0.25, 0.4],
      fallWindow: [0.25, 0.47],
      fallVel: [-0.12, 0.16, 0.05],
      fallGravity: 4.4,
      fallScale: 1.5,
    });
    this.setTier(0);
  }

  onFire(tier: number, strength = 1): void {
    this.motion.kick(strength, this.lastAds);
    this.flash.trigger(tier, strength);
  }

  private lastAds = 0;

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

    const reloading = pose.reloadPhase === 'mag';
    const t = reloading ? clamp01(pose.reloadT) : 0;
    const d = m.out;
    let chBack = 0;

    if (reloading) {
      // cant the rifle so the magwell turns toward the support hand, then settle
      const tilt = keys(t, TILT_KEYS);
      d.dRot.z += -0.36 * tilt;
      d.dRot.x += 0.09 * tilt;
      d.dRot.y += 0.12 * tilt;
      d.dPos.x -= 0.05 * tilt;
      d.dPos.y += 0.03 * tilt;
      // insertion shove: the rifle bumps slightly when the mag seats
      const seat = bump(t, 0.66, 0.78);
      d.dPos.z += 0.012 * seat;
      d.dRot.x -= 0.03 * seat;
      if (pose.reloadEmpty) chBack = bump(t, 0.78, 0.9) * 0.042;
    } else if (pose.ammo <= 0) {
      chBack = 0.012; // bolt locked back
    }
    // per-shot tremble
    const trem = 1 - clamp01(pose.cycle * 2.5);
    d.dRot.z += Math.sin(pose.time * 90) * 0.004 * trem;

    m.apply(this.gun);

    // charging handle and bolt catch
    this.charging.position.z = chBack;
    this.boltCatch.rotation.x = chBack > 0.005 ? 0.55 : 0;

    // ---- hands ----
    this.tFore.refresh(this.gun);
    this.tMag.refresh(this.gun);
    this.tOut.refresh(this.gun);
    this.tReady.refresh(this.gun);
    this.tSlap.refresh(this.gun);
    this.tBolt.refresh(this.gun);

    // right hand: trigger finger pulls on each shot
    const trigTarget = pose.cycle < 0.35 ? 1 : 0;
    this.trig += (trigTarget - this.trig) * (1 - Math.exp(-dt * 40));
    const rPoseT = reloading && t > 0.05 && t < 0.9 ? 0 : this.trig;
    lerpPose(HAND_POSES.gripR, HAND_POSES.gripRFire, rPoseT, this.tmpPose);
    this.rh.setPose(this.tmpPose);
    this.rhDrv.place(this.gun, this.aRH);

    if (reloading) {
      this.reloader.update(t, pose.reloadEmpty);
    } else {
      this.reloader.idle();
      this.lh.setPose(HAND_POSES.grip);
      this.lhDrv.place(this.gun, this.aLF);
    }

    this.flash.update(dt);
    this.mats.pulse(pose.time);
    this.root.updateMatrixWorld(true);
  }
}

// -------------------------------------------------------------------------------------------------
// Geometry
// -------------------------------------------------------------------------------------------------

function buildBody(b: PartBuilder): void {
  // upper receiver
  b.box('metal', 0.038, 0.046, 0.275, 0, Y(0.013), F(0.0225), 0.0026);
  // ejection port cover + forward assist (right side)
  b.box('metal', 0.003, 0.02, 0.05, 0.0195, Y(0.018), F(0.03), 0.001);
  b.cyl('metal', 0.0045, 0.0045, 0.012, 0.0215, Y(0.015), F(-0.058), 'x', 10);
  // lower receiver + magwell flare
  b.box('metal', 0.036, 0.05, 0.205, 0, Y(-0.037), F(0.0075), 0.0022);
  b.box('metal', 0.036, 0.024, 0.056, 0, Y(-0.075), F(0.074), 0.0022);
  // pistol grip
  b.side('grip', [[-0.046, -0.055], [-0.056, -0.1], [-0.078, -0.15], [-0.073, -0.172], [-0.042, -0.176], [-0.027, -0.15], [-0.022, -0.1], [-0.02, -0.055]].map(([f, y]) => [f!, Y(y!)] as [number, number]), 0.031, 0, 0.0012, 0.6, 0);
  b.box('rubber', 0.032, 0.006, 0.04, 0, Y(-0.176), F(-0.058), 0.002);
  // trigger guard + trigger
  b.box('metal', 0.004, 0.03, 0.005, 0, Y(-0.075), F(-0.018), 0.0008);
  b.box('metal', 0.004, 0.005, 0.064, 0, Y(-0.092), F(0.012), 0.0008);
  b.box('metal', 0.004, 0.028, 0.005, 0, Y(-0.078), F(0.044), 0.0008);
  b.box('steel', 0.005, 0.022, 0.006, 0, Y(-0.075), F(0.008), 0.0012, { rx: 0.25 });
  // safety selector, bolt catch, takedown pins (left side)
  b.cyl('steel', 0.0065, 0.0065, 0.006, -0.0195, Y(-0.03), F(-0.047), 'x', 12);
  b.box('steel', 0.004, 0.005, 0.022, -0.0225, Y(-0.03), F(-0.038), 0.0012, { rx: 0 });
  b.box('red', 0.0025, 0.004, 0.006, -0.0245, Y(-0.03), F(-0.029), 0.0006);
  b.cyl('steel', 0.0042, 0.0042, 0.005, -0.019, Y(-0.032), F(0.098), 'x', 10);
  b.cyl('steel', 0.0042, 0.0042, 0.005, -0.019, Y(-0.032), F(-0.078), 'x', 10);
  // top rail: base bar, teeth (skipping the optic footprint), rail riser under the handguard
  b.box('metal', 0.021, 0.005, 0.515, 0, Y(0.0385), F(0.1425), 0.0006);
  b.box('metal', 0.018, 0.0125, 0.29, 0, Y(0.031), F(0.255), 0.0006);
  for (let i = 0; i < 54; i++) {
    const f = -0.108 + i * 0.0095;
    if (f > -0.048 && f < 0.062) continue;
    b.box('metal', 0.021, 0.0036, 0.0046, 0, Y(0.0428), F(f), 0);
  }
  // handguard: free-float octagon with M-LOK slots
  const AP = 0.0275;
  const R = AP / Math.cos(Math.PI / 8);
  const oct: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    oct.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  b.prism('metal', oct, 0, YB, 0.11, 0.4, 0.0012, 0.5);
  b.cyl('steel', 0.032, 0.032, 0.014, 0, YB, F(0.117), 'z', 20); // barrel nut
  b.cyl('steel', 0.0295, 0.0295, 0.012, 0, YB, F(0.397), 'z', 20); // front cap
  const slotAngles = [180, 135, 225, 270, 315, 0, 45];
  for (const ang of slotAngles) {
    const psi = (ang * Math.PI) / 180;
    for (let i = 0; i < 5; i++) {
      const f = 0.165 + i * 0.05;
      const r = AP + 0.0014;
      b.box('polymer', 0.007, 0.0016, 0.028, Math.cos(psi) * r, YB + Math.sin(psi) * r, F(f), 0.0007, { rz: psi - Math.PI / 2 });
    }
  }
  // sling loop on the handguard
  b.torus('steel', 0.0065, 0.0016, -0.029, Y(0.004), F(0.14), { ry: Math.PI / 2 }, 10);
  // low-profile gas block + folding front sight
  b.box('blued', 0.010, 0.007, 0.016, 0, Y(0.0415), F(0.388), 0.001);
  b.box('blued', 0.0035, 0.009, 0.004, 0, Y(0.049), F(0.388), 0.0005);
  // barrel and muzzle brake
  b.cyl('blued', 0.0108, 0.0108, 0.14, 0, YB, F(0.47), 'z', 14);
  b.cyl('blued', 0.0125, 0.0125, 0.058, 0, YB, F(0.559), 'z', 16);
  b.box('polymer', 0.026, 0.0028, 0.02, 0, YB, F(0.556), 0);
  b.box('polymer', 0.0028, 0.026, 0.02, 0, YB, F(0.556), 0);
  b.cyl('blued', 0.0135, 0.0135, 0.006, 0, YB, F(0.531), 'z', 16);
  // angled foregrip
  b.side('grip', [[0.195, -0.026], [0.252, -0.026], [0.247, -0.072], [0.24, -0.124], [0.224, -0.143], [0.205, -0.137], [0.197, -0.092]].map(([f, y]) => [f!, Y(y!)] as [number, number]), 0.03, 0, 0.0012, 0.6, 0);
  b.box('steel', 0.02, 0.006, 0.062, 0, Y(-0.0275), F(0.223), 0.0012);
  // stock (shortened: it stays out of the ADS sight picture): buffer tube + body + butt pad
  b.cyl('metal', 0.0165, 0.0175, 0.1, 0, Y(-0.003), F(-0.165), 'z', 18);
  b.side(
    'polymer',
    [[-0.15, 0.028], [-0.19, 0.03], [-0.22, 0.031], [-0.228, 0.028], [-0.23, 0.0], [-0.228, -0.042], [-0.218, -0.05], [-0.2, -0.048], [-0.17, -0.032], [-0.15, -0.028]].map(([f, y]) => [f!, Y(y!)] as [number, number]),
    0.03,
    0,
    0.0014,
    0.6,
    0,
  );
  b.box('rubber', 0.031, 0.078, 0.008, 0, Y(-0.011), F(-0.233), 0.002);
}

function buildOptic(b: PartBuilder): void {
  // mount riser onto the rail + quick-release lever
  b.box('metal', 0.032, 0.0165, 0.058, 0, -0.0358, F(0.004), 0.0015);
  b.box('steel', 0.006, 0.01, 0.012, -0.0195, -0.0345, F(-0.022), 0.001);
  // compact housing: rounded frame around a 33 x 30 mm see-through window
  const W = 0.044;
  const H = 0.05;
  const D = 0.07;
  const ix = 0.033;
  const iy = 0.03;
  const wall = (H - iy) / 2;
  const side = (W - ix) / 2;
  b.box('blued', W, wall, D, 0, iy / 2 + wall / 2, F(0.004), 0.0045);
  b.box('blued', W, wall, D, 0, -iy / 2 - wall / 2, F(0.004), 0.0045);
  b.box('blued', side, iy + 0.002, D, -(ix / 2 + side / 2), 0, F(0.004), 0.0028);
  b.box('blued', side, iy + 0.002, D, ix / 2 + side / 2, 0, F(0.004), 0.0028);
  // front hood over the emitter and a slim rear bezel
  b.box('blued', W - 0.006, 0.006, 0.022, 0, H / 2 + 0.0005, F(0.03), 0.0028, { rx: 0.12 });
  b.box('polymer', W + 0.001, 0.0032, 0.0045, 0, iy / 2 + 0.0016, F(-0.0335), 0.001);
  b.box('polymer', W + 0.001, 0.0032, 0.0045, 0, -iy / 2 - 0.0016, F(-0.0335), 0.001);
  // lenses (transparent): front coated, rear clear
  b.plane('lensCoat', ix, iy, 0, 0, F(0.036));
  b.plane('lens', ix, iy, 0, 0, F(-0.03));
  // brightness dial, battery cap, flank panel
  b.cyl('steel', 0.0058, 0.0058, 0.006, -0.0245, 0.007, F(0.012), 'x', 14);
  b.box('steel', 0.0035, 0.005, 0.01, -0.0282, 0.007, F(0.012), 0.0008);
  b.cyl('steel', 0.0048, 0.0048, 0.005, 0, 0.0275, F(0.016), 'y', 12);
  b.box('polymer', 0.0014, 0.016, 0.046, -0.0229, -0.006, F(0.004), 0.0006);
}

function buildMag(b: PartBuilder): void {
  const fc = (s: number) => 0.071 + 0.026 * s * s;
  const yc = (s: number) => -0.062 - 0.142 * s;
  const th = (s: number) => 0.031 + 0.003 * s;
  const n = 12;
  const front: [number, number][] = [];
  const back: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    front.push([fc(s) + th(s) / 2, Y(yc(s))]);
    back.push([fc(s) - th(s) / 2, Y(yc(s))]);
  }
  const poly = [...front, ...back.reverse()];
  b.side('polymer', poly, 0.0255, 0, 0.0012, 0.7, 0);
  // rib lines on the front spine and along the left face
  for (let i = 1; i < 10; i++) {
    const s = i / 10;
    b.box('metal', 0.0264, 0.0014, 0.0328, 0, Y(yc(s)), F(fc(s)), 0.0002, { rx: -0.3 * s });
  }
  // baseplate
  b.box('rubber', 0.03, 0.008, 0.042, 0, Y(yc(1) - 0.003), F(fc(1)), 0.002, { rx: -0.36 });
  // brass rounds poking out of the top (visible when the mag is out of the well)
  for (let i = 0; i < 3; i++) {
    const zz = fc(0) + (i % 2 === 0 ? -0.006 : 0.006) + (i - 1) * 0.0;
    b.cyl('brass', 0.0044, 0.0044, 0.02, i === 1 ? 0.0 : (i - 1) * 0.0, Y(-0.052 + i * 0.001), F(zz + i * 0.0), 'y', 8);
  }
}

function buildCharging(b: PartBuilder): void {
  b.box('metal', 0.011, 0.01, 0.07, 0, Y(0.031), F(-0.07), 0.0012);
  b.box('polymer', 0.034, 0.009, 0.014, 0, Y(0.03), F(-0.125), 0.0022);
  b.box('polymer', 0.007, 0.016, 0.016, -0.0155, Y(0.024), F(-0.126), 0.0018);
  b.box('polymer', 0.007, 0.016, 0.016, 0.0155, Y(0.024), F(-0.126), 0.0018);
}

const AP0 = 0.0275;
function buildAccents(a: PartBuilder, c: PartBuilder): void {
  // tier 1: amber inlays on the handguard flanks, receiver flank and magazine
  for (const ang of [180, 135]) {
    const psi = (ang * Math.PI) / 180;
    const r = AP0 + 0.0018;
    a.box('accentA', 0.0028, 0.0012, 0.18, Math.cos(psi) * r, YB + Math.sin(psi) * r, F(0.26), 0.0004, { rz: psi - Math.PI / 2 });
  }
  a.box('accentA', 0.0012, 0.004, 0.06, -0.0195, Y(0.024), F(0.03), 0.0004);
  a.box('accentA', 0.0012, 0.004, 0.05, -0.0195, Y(-0.012), F(0.0), 0.0004);
  a.box('accentA', 0.0012, 0.05, 0.003, -0.0132, Y(-0.132), F(0.056), 0.0004, { rx: -0.34 });
  a.box('accentA', 0.05, 0.0016, 0.0016, 0, 0.0, F(0.043), 0.0004);
  // tier 2: cyan energy lines along the top rail, barrel shroud and receiver
  c.box('accentB', 0.0016, 0.0016, 0.5, -0.0108, Y(0.0398), F(0.14), 0.0004);
  c.box('accentB', 0.0016, 0.0016, 0.5, 0.0108, Y(0.0398), F(0.14), 0.0004);
  for (let i = 0; i < 4; i++) {
    c.box('accentB', 0.0016, 0.0016, 0.012, -0.0195, Y(-0.038), F(-0.04 + i * 0.03), 0.0004);
  }
  c.cyl('accentB', 0.0136, 0.0136, 0.003, 0, YB, F(0.545), 'z', 16);
  c.cyl('accentB', 0.0136, 0.0136, 0.003, 0, YB, F(0.565), 'z', 16);
  c.box('accentB', 0.0012, 0.04, 0.0016, -0.0132, Y(-0.132), F(0.082), 0.0004, { rx: -0.34 });
  c.box('accentB', 0.03, 0.0014, 0.0014, 0, 0.0295, F(0.043), 0.0004);
}

export function createRifle(tex: SharedTextures): RifleRig {
  return new RifleRig(tex);
}

