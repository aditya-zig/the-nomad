/**
 * Armour plate application viewmodel. `pose.action` timeline (spans the apply time): the right hand brings a ceramic plate
 * into view (0-0.16), presents it while the support hand lifts the plate carrier into the bottom of the frame (0.16-0.34),
 * the plate is slid down into the carrier's top pocket (0.34-0.62), the hand pats it home (0.62-0.78) and both hands
 * withdraw (0.78-1).
 */
import * as THREE from 'three';
import type { ViewmodelPose } from '../viewmodelTypes';
import { sampleRows } from './grenade';
import { GloveHand, HAND_POSES, clonePose, lerpPose, type HandPose } from './hand';
import { PartBuilder } from './kit';
import { RigMaterials, type SharedTextures } from './materials';
import { UtilityRig } from './rigBase';
import { bump, clamp01, smooth } from './util';

// plate: t, x, y, z, rx, ry, rz
const PLATE_ROWS: number[][] = [
  [0.0, 0.11, -0.36, -0.36, 0.05, -0.25, 0.08],
  [0.15, 0.03, 0.03, -0.36, -0.05, -0.22, 0.05],
  [0.26, 0.03, 0.035, -0.36, -0.03, 0.14, -0.04],
  [0.34, 0.015, 0.03, -0.38, 0.0, 0.0, 0.0],
  [0.42, 0.005, 0.02, -0.42, 0.0, 0.0, 0.0],
  [0.6, 0.005, -0.205, -0.428, 0.0, 0.0, 0.0],
  [0.68, 0.005, -0.198, -0.428, 0.0, 0.0, 0.0],
  [1.0, 0.005, -0.198, -0.428, 0.0, 0.0, 0.0],
];
// vest: t, y (top edge), z, rx
const VEST_ROWS: number[][] = [
  [0.0, -0.78, -0.42, 0.25],
  [0.16, -0.78, -0.42, 0.25],
  [0.34, -0.115, -0.4, 0.12],
  [0.78, -0.115, -0.4, 0.12],
  [0.97, -0.78, -0.42, 0.25],
];

const PLATE_W = 0.21;
const PLATE_H = 0.25;
const PLATE_T = 0.02;

export class PlateRig extends UtilityRig {
  readonly id = 'plate' as const;
  private readonly rh: GloveHand;
  private readonly lh: GloveHand;
  private readonly plate: THREE.Group;
  private readonly vest: THREE.Group;
  private readonly tmp = [0, 0, 0, 0, 0, 0, 0];
  private readonly tmpV = [0, 0, 0, 0];
  private readonly eA = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly qA = new THREE.Quaternion();
  private readonly qB = new THREE.Quaternion();
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly mA = new THREE.Matrix4();
  private readonly mB = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly poseA: HandPose = clonePose(HAND_POSES.pinch);
  private readonly poseB: HandPose = clonePose(HAND_POSES.hold);
  private readonly elbowR = new THREE.Vector3(0.3, -0.6, 0.3);
  private readonly elbowL = new THREE.Vector3(-0.3, -0.6, 0.3);
  private readonly _e = new THREE.Vector3();

  constructor(tex: SharedTextures) {
    super(new RigMaterials(tex));
    const mats = this.mats;
    const mk = (k: string) => mats.get(k);
    this.rh = new GloveHand({ side: 'right', seed: 43 }, mats);
    this.lh = new GloveHand({ side: 'left', watch: true, seed: 45 }, mats);
    this.root.add(this.rh.root, this.lh.root);
    this.disposables.push(this.rh, this.lh);

    const pb = new PartBuilder();
    buildPlate(pb);
    this.plate = pb.build(mk, { ceramic: 6, rubber: 12, plateLabel: 0 });
    this.root.add(this.plate);
    this.disposables.push(pb);

    const vb = new PartBuilder();
    buildVest(vb);
    this.vest = vb.build(mk, { vestFabric: 5, webbing: 6, polymer: 20, steel: 9, rubber: 12, oliveMetal: 10 });
    this.root.add(this.vest);
    this.disposables.push(vb);
    this.setTier(0);
  }

  reset(): void {
    this.root.visible = false;
  }

  /** Aim the hand's sleeved forearm toward an elbow point given in view space. */
  private aim(hand: GloveHand, elbow: THREE.Vector3): void {
    this.mA.copy(hand.root.matrix).invert();
    this._e.copy(elbow).applyMatrix4(this.mA);
    hand.aimForearm(this._e.x, this._e.y, this._e.z);
  }

