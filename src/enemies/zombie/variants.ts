/**
 * Appearance variants: each (type, index) bakes one merged skinned geometry with its own outfit, skin tone, wounds
 * and stains. Geometry is shared by every rig that uses the variant.
 */
import * as THREE from 'three';
import type { ZombieType } from '../../types';
import { B, type Dims, NOMINAL_HEIGHT, makeDims, restPositions } from './dims';
import { type Ctx, V, addArmsSkin, addFeet, addHands, addHead, addLegsSkin, addNeck, addTorsoSkin, addWound, hex, headCenter } from './body';
import { type Outfit, addOutfit } from './garments';
import { addRiotGear, addWardenSuit } from './gear';
import { Accum, type Splat, type Weather } from './mesh';
import { mulberry32 } from './prng';

export const VARIANT_COUNT: Record<ZombieType, number> = { shambler: 9, runner: 5, armored: 4, warden: 1 };

const SHAMBLERS: Outfit[] = [
  { name: 'office', top: 'shirt', topColor: 0x8f9fb0, accent: 0x6b2a2a, sleeves: 'torn', bottom: 'slacks', bottomColor: 0x3b3e46, shoes: 'dress', shoeColor: 0x2a221c, hair: 'patchy', hairColor: 0x3a2c22, skin: 0xa39c82, extras: ['tie', 'belt', 'lanyard'] },
  { name: 'hoodie', top: 'hoodie', topColor: 0x71767c, accent: 0x444a50, sleeves: 'long', bottom: 'jeans', bottomColor: 0x3f4d61, shoes: 'sneakers', shoeColor: 0xa9a597, hair: 'patchy', hairColor: 0x1f1b18, skin: 0x8f9c88 },
  { name: 'coveralls', top: 'overalls', topColor: 0xb0703c, accent: 0x7d8288, sleeves: 'long', bottom: 'jeans', bottomColor: 0xb0703c, shoes: 'boots', shoeColor: 0x4a3a2c, hair: 'none', hairColor: 0x2a2420, skin: 0x97a38f },
  { name: 'gown', top: 'gown', topColor: 0x9cbcc0, accent: 0x9cbcc0, sleeves: 'none', bottom: 'none', bottomColor: 0x000000, shoes: 'barefoot', shoeColor: 0x000000, hair: 'long', hairColor: 0x4b433a, skin: 0xaab0ab },
  { name: 'military', top: 'jacket', topColor: 0x59623f, accent: 0x33372a, sleeves: 'long', bottom: 'cargo', bottomColor: 0x646a4c, shoes: 'combat', shoeColor: 0x2c2a26, hair: 'patchy', hairColor: 0x2c2620, skin: 0x84907c, extras: ['belt'] },
  { name: 'leather', top: 'jacket', topColor: 0x5a4636, accent: 0x2e3034, sleeves: 'long', bottom: 'jeans', bottomColor: 0x434c5e, shoes: 'boots', shoeColor: 0x2a2622, hair: 'long', hairColor: 0x2a2420, skin: 0x6f5a49 },
  { name: 'plaid', top: 'shirt', topColor: 0x914a40, accent: 0x33404e, sleeves: 'torn', bottom: 'jeans', bottomColor: 0x37424f, shoes: 'boots', shoeColor: 0x3a2f26, hair: 'patchy', hairColor: 0x77756d, skin: 0x9b9783, extras: ['bandage'] },
  { name: 'tank', top: 'tank', topColor: 0xbab7a9, accent: 0x4a5560, sleeves: 'none', bottom: 'shorts', bottomColor: 0x4d5a66, shoes: 'barefoot', shoeColor: 0x000000, hair: 'none', hairColor: 0x2a2420, skin: 0x6d5748 },
  { name: 'labcoat', top: 'labcoat', topColor: 0xc3c4bb, accent: 0x6f979b, sleeves: 'long', bottom: 'scrubs', bottomColor: 0x6f979b, shoes: 'sneakers', shoeColor: 0xb8b6aa, hair: 'strands', hairColor: 0x55504a, skin: 0xa2a58f, extras: ['lanyard'], missingShoe: 1 },
];

