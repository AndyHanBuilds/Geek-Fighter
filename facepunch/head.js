// A punchable, realistic head built from one photo or scan: a dense skin mesh
// with soft-tissue physics, real eye and mouth interiors, reaction expressions,
// mild bruising and swelling, and a skull, ears, neck and shoulders coloured
// from the photo itself.
import * as THREE from 'three';
import Delaunator from 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';

const K = 150, C = 6, KN = 80;            // tissue spring, damping, neighbour coupling
const NL = 468;                           // face landmarks used for the skin

// landmark groups (same numbering on every face)
const LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const LIP_UP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LIP_LO_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const EYES = [
  { up: [246, 161, 160, 159, 158, 157, 173], lo: [7, 163, 144, 145, 153, 154, 155], ends: [33, 133], top: 159, bot: 145 },
  { up: [466, 388, 387, 386, 385, 384, 398], lo: [249, 390, 373, 374, 380, 381, 382], ends: [263, 362], top: 386, bot: 374 },
];
const BROWS = [[70, 63, 105, 66, 107, 55, 65, 52, 53, 46], [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]];
const CHEEKS = [50, 280];
const RING_D = [0.13, 0.3, 0.5], RING_A = [0.97, 0.6, 0], RING_W = [0.55, 1, 1];   // rim rings: distance, opacity, pull onto the skull
const RING_PIN = [0.6, 0.25, 0];

// reaction presets: jaw drop, eye squeeze, brows up, set brow, cheek puff, rolling eyes, crossed eyes
const EXPR = {
  neutral: { jaw: 0, squint: 0, brow: 0, grit: 0, puff: 0, dizzy: 0, cross: 0 },
  hurt: { jaw: 0.1, squint: 0.3, brow: 0.5, grit: 0, puff: 0, dizzy: 0, cross: 0 },
  hit: { jaw: 0.45, squint: 0.9, brow: 0.5, grit: 0, puff: 0.3, dizzy: 0, cross: 0 },
  heavy: { jaw: 0.9, squint: 0.35, brow: 0.9, grit: 0, puff: 1, dizzy: 0, cross: 1 },
  ko: { jaw: 0.75, squint: 0.45, brow: 0.3, grit: 0, puff: 0.1, dizzy: 1, cross: 0 },
  grit: { jaw: 0, squint: 0.3, brow: 0, grit: 1, puff: 0, dizzy: 0, cross: 0 },
};
const KEYS = ['jaw', 'squint', 'brow', 'grit', 'puff', 'dizzy', 'cross'];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = THREE.MathUtils.clamp;

let teethTex;
function teethTexture() {
  if (teethTex) return teethTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32); grad.addColorStop(0, '#a39584'); grad.addColorStop(0.35, '#ddd3c2'); grad.addColorStop(1, '#c9bda9');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 32);
  g.strokeStyle = 'rgba(70,50,45,0.5)'; g.lineWidth = 1.5;
  for (let k = 1; k < 10; k++) { const x = k * 25.6 + (k % 2 ? 2 : -2); g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 32); g.stroke(); }
  teethTex = new THREE.CanvasTexture(c); teethTex.colorSpace = THREE.SRGBColorSpace; return teethTex;
}
let hairTex;
// fine streaks so the hair is not one flat colour
function hairTexture() {
  if (hairTex) return hairTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, 256, 64);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 420; k++) { const v = 150 + rnd() * 105 | 0; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(rnd() * 256, 0, 0.6 + rnd() * 1.6, 64); }
  hairTex = new THREE.CanvasTexture(c); hairTex.colorSpace = THREE.SRGBColorSpace; hairTex.wrapS = THREE.RepeatWrapping; hairTex.repeat.set(3, 1); return hairTex;
}

export class Head {
  constructor(opts = {}) {
    this.name = opts.name || 'FACE';
    this.root = new THREE.Group();         // whole fighter: fall and swap animations
    this.pivot = new THREE.Group();        // base of the neck: the head rocks around it
    this.headG = new THREE.Group();
    this.root.add(this.pivot); this.pivot.add(this.headG);
    this.spring = { rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, vpx: 0, vpy: 0, vpz: 0 };
    this.w = { ...EXPR.neutral }; this.wT = { ...EXPR.neutral }; this.exprHold = 0; this.idle = 'neutral';
    this.skew = 0;
    this.fallV = 0; this.fallP = 0; this.fallT = 0;      // 0 standing, 1 knocked down
    this.swap = 0; this.swapT = 0; this.swapDir = 1;     // 0 on stage, 1 off stage
    this.bumpP = 0; this.bumpV = 0; this.bumpT = 0; this.bumpTimer = 0;
    this.reliefAmt = 0; this.reliefT = 0;
    this.turn = [0, 0, 0]; this.turnS = [0, 0, 0]; this.mirrorAt = -1e9;     // live head turn, copied from the camera
    this.t = Math.random() * 10; this.live = false; this.kind = 'photo';
  }

  // source: an image or canvas; lm: 478 face landmarks in picture coordinates
  static fromLandmarks(lm, source, opts = {}) {
    const h = new Head(opts);
    const w = source.naturalWidth || source.width, ht = source.naturalHeight || source.height;
    h.aspect = w / ht;
    const tex = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true; h.tex = tex;
    h._colours(source, w, ht, lm);
    h._topology(lm);
    h.setPose(lm, h.aspect);
    h._rig();
    h._material();
    h._interiors(lm);
    h._dress();
    h._occlusion();
    return h;
  }

