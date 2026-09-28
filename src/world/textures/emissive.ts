/**
 * Emissive material painters: lamp lenses, contamination / cryo glows, monitor screens, lit windows.
 * Emissive intensities are > 1 so the (restrained) bloom pass picks them up without washing out the scene.
 */
import * as THREE from 'three';
import { type PaintCtx, SM, SS, TexBuilder, finishMaterial, sstep } from './core';
import { canvasTexture, makeCanvas } from './stencil';

export type EmissiveName = 'lampWarm' | 'lampCool' | 'lampRed' | 'emGreen' | 'emBlue' | 'emAmber' | 'screen' | 'windowLit';

function plain(color: number, emissive: number, intensity: number, rough = 0.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: rough, metalness: 0 });
}

/** Swirling glow (liquid / gas): dark tinted albedo + noisy emissive map. */
function glowNoise(ctx: PaintCtx, base: [number, number, number], hot: [number, number, number], intensity: number): THREE.MeshStandardMaterial {
  const n = 256;
  const tb = new TexBuilder(n, { emissive: true });
  const { bank } = ctx;
  const em = tb.emissive!;
  for (let y = 0; y < n; y++) {
    const rowB = ((y * 2) & SM) << SS;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bi = rowB | ((x * 2) & SM);
      const swirl = bank.macro[bi]! * 0.55 + bank.mid[(bi + 300) & 262143]! * 0.45;
      const fine = bank.fine[bi]!;
      const k = 0.55 + 0.6 * sstep(0.25, 0.85, swirl) + (fine - 0.5) * 0.2;
      const o = i * 4;
      tb.albedo[o] = base[0] * 0.2;
      tb.albedo[o + 1] = base[1] * 0.2;
      tb.albedo[o + 2] = base[2] * 0.2;
      em[o] = Math.min(255, hot[0] * k);
      em[o + 1] = Math.min(255, hot[1] * k);
      em[o + 2] = Math.min(255, hot[2] * k);
      em[o + 3] = 255;
      tb.orm[o + 1] = 70;
      tb.height[i] = swirl * 0.5;
    }
  }
  const m = finishMaterial(ctx, tb, { tile: 2, normalStrength: 1.5, roughness: 1 });
  m.emissiveIntensity = intensity;
  return m;
}

function paintScreen(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 256;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = 'rgb(5,13,22)';
  g.fillRect(0, 0, w, h);
  // header bar
  g.fillStyle = 'rgb(20,110,140)';
  g.fillRect(8, 8, w - 16, 16);
  g.fillStyle = 'rgb(140,230,255)';
  g.fillRect(12, 12, 60, 8);
  g.fillRect(w - 52, 12, 36, 8);
  // text rows
  g.fillStyle = 'rgb(60,190,210)';
  const lens = [180, 140, 200, 90, 160, 120, 176, 70];
  for (let i = 0; i < lens.length; i++) g.fillRect(12, 34 + i * 11, lens[i]!, 5);
  // waveform graph
  g.strokeStyle = 'rgb(90,255,150)';
  g.lineWidth = 2;
  g.strokeRect(12, 132, w - 24, 70);
  g.beginPath();
  for (let x = 0; x <= w - 26; x += 4) {
    const y = 167 + Math.sin(x * 0.09) * 18 + Math.sin(x * 0.31) * 8 + Math.sin(x * 0.021) * 6;
    if (x === 0) g.moveTo(14 + x, y);
    else g.lineTo(14 + x, y);
  }
  g.stroke();
  // amber status tiles
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i === 2 ? 'rgb(255,150,40)' : 'rgb(40,150,170)';
    g.fillRect(12 + i * 40, 212, 32, 24);
  }
  // scanlines
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  const tex = ctx.track(canvasTexture(canvas));
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.7,
    roughness: 0.25,
    metalness: 0.1,
  });
  return m;
}

function paintWindowLit(ctx: PaintCtx): THREE.MeshStandardMaterial {
  const w = 256;
  const h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgb(255,214,140)');
  grad.addColorStop(1, 'rgb(255,168,84)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // curtain / interior shadow and blinds
  g.fillStyle = 'rgba(120,60,20,0.35)';
  g.fillRect(0, 0, 70, h);
  g.fillStyle = 'rgba(90,40,10,0.22)';
  for (let y = 12; y < h; y += 14) g.fillRect(0, y, w, 4);
  // silhouette of a lamp / furniture
  g.fillStyle = 'rgba(70,30,10,0.4)';
  g.fillRect(150, 150, 70, 106);
  // mullions
  g.fillStyle = 'rgb(22,18,14)';
  g.fillRect(0, 0, w, 10);
  g.fillRect(0, h - 10, w, 10);
  g.fillRect(0, 0, 10, h);
  g.fillRect(w - 10, 0, 10, h);
  g.fillRect(w / 2 - 5, 0, 10, h);
  g.fillRect(0, h / 2 - 5, w, 10);
  const tex = ctx.track(canvasTexture(canvas));
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.5,
    roughness: 0.5,
    metalness: 0,
  });
}

export function paintEmissive(ctx: PaintCtx, name: EmissiveName): THREE.MeshStandardMaterial {
  switch (name) {
    case 'lampWarm':
      return plain(0x2a1a0c, 0xffa858, 2.4);
    case 'lampCool':
      return plain(0x1a1e26, 0xbcd8ff, 2.0);
    case 'lampRed':
      return plain(0x240604, 0xff2412, 2.6);
    case 'emAmber':
      return plain(0x2a1a04, 0xffa012, 2.2);
    case 'emGreen':
      return glowNoise(ctx, [40, 255, 120], [40, 255, 120], 1.7);
    case 'emBlue':
      return glowNoise(ctx, [60, 160, 255], [60, 160, 255], 1.7);
    case 'screen':
      return paintScreen(ctx);
    case 'windowLit':
      return paintWindowLit(ctx);
  }
}

