// Game feel: hit-stop, slow motion, shockwave rings, sparks, plain impact numbers,
// screen flash, and the sound entry point.
import * as THREE from 'three';
import { scene, quality, toScreen } from './arena.js';
import * as snd from './sound.js';

export const sound = (name, opts) => snd.play(name, opts);

let stop = 0, slow = 1, slowLeft = 0;
export const hitStop = s => { stop = Math.max(stop, s); };
export function slowmo(scale, seconds) { slow = scale; slowLeft = seconds; }
// real seconds in, game seconds out
export function tick(real) {
  if (slowLeft > 0) { slowLeft -= real; if (slowLeft <= 0) slow = 1; }
  if (stop > 0) { stop -= real; return 0; }
  return real * slow;
}

function tex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dotTex = tex(32, (g, s) => { const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, '#fff'); r.addColorStop(0.4, '#ffe680'); r.addColorStop(1, 'rgba(255,160,0,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });

// shockwave rings
const rings = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  m.visible = false; m.renderOrder = 8; scene.add(m); return { m, life: 0, size: 1 };
});
// sparks
const SP = 140, sPos = new Float32Array(SP * 3), sVel = new Float32Array(SP * 3), sLife = new Float32Array(SP);
const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.24, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
sparks.frustumCulled = false; sparks.renderOrder = 9; scene.add(sparks); sPos.fill(999);
let sNext = 0;

const wordsEl = document.getElementById('words'), flashEl = document.getElementById('flash');

// the layered hit: ring, sparks, number. Small hits get small effects.
export function impact(x, y, strength, combo = 0, value = 0) {
  const r = rings.find(q => q.life <= 0) || rings[0];
  r.life = 1; r.size = 0.45 + strength * 0.75; r.m.position.set(x, y, 0.8); r.m.visible = true;
  r.m.material.color.set(strength > 1.15 ? 0xfff0a0 : 0xffffff);
  const n = Math.round((quality.low ? 5 : 12) * (0.5 + strength));
  for (let k = 0; k < n; k++) {
    const i = sNext; sNext = (sNext + 1) % SP;
    const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 5) * (0.6 + strength * 0.5);
    sPos[3 * i] = x; sPos[3 * i + 1] = y; sPos[3 * i + 2] = 0.9;
    sVel[3 * i] = Math.cos(a) * v; sVel[3 * i + 1] = Math.sin(a) * v + 2; sVel[3 * i + 2] = 1 + Math.random() * 3;
    sLife[i] = 0.35 + Math.random() * 0.3;
  }
  if (strength > 1.15) flash(0.35);
  word(String(value) + (combo >= 3 ? '  x' + combo : ''), x, y + 0.5, strength);
}

export function word(text, x, y, strength = 1, cls = '') {
  const p = toScreen(x, y, 0.8), el = document.createElement('div');
  el.className = 'word ' + cls; el.textContent = text;
  el.style.left = Math.max(60, Math.min(innerWidth - 60, p.x)) + 'px'; el.style.top = Math.max(130, p.y) + 'px';
  el.style.setProperty('--rot', ((Math.random() - 0.5) * 24) + 'deg'); el.style.setProperty('--sc', 0.75 + strength * 0.45);
  wordsEl.appendChild(el); setTimeout(() => el.remove(), 700);
  while (wordsEl.children.length > 6) wordsEl.firstChild.remove();
}
export function flash(a = 0.5) { flashEl.style.transition = 'none'; flashEl.style.opacity = a; requestAnimationFrame(() => { flashEl.style.transition = 'opacity .25s'; flashEl.style.opacity = 0; }); }