  // a small blurred copy of the picture for colour lookups; skin, neck and hair colours come from it
  _colours(source, w, h, lm) {
    this.skin = new THREE.Color('#c99a7c'); this.hair = new THREE.Color('#2a211c'); this.neckCol = this.skin.clone().multiplyScalar(0.85);
    try {
      const c = document.createElement('canvas'), s = Math.min(1, 160 / Math.max(w, h)); c.width = Math.max(2, Math.round(w * s)); c.height = Math.max(2, Math.round(h * s));
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(source, 0, 0, c.width, c.height);
      this.px = { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      const fh = lm[152].y - lm[10].y, fw = lm[454].x - lm[234].x, P = (u, v, r) => this._sample(u, v, r);
      this.skin = P(lm[50].x, lm[50].y, 0.03).lerp(P(lm[280].x, lm[280].y, 0.03), 0.5);
      const jaw = P(lm[172].x * 0.6 + lm[152].x * 0.4, lm[172].y * 0.5 + lm[152].y * 0.5, 0.02);
      this.neckCol = lm[152].y + fh * 0.12 < 0.98 ? P(lm[152].x, lm[152].y + fh * 0.12, 0.025).lerp(jaw, 0.5) : jaw.clone().multiplyScalar(0.8);
      const hy = Math.max(0.01, lm[10].y - fh * 0.16);
      this.hair = P(lm[10].x, hy, 0.03).lerp(P(lm[10].x - fw * 0.22, hy + fh * 0.02, 0.03), 0.33).lerp(P(lm[10].x + fw * 0.22, hy + fh * 0.02, 0.03), 0.33);
    } catch (e) { this.px = null; }
  }
  // average colour of a patch of the picture (u, v in 0..1); with strict, null when it is outside the picture
  _sample(u, v, r = 0.02, strict = false) {
    const p = this.px;
    if (!p || (strict && (u < 0 || u > 1 || v < 0 || v > 1))) return strict ? null : this.skin.clone();
    const x0 = clamp(Math.round((u - r) * p.w), 0, p.w - 1), x1 = clamp(Math.round((u + r) * p.w), x0, p.w - 1);
    const y0 = clamp(Math.round((v - r) * p.h), 0, p.h - 1), y1 = clamp(Math.round((v + r) * p.h), y0, p.h - 1);
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = 4 * (y * p.w + x); R += p.d[i]; G += p.d[i + 1]; B += p.d[i + 2]; n++; }
    return new THREE.Color().setRGB(R / n / 255, G / n / 255, B / n / 255, THREE.SRGBColorSpace);
  }
  // how far a sampled colour can be trusted to belong to the head and not the background: 0..1
  _trust(c) {
    const d = q => Math.hypot(c.r - q.r, c.g - q.g, c.b - q.b);
    return 1 - smooth(0.1, 0.22, Math.min(d(this.skin), d(this.hair), d(this.neckCol)));
  }

  // triangles over the landmarks, holes for eyes and mouth, three rim rings, then one round of subdivision
  _topology(lm) {
    const asp = this.aspect, pts = new Float64Array(NL * 2);
    let minx = 9, maxx = -9;
    for (let i = 0; i < NL; i++) { pts[2 * i] = lm[i].x * asp; pts[2 * i + 1] = lm[i].y; minx = Math.min(minx, pts[2 * i]); maxx = Math.max(maxx, pts[2 * i]); }
    const maxEdge = 0.3 * (maxx - minx), d = new Delaunator(pts);
    const mouthSet = new Set([...LIP_UP_IN, ...LIP_LO_IN]);
    const eyeSets = EYES.map(e => new Set([...e.up, ...e.lo, ...e.ends]));
    const holes = [mouthSet, ...eyeSets], inHole = (a, b, c) => holes.some(s => s.has(a) && s.has(b) && (c === undefined || s.has(c)));
    const e = (p, q) => Math.hypot(pts[2 * p] - pts[2 * q], pts[2 * p + 1] - pts[2 * q + 1]);
    const tris = [];
    for (let t = 0; t < d.triangles.length; t += 3) {
      const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
      if (Math.max(e(a, b), e(b, c), e(c, a)) < maxEdge && !inHole(a, b, c)) tris.push(a, b, c);
    }
    // derived vertices are described by their parents so a live pose can rebuild them
    const der = [];                                // {a, b} midpoint, or {p, r} rim point of ring r
    const alpha = new Array(NL).fill(1);
    // outer boundary: the longest loop of edges that belong to one triangle only
    const count = new Map(), key = (a, b) => (a < b ? a * 4096 + b : b * 4096 + a);
    const edges = t => [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]];
    for (let t = 0; t < tris.length; t += 3) for (const [a, b] of edges(t)) count.set(key(a, b), (count.get(key(a, b)) || 0) + 1);
    const nxt = new Map();
    for (let t = 0; t < tris.length; t += 3) for (const [a, b] of edges(t)) if (count.get(key(a, b)) === 1 && !inHole(a, b)) nxt.set(a, b);
    let loop = []; const seen = new Set();
    for (const start of nxt.keys()) {
      if (seen.has(start)) continue; const L = []; let cur = start;
      for (let n = 0; cur !== undefined && !seen.has(cur) && n < 400; n++) { seen.add(cur); L.push(cur); cur = nxt.get(cur); }
      if (cur === start && L.length > loop.length) loop = L;
    }
    if (loop.length <= 20) loop = [];
    this.loop = loop; this.rings = [];
    if (loop.length) {
      const ids = [loop];
      RING_D.forEach((_, r) => { ids.push(loop.map(p => { der.push({ p, r }); alpha.push(RING_A[r]); return NL + der.length - 1; })); });
      this.rings = ids.slice(1);
      for (let r = 0; r < RING_D.length; r++) for (let j = 0; j < loop.length; j++) {
        const j2 = (j + 1) % loop.length, a = ids[r][j], b = ids[r][j2], a1 = ids[r + 1][j], b1 = ids[r + 1][j2];
        tris.push(a, b, b1, a, b1, a1);
      }
    }
    // one round of midpoint subdivision makes the skin dense enough to bend smoothly
    const mid = new Map(), out = [];
    const m = (a, b) => {
      const k2 = a < b ? a * 65536 + b : b * 65536 + a; let v = mid.get(k2);
      if (v === undefined) { der.push({ a, b }); alpha.push(1); v = NL + der.length - 1; mid.set(k2, v); }
      return v;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
      out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const N = this.N = NL + der.length; this.der = der;
    this.base = new Float32Array(N * 3); this.off = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.bruise = new Float32Array(N); this.bump = new Float32Array(N); this.relief = new Float32Array(N); this.ao = new Float32Array(N).fill(1);
    this.alpha = Float32Array.from(alpha); this.imgX = new Float32Array(N); this.imgY = new Float32Array(N);
    for (let i = 0; i < NL; i++) { this.imgX[i] = lm[i].x; this.imgY[i] = lm[i].y; }
    this.colors = new Float32Array(N * 4).fill(1);
    this._tris = out;
  }

