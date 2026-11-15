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
}
export const dizzy = () => {};