const RUNNERS: Outfit[] = [
  { name: 'torn-hoodie', top: 'hoodie', topColor: 0x656a70, accent: 0x40454a, sleeves: 'torn', bottom: 'scrubs', bottomColor: 0x2d3238, shoes: 'barefoot', shoeColor: 0, hair: 'strands', hairColor: 0x1c1816, skin: 0x9aa397 },
  { name: 'tank-runner', top: 'tank', topColor: 0x8f8d7f, accent: 0x40454a, sleeves: 'none', bottom: 'shorts', bottomColor: 0x3d4a5c, shoes: 'sneakers', shoeColor: 0x9c9a8c, hair: 'patchy', hairColor: 0x3d322a, skin: 0xa5a48f },
  { name: 'bare', top: 'none', topColor: 0, accent: 0, sleeves: 'none', bottom: 'cargo', bottomColor: 0x5c6046, shoes: 'barefoot', shoeColor: 0, hair: 'none', hairColor: 0x2a2420, skin: 0x8c968a },
  { name: 'plaid-runner', top: 'shirt', topColor: 0x7f4a44, accent: 0x33404e, sleeves: 'torn', bottom: 'jeans', bottomColor: 0x36414f, shoes: 'boots', shoeColor: 0x362d25, hair: 'long', hairColor: 0x2a241f, skin: 0x97957f },
  { name: 'scrubs', top: 'tshirt', topColor: 0x729aa0, accent: 0x729aa0, sleeves: 'short', bottom: 'scrubs', bottomColor: 0x729aa0, shoes: 'barefoot', shoeColor: 0, hair: 'strands', hairColor: 0x4a423a, skin: 0xa8ada6 },
];

function skinSet(base: number): { skin: THREE.Color; dark: THREE.Color; light: THREE.Color } {
  const skin = hex(base);
  const hsl = { h: 0, s: 0, l: 0 };
  skin.getHSL(hsl);
  const dark = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.06), hsl.l * 0.5);
  const light = new THREE.Color().setHSL(hsl.h, hsl.s * 0.85, Math.min(0.85, hsl.l * 1.14));
  return { skin, dark, light };
}

export function dimsFor(type: ZombieType): Dims {
  return makeDims(type, NOMINAL_HEIGHT[type]);
}

function seedFor(type: ZombieType, index: number): number {
  const t = type === 'shambler' ? 1 : type === 'runner' ? 2 : type === 'armored' ? 3 : 4;
  return (t * 7919 + index * 104729 + 12345) >>> 0;
}

function makeWeather(ctx: Ctx, seed: number, gore: number): Weather {
  const { D, rand } = ctx;
  const k = D.k;
  const hc = headCenter(D);
  const blood = new THREE.Color(0.2, 0.018, 0.016);
  const old = new THREE.Color(0.11, 0.055, 0.03);
  const splats: Splat[] = [];
  // mouth / chin / neck drool
  splats.push({ c: V(0, hc.y - 0.07 * k, hc.z - 0.07 * k), r: 0.075 * k, a: 0.9 * gore, color: blood });
  splats.push({ c: V(0, D.neckY - 0.02 * k, -0.05 * k), r: 0.1 * k, a: 0.85 * gore, color: blood });
  // chest / abdomen
  splats.push({ c: V((rand() - 0.5) * 0.1 * k, 1.16 * k, -0.11 * k), r: (0.12 + rand() * 0.08) * k, a: (0.55 + rand() * 0.3) * gore, color: rand() < 0.6 ? blood : old });
  // hands / forearms
  for (const s of [-1, 1]) {
    const w = ctx.rest[s < 0 ? B.haL : B.haR]!;
    splats.push({ c: V(w.x, w.y - 0.05 * k, w.z), r: 0.1 * k, a: 0.7 * gore, color: old });
  }
  const extra = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < extra; i++) {
    splats.push({ c: V((rand() - 0.5) * 0.5 * k, (0.3 + rand() * 1.2) * k, (rand() - 0.5) * 0.2 * k), r: (0.06 + rand() * 0.09) * k, a: (0.4 + rand() * 0.4) * gore, color: rand() < 0.5 ? blood : old });
  }
  return { seed, dirt: 0.7, tone: 1.32, splats };
}