  update(pose: ViewmodelPose, dt: number): void {
    void dt;
    const a = clamp01(pose.action);
    const vis = pose.raise > 0.015 && a < 0.999;
    this.root.visible = vis;
    if (!vis) return;
    const ms = pose.reducedMotion ? 0.35 : 1;

    // ---- plate ----
    sampleRows(PLATE_ROWS, a, this.tmp);
    const px = this.tmp[0]!;
    const py0 = this.tmp[1]!;
    const pz = this.tmp[2]!;
    const prx = this.tmp[3]!;
    const pry = this.tmp[4]!;
    const prz = this.tmp[5]!;
    // pat on the top edge (two quick presses)
    const pat = (bump(a, 0.68, 0.72) + bump(a, 0.73, 0.77)) * 0.006 * ms;
    const py = py0 - pat;
    this.plate.position.set(px, py, pz);
    this.eA.set(prx, pry, prz, 'YXZ');
    this.plate.quaternion.setFromEuler(this.eA);
    this.plate.updateMatrix();
    // once the plate is fully seated it disappears into the pocket (only its top edge remains, hidden by the panel)
    this.plate.visible = true;

    // ---- vest ----
    sampleRows(VEST_ROWS, a, this.tmpV);
    const vy = this.tmpV[0]!;
    const vz = this.tmpV[1]!;
    const vrx = this.tmpV[2]!;
    // once seated the plate rides with the carrier as it drops away
    if (a >= 0.6) {
      const seated = smooth((a - 0.6) / 0.05);
      const carried = vy - 0.09;
      this.plate.position.y = THREE.MathUtils.lerp(this.plate.position.y, Math.min(this.plate.position.y, carried + pat), seated);
      this.plate.updateMatrix();
    }
    this.vest.position.set(0, vy, vz);
    this.vest.rotation.set(vrx, 0, 0);
    this.vest.updateMatrix();
    this.vest.visible = vy > -0.7;

    // ---- right hand: on the plate's right edge, sliding up to the top corner while inserting ----
    const grab = smooth((a - 0.34) / 0.2);
    const hy = THREE.MathUtils.lerp(-0.045, 0.085, grab);
    this.vA.set(PLATE_W / 2 + 0.019, hy, 0.05);
    this.eA.set(-0.15, 0.0, -Math.PI / 2 + 0.1, 'YXZ');
    this.qA.setFromEuler(this.eA);
    this.mA.compose(this.vA, this.qA, this.one);
    this.mB.copy(this.plate.matrix).multiply(this.mA);
    this.mB.decompose(this.vA, this.qB, this.vB);
    // enter from below / leave after the pat
    const enter = 1 - smooth(a / 0.1);
    const leave = smooth((a - 0.78) / 0.16);
    const outX = 0.2;
    const outY = -0.45;
    const outZ = -0.28;
    this.vA.x = THREE.MathUtils.lerp(this.vA.x, outX, leave);
    this.vA.y = THREE.MathUtils.lerp(this.vA.y, outY, Math.max(leave, 0));
    this.vA.z = THREE.MathUtils.lerp(this.vA.z, outZ, leave);
    void enter;
    this.rh.root.position.copy(this.vA);
    this.rh.root.quaternion.copy(this.qB);
    this.rh.root.updateMatrix();
    const rPinch = 1 - leave;
    lerpPose(HAND_POSES.relaxed, HAND_POSES.pinch, rPinch, this.poseA);
    if (a > 0.66 && a < 0.78) lerpPose(this.poseA, HAND_POSES.flat, 0.7, this.poseA);
    this.rh.setPose(this.poseA);
    this.aim(this.rh, this.elbowR);

    // ---- support hand: grabs the top-left corner of the carrier and holds the pocket open ----
    const lIn = smooth((a - 0.08) / 0.2);
    const lOut = smooth((a - 0.76) / 0.18);
    const w = lIn * (1 - lOut);
    this.vA.set(-0.155, -0.0, 0.05);
    this.eA.set(-0.1, 0.0, Math.PI / 2 - 0.15, 'YXZ');
    this.qA.setFromEuler(this.eA);
    this.mA.compose(this.vA, this.qA, this.one);
    this.mB.copy(this.vest.matrix).multiply(this.mA);
    this.mB.decompose(this.vA, this.qB, this.vB);
    // free start/end position (off-screen bottom-left)
    this.vB.set(-0.24, -0.46, -0.24);
    this.vA.lerp(this.vB, 1 - w);
    this.lh.root.position.copy(this.vA);
    this.lh.root.quaternion.copy(this.qB);
    this.lh.root.updateMatrix();
    lerpPose(HAND_POSES.open, HAND_POSES.hold, clamp01(w * 1.2), this.poseB);
    this.lh.setPose(this.poseB);
    this.aim(this.lh, this.elbowL);
    this.lh.root.visible = w > 0.01 || a < 0.9;

    this.mats.pulse(pose.time);
    this.root.updateMatrixWorld(true);
  }
}