  // landmarks -> an upright head, centred, face width = 2; z grows toward the camera
  setPose(lm, aspect) {
    const base = this.base, first = !this.sk;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < NL; i++) { cx += lm[i].x; cy += lm[i].y; cz += lm[i].z; }
    cx /= NL; cy /= NL; cz /= NL;
    for (let i = 0; i < NL; i++) { base[3 * i] = (lm[i].x - cx) * aspect; base[3 * i + 1] = -(lm[i].y - cy); base[3 * i + 2] = -(lm[i].z - cz) * aspect; }
    // take the tilt, turn and nod of the picture out, so every head starts upright
    const lim = a => clamp(a, -0.6, 0.6), D = (a, b, k) => base[3 * a + k] - base[3 * b + k];
    const rot = (u, v, ang) => { const c = Math.cos(ang), s = Math.sin(ang); for (let i = 0; i < NL; i++) { const a = base[3 * i + u], b = base[3 * i + v]; base[3 * i + u] = a * c - b * s; base[3 * i + v] = a * s + b * c; } };
    const roll = lim(Math.atan2(D(263, 33, 1), D(263, 33, 0))); rot(0, 1, -roll);
    const yaw = lim(Math.atan2(D(454, 234, 2), D(454, 234, 0))); rot(0, 2, -yaw);
    const nod = lim(Math.atan2(D(10, 152, 2), D(10, 152, 1))); rot(1, 2, -nod);
    this.turn = [nod, -yaw, roll];
    const mx = (base[3 * 234] + base[3 * 454]) / 2, k = 2 / Math.max(1e-6, base[3 * 454] - base[3 * 234]);
    for (let i = 0; i < NL; i++) { base[3 * i] = (base[3 * i] - mx) * k; base[3 * i + 1] *= k; base[3 * i + 2] *= k; }
    if (first) this._measure(); else this.mirrorAt = performance.now();
    // picture coordinates as a straight-line function of head x, y (least squares over the landmarks)
    const fit = this._fit(lm); if (first) this.fit = fit;
    // rim rings: out from the face edge, onto the skull above the jaw, folding back under it
    const sk = this.sk;
    this.rings.forEach((ring, r) => ring.forEach((v, j) => {
      const p = this.loop[j], px = base[3 * p], py = base[3 * p + 1], pz = base[3 * p + 2];
      let dx = px, dy = py - sk.midY; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const s = RING_D[r], jawW = smooth(sk.noseY, sk.mouthY, py);
      const q = this._skullFront(px + dx * s, py + dy * s);
      const flat = pz - 0.5 * s, ux = q.x, uy = q.y, uz = flat + (Math.min(q.z + 0.035, pz) - flat) * RING_W[r];
      const lx = px + dx * s * 0.4, ly = py + dy * s * 0.5, lz = pz - s * 1.25;
      const i = 3 * v;
      base[i] = ux + (lx - ux) * jawW; base[i + 1] = uy + (ly - uy) * jawW; base[i + 2] = uz + (lz - uz) * jawW;
      if (first) {
        // the texture follows the picture outward; where that leaves the picture or meets the background, the rim goes clear
        const ex = dx * s, ey = dy * s, u = lm[p].x + fit[1] * ex + fit[2] * ey, w = lm[p].y + fit[4] * ex + fit[5] * ey;
        this.imgX[v] = clamp(u, 0.002, 0.998); this.imgY[v] = clamp(w, 0.002, 0.998);
        const col = this._sample(u, w, 0.02, true);
        this.alpha[v] = col ? RING_A[r] * (0.2 + 0.8 * this._trust(col)) : 0;
      }
    }));
    this.der.forEach((q, j) => {
      if (q.p !== undefined) return;
      const v = NL + j, i = 3 * v, a = 3 * q.a, b = 3 * q.b;
      base[i] = (base[a] + base[b]) / 2; base[i + 1] = (base[a + 1] + base[b + 1]) / 2; base[i + 2] = (base[a + 2] + base[b + 2]) / 2;
      if (first) { this.imgX[v] = (this.imgX[q.a] + this.imgX[q.b]) / 2; this.imgY[v] = (this.imgY[q.a] + this.imgY[q.b]) / 2; this.alpha[v] = (this.alpha[q.a] + this.alpha[q.b]) / 2; }
    });
    if (first) { const uv = this._uv = new Float32Array(this.N * 2); for (let i = 0; i < this.N; i++) { uv[2 * i] = this.imgX[i]; uv[2 * i + 1] = 1 - this.imgY[i]; } }
  }
  _fit(lm) {
    const b = this.base; let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, su = 0, sv = 0, sxu = 0, syu = 0, sxv = 0, syv = 0;
    for (let i = 0; i < NL; i++) { const x = b[3 * i], y = b[3 * i + 1], u = lm[i].x, v = lm[i].y; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; su += u; sv += v; sxu += x * u; syu += y * u; sxv += x * v; syv += y * v; }
    const n = NL, mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cxy = sxy / n - mx * my, cyy = syy / n - my * my, det = cxx * cyy - cxy * cxy || 1e-9;
    const solve = (st, sxt, syt) => { const mt = st / n, cxt = sxt / n - mx * mt, cyt = syt / n - my * mt, a = (cxt * cyy - cyt * cxy) / det, c = (cyt * cxx - cxt * cxy) / det; return [mt - a * mx - c * my, a, c]; };
    return [...solve(su, sxu, syu), ...solve(sv, sxv, syv)];       // u = f0 + f1 x + f2 y, v = f3 + f4 x + f5 y
  }

  // head measurements taken once from the upright face; the skull is built from them
  _measure() {
    const b = this.base, Y = i => b[3 * i + 1], Z = i => b[3 * i + 2];
    const chin = Y(152), eyeY = (Y(159) + Y(145) + Y(386) + Y(374)) / 4, half = eyeY - chin;
    const top = eyeY + half * 0.98, cy = eyeY + half * 0.3;
    let edgeZ = 0, n = 0; for (let i = 0; i < NL; i++) if (Math.abs(b[3 * i]) > 0.85) { edgeZ += Z(i); n++; } edgeZ = n ? edgeZ / n : -0.5;
    const rz = 1.36, ry = top - cy;
    // the forehead sits on the skull: the front of the skull passes just behind the top of the forehead
    const f = Math.sqrt(Math.max(0.05, 1 - ((Y(10) - cy) / ry) ** 2));
    const cz = Math.min(Z(10) - 0.05 - rz * f, edgeZ - 0.25);
    this.sk = { chin, eyeY, top, cy, ry, ryLow: cy - (chin + 0.32), rx: 1.07, rz, cz, edgeZ, noseY: Y(2), mouthY: (Y(13) + Y(14)) / 2, midY: (eyeY + Y(2)) / 2, earY: (eyeY + Y(2)) / 2 };
  }
  // unit sphere direction -> skull surface: a wide dome that narrows toward the jaw and the nape
  _skull(sx, sy, sz) {
    const k = this.sk, y = k.cy + sy * (sy >= 0 ? k.ry : k.ryLow), t = sy >= 0 ? 0 : -sy;
    const x = sx * k.rx * (1 - 0.3 * t * t);
    const z = k.cz + sz * (sz >= 0 ? k.rz * (1 - 0.75 * smooth(0, 0.8, t)) : k.rz * (1 - 0.28 * t * t));
    return [x, y, z];
  }
  // the front of the skull at head x, y; points outside its outline are pulled onto the outline
  _skullFront(x, y) {
    const k = this.sk; let sy = clamp((y - k.cy) / (y >= k.cy ? k.ry : k.ryLow), -0.98, 0.98);
    const t = sy >= 0 ? 0 : -sy; let sx = x / (k.rx * (1 - 0.3 * t * t));
    const r = Math.hypot(sx, sy); if (r > 0.96) { sx *= 0.96 / r; sy *= 0.96 / r; }
    const p = this._skull(sx, sy, Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)));
    return { x: p[0], y: p[1], z: p[2] };
  }

  // per-vertex weights for the reactions and for how soft the tissue is
  _rig() {
    const N = this.N, b = this.base, X = i => b[3 * i], Y = i => b[3 * i + 1];
    const mk = () => new Float32Array(N);
    const rJaw = this.rJaw = mk(), rLid = this.rLid = mk(), rLip = this.rLip = mk(), rBrow = this.rBrow = mk(), rGrit = this.rGrit = mk(), rPuff = this.rPuff = mk(), soft = this.soft = mk();
    const mouthY = (Y(13) + Y(14)) / 2, chinY = Y(152), mouthX = X(13), span = mouthY - chinY;
    for (let i = 0; i < NL; i++) {
      const t = (mouthY - Y(i)) / span;
      if (t > 0.12) rJaw[i] = smooth(0.12, 0.4, t) * Math.max(0, 1 - ((X(i) - mouthX) / 1.15) ** 2);
    }
    const arc = (list, lo, arr, sign) => list.forEach((v, j) => { const p = Math.sin(j / (list.length - 1) * Math.PI); arr[v] = sign * (lo + (1 - lo) * p); });
    arc(LIP_LO_IN, 0, rJaw, 1); arc(LIP_LO_OUT, 0.25, rJaw, 1);
    arc(LIP_UP_IN, 0, rLip, 1); arc(LIP_UP_OUT, 0, rLip, 0.6);
    for (const v of [78, 308, 61, 291]) rJaw[v] = 0.2;
    for (const eye of EYES) {
      const midY = Y(eye.top) * 0.3 + Y(eye.bot) * 0.7;
      for (const v of eye.up) rLid[v] = (midY - Y(v)) * 0.97;
      for (const v of eye.lo) rLid[v] = (midY - Y(v)) * 0.85;
    }
    for (const brow of BROWS) {
      let far = 0; for (const v of brow) far = Math.max(far, Math.abs(X(v)));
      for (const v of brow) { rBrow[v] = 1; rGrit[v] = 0.03 - 0.1 * (1 - Math.abs(X(v)) / far) ** 1.2; }
    }
    for (const c of CHEEKS) for (let i = 0; i < NL; i++) {
      const d2 = (X(i) - X(c)) ** 2 + (Y(i) - (Y(c) - 0.15)) ** 2;
      rPuff[i] = Math.max(rPuff[i], Math.exp(-d2 / 0.12));
    }
    // the rim is pinned to the skull: it moves less the further out it sits
    const pin = this.pin = new Float32Array(N).fill(1);
    this.der.forEach((q, j) => {
      const i = NL + j;
      if (q.p !== undefined) pin[i] = RING_PIN[q.r]; else pin[i] = (pin[q.a] + pin[q.b]) / 2;
      for (const arr of [rJaw, rLid, rLip, rBrow, rGrit, rPuff]) arr[i] = q.p !== undefined ? arr[q.p] * RING_PIN[q.r] : (arr[q.a] + arr[q.b]) / 2;
    });
    // cheeks and jowls are loose, forehead and nose bridge are tight
    for (let i = 0; i < N; i++) soft[i] = clamp(Math.max(rPuff[i], rJaw[i] * 0.85), 0, 1);
  }

  _material() {
    const N = this.N, geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this._uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(this._fixWinding(this._tris));
    const sets = Array.from({ length: N }, () => new Set()), tri = geo.index.array;
    for (let t = 0; t < tri.length; t += 3) { const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]]; sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b); }
    this.nbr = sets.map(s => Array.from(s));
    // skin: the photo carries the colour, the lights add shape and a soft sheen
    this.skinMat = new THREE.MeshStandardMaterial({ map: this.tex, vertexColors: true, transparent: true, roughness: 0.58, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, this.skinMat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.headG.add(this.mesh);
  }
  // make every triangle face the camera (the picture has y down, the scene has y up)
  _fixWinding(list) {
    const X = this.imgX, Y = this.imgY, out = new Uint32Array(list.length);
    for (let t = 0; t < list.length; t += 3) {
      const a = list[t], q = list[t + 1], c = list[t + 2];
      const area = (X[q] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[q] - Y[a]);
      out[t] = a; out[t + 1] = area > 0 ? c : q; out[t + 2] = area > 0 ? q : c;
    }
    return new THREE.BufferAttribute(out, 1);
  }

  // eyes that sit behind the lids with an iris that can move, and a mouth with the
  // photo's own interior, teeth and a dark cavity behind the lips
  _interiors(lm) {
    const f = this.fit, det = f[1] * f[5] - f[2] * f[4] || 1e-9;
    const toHead = (du, dv) => [(du * f[5] - dv * f[2]) / det, (dv * f[1] - du * f[4]) / det];      // picture offset -> head offset
    const part = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; this.headG.add(m); return m; };
    const dyn = n => new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.eyes = EYES.map(e => {
      const ring = [e.ends[0], ...e.lo, e.ends[1], ...e.up.slice().reverse()], n = ring.length;
      let cu = 0, cv = 0; for (const v of ring) { cu += lm[v].x; cv += lm[v].y; } cu /= n; cv /= n;
      // the photo's own eye, a little larger than the opening, behind the lids
      const g = new THREE.BufferGeometry(), uv = new Float32Array((n + 1) * 2), idx = [];
      uv[0] = cu; uv[1] = 1 - cv;
      ring.forEach((v, j) => { uv[2 * (j + 1)] = cu + (lm[v].x - cu) * 1.5; uv[2 * (j + 1) + 1] = 1 - (cv + (lm[v].y - cv) * 1.5); });
      for (let j = 0; j < n; j++) idx.push(0, j + 1, (j + 1) % n + 1);
      g.setAttribute('position', dyn(n + 1)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      part(g, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.5, side: THREE.DoubleSide }), 1);
      // the iris, found by the tracker; it rides in front of a plain white that only shows when the eye moves
      const ci = [468, 473].sort((a, b) => Math.hypot(lm[a].x - cu, lm[a].y - cv) - Math.hypot(lm[b].x - cu, lm[b].y - cv))[0], ic = lm[ci];
      let ir = 0; for (let q = 1; q <= 4; q++) ir += Math.hypot((lm[ci + q].x - ic.x) * this.aspect, lm[ci + q].y - ic.y) / 4;
      const whiteAt = end => this._sample(ic.x + (lm[end].x - ic.x) * 0.62, ic.y + (lm[end].y - ic.y) * 0.62, 0.004);
      const white = whiteAt(e.ends[0]).lerp(whiteAt(e.ends[1]), 0.5);
      const wg = new THREE.BufferGeometry(), wcol = new Float32Array((n + 1) * 3);
      for (let j = 0; j <= n; j++) { const s = j ? 0.62 : 1; wcol[3 * j] = white.r * s; wcol[3 * j + 1] = white.g * s * 0.93; wcol[3 * j + 2] = white.b * s * 0.93; }
      wg.setAttribute('position', dyn(n + 1)); wg.setAttribute('color', new THREE.BufferAttribute(wcol, 3)); wg.setIndex(idx);
      const whiteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0, side: THREE.DoubleSide });
      part(wg, whiteMat, 2);
      const M = 16, ig = new THREE.BufferGeometry(), iuv = new Float32Array((M + 1) * 2), iidx = [], disc = [[0, 0]];
      iuv[0] = ic.x; iuv[1] = 1 - ic.y;
      for (let j = 0; j < M; j++) {
        const a = j / M * Math.PI * 2, du = Math.cos(a) * ir * 1.08 / this.aspect, dv = Math.sin(a) * ir * 1.08;
        iuv[2 * (j + 1)] = ic.x + du; iuv[2 * (j + 1) + 1] = 1 - (ic.y + dv); disc.push(toHead(du, dv)); iidx.push(0, j + 1, (j + 1) % M + 1);
      }
      ig.setAttribute('position', dyn(M + 1)); ig.setAttribute('uv', new THREE.BufferAttribute(iuv, 2)); ig.setIndex(iidx);
      part(ig, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.35, side: THREE.DoubleSide }), 1);
      return { ring, g, wg, ig, whiteMat, disc, at: toHead(ic.x - cu, ic.y - cv), side: Math.sign(cu - lm[168].x) || 1 };
    });
    // mouth, back to front: dark cavity, plain teeth, then the photo's own mouth interior split
    // along the middle so the upper half stays with the skull and the lower half drops with the jaw
    const cg = this.cavGeo = new THREE.BufferGeometry(), cidx = [], ccol = new Float32Array(22 * 3);
    for (let j = 0; j < 10; j++) cidx.push(j, j + 1, 11 + j, j + 1, 12 + j, 11 + j);
    for (let j = 0; j < 11; j++) { ccol.set([0.07, 0.015, 0.02], 3 * j); ccol.set([0.3, 0.09, 0.1], 3 * (11 + j)); }
    cg.setAttribute('position', dyn(22)); cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3)); cg.setIndex(cidx);
    part(cg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 1);
    this.teeth = [0, 1].map(() => {
      const g = new THREE.BufferGeometry(), uv = new Float32Array(18 * 2), idx = [];
      for (let j = 0; j < 9; j++) { uv[2 * j] = j / 8; uv[2 * j + 1] = 1; uv[2 * (9 + j)] = j / 8; uv[2 * (9 + j) + 1] = 0; }
      for (let j = 0; j < 8; j++) idx.push(j, j + 1, 9 + j, j + 1, 10 + j, 9 + j);
      g.setAttribute('position', dyn(18)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      part(g, new THREE.MeshStandardMaterial({ map: teethTexture(), roughness: 0.35, side: THREE.DoubleSide }), 2);
      return g;
    });
    const mg = this.mouthGeo = new THREE.BufferGeometry(), muv = new Float32Array(44 * 2), midx = [], b = this.base;
    this.mouthRest = [];
    for (let k = 0; k < 11; k++) {
      const U = LIP_UP_IN[k], L = LIP_LO_IN[k], mu = (lm[U].x + lm[L].x) / 2, mv = (lm[U].y + lm[L].y) / 2;
      [[lm[U].x, lm[U].y], [mu, mv], [mu, mv], [lm[L].x, lm[L].y]].forEach(([u, v], row) => { muv[2 * (row * 11 + k)] = u; muv[2 * (row * 11 + k) + 1] = 1 - v; });
      this.mouthRest.push([(b[3 * L] - b[3 * U]) / 2, (b[3 * L + 1] - b[3 * U + 1]) / 2]);       // upper lip -> middle of the opening
    }
    for (const row of [0, 2]) for (let k = 0; k < 10; k++) { const a = row * 11 + k; midx.push(a, a + 1, a + 11, a + 1, a + 12, a + 11); }
    mg.setAttribute('position', dyn(44)); mg.setAttribute('uv', new THREE.BufferAttribute(muv, 2)); mg.setIndex(midx);
    part(mg, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.5, side: THREE.DoubleSide }), 2);
  }

  // skull with hair, ears, neck and shoulders, sized from the face and coloured from the picture
  _dress() {
    const b = this.base, k = this.sk, f = this.fit, c = new THREE.Color();
    const sg = new THREE.SphereGeometry(1, 48, 36), p = sg.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const sx = p.getX(i), sy = p.getY(i), sz = p.getZ(i);
      let [x, y, z] = this._skull(sx, sy, sz);
      if (sz > -0.15) {
        // never let the skull poke through the face: stay behind the lowest landmark close by
        let low = 9;
        for (let j = 0; j < NL; j++) { const d2 = (b[3 * j] - x) ** 2 + (b[3 * j + 1] - y) ** 2; if (d2 < 0.06 && b[3 * j + 2] < low) low = b[3 * j + 2]; }
        if (low < 9) z = Math.min(z, low - 0.07);
      }
      p.setXYZ(i, x, y, z);
      // colour: the picture where it can be seen and trusted, hair everywhere else
      const front = smooth(-0.2, 0.3, sz), u = f[0] + f[1] * x + f[2] * y, v = f[3] + f[4] * x + f[5] * y;
      const seen = front > 0 ? this._sample(u, v, 0.035, true) : null;
      c.copy(this.hair);
      if (seen) c.lerp(seen, this._trust(seen) * front);
      else if (front > 0 && y < k.earY + 0.1) c.lerp(this.skin, front * 0.8);
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3)); sg.computeVertexNormals();
    this.headG.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, map: hairTexture(), roughness: 0.82 })));
    // ears take the colour of whatever the picture shows there (skin, or the hair that covers them)
    for (const s of [-1, 1]) {
      const e = s < 0 ? 234 : 454, ex = b[3 * e] + s * 0.1, ey = k.earY;
      const seen = this._sample(f[0] + f[1] * ex + f[2] * ey, f[3] + f[4] * ex + f[5] * ey, 0.02, true);
      c.copy(this.skin).multiplyScalar(0.9); if (seen && this._trust(seen) > 0.5) c.copy(seen);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.6 }));
      ear.scale.set(0.075, 0.36, 0.2); ear.rotation.set(0, s * 0.4, s * -0.1);
      ear.position.set(b[3 * e] + s * 0.07, ey, b[3 * e + 2] - 0.26); this.headG.add(ear);
    }
    // neck: skin tone from under the jaw, darker in the shadow of the chin
    const ng = new THREE.CylinderGeometry(0.8, 0.98, 1.7, 28, 6, true), np = ng.attributes.position, ncol = new Float32Array(np.count * 3);
    for (let i = 0; i < np.count; i++) { const t = (np.getY(i) + 0.85) / 1.7, front = Math.max(0, np.getZ(i)); c.copy(this.neckCol).multiplyScalar(0.98 - 0.45 * t * (0.3 + front)); ncol[3 * i] = c.r; ncol[3 * i + 1] = c.g; ncol[3 * i + 2] = c.b; }
    ng.setAttribute('color', new THREE.BufferAttribute(ncol, 3));
    const neckY = k.chin - 0.62, neckZ = k.cz + 0.22;
    const neck = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 })); neck.position.set(0, neckY - 0.2, neckZ); this.root.add(neck);
    // shoulders in a plain dark shirt
    const shirt = new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.92 });
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 20), shirt); torso.scale.set(3.3, 1.05, 1.5); torso.position.set(0, neckY - 1.45, neckZ - 0.15); this.root.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.09, 10, 32), shirt); collar.rotation.x = Math.PI / 2 - 0.22; collar.position.set(0, neckY - 0.78, neckZ + 0.05); this.root.add(collar);
    this.pivot.position.set(0, neckY - 0.2, neckZ); this.headG.position.set(0, -(neckY - 0.2), -neckZ);
    this._pv = [neckY - 0.2, neckZ];
  }

  // creases sit in shade: darken vertices that lie below their neighbours
  _occlusion() {
    const { N, base, relief, nbr, ao } = this, z = i => base[3 * i + 2] + relief[i] * this.reliefT;
    for (let i = 0; i < N; i++) {
      const L = nbr[i]; if (!L.length) continue; let avg = 0; for (const j of L) avg += z(j);
      ao[i] = 1 - clamp((avg / L.length - z(i)) * 3, 0, 0.14);
    }
  }

  // relief from a depth picture: sampleDepth(u, v) returns nearness 0..1 in picture coordinates.
  // The landmark depth is the prior: the depth picture is fitted to it, then blended in.
  applyDepth(sampleDepth) {
    const { N, base, imgX, imgY, alpha } = this, d = new Float32Array(N);
    let sd = 0, sz = 0, sdd = 0, sdz = 0, szz = 0, n = 0;
    for (let i = 0; i < N; i++) {
      d[i] = sampleDepth(imgX[i], imgY[i]);
      if (i < NL) { const z = base[3 * i + 2]; sd += d[i]; sz += z; sdd += d[i] * d[i]; sdz += d[i] * z; szz += z * z; n++; }
    }
    const vd = sdd / n - (sd / n) ** 2, vz = szz / n - (sz / n) ** 2, cov = sdz / n - (sd / n) * (sz / n);
    const r = cov / Math.sqrt(vd * vz + 1e-12), a = cov / (vd + 1e-12), b0 = sz / n - a * sd / n;
    if (!(r > 0.45) || !(a > 0)) return { ok: false, r };
    for (let i = 0; i < N; i++) {
      const zd = a * d[i] + b0, diff = clamp(zd - base[3 * i + 2], -0.22, 0.22);
      this.relief[i] = diff * 0.65 * Math.min(1, alpha[i] * 1.2) * this.pin[i];
    }
    // one smoothing pass keeps pores and stubble from turning into bumps
    const sm = new Float32Array(N);
    for (let i = 0; i < N; i++) { const L = this.nbr[i]; let s = this.relief[i] * 2; for (const j of L) s += this.relief[j]; sm[i] = s / (L.length + 2); }
    this.relief.set(sm); this.reliefT = 1; this._occlusion();
    return { ok: true, r };
  }

  // ---------- reactions ----------
  setExpr(name, hold = 0.35) { this.wT = EXPR[name] || EXPR.neutral; this.exprHold = hold; }
  setIdle(name) { this.idle = name; if (this.exprHold <= 0) this.wT = EXPR[name]; }

  // one blow; x, y in head-plane units
  hit({ x, y, dx = 0, dy = 0, strength = 1 }) {
    strength = clamp(strength, 0.35, 1.8);
    const { N, base, off, vel, bruise, soft, pin } = this, sig = 0.5, s = this.spring;
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, d2 = (base[i3] + off[i3] - x) ** 2 + (base[i3 + 1] + off[i3 + 1] - y) ** 2;
      const w = Math.exp(-d2 / (sig * sig)) * pin[i], lag = soft[i] * strength * pin[i];
      vel[i3] += dx * lag * 2.2; vel[i3 + 1] += dy * lag * 2.2 - lag * 0.8;        // loose tissue is thrown by every blow
      if (w < 0.01) continue;
      vel[i3] += dx * strength * w * 5; vel[i3 + 1] += dy * strength * w * 5; vel[i3 + 2] -= strength * w * 11;
      bruise[i] = Math.min(1, bruise[i] + w * 0.34 * strength);
    }
    s.vx += -y * strength * 3 - dy * strength * 2.4 - strength * 2;       // rock away from the blow
    s.vy += x * strength * 4 + dx * strength * 2.6;
    s.vz += -x * strength * 2 - dx * strength * 2.4;
    s.vpz -= strength * 3; s.vpx += dx * strength * 2.2; s.vpy += dy * strength * 2.2;
    this.skew = clamp(dx + x * 0.6, -1, 1);
    this.setExpr(strength > 1.15 ? 'heavy' : 'hit', 0.26 + 0.2 * strength);
  }

  knockDown() { this.fallT = 1; this.fallV += 3; this.setExpr('ko', 99); this.spring.vx -= 8; }
  bounceBack() { this.fallT = 0; this.fallV -= 9; this.setExpr('grit', 1.6); this.bruise.fill(0); this.spring.vpy += 6; }

  // the bruises swell up for a second, then spring back; returns seconds until smooth again
  booboo() {
    const { N, base, bruise, bump } = this, picks = [];
    for (let k = 0; k < 3; k++) {
      let best = -1, bv = 0.12;
      for (let i = 0; i < NL; i++) {
        if (bruise[i] <= bv) continue;
        if (picks.some(p => (base[3 * p] - base[3 * i]) ** 2 + (base[3 * p + 1] - base[3 * i + 1]) ** 2 < 0.3)) continue;
        best = i; bv = bruise[i];
      }
      if (best >= 0) picks.push(best);
    }
    if (!picks.length) return 0;
    bump.fill(0);
    for (const p of picks) for (let i = 0; i < N; i++) {
      const d2 = (base[3 * p] - base[3 * i]) ** 2 + (base[3 * p + 1] - base[3 * i + 1]) ** 2;
      bump[i] = Math.max(bump[i], Math.exp(-d2 / 0.07) * this.pin[i]);
    }
    this.bumpT = 1; this.bumpV = 7; this.bumpTimer = 1.0;
    this.setExpr('hurt', 1.0);
    return 1.5;
  }

  swapOut(dir = -1) { this.swapT = 1; this.swapDir = dir; }
  swapIn(dir = 1) { this.swap = 1; this.swapT = 0; this.swapDir = dir; this.root.visible = true; }

  // ---------- per frame ----------
  update(dt) {
    dt = Math.min(dt, 1 / 30); this.t += dt;
    const { N, base, off, vel, nbr, bruise, bump, colors, soft, relief, alpha, ao, pin } = this, s = this.spring;
    const sub = 2, h = dt / sub;
    if (dt > 0) for (let q = 0; q < sub; q++) {
      for (let i = 0; i < N; i++) {
        const L = nbr[i], n = L.length || 1, i3 = 3 * i, k = K * (1.3 - 0.75 * soft[i]) * (3 - 2 * pin[i]), c = C * (1.15 - 0.45 * soft[i]);
        let ax = 0, ay = 0, az = 0;
        for (let j = 0; j < L.length; j++) { const j3 = 3 * L[j]; ax += off[j3]; ay += off[j3 + 1]; az += off[j3 + 2]; }
        vel[i3] += (-k * off[i3] - c * vel[i3] + KN * (ax / n - off[i3])) * h;
        vel[i3 + 1] += (-k * off[i3 + 1] - c * vel[i3 + 1] + KN * (ay / n - off[i3 + 1])) * h;
        vel[i3 + 2] += (-k * off[i3 + 2] - c * vel[i3 + 2] + KN * (az / n - off[i3 + 2])) * h;
      }
      for (let i = 0; i < N; i++) {
        const i3 = 3 * i;
        if (pin[i] <= 0) { off[i3] = off[i3 + 1] = off[i3 + 2] = 0; vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0; continue; }
        off[i3] += vel[i3] * h; off[i3 + 1] += vel[i3 + 1] * h; off[i3 + 2] += vel[i3 + 2] * h;
      }
      s.vx += (-70 * s.rx - 6.5 * s.vx) * h; s.rx += s.vx * h;
      s.vy += (-70 * s.ry - 6.5 * s.vy) * h; s.ry += s.vy * h;
      s.vz += (-70 * s.rz - 6.5 * s.vz) * h; s.rz += s.vz * h;
      s.vpx += (-60 * s.px - 7 * s.vpx) * h; s.px += s.vpx * h;
      s.vpy += (-60 * s.py - 7 * s.vpy) * h; s.py += s.vpy * h;
      s.vpz += (-60 * s.pz - 7 * s.vpz) * h; s.pz += s.vpz * h;
      this.fallV += (-70 * (this.fallP - this.fallT) - 6.5 * this.fallV) * h; this.fallP += this.fallV * h;
      this.bumpV += (-190 * (this.bumpP - this.bumpT) - 9 * this.bumpV) * h; this.bumpP += this.bumpV * h;
    }
    if (this.bumpTimer > 0) { this.bumpTimer -= dt; if (this.bumpTimer <= 0) { this.bumpT = 0; this.bumpV -= 12; this.bruise.fill(0); this.onPop && this.onPop(); } }
    if (this.bumpT === 0 && Math.abs(this.bumpP) < 0.02 && Math.abs(this.bumpV) < 0.3) this.bumpP = 0;
    if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) this.wT = EXPR[this.idle]; }
    const e = 1 - Math.exp(-dt * 20);
    for (const k of KEYS) this.w[k] += (this.wT[k] - this.w[k]) * e;
    this.reliefAmt += (this.reliefT - this.reliefAmt) * Math.min(1, dt * 3);
    this.swap += (this.swapT - this.swap) * Math.min(1, dt * 7);
    if (this.swapT === 1 && this.swap > 0.97) this.root.visible = false;

    const w = this.w, bp = this.bumpP, ra = this.reliefAmt, pos = this.geo.attributes.position.array;
    const { rJaw, rLid, rLip, rBrow, rGrit, rPuff } = this;
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, bz = bump[i] * bp, j = rJaw[i], b = bruise[i];
      pos[i3] = base[i3] + off[i3] + 0.07 * w.puff * rPuff[i] * Math.sign(base[i3]) + this.skew * 0.1 * w.jaw * j;
      pos[i3 + 1] = base[i3 + 1] + off[i3 + 1] - 0.3 * w.jaw * j + w.squint * rLid[i] + 0.07 * w.brow * rBrow[i] + w.grit * rGrit[i] + 0.04 * w.jaw * rLip[i];
      pos[i3 + 2] = base[i3 + 2] + off[i3 + 2] + relief[i] * ra + bz * 0.2 + b * 0.05 * pin[i] + 0.16 * w.puff * rPuff[i] - 0.05 * w.jaw * j;
      if (dt > 0) bruise[i] = Math.max(0, b - dt * 0.03);
      // bruises: a dull red-purple under the skin, deeper where it swells
      const m = Math.min(1, b * 0.9 + Math.max(0, bz) * 0.7), a = ao[i], c4 = 4 * i;
      colors[c4] = a * (1 - 0.2 * m); colors[c4 + 1] = a * (1 - 0.52 * m); colors[c4 + 2] = a * (1 - 0.36 * m); colors[c4 + 3] = alpha[i];
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();

    // eyes: the socket follows the head, never the lids; the iris crosses on a heavy blow and rolls on a KO
    const show = clamp((w.dizzy + w.cross) * 5, 0, 1);
    this.eyes.forEach((eye, ei) => {
      const ep = eye.g.attributes.position.array, wp = eye.wg.attributes.position.array, ring = eye.ring, n = ring.length; let cx = 0, cy = 0, cz = 0;
      for (const v of ring) { cx += base[3 * v] + off[3 * v]; cy += base[3 * v + 1] + off[3 * v + 1]; cz += base[3 * v + 2] + off[3 * v + 2] + relief[v] * ra; }
      cx /= n; cy /= n; cz /= n;
      ep[0] = cx; ep[1] = cy; ep[2] = cz - 0.03;
      ring.forEach((v, k) => { const o = 3 * (k + 1); ep[o] = cx + (base[3 * v] + off[3 * v] - cx) * 1.5; ep[o + 1] = cy + (base[3 * v + 1] + off[3 * v + 1] - cy) * 1.5; ep[o + 2] = cz - 0.08; });
      for (let k = 0; k < ep.length; k += 3) { wp[k] = ep[k]; wp[k + 1] = ep[k + 1]; wp[k + 2] = ep[k + 2] + 0.006; }
      eye.g.attributes.position.needsUpdate = true; eye.wg.attributes.position.needsUpdate = true; eye.g.computeVertexNormals(); eye.wg.computeVertexNormals();
      eye.whiteMat.opacity = show;
      const ph = this.t * 4.2 + ei * 1.9;
      const ix = cx + eye.at[0] - eye.side * 0.075 * w.cross + w.dizzy * Math.sin(ph) * 0.05, iy = cy + eye.at[1] + w.dizzy * (0.045 + Math.cos(ph) * 0.035) - 0.01 * w.cross;
      const ip = eye.ig.attributes.position.array;
      eye.disc.forEach((d, k) => { ip[3 * k] = ix + d[0]; ip[3 * k + 1] = iy + d[1]; ip[3 * k + 2] = cz - 0.016; });
      eye.ig.attributes.position.needsUpdate = true; eye.ig.computeVertexNormals();
    });
    // mouth: cavity furthest back, plain teeth, then the photo's own interior in two halves
    const cp = this.cavGeo.attributes.position.array, mx = (pos[3 * 78] + pos[3 * 308]) / 2;
    for (let k = 0; k < 11; k++) {
      const u = 3 * LIP_UP_IN[k], l = 3 * LIP_LO_IN[k];
      cp[3 * k] = mx + (pos[u] - mx) * 1.12; cp[3 * k + 1] = pos[u + 1] + 0.03; cp[3 * k + 2] = pos[u + 2] - 0.2;
      cp[3 * (11 + k)] = mx + (pos[l] - mx) * 1.12; cp[3 * (11 + k) + 1] = pos[l + 1] - 0.03; cp[3 * (11 + k) + 2] = pos[l + 2] - 0.16;
    }
    this.cavGeo.attributes.position.needsUpdate = true;
    [LIP_UP_IN, LIP_LO_IN].forEach((chain, r) => {
      const tp = this.teeth[r].attributes.position.array, dir = r ? 1 : -1;
      for (let k = 0; k < 9; k++) {
        const v = 3 * chain[k + 1], prof = 0.55 + 0.45 * Math.sin(k / 8 * Math.PI), x = mx + (pos[v] - mx) * 0.94, z = pos[v + 2] - (r ? 0.13 : 0.1);
        const lipY = pos[v + 1] - dir * 0.012;
        tp[3 * k] = x; tp[3 * k + 1] = r ? lipY + 0.075 * prof : lipY; tp[3 * k + 2] = z;                 // row 0..8: gum side for uppers, tip side for lowers
        tp[3 * (9 + k)] = x; tp[3 * (9 + k) + 1] = r ? lipY - 0.02 : lipY - 0.095 * prof; tp[3 * (9 + k) + 2] = z;
      }
      this.teeth[r].attributes.position.needsUpdate = true; this.teeth[r].computeVertexNormals();
    });
    const mp = this.mouthGeo.attributes.position.array;
    for (let k = 0; k < 11; k++) {
      const u = 3 * LIP_UP_IN[k], l = 3 * LIP_LO_IN[k], [hx, hy] = this.mouthRest[k];
      const put = (row, x, y, z) => { const o = 3 * (row * 11 + k); mp[o] = x; mp[o + 1] = y; mp[o + 2] = z; };
      put(0, pos[u], pos[u + 1] + 0.01, pos[u + 2] - 0.04); put(1, pos[u] + hx, pos[u + 1] + hy, pos[u + 2] - 0.06);
      put(3, pos[l], pos[l + 1] - 0.01, pos[l + 2] - 0.04); put(2, pos[l] - hx, pos[l + 1] - hy, pos[l + 2] - 0.06);
    }
    this.mouthGeo.attributes.position.needsUpdate = true; this.mouthGeo.computeVertexNormals();

    // rigid motion: rock on the neck, fall, swap, a little breathing sway, and the live head turn
    const f = this.fallP, sw = this.swap, [py, pz] = this._pv, ts = this.turnS, mir = performance.now() - this.mirrorAt < 1200 ? 0.7 : 0;
    for (let k = 0; k < 3; k++) ts[k] += (this.turn[k] * mir - ts[k]) * Math.min(1, dt * 10);
    this.pivot.rotation.set(clamp(s.rx, -0.34, 0.34) * 0.8 - f * 0.5 + Math.sin(this.t * 1.1) * 0.012 + ts[0], clamp(s.ry, -0.42, 0.42) * 0.8 + Math.sin(this.t * 0.8) * 0.03 + ts[1], clamp(s.rz, -0.3, 0.3) * 0.7 + f * 0.2 + ts[2]);
    this.headG.position.set(s.px * 0.4, -py + s.py * 0.4, -pz + s.pz * 0.8);
    this.root.position.set(this.swapDir * sw * 9, -f * 1.15, -f * 0.8 - sw * 2);
    this.root.rotation.set(-f * 0.3, sw * this.swapDir * 2.4, f * 0.1);
  }

  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    if (this.tex) this.tex.dispose();
    this.root.removeFromParent();
  }
}
