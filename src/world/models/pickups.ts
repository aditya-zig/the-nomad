/** Ground pickups: ammo can, armour plate, frag grenade. Small, emissive, readable at 20 m. */
import * as THREE from 'three';
import type { PickupKind } from '../models';
import { buildGrenadeGeo } from './small';
import { GeoBatch, acquire, createDetailMaterial, hdr, makeDetailUniforms, makeRadialTexture, release, type DetailUniforms } from './util';

const GLOW: Record<PickupKind, number> = { ammo: 0x58ff8a, plate: 0xffb030, grenade: 0xff4a30 };

function buildAmmo(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const green = hdr(0x58ff8a, 2.2);
  // can body
  b.rbox(0.3, 0.15, 0.12, 0.012, 0x56603c, { pos: [0, 0.075, 0] });
  // stencil band and latch
  b.box(0.16, 0.06, 0.004, 0xd7c25a, { pos: [-0.03, 0.08, -0.062] });
  b.box(0.05, 0.012, 0.004, 0x2b2e22, { pos: [-0.06, 0.09, -0.065] });
  b.box(0.07, 0.012, 0.004, 0x2b2e22, { pos: [-0.03, 0.068, -0.065] });
  b.box(0.05, 0.05, 0.012, 0x363b31, { pos: [0.1, 0.11, -0.064] });
  // emissive status strip along the front rim
  b.box(0.22, 0.014, 0.006, 0x58ff8a, { pos: [0, 0.145, -0.064] }, green);
  // lid opened back to reveal the rounds
  b.rbox(0.31, 0.02, 0.125, 0.008, 0x646f47, { pos: [0, 0.27, 0.115], rot: [-0.32, 0, 0] });
  b.box(0.3, 0.012, 0.11, 0x2c3022, { pos: [0, 0.152, 0] });
  // handle
  b.torus(0.06, 0.008, 5, 12, Math.PI, 0x8f9499, { pos: [0, 0.13, 0.062], rot: [Math.PI / 2, 0, 0] });
  // brass rounds standing in rows
  const brass = 0xd0a84e;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 7; i++) {
      const x = -0.115 + i * 0.038;
      const z = -0.02 + row * 0.048;
      b.cyl(0.0085, 0.0085, 0.032, 6, brass, { pos: [x, 0.172, z] });
      b.cyl(0.002, 0.0075, 0.026, 6, 0xb4622e, { pos: [x, 0.201, z] }, hdr(0x58ff8a, 0.25));
    }
  }
  return b.build();
}

function buildPlate(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const shape = new THREE.Shape();
  const w = 0.135;
  const h = 0.16;
  const c = 0.045;
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, h - c);
  shape.lineTo(w - c, h);
  shape.lineTo(-w + c, h);
  shape.lineTo(-w, h - c);
  shape.closePath();
  const amber = hdr(0xffb030, 2.4);
  const lean = [-0.16, 0, 0] as [number, number, number];
  // glowing rim slightly larger, behind
  const rim = new THREE.Shape();
  const e = 0.014;
  rim.moveTo(-w - e, -h - e);
  rim.lineTo(w + e, -h - e);
  rim.lineTo(w + e, h - c + e * 0.4);
  rim.lineTo(w - c + e * 0.4, h + e);
  rim.lineTo(-w + c - e * 0.4, h + e);
  rim.lineTo(-w - e, h - c + e * 0.4);
  rim.closePath();
  b.add(new THREE.ExtrudeGeometry(rim, { depth: 0.012, bevelEnabled: false }), 0xffb030, { pos: [0, 0.2, 0.012], rot: lean }, amber);
  b.add(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), 0x7b8085, { pos: [0, 0.2, -0.02], rot: lean });
  // inset ballistic face and a small amber arrow
  const inset = new THREE.Shape();
  const iw = w - 0.02;
  const ih = h - 0.02;
  const ic = c - 0.01;
  inset.moveTo(-iw, -ih);
  inset.lineTo(iw, -ih);
  inset.lineTo(iw, ih - ic);
  inset.lineTo(iw - ic, ih);
  inset.lineTo(-iw + ic, ih);
  inset.lineTo(-iw, ih - ic);
  inset.closePath();
  b.add(new THREE.ExtrudeGeometry(inset, { depth: 0.006, bevelEnabled: false }), 0x8f959a, { pos: [0, 0.2, -0.054], rot: lean });
  b.box(0.05, 0.012, 0.004, 0x2c2f33, { pos: [0, 0.2, -0.062], rot: lean });
  b.box(0.012, 0.05, 0.004, 0x2c2f33, { pos: [0, 0.2, -0.062], rot: lean });
  // stand
  b.box(0.2, 0.03, 0.09, 0x2d3034, { pos: [0, 0.015, 0.0] });
  b.box(0.16, 0.03, 0.02, 0x2d3034, { pos: [0, 0.04, -0.025] });
  return b.build();
}

