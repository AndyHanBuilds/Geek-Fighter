// The ring, the crowd, the lights and the camera rig.
import * as THREE from 'three';

export const canvas = document.getElementById('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d0b1e');
scene.fog = new THREE.Fog('#0d0b1e', 12, 26);
export const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
export const quality = { low: false, mode: 'auto', scale: 1 };

const FOV_T = Math.tan(THREE.MathUtils.degToRad(35 / 2));
const rig = { trauma: 0, kx: 0, ky: 0, kvx: 0, kvy: 0, push: 0, pushV: 0, zoom: 0, zoomT: 0, baseZ: 7.6, t: 0, pan: 0, panV: 0 };
export const view = { w: 4, h: 4 };

// ---- lights
scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x3a2a55, 0.95));
const key = new THREE.DirectionalLight(0xfff0d0, 1.5); key.position.set(1.5, 5, 6); scene.add(key);
const rimA = new THREE.PointLight(0xff3fa4, 60, 14); rimA.position.set(-4.5, 1.5, -1.5); scene.add(rimA);
const rimB = new THREE.PointLight(0x35d6ff, 60, 14); rimB.position.set(4.5, 1.5, -1.5); scene.add(rimB);

// ---- ring
const std = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
const mat = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 12), std('#2b5fd9', 0.8));
mat.position.set(0, -3.75, -2); scene.add(mat);
const apron = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.3, 12.4), std('#e8e8f0'));
apron.position.set(0, -3.95, -2); scene.add(apron);
[['#ff3355', -1.2], ['#f4f4ff', -1.95], ['#3aa0ff', -2.7]].forEach(([c, y]) => {
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 17, 8), std(c, 0.4));
  rope.rotation.z = Math.PI / 2; rope.position.set(0, y, -5.5); scene.add(rope);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 10, 8), std(c, 0.4));
    side.rotation.x = Math.PI / 2; side.position.set(sx * 8.4, y, -0.6); scene.add(side);
  }
});
[['#ff3355', -8.4], ['#3aa0ff', 8.4]].forEach(([c, x]) => {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.4, 12), std(c, 0.45));
  post.position.set(x, -2.0, -5.5); scene.add(post);
});

// ---- crowd backdrop (one painted texture) and camera flashes
function crowdTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512); grad.addColorStop(0, '#07061a'); grad.addColorStop(0.55, '#1c1140'); grad.addColorStop(1, '#2a1658');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 9; row++) {
    const y = 190 + row * 36, r = 13 + row * 2.2;
    for (let x = -20; x < 1044; x += r * 2.1) {
      const hue = 250 + rnd() * 70, light = 12 + row * 2.4 + rnd() * 6;
      g.fillStyle = `hsl(${hue} 45% ${light}%)`;
      const ox = x + rnd() * 10, oy = y + rnd() * 12;
      g.beginPath(); g.arc(ox, oy, r, 0, 6.3); g.fill();
      g.fillRect(ox - r * 1.25, oy + r * 0.8, r * 2.5, r * 2.4);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const crowd = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), new THREE.MeshBasicMaterial({ map: crowdTexture(), fog: false }));
crowd.position.set(0, 2.2, -13); scene.add(crowd);

