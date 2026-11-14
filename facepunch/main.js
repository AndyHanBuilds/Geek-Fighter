// Boot and the frame loop.
import * as THREE from 'three';
import * as Head from './head.js';
import * as Hands from './hands.js';
import * as Game from './game.js';
import { fx } from './fx.js';
import { initInput } from './input.js';
import { initUI, liveStep, loadPhoto } from './ui.js';
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color('#10131f');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); camera.position.set(0, 0, 7);
scene.add(Head.group);
let VIEW_H = 1, VIEW_W = 1;
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  VIEW_H = 2 * Math.tan(THREE.MathUtils.degToRad(35 / 2)) * 7; VIEW_W = VIEW_H * camera.aspect;
  camera.position.z = Math.max(7, 7 * (3.0 / VIEW_W));   // keep the face visible on tall phones
}
addEventListener('resize', resize); resize();
const fist = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
fist.visible = false; scene.add(fist);
const ray = new THREE.Raycaster(), P = new THREE.Vector3();
function toPlane(cx, cy) {
  ray.setFromCamera({ x: (cx / innerWidth - 0.5) * 2, y: -(cy / innerHeight - 0.5) * 2 }, camera);
  ray.ray.at(-ray.ray.origin.z / ray.ray.direction.z, P); return P.clone();
}
initInput(canvas, toPlane); initUI();
window.game = { loadPhoto, state: Game.game };
let last = performance.now();
function frame(ts) {
  const dt = (ts - last) / 1000; last = ts;
  if (Head.state.ready) {
    liveStep(ts, VIEW_W, VIEW_H);
    if (fx.hitStop > 0) fx.hitStop -= dt; else Head.update(dt);
    Game.update(dt); Head.sync();
  }
  fist.visible = Hands.fist.visible; fist.position.set(Hands.fist.x, Hands.fist.y, 1); fist.scale.setScalar(Hands.fist.scale);
  fx.shake = Math.max(0, fx.shake - dt * 0.6);
  camera.position.x = (Math.random() - .5) * fx.shake; camera.position.y = (Math.random() - .5) * fx.shake;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
