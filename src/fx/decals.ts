/**
 * Decal pools: one InstancedMesh per family (bullet holes, blood, scorch) drawn as lit, alpha-blended quads laid on
 * surfaces. Fixed-capacity ring buffers; per-instance tile selection (atlas cell) and fade alpha come from instanced
 * attributes injected into a standard PBR material so decals pick up scene lighting, shadows and reflections.
 */
import * as THREE from 'three';
import { makeBasis, basis } from './rng';

export interface DecalPoolOpts {
  name: string;
  cap: number;
  atlas: THREE.Texture;
  cols: number;
  rows: number;
  roughness: number;
  metalness?: number;
  renderOrder: number;
  /** Extra polygon offset strength (larger = stronger pull toward the camera). */
  offset?: number;
}

export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private limit: number;
  private cursor = 0;
  private readonly alive: Uint8Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly fadeTime: Float32Array;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly m = new THREE.Matrix4();
  private dirtyAlpha = false;
  liveCount = 0;

  constructor(o: DecalPoolOpts) {
    this.cap = o.cap;
    this.limit = o.cap;
    this.alive = new Uint8Array(o.cap);
    this.age = new Float32Array(o.cap);
    this.life = new Float32Array(o.cap);
    this.fadeTime = new Float32Array(o.cap);

    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(o.cap), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(o.cap * 2), 2);
    this.tileAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aTile', this.tileAttr);

    const off = o.offset ?? 1;
    this.material = new THREE.MeshStandardMaterial({
      map: o.atlas,
      transparent: true,
      depthWrite: false,
      roughness: o.roughness,
      metalness: o.metalness ?? 0,
      polygonOffset: true,
      polygonOffsetFactor: -2 * off,
      polygonOffsetUnits: -2 * off,
    });
    const tileScale = new THREE.Vector2(1 / o.cols, 1 / o.rows);
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTileScale = { value: tileScale };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aAlpha;\nattribute vec2 aTile;\nuniform vec2 uTileScale;\nvarying float vDecalAlpha;',
        )
        .replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\nvDecalAlpha = aAlpha;\n#ifdef USE_MAP\nvMapUv = (uv + aTile) * uTileScale;\n#endif',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalAlpha;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalAlpha;');
    };
    this.material.customProgramCacheKey = () => 'fxDecalAtlas';

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, o.cap);
    this.mesh.name = o.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < o.cap; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Place a decal at `p` (already offset from the surface) facing normal `n`. `size` is the quad edge in metres.
   * Life / fade in seconds: alpha stays 1 until `life - fade`, then fades to 0.
   */
  add(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    size: number,
    spin: number,
    col: number,
    row: number,
    life: number,
    fade: number,
  ): void {
    if (this.limit <= 0) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    makeBasis(nx, ny, nz);
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const tx = basis.tx * c + basis.bx * s;
    const ty = basis.ty * c + basis.by * s;
    const tz = basis.tz * c + basis.bz * s;
    const bx = -basis.tx * s + basis.bx * c;
    const by = -basis.ty * s + basis.by * c;
    const bz = -basis.tz * s + basis.bz * c;
    this.m.set(
      tx * size, bx * size, nx, px,
      ty * size, by * size, ny, py,
      tz * size, bz * size, nz, pz,
      0, 0, 0, 1,
    );
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive[i] = 1;
    this.age[i] = 0;
    this.life[i] = life;
    this.fadeTime[i] = Math.max(0.01, fade);
    this.alphaAttr.setX(i, 1);
    this.tileAttr.setXY(i, col, row);
    this.tileAttr.needsUpdate = true;
    this.dirtyAlpha = true;
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.alive[i] === 0) continue;
      const age = this.age[i] + dt;
      this.age[i] = age;
      const remaining = this.life[i] - age;
      if (remaining <= 0) {
        this.kill(i);
        continue;
      }
      live++;
      const f = this.fadeTime[i];
      if (remaining < f) {
        this.alphaAttr.setX(i, remaining / f);
        this.dirtyAlpha = true;
      }
    }
    this.liveCount = live;
    if (this.dirtyAlpha) {
      this.alphaAttr.needsUpdate = true;
      this.dirtyAlpha = false;
    }
  }

  private kill(i: number): void {
    this.alive[i] = 0;
    this.alphaAttr.setX(i, 0);
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirtyAlpha = true;
  }

  setLimit(n: number): void {
    const lim = Math.max(0, Math.min(this.cap, Math.floor(n)));
    for (let i = lim; i < this.cap; i++) if (this.alive[i]) this.kill(i);
    this.limit = lim;
    if (lim > 0) this.cursor %= lim;
    else this.cursor = 0;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) if (this.alive[i]) this.kill(i);
    this.cursor = 0;
    this.liveCount = 0;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