const FL = 46, flashPos = new Float32Array(FL * 3), flashCol = new Float32Array(FL * 3), flashLife = new Float32Array(FL);
for (let i = 0; i < FL; i++) { flashPos[3 * i] = (Math.random() - 0.5) * 34; flashPos[3 * i + 1] = -1 + Math.random() * 5; flashPos[3 * i + 2] = -12.6; }
const flashGeo = new THREE.BufferGeometry();
flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
const flashes = new THREE.Points(flashGeo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
scene.add(flashes);

// ---- spotlight cone over the fighter
const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 11, 28, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
cone.position.set(0, 2.2, -1.2); scene.add(cone);
const pool = new THREE.Mesh(new THREE.CircleGeometry(4.4, 40), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
pool.rotation.x = -Math.PI / 2; pool.position.set(0, -3.49, -1.2); scene.add(pool);

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(quality.low ? Math.min(devicePixelRatio, 1) * quality.scale : Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const baseW = 2 * FOV_T * 7.6 * camera.aspect;
  rig.baseZ = Math.max(7.6, 7.6 * (3.5 / baseW));       // keep the whole face on tall phone screens
  view.h = 2 * FOV_T * rig.baseZ; view.w = view.h * camera.aspect;
}
addEventListener('resize', resize);

export function setQuality(low) { quality.low = low; quality.scale = 1; flashes.visible = !low; cone.visible = !low; resize(); }

export const addTrauma = a => { rig.trauma = Math.min(1, rig.trauma + a); };
export function kick(dx, dy, s) { rig.kvx += dx * s * 5; rig.kvy += dy * s * 5; rig.pushV += s * 7; }
export const whip = dir => { rig.panV += dir * 26; };
export const zoom = z => { rig.zoomT = z; };
export function crowdPop(n = 10) { for (let k = 0; k < n; k++) flashLife[(Math.random() * FL) | 0] = 0.25 + Math.random() * 0.2; }

const ray = new THREE.Raycaster(), P = new THREE.Vector3(), ndc = new THREE.Vector2();
// screen point -> point on the head plane (z = 0)
export function toPlane(clientX, clientY) {
  ndc.set((clientX / innerWidth - 0.5) * 2, -(clientY / innerHeight - 0.5) * 2);
  ray.setFromCamera(ndc, camera);
  const t = -ray.ray.origin.z / ray.ray.direction.z; ray.ray.at(t, P);
  return { x: P.x, y: P.y };
}
// world point -> screen pixels
export function toScreen(x, y, z) {
  P.set(x, y, z).project(camera);
  return { x: (P.x * 0.5 + 0.5) * innerWidth, y: (-P.y * 0.5 + 0.5) * innerHeight };
}

export function update(dt) {
  rig.t += dt;
  rig.trauma = Math.max(0, rig.trauma - dt * 1.6);
  const sh = rig.trauma * rig.trauma;
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;       // small steps keep the springs stable on slow frames
  for (let q = 0; q < steps; q++) {
    rig.kvx += (-140 * rig.kx - 16 * rig.kvx) * h; rig.kx += rig.kvx * h;
    rig.kvy += (-140 * rig.ky - 16 * rig.kvy) * h; rig.ky += rig.kvy * h;
    rig.pushV += (-160 * rig.push - 15 * rig.pushV) * h; rig.push += rig.pushV * h;
    rig.panV += (-90 * rig.pan - 11 * rig.panV) * h; rig.pan += rig.panV * h;
  }
  rig.zoom += (rig.zoomT - rig.zoom) * Math.min(1, dt * 5);
  const n = (a, b) => Math.sin(rig.t * a + b) * Math.sin(rig.t * a * 1.7 + b * 2);
  camera.position.set(rig.kx * 0.12 + n(47, 1) * sh * 0.3 + rig.pan,
    0.05 + rig.ky * 0.12 + n(53, 2) * sh * 0.3 + rig.zoom * 0.25,
    rig.baseZ * (1 - 0.3 * rig.zoom) - Math.max(-0.6, Math.min(0.9, rig.push)) * 0.5);
  camera.lookAt(rig.pan * 0.6, -0.2 + rig.zoom * 0.25, 0);
  camera.rotation.z += n(41, 3) * sh * 0.07 + rig.zoom * 0.06;
  if (!quality.low) {
    if (Math.random() < dt * 5) flashLife[(Math.random() * FL) | 0] = 0.22;
    for (let i = 0; i < FL; i++) {
      flashLife[i] = Math.max(0, flashLife[i] - dt);
      const v = flashLife[i] * 4; flashCol[3 * i] = v; flashCol[3 * i + 1] = v; flashCol[3 * i + 2] = v * 1.1;
    }
    flashGeo.attributes.color.needsUpdate = true;
    cone.material.opacity = 0.07 + Math.sin(rig.t * 1.3) * 0.012;
  }
}
export const render = () => renderer.render(scene, camera);
resize();
