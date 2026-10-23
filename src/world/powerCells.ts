/** Lightweight cache-mounted salvage: shared geometry/materials, no textures or extra lights. */
import * as THREE from 'three';

export class PowerCellModels {
  private readonly body = new THREE.CylinderGeometry(0.105, 0.105, 0.42, 8);
  private readonly band = new THREE.CylinderGeometry(0.111, 0.111, 0.065, 8);
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x3c4640, metalness: 0.7, roughness: 0.5 });
  private readonly charge = new THREE.MeshStandardMaterial({ color: 0xb7eb80, emissive: 0x84d646, emissiveIntensity: 2 });

  create(count: number): THREE.Group {
    const g = new THREE.Group();
    g.name = 'NomadPowerCells';
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.24;
      const body = new THREE.Mesh(this.body, this.metal);
      body.position.set(x, 1.02, 0);
      const band = new THREE.Mesh(this.band, this.charge);
      band.position.set(x, 1.09, 0);
      g.add(body, band);
    }
    return g;
  }

  dispose(): void {
    this.body.dispose();
    this.band.dispose();
    this.metal.dispose();
    this.charge.dispose();
  }
}
