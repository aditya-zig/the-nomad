/**
 * ONE shared material for every zombie. Vertex colours carry the albedo, `aGlow` adds emissive light in the vertex
 * colour, and `aSpec` lerps roughness / metalness toward a hard-surface look (armour plates, visors, plastic, wet
 * wounds). A small tiling grunge map adds cloth and dirt micro-detail. Result: a single draw call per rig.
 */
import * as THREE from 'three';
import { clamp } from './prng';

function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => {
    const aa = ((a % period) + period) % period;
    const bb = ((b % period) + period) % period;
    let n = Math.imul(aa + seed * 57, 374761393) + Math.imul(bb, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function createDetailTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const low = periodicNoise(u * 4, v * 4, 4, 1) * 0.55 + periodicNoise(u * 8, v * 8, 8, 2) * 0.3 + periodicNoise(u * 16, v * 16, 16, 3) * 0.15;
      const fine = periodicNoise(u * 64, v * 64, 64, 4);
      const stain = periodicNoise(u * 3, v * 3, 3, 9);
      let val = 0.86 + (low - 0.5) * 0.34 + (fine - 0.5) * 0.14;
      if (stain > 0.62) val -= (stain - 0.62) * 0.9;
      // faint cloth weave
      val += Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48) * 0.018;
      const g8 = Math.round(clamp(val, 0.35, 1) * 255);
      const o = (y * size + x) * 4;
      img.data[o] = g8;
      img.data[o + 1] = g8;
      img.data[o + 2] = g8;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function createZombieMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map,
    bumpMap: map,
    bumpScale: 1.6,
    roughness: 0.9,
    metalness: 0,
  });
  mat.name = 'ZombieShared';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aSpec;\nvarying float vGlow;\nvarying float vSpec;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvSpec = aSpec;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vSpec;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vSpec);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.7, vSpec);')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow;\n{ float rimK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0); totalEmissiveRadiance += vec3(0.075, 0.115, 0.17) * rimK * (1.0 - clamp(vGlow, 0.0, 1.0)); }',
      );
  };
  mat.customProgramCacheKey = () => 'zombie-shared-v1';
  return mat;
}