// -------------------------------------------------------------------------------------------------

function plateOutline(w: number, h: number, corner: number, chamfer: number): [number, number][] {
  const pts: [number, number][] = [];
  const hw = w / 2;
  const hh = h / 2;
  // top-right rounded corner
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([hw - corner + Math.sin(a) * corner, hh - corner + Math.cos(a) * corner]);
  }
  // right side down to the chamfer, then bottom chamfers
  pts.push([hw, -hh + chamfer]);
  pts.push([hw - chamfer, -hh]);
  pts.push([-hw + chamfer, -hh]);
  pts.push([-hw, -hh + chamfer]);
  // top-left rounded corner
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([-hw + corner - Math.cos(a) * corner, hh - corner + Math.sin(a) * corner]);
  }
  return pts;
}

function buildPlate(b: PartBuilder): void {
  const outline = plateOutline(PLATE_W, PLATE_H, 0.05, 0.04);
  const rim = plateOutline(PLATE_W + 0.008, PLATE_H + 0.008, 0.054, 0.042);
  // edge tape body (black) and the ceramic strike face slightly proud of it
  b.prism('rubber', rim, 0, 0, -PLATE_T / 2, PLATE_T / 2, 0.0012, 0.6);
  b.prism('ceramic', outline, 0, 0, -PLATE_T / 2 - 0.0002, PLATE_T / 2 + 0.0006, 0.0008, 0.6);
  // stencilled label and corner markings on the front face
  b.plane('plateLabel', 0.15, 0.0375, 0, 0.055, PLATE_T / 2 + 0.0016);
  for (const sx of [-1, 1]) b.box('yellow', 0.012, 0.0016, 0.0006, sx * 0.085, -0.108, PLATE_T / 2 + 0.0012, 0.0002);
}

function buildVest(b: PartBuilder): void {
  // local frame: origin at the top-centre edge of the front panel; the panel hangs down (-Y), face toward +Z
  const W = 0.4;
  const H = 0.46;
  const T = 0.026;
  b.box('vestFabric', W, H, T, 0, -H / 2, 0, 0.007);
  // stitched border and the plate-pocket slit at the top edge
  b.box('webbing', W - 0.02, 0.008, 0.002, 0, -0.012, T / 2 + 0.0004, 0.0004);
  b.box('rubber', W - 0.05, 0.006, T + 0.002, 0, -0.002, 0, 0.001);
  // MOLLE webbing ladder rows
  for (let r = 0; r < 6; r++) {
    const y = -0.062 - r * 0.052;
    b.box('webbing', W - 0.06, 0.0075, 0.0034, 0, y, T / 2 + 0.0012, 0.0006);
    for (let i = 0; i < 13; i++) b.box('webbing', 0.004, 0.02, 0.0028, -0.156 + i * 0.026, y - 0.012, T / 2 + 0.001, 0.0005);
  }
  // shoulder strap stubs and quick-release buckles
  for (const sx of [-1, 1]) {
    b.box('vestFabric', 0.06, 0.05, 0.012, sx * 0.14, 0.018, 0.0, 0.003, { rx: -0.25 });
    b.box('steel', 0.022, 0.014, 0.008, sx * 0.135, 0.005, T / 2 + 0.006, 0.0015);
    b.box('polymer', 0.016, 0.02, 0.008, sx * 0.135, -0.014, T / 2 + 0.006, 0.0015);
  }
  // mag pouches with rifle magazines (bottom row) and an admin patch
  for (let i = -1; i <= 1; i++) {
    b.box('vestFabric', 0.082, 0.11, 0.046, i * 0.104, -0.27, T / 2 + 0.022, 0.006);
    b.box('webbing', 0.07, 0.012, 0.048, i * 0.104, -0.222, T / 2 + 0.022, 0.003);
    b.box('polymer', 0.03, 0.03, 0.036, i * 0.104, -0.212, T / 2 + 0.022, 0.003);
  }
  b.box('webbing', 0.2, 0.09, 0.004, 0, -0.16, T / 2 + 0.0026, 0.002);
  b.box('rubber', 0.06, 0.014, 0.0022, 0, -0.16, T / 2 + 0.0056, 0.0006);
}

export function createPlate(tex: SharedTextures): PlateRig {
  return new PlateRig(tex);
}