export function buildVariant(type: ZombieType, index: number): THREE.BufferGeometry {
  const D = dimsFor(type);
  const seed = seedFor(type, index);
  const rand = mulberry32(seed);
  const acc = new Accum();
  let outfit: Outfit;
  let girth = 0.92 + rand() * 0.22;
  let gaunt = 0.2;
  let gore = 1;
  if (type === 'shambler') {
    outfit = SHAMBLERS[index % SHAMBLERS.length]!;
  } else if (type === 'runner') {
    outfit = RUNNERS[index % RUNNERS.length]!;
    girth = 0.9 + rand() * 0.08;
    gaunt = 0.85;
    gore = 1.15;
  } else if (type === 'armored') {
    outfit = { name: 'riot', top: 'jacket', topColor: [0x4c5359, 0x545c44, 0x4b4e56, 0x5b5548][index % 4]!, accent: 0x3a3d40, sleeves: 'long', bottom: 'cargo', bottomColor: [0x4d5346, 0x474b53, 0x55554b, 0x484f4a][index % 4]!, shoes: 'combat', shoeColor: 0x2a2825, hair: 'none', hairColor: 0x2a2420, skin: [0x8b978a, 0x7d8a80, 0x99998a, 0x6c5a4c][index % 4]! };
    girth = 1.0 + rand() * 0.06;
    gaunt = 0.3;
  } else {
    outfit = { name: 'hazmat', top: 'jacket', topColor: 0x8a7a2a, accent: 0x40402a, sleeves: 'long', bottom: 'cargo', bottomColor: 0x8a7a2a, shoes: 'combat', shoeColor: 0x1f1d1a, hair: 'none', hairColor: 0x2a2420, skin: 0x8b978a };
    girth = 1;
    gaunt = 0.2;
  }
  const sk = skinSet(outfit.skin);
  const ctx: Ctx = {
    acc,
    D,
    rest: restPositions(D),
    rand,
    girth,
    skin: sk.skin,
    skinDark: sk.dark,
    skinLight: sk.light,
    eye: type === 'warden' ? new THREE.Color(1.0, 0.32, 0.1) : new THREE.Color(0.5, 0.95, 0.82),
    eyeGlow: type === 'warden' ? 3.2 : 1.6,
  };

  const rib = type === 'runner' ? 0.9 : type === 'shambler' ? 0.25 : 0;
  if (type === 'warden') {
    // the hazmat suit covers everything; only build what is visible through it
    addTorsoSkin(ctx);
    addNeck(ctx, 1.4);
    addArmsSkin(ctx);
    addLegsSkin(ctx);
    addFeet(ctx, 'combat', hex(0x1f1d1a));
    addWardenSuit(ctx);
  } else {
    addTorsoSkin(ctx, undefined, rib);
    addNeck(ctx);
    addHead(ctx, { hair: type === 'armored' ? 'none' : outfit.hair, hairColor: hex(outfit.hairColor), gaunt, teeth: hex(0xb3a988) });
    addArmsSkin(ctx);
    addLegsSkin(ctx);
    addHands(ctx, type === 'armored' ? { glove: hex(0x1b1c1e), gloveSpec: 0.2, clawColor: hex(0x1b1c1e) } : {});
    addOutfit(ctx, outfit);
    if (type === 'armored') addRiotGear(ctx, index);
    // wounds
    if (type !== 'armored') {
      const k = D.k;
      if (rand() < 0.7) addWound(ctx, V((rand() < 0.5 ? -1 : 1) * 0.16 * k, 1.36 * k, -0.03 * k), 0.035 * k, B.chest, V(rand() < 0.5 ? -0.6 : 0.6, 0.2, -0.5));
      if (rand() < 0.5) addWound(ctx, V(0.02 * k, 1.42 * k, -0.06 * k), 0.028 * k, B.neck, V(0.3, 0.1, -1));
    }
  }
  return acc.toGeometry(makeWeather(ctx, seed, gore));
}