export function update(dt, real) {
  for (const r of rings) if (r.life > 0) {
    r.life -= real / 0.32; const k = 1 - Math.max(0, r.life);
    r.m.scale.setScalar(r.size * (0.25 + 1.6 * (1 - (1 - k) ** 2))); r.m.material.opacity = Math.max(0, r.life) * 0.55;
    if (r.life <= 0) r.m.visible = false;
  }
  for (let i = 0; i < SP; i++) if (sLife[i] > 0) {
    sLife[i] -= real; sVel[3 * i + 1] -= 14 * real;
    sPos[3 * i] += sVel[3 * i] * real; sPos[3 * i + 1] += sVel[3 * i + 1] * real; sPos[3 * i + 2] += sVel[3 * i + 2] * real;
    if (sLife[i] <= 0) sPos[3 * i] = 999;
  }
  sGeo.attributes.position.needsUpdate = true;
  updateLumps(real);
}
export const dizzy = () => {};

// ---------- lumps: at the turn switch every dent pops back out as a big silly sphere ----------
const LUMP_MAX = 6, POP = 0.5, HOLD = 0.8, OUT = 0.5, GAP = 0.1;
const lumpGeo = new THREE.SphereGeometry(1, quality.low ? 16 : 24, quality.low ? 10 : 16);
const lumpList = [];
const elastic = k => k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
// merge nearby hits, keep the biggest few, make each one a sphere sitting half out of the face
export function lumps(head) {
  const hits = head.hits || []; if (!hits.length) return 0;
  const groups = [];
  for (const h of hits) {
    const g = groups.find(q => (q.x - h.x) ** 2 + (q.y - h.y) ** 2 < 0.2);
    if (g) { g.dmg += h.dmg; g.n++; } else groups.push({ ...h, n: 1 });
  }
  groups.sort((a, b) => b.dmg - a.dmg); groups.length = Math.min(groups.length, LUMP_MAX);
  groups.sort((a, b) => a.y - b.y);
  const tint = ['#c8325a', '#a63a8c', '#d4503a'];
  groups.forEach((g, k) => {
    const r = 0.2 + 0.26 * Math.min(1, g.dmg / 9) + 0.04 * Math.min(g.n - 1, 3);
    const mat = new THREE.MeshStandardMaterial({ color: head.skin.clone().lerp(new THREE.Color(tint[k % 3]), 0.62), roughness: 0.3, metalness: 0 });
    mat.emissive = mat.color.clone().multiplyScalar(0.18);
    const m = new THREE.Mesh(lumpGeo, mat); m.frustumCulled = false; m.renderOrder = 4;
    const nl = Math.hypot(g.nx, g.ny, g.nz) || 1;
    m.position.set(g.x + g.nx / nl * r * 0.45, g.y + g.ny / nl * r * 0.45, g.z + g.nz / nl * r * 0.45);
    m.scale.setScalar(0.0001); head.headG.add(m);
    lumpList.push({ m, mat, head, r, t: -k * GAP, popped: false });
  });
  const total = (groups.length - 1) * GAP + POP + HOLD;
  head.dentRelease(total, OUT);
  return total + OUT;
}
function updateLumps(real) {
  for (let i = lumpList.length - 1; i >= 0; i--) {
    const L = lumpList[i]; L.t += real;
    if (L.t >= 0 && !L.popped) { L.popped = true; sound('brainrot_bonk', { gain: 0.9, rate: 1.1 + Math.random() * 0.3, channel: 'pop' + (i % 3) }); }
    let s;
    if (L.t < 0) s = 0.0001;
    else if (L.t < POP) s = L.r * elastic(L.t / POP);
    else if (L.t < POP + HOLD) s = L.r;
    else { const k = Math.min(1, (L.t - POP - HOLD) / OUT); s = L.r * (1 - k * k * (3 - 2 * k)); }
    if (L.t >= POP + HOLD + OUT || !L.head.root.parent) { L.m.removeFromParent(); L.mat.dispose(); lumpList.splice(i, 1); continue; }
    L.m.scale.setScalar(Math.max(0.0001, s));
  }
}
export function clearLumps() { for (const L of lumpList) { L.m.removeFromParent(); L.mat.dispose(); } lumpList.length = 0; }
