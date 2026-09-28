/**
 * TEMPLATE dev harness: shows how to preview an asset under the game's blue-hour lighting.
 * Copy this file for your own harness (dev/<name>.html + dev/<name>.ts). Vite serves /dev/<name>.html in dev.
 * Scripted screenshots: `node scripts/shot.mjs http://127.0.0.1:PORT/dev/stage-demo.html out.png --waitfor "window.__ready" --eval "window.setCam(6,3,8, 0,1,0)"`
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment, createRenderer, createSkyDome, setupBlueHour } from '../src/render/stage';
import { createMaterialLib } from '../src/world/materials';
import { RENDER } from '../src/config';

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyDome();
scene.add(sky);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.7;
const rig = setupBlueHour(scene, 30);
renderer.shadowMap.enabled = true;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
camera.position.set(6, 3, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const mats = createMaterialLib();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mats.get('asphalt'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mats.get('containerRed'));
cube.position.set(0, 1, 0);
cube.castShadow = true;
scene.add(cube);

(window as unknown as { setCam: (...a: number[]) => void }).setCam = (x, y, z, tx, ty, tz) => {
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  controls.update();
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  sky.position.copy(camera.position);
  (sky.userData.uniforms.uTime as THREE.IUniform).value = now / 1000;
  rig.focusShadow(controls.target);
  renderer.render(scene, camera);
  void dt;
  (window as unknown as { __ready: boolean }).__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