// the grenade geometry carries its own vertex colours (via GeoBatch inside buildGrenadeGeo); wrapping it again would
// overwrite them, so the grenade pickup uses the raw geometry instead.
function buildGrenadeRaw(): THREE.BufferGeometry {
  const g = buildGrenadeGeo();
  g.applyMatrix4(new THREE.Matrix4().makeScale(1.5, 1.5, 1.5).setPosition(0, 0.098, 0));
  return g;
}

interface PickupShared {
  material: THREE.MeshStandardMaterial;
  uniforms: DetailUniforms;
  geos: Record<PickupKind, THREE.BufferGeometry>;
  glowTex: THREE.CanvasTexture;
  glowMats: Record<PickupKind, THREE.MeshBasicMaterial>;
  glowGeo: THREE.PlaneGeometry;
}

function getShared(): PickupShared {
  return acquire(
    'pickup-shared',
    () => {
      const uniforms = makeDetailUniforms();
      uniforms.pulse.value = 0.4;
      uniforms.pulseSpeed.value = 3.0;
      const material = createDetailMaterial(
        { tag: 'pickup', roughness: 0.55, metalness: 0.35, emis: true, panels: { x: 0.2, y: 0.2, z: 0.2, grime: 0.4, wear: 0.5, tint: 0.05 } },
        uniforms,
      ).material;
      const glowTex = makeRadialTexture(128, [
        [0, 'rgba(255,255,255,0.9)'],
        [0.35, 'rgba(255,255,255,0.28)'],
        [1, 'rgba(255,255,255,0)'],
      ]);
      const mk = (kind: PickupKind) =>
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: new THREE.Color(GLOW[kind]).multiplyScalar(0.7),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        });
      const glowGeo = new THREE.PlaneGeometry(0.95, 0.95);
      glowGeo.rotateX(-Math.PI / 2);
      return {
        material,
        uniforms,
        geos: { ammo: buildAmmo(), plate: buildPlate(), grenade: buildGrenadeRaw() },
        glowTex,
        glowMats: { ammo: mk('ammo'), plate: mk('plate'), grenade: mk('grenade') },
        glowGeo,
      };
    },
    (s) => {
      s.material.dispose();
      for (const g of Object.values(s.geos)) g.dispose();
      for (const m of Object.values(s.glowMats)) m.dispose();
      s.glowTex.dispose();
      s.glowGeo.dispose();
    },
  );
}

export function createPickupModelImpl(kind: PickupKind): THREE.Object3D {
  const s = getShared();
  const group = new THREE.Group();
  group.name = `Pickup:${kind}`;
  const mesh = new THREE.Mesh(s.geos[kind], s.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // shared time uniform stays in sync without an update hook
  mesh.onBeforeRender = () => {
    s.uniforms.time.value = performance.now() / 1000;
  };
  const glow = new THREE.Mesh(s.glowGeo, s.glowMats[kind]);
  glow.position.y = 0.012;
  glow.renderOrder = 3;
  group.add(glow, mesh);
  group.userData.dispose = () => release('pickup-shared');
  return group;
}
