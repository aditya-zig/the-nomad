/** Small hand-held props: world grenade projectile and lying signal flare. */
import * as THREE from 'three';
import { GeoBatch, acquire, createDetailMaterial, hdr, makeDetailUniforms, release, type DetailUniforms } from './util';

const OLIVE = 0x4c5537;
const OLIVE_DARK = 0x353c26;
const STEEL = 0x8a8f94;

/** Frag grenade geometry (origin at body centre, ~0.09 m bounding radius, +Y up). Reused by the grenade pickup. */
export function buildGrenadeGeo(): THREE.BufferGeometry {
  const b = new GeoBatch();
  // body: slightly egg-shaped
  const body = new THREE.SphereGeometry(0.055, 18, 12);
  b.add(body, OLIVE, { scale: [1, 1.12, 1] });
  // segmentation grooves
  for (const y of [-0.028, 0, 0.028]) {
    const r = Math.sqrt(Math.max(0.0001, 0.055 * 0.055 - (y / 1.12) * (y / 1.12)));
    b.torus(r * 1.005, 0.0042, 6, 20, Math.PI * 2, OLIVE_DARK, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] });
  }
  // neck band + fuze
  b.cyl(0.02, 0.026, 0.026, 10, 0xb8a13a, { pos: [0, 0.066, 0] });
  b.cyl(0.014, 0.017, 0.032, 10, 0x2e3330, { pos: [0, 0.089, 0] });
  b.cyl(0.006, 0.006, 0.02, 6, STEEL, { pos: [0.008, 0.108, 0], rot: [0, 0, 0.3] });
  // safety lever (spoon) hugging the body
  b.box(0.012, 0.09, 0.0032, 0x6d7278, { pos: [0.043, 0.036, 0], rot: [0, 0, -0.34] });
  b.box(0.02, 0.012, 0.004, 0x6d7278, { pos: [0.028, 0.082, 0] });
  // pull ring
  b.torus(0.0125, 0.0018, 5, 12, Math.PI * 2, STEEL, { pos: [-0.008, 0.108, 0], rot: [Math.PI / 2, 0.4, 0] });
  // tiny status LED so the projectile reads in the dark
  b.sphere(0.0065, 6, 4, 0xff3a1a, { pos: [0.02, 0.052, 0.036] }, hdr(0xff2a10, 2.6));
  return b.build();
}

interface SmallShared {
  material: THREE.MeshStandardMaterial;
  uniforms: DetailUniforms;
  grenade: THREE.BufferGeometry;
  flare: THREE.BufferGeometry;
}

function buildFlareGeo(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const r = 0.021;
  const L = 0.3;
  const rot = [0, 0, Math.PI / 2] as [number, number, number];
  // paper tube with printed bands
  b.cyl(r, r, L, 12, 0xa52a20, { rot });
  b.cyl(r * 1.03, r * 1.03, 0.03, 12, 0x23262a, { pos: [-0.09, 0, 0], rot });
  b.cyl(r * 1.03, r * 1.03, 0.012, 12, 0xe0d4b0, { pos: [-0.06, 0, 0], rot });
  b.cyl(r * 1.03, r * 1.03, 0.012, 12, 0xe0d4b0, { pos: [0.04, 0, 0], rot });
  // striker cap
  b.cyl(r * 1.12, r * 1.12, 0.05, 12, 0x1e2124, { pos: [-L / 2 - 0.02, 0, 0], rot });
  b.cyl(r * 0.5, r * 1.12, 0.014, 12, 0x3a3f44, { pos: [-L / 2 - 0.052, 0, 0], rot });
  // spike end
  b.cyl(0.002, 0.008, 0.045, 8, 0x70757a, { pos: [-L / 2 - 0.09, 0, 0], rot: [0, 0, -Math.PI / 2] });
  // ignition tip: glowing
  b.cyl(r * 0.96, r, 0.03, 12, 0x2a1a12, { pos: [L / 2 + 0.005, 0, 0], rot }, hdr(0xff5a1a, 2.8));
  b.sphere(r * 0.9, 10, 6, 0xffa050, { pos: [L / 2 + 0.02, 0, 0], scale: [0.5, 1, 1] }, hdr(0xff8a30, 4));
  return b.build();
}

function getShared(): SmallShared {
  return acquire(
    'small-shared',
    () => {
      const uniforms = makeDetailUniforms();
      uniforms.pulse.value = 0.25;
      const material = createDetailMaterial(
        { tag: 'small', roughness: 0.55, metalness: 0.35, emis: true, panels: { x: 0.12, y: 0.12, z: 0.12, grime: 0.35, wear: 0.4, tint: 0.05 } },
        uniforms,
      ).material;
      return { material, uniforms, grenade: buildGrenadeGeo(), flare: buildFlareGeo() };
    },
    (s) => {
      s.material.dispose();
      s.grenade.dispose();
      s.flare.dispose();
    },
  );
}

/** World grenade projectile. Origin at its centre. */
export function createGrenadeModelImpl(): THREE.Object3D {
  const shared = getShared();
  const g = new THREE.Group();
  g.name = 'Grenade';
  const mesh = new THREE.Mesh(shared.grenade, shared.material);
  mesh.castShadow = true;
  g.add(mesh);
  g.userData.dispose = () => release('small-shared');
  return g;
}

/** Lying flare stick, origin at ground level under its centre, axis along local X. */
export function createFlareModelImpl(): THREE.Object3D {
  const shared = getShared();
  const g = new THREE.Group();
  g.name = 'FlareStick';
  const mesh = new THREE.Mesh(shared.flare, shared.material);
  mesh.position.y = 0.023;
  mesh.castShadow = true;
  g.add(mesh);
  g.userData.dispose = () => release('small-shared');
  return g;
}
