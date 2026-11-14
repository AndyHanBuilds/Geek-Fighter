// Head: scan to mesh, jelly physics, bruises, head springs.
import * as THREE from 'three';
import Delaunator from 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';
export const group = new THREE.Group();
const headGroup = group;
export const state = { ready: false };
// ---------- face mesh ----------
let mesh = null, geo = null, N = 0, base, off, vel, uvs, tri, nbr, bruise, colors, tex;
const HALF_W = 1.0;                       // face is 2 units wide
let faceWidthScale = 1;

export function build(lm, aspect, texture) {
  N = 468;
  const pts2 = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) { pts2[2 * i] = lm[i].x * aspect; pts2[2 * i + 1] = lm[i].y; }
  const d = new Delaunator(pts2);
  let w = 0, minx = 9, maxx = -9;
  for (let i = 0; i < N; i++) { minx = Math.min(minx, pts2[2 * i]); maxx = Math.max(maxx, pts2[2 * i]); }
  w = maxx - minx;
  const keep = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
    const e = (p, q) => Math.hypot(pts2[2 * p] - pts2[2 * q], pts2[2 * p + 1] - pts2[2 * q + 1]);
    if (Math.max(e(a, b), e(b, c), e(c, a)) < 0.30 * w) keep.push(a, b, c);
  }
  tri = new Uint32Array(keep);
  uvs = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { uvs[2 * i] = lm[i].x; uvs[2 * i + 1] = 1 - lm[i].y; }
  base = new Float32Array(N * 3); off = new Float32Array(N * 3); vel = new Float32Array(N * 3);
  bruise = new Float32Array(N); colors = new Float32Array(N * 3).fill(1);
  // neighbour lists
  const sets = Array.from({ length: N }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]]; sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b); }
  nbr = sets.map(s => Array.from(s));
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(tri, 1));
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, side: THREE.DoubleSide });
  if (mesh) { headGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; headGroup.add(mesh);
  setPose(lm, aspect); state.ready = true;
}

// landmarks -> centred, scaled scene positions (face width = 2 units); z grows toward the camera
export function setPose(lm, aspect) {
  let cx = 0, cy = 0, cz = 0, minx = 9, maxx = -9;
  for (let i = 0; i < N; i++) { cx += lm[i].x; cy += lm[i].y; cz += lm[i].z; minx = Math.min(minx, lm[i].x); maxx = Math.max(maxx, lm[i].x); }
  cx /= N; cy /= N; cz /= N;
  const k = 2 / ((maxx - minx) * aspect);
  for (let i = 0; i < N; i++) {
    base[3 * i] = (lm[i].x - cx) * aspect * k;
    base[3 * i + 1] = -(lm[i].y - cy) * k;
    base[3 * i + 2] = -(lm[i].z - cz) * aspect * k * 1.1;
  }
}

// ---------- jelly physics ----------
const K = 150, C = 5.5, KN = 70;     // spring, damping, neighbour coupling
const head = { rx: 0, ry: 0, vx: 0, vy: 0, px: 0, py: 0, pz: 0, vpx: 0, vpy: 0, vpz: 0 };
const P = new THREE.Vector3();

export function hit({ x: px, y: py, dx = 0, dy = 0, strength = 1 }) {
  if (!mesh) return;
  strength = Math.max(0.35, Math.min(1.8, strength));
  const sig = 0.55;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const x = base[3 * i] + off[3 * i], y = base[3 * i + 1] + off[3 * i + 1];
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    const w = Math.exp(-d2 / (sig * sig));
    if (w < 0.01) continue;
    vel[3 * i] += dx * strength * w * 6; vel[3 * i + 1] += dy * strength * w * 6; vel[3 * i + 2] -= strength * w * 16;
    bruise[i] = Math.min(1, bruise[i] + w * 0.55 * strength); n++;
  }
  head.vx += -py * strength * 5 + dy * strength * 3;   // tilt away from the blow
  head.vy += px * strength * 5 + dx * strength * 3;
  head.vpz -= strength * 4; head.vpx += dx * strength * 3; head.vpy += dy * strength * 3;
}

export function update(dt) {
  dt = Math.min(dt, 1 / 30);
  const sub = 2, h = dt / sub;
  for (let s = 0; s < sub; s++) {
    for (let i = 0; i < N; i++) {
      for (let a = 0; a < 3; a++) {
        const idx = 3 * i + a;
        let acc = -K * off[idx] - C * vel[idx];
        let avg = 0; const L = nbr[i];
        for (let j = 0; j < L.length; j++) avg += off[3 * L[j] + a];
        acc += KN * (avg / L.length - off[idx]);
        vel[idx] += acc * h;
      }
    }
    for (let i = 0; i < 3 * N; i++) off[i] += vel[i] * h;
    // rigid head springs
    head.vx += (-60 * head.rx - 5 * head.vx) * h; head.rx += head.vx * h;
    head.vy += (-60 * head.ry - 5 * head.vy) * h; head.ry += head.vy * h;
    head.vpx += (-50 * head.px - 5 * head.vpx) * h; head.px += head.vpx * h;
    head.vpy += (-50 * head.py - 5 * head.vpy) * h; head.py += head.vpy * h;
    head.vpz += (-50 * head.pz - 5 * head.vpz) * h; head.pz += head.vpz * h;
  }
  for (let i = 0; i < N; i++) {
    bruise[i] = Math.max(0, bruise[i] - dt * 0.12);
    const b = bruise[i]; colors[3 * i] = 1; colors[3 * i + 1] = 1 - 0.55 * b; colors[3 * i + 2] = 1 - 0.65 * b;
  }
}

export function sync() {
  const pos = geo.attributes.position.array;
  for (let i = 0; i < 3 * N; i++) pos[i] = base[i] + off[i];
  geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  headGroup.rotation.set(THREE.MathUtils.clamp(head.rx, -0.35, 0.35), THREE.MathUtils.clamp(head.ry, -0.35, 0.35), 0);
  headGroup.position.set(head.px, head.py, head.pz);
}


export function knock(z, rx) { head.vpz += z; head.vx += rx; }
