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

// reaction presets: jaw drop, eye squeeze, brows up, set brow, cheek puff, rolling eyes
const EXPR = {
  neutral: { jaw: 0, squint: 0, brow: 0, grit: 0, puff: 0, dizzy: 0 },
  hurt: { jaw: 0.1, squint: 0.3, brow: 0.5, grit: 0, puff: 0, dizzy: 0 },
  hit: { jaw: 0.45, squint: 0.9, brow: 0.5, grit: 0, puff: 0.3, dizzy: 0 },
  heavy: { jaw: 0.9, squint: 1, brow: 0.9, grit: 0, puff: 1, dizzy: 0 },
  ko: { jaw: 0.75, squint: 0.55, brow: 0.3, grit: 0, puff: 0.1, dizzy: 1 },
  grit: { jaw: 0, squint: 0.3, brow: 0, grit: 1, puff: 0, dizzy: 0 },
};
const KEYS = ['jaw', 'squint', 'brow', 'grit', 'puff', 'dizzy'];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = THREE.MathUtils.clamp;

let teethTex;
function teethTexture() {
  if (teethTex) return teethTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 32; const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32); grad.addColorStop(0, '#b9ab9c'); grad.addColorStop(0.35, '#ece4d6'); grad.addColorStop(1, '#d8cdbb');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 32);
  g.strokeStyle = 'rgba(70,50,45,0.55)'; g.lineWidth = 1.5;
  for (let k = 1; k < 10; k++) { const x = k * 25.6 + (k % 2 ? 2 : -2); g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 32); g.stroke(); }
  teethTex = new THREE.CanvasTexture(c); teethTex.colorSpace = THREE.SRGBColorSpace; return teethTex;
}

// average colour of a small patch of the source picture
function sample(ctx, w, h, u, v, r = 0.02) {
  const x = clamp(Math.round((u - r) * w), 0, w - 2), y = clamp(Math.round((v - r) * h), 0, h - 2);
  const sw = Math.max(1, Math.min(w - x, Math.round(2 * r * w))), sh = Math.max(1, Math.min(h - y, Math.round(2 * r * h)));
  const d = ctx.getImageData(x, y, sw, sh).data; let R = 0, G = 0, B = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
  return new THREE.Color().setRGB(R / n / 255, G / n / 255, B / n / 255, THREE.SRGBColorSpace);
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
    h._interiors();
    h._dress();
    h._occlusion();
    return h;
  }

  // skin, neck and hair colours come from the picture itself
  _colours(source, w, h, lm) {
    this.skin = new THREE.Color('#c99a7c'); this.hair = new THREE.Color('#2a211c'); this.neckCol = this.skin.clone().multiplyScalar(0.85);
    try {
      const c = document.createElement('canvas'), s = Math.min(1, 512 / Math.max(w, h)); c.width = Math.round(w * s); c.height = Math.round(h * s);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(source, 0, 0, c.width, c.height);
      const fh = lm[152].y - lm[10].y;
      const a = sample(g, c.width, c.height, lm[50].x, lm[50].y), b = sample(g, c.width, c.height, lm[280].x, lm[280].y);
      this.skin = a.clone().lerp(b, 0.5);
      const jaw = sample(g, c.width, c.height, lm[172].x * 0.6 + lm[152].x * 0.4, lm[172].y * 0.5 + lm[152].y * 0.5);
      this.neckCol = lm[152].y + fh * 0.12 < 0.98 ? sample(g, c.width, c.height, lm[152].x, lm[152].y + fh * 0.12, 0.025).lerp(jaw, 0.5) : jaw.clone().multiplyScalar(0.8);
      const hy = Math.max(0.01, lm[10].y - fh * 0.14);
      this.hair = sample(g, c.width, c.height, lm[10].x, hy, 0.03).lerp(sample(g, c.width, c.height, lm[10].x - (lm[454].x - lm[234].x) * 0.25, hy, 0.03), 0.5);
    } catch (e) { /* keep the defaults */ }
  }

  // triangles over the landmarks, holes for eyes and mouth, a soft rim, then one round of subdivision
  _topology(lm) {
    const asp = this.aspect, pts = new Float64Array(NL * 2);
    let minx = 9, maxx = -9;
    for (let i = 0; i < NL; i++) { pts[2 * i] = lm[i].x * asp; pts[2 * i + 1] = lm[i].y; minx = Math.min(minx, pts[2 * i]); maxx = Math.max(maxx, pts[2 * i]); }
    const maxEdge = 0.3 * (maxx - minx), d = new Delaunator(pts);
    const mouthSet = new Set([...LIP_UP_IN, ...LIP_LO_IN]);
    const eyeSets = EYES.map(e => new Set([...e.up, ...e.lo, ...e.ends]));
    const holes = [mouthSet, ...eyeSets], inHole = (a, b, c) => holes.some(s => s.has(a) && s.has(b) && (c === undefined || s.has(c)));
    const e = (p, q) => Math.hypot(pts[2 * p] - pts[2 * q], pts[2 * p + 1] - pts[2 * q + 1]);
    let tris = [];
    for (let t = 0; t < d.triangles.length; t += 3) {
      const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
      if (Math.max(e(a, b), e(b, c), e(c, a)) < maxEdge && !inHole(a, b, c)) tris.push(a, b, c);
    }
    // derived vertices are described by their parents so a live pose can rebuild them
    const der = [];                                // {a, b} midpoint, or {p, k, dz} rim point
    const imgX = [], imgY = [], alpha = [];
    for (let i = 0; i < NL; i++) { imgX.push(lm[i].x); imgY.push(lm[i].y); alpha.push(1); }
    // outer boundary loop
    const count = new Map(), key = (a, b) => (a < b ? a * 4096 + b : b * 4096 + a);
    for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) count.set(key(a, b), (count.get(key(a, b)) || 0) + 1);
    const nxt = new Map();
    for (let t = 0; t < tris.length; t += 3) for (const [a, b] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) if (count.get(key(a, b)) === 1 && !inHole(a, b)) nxt.set(a, b);
    const loop = []; let start = nxt.keys().next().value, cur = start;
    for (let n = 0; cur !== undefined && n < 400; n++) { loop.push(cur); cur = nxt.get(cur); if (cur === start) break; }
    if (cur === start && loop.length > 20) {
      let cx = 0, cy = 0; for (const v of loop) { cx += imgX[v]; cy += imgY[v]; } cx /= loop.length; cy /= loop.length;
      const rings = [[0.07, 0.2, 0.75], [0.13, 0.5, 0]], ids = [loop];
      for (const [k, dz, al] of rings) {
        const ring = loop.map(p => {
          der.push({ p, k, dz }); imgX.push(clamp(cx + (imgX[p] - cx) * (1 + k), 0.002, 0.998)); imgY.push(clamp(cy + (imgY[p] - cy) * (1 + k), 0.002, 0.998)); alpha.push(al);
          return NL + der.length - 1;
        });
        ids.push(ring);
      }
      this.rimC = [cx, cy];
      for (let r = 0; r < 2; r++) for (let j = 0; j < loop.length; j++) {
        const j2 = (j + 1) % loop.length, a = ids[r][j], b = ids[r][j2], a1 = ids[r + 1][j], b1 = ids[r + 1][j2];
        tris.push(a, b, b1, a, b1, a1);
      }
    }
    // one round of midpoint subdivision makes the skin dense enough to bend smoothly
    const mid = new Map(), out = [];
    const m = (a, b) => {
      const k2 = a < b ? a * 65536 + b : b * 65536 + a; let v = mid.get(k2);
      if (v === undefined) { der.push({ a, b }); imgX.push((imgX[a] + imgX[b]) / 2); imgY.push((imgY[a] + imgY[b]) / 2); alpha.push((alpha[a] + alpha[b]) / 2); v = NL + der.length - 1; mid.set(k2, v); }
      return v;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
      out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const N = this.N = NL + der.length; this.der = der;
    this.base = new Float32Array(N * 3); this.off = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.bruise = new Float32Array(N); this.bump = new Float32Array(N); this.relief = new Float32Array(N); this.ao = new Float32Array(N).fill(1);
    this.alpha = Float32Array.from(alpha); this.imgX = Float32Array.from(imgX); this.imgY = Float32Array.from(imgY);
    this.colors = new Float32Array(N * 4).fill(1);
    const uv = new Float32Array(N * 2); for (let i = 0; i < N; i++) { uv[2 * i] = imgX[i]; uv[2 * i + 1] = 1 - imgY[i]; }
    this._tris = out; this._uv = uv;
  }

  // landmarks -> centred, scaled positions (face width = 2); z grows toward the camera
  setPose(lm, aspect) {
    const base = this.base;
    let cx = 0, cy = 0, cz = 0, minx = 9, maxx = -9;
    for (let i = 0; i < NL; i++) { cx += lm[i].x; cy += lm[i].y; cz += lm[i].z; minx = Math.min(minx, lm[i].x); maxx = Math.max(maxx, lm[i].x); }
    cx /= NL; cy /= NL; cz /= NL;
    const k = 2 / ((maxx - minx) * aspect);
    for (let i = 0; i < NL; i++) {
      base[3 * i] = (lm[i].x - cx) * aspect * k;
      base[3 * i + 1] = -(lm[i].y - cy) * k;
      base[3 * i + 2] = -(lm[i].z - cz) * aspect * k;
    }
    // rim points lean outward and back, midpoints sit between their parents
    const rc = this.rimC, rx = rc ? (rc[0] - cx) * aspect * k : 0, ry = rc ? -(rc[1] - cy) * k : 0;
    this.der.forEach((q, j) => {
      const i = 3 * (NL + j);
      if (q.p !== undefined) { const p = 3 * q.p; base[i] = rx + (base[p] - rx) * (1 + q.k); base[i + 1] = ry + (base[p + 1] - ry) * (1 + q.k); base[i + 2] = base[p + 2] - q.dz; }
      else { const a = 3 * q.a, b = 3 * q.b; base[i] = (base[a] + base[b]) / 2; base[i + 1] = (base[a + 1] + base[b + 1]) / 2; base[i + 2] = (base[a + 2] + base[b + 2]) / 2; }
    });
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
    // derived vertices inherit from their parents (rim points move half as much)
    this.der.forEach((q, j) => {
      const i = NL + j;
      for (const arr of [rJaw, rLid, rLip, rBrow, rGrit, rPuff]) arr[i] = q.p !== undefined ? arr[q.p] * 0.5 : (arr[q.a] + arr[q.b]) / 2;
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
    // skin: the photo carries the colour, the lights add shape, sheen and a soft wrap
    this.skinMat = new THREE.MeshPhysicalMaterial({ map: this.tex, vertexColors: true, transparent: true, roughness: 0.52, metalness: 0, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffd9c4), specularIntensity: 0.35, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.skinMat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.castShadow = true;
    this.headG.add(this.mesh);
  }
  // picture space has y down, the scene has y up: make every triangle face the camera
  _fixWinding(list) {
    const b = this.base, out = new Uint32Array(list.length);
    for (let t = 0; t < list.length; t += 3) {
      const a = list[t], q = list[t + 1], c = list[t + 2];
      const area = (b[3 * q] - b[3 * a]) * (b[3 * c + 1] - b[3 * a + 1]) - (b[3 * c] - b[3 * a]) * (b[3 * q + 1] - b[3 * a + 1]);
      out[t] = a; out[t + 1] = area < 0 ? c : q; out[t + 2] = area < 0 ? q : c;
    }
    return new THREE.BufferAttribute(out, 1);
  }

  // eyeballs from the photo that sit behind the lids, and a mouth with teeth behind the lips
  _interiors() {
    this.eyes = EYES.map(e => {
      const ring = [e.ends[0], ...e.lo, e.ends[1], ...e.up.slice().reverse()], n = ring.length;
      const g = new THREE.BufferGeometry(), uv = new Float32Array((n + 1) * 2), idx = [];
      let cu = 0, cv = 0; for (const v of ring) { cu += this.imgX[v]; cv += this.imgY[v]; } cu /= n; cv /= n;
      uv[0] = cu; uv[1] = 1 - cv;
      ring.forEach((v, j) => { uv[2 * (j + 1)] = cu + (this.imgX[v] - cu) * 1.5; uv[2 * (j + 1) + 1] = 1 - (cv + (this.imgY[v] - cv) * 1.5); idx.push(0, j + 1, (j + 1) % n + 1); });
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.25, side: THREE.DoubleSide }));
      mesh.frustumCulled = false; mesh.renderOrder = 1; this.headG.add(mesh);
      return { ring, g };
    });
    // mouth: dark cavity, tongue tint, upper and lower teeth
    const cg = this.cavGeo = new THREE.BufferGeometry(), cidx = [], ccol = new Float32Array(22 * 3);
    for (let j = 0; j < 10; j++) cidx.push(j, j + 1, 11 + j, j + 1, 12 + j, 11 + j);
    for (let j = 0; j < 11; j++) { ccol.set([0.1, 0.02, 0.03], 3 * j); ccol.set([0.42, 0.13, 0.15], 3 * (11 + j)); }
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3)); cg.setIndex(cidx);
    const cav = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); cav.frustumCulled = false; cav.renderOrder = 1; this.headG.add(cav);
    this.teeth = [0, 1].map(() => {
      const g = new THREE.BufferGeometry(), uv = new Float32Array(18 * 2), idx = [];
      for (let j = 0; j < 9; j++) { uv[2 * j] = j / 8; uv[2 * j + 1] = 1; uv[2 * (9 + j)] = j / 8; uv[2 * (9 + j) + 1] = 0; }
      for (let j = 0; j < 8; j++) idx.push(j, j + 1, 9 + j, j + 1, 10 + j, 9 + j);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: teethTexture(), roughness: 0.3, side: THREE.DoubleSide })); mesh.frustumCulled = false; mesh.renderOrder = 2; this.headG.add(mesh);
      return g;
    });
  }

  // skull with hair, ears, neck and shoulders, sized from the face
  _dress() {
    const b = this.base, Y = i => b[3 * i + 1];
    const top = Y(10), chin = Y(152), fh = top - chin;
    let edgeZ = 0, n = 0; for (let i = 0; i < NL; i++) if (Math.abs(b[3 * i]) > 0.82) { edgeZ += b[3 * i + 2]; n++; } edgeZ = n ? edgeZ / n : -0.45;
    const cy = top - fh * 0.36, ry = fh * 0.66, rx = 1.1, rz = 1.28, cz = edgeZ - 0.42;
    const sg = new THREE.SphereGeometry(1, 40, 30), p = sg.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const hairLine = top - fh * 0.05, earY = (Y(159) + Y(2)) / 2;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) { const t = -y; x *= 1 - 0.42 * t * t; z *= 1 - 0.3 * t * t; if (z > 0) z *= 1 - 0.5 * t; }     // taper toward the jaw and nape
      const wx = x * rx, wy = cy + y * ry, wz = cz + z * rz;
      p.setXYZ(i, wx, wy, wz);
      // hair on top and behind; skin low at the front and sides
      const line = hairLine - Math.max(0, cz + 0.2 - wz) * 1.5;
      const hairW = smooth(-0.12, 0.12, wy - line);
      c.copy(this.skin).multiplyScalar(0.92).lerp(this.hair, hairW); col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3)); sg.computeVertexNormals();
    const skull = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })); skull.castShadow = true; this.headG.add(skull);
    const skinM = new THREE.MeshStandardMaterial({ color: this.skin.clone().multiplyScalar(0.9), roughness: 0.6 });
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skinM); ear.scale.set(0.09, 0.3, 0.17); ear.rotation.set(0, s * 0.35, s * -0.12);
      ear.position.set(s * (rx + 0.02), earY, cz + 0.1); this.headG.add(ear);
    }
    // neck: skin tone from under the jaw, darker in the shadow of the chin
    const ng = new THREE.CylinderGeometry(0.66, 0.82, 2.2, 28, 6, true), np = ng.attributes.position, ncol = new Float32Array(np.count * 3);
    for (let i = 0; i < np.count; i++) { const t = (np.getY(i) + 1.1) / 2.2, front = Math.max(0, np.getZ(i)); c.copy(this.neckCol).multiplyScalar(0.95 - 0.4 * t * (0.4 + front)); ncol[3 * i] = c.r; ncol[3 * i + 1] = c.g; ncol[3 * i + 2] = c.b; }
    ng.setAttribute('color', new THREE.BufferAttribute(ncol, 3));
    const neckY = chin - 0.75, neckZ = cz + 0.12;
    const neck = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })); neck.position.set(0, neckY, neckZ); neck.receiveShadow = true; this.root.add(neck);
    // shoulders in a plain dark shirt
    const shirt = new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 20), shirt); torso.scale.set(3.3, 1.05, 1.45); torso.position.set(0, neckY - 1.75, neckZ - 0.15); torso.receiveShadow = true; this.root.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.09, 10, 32), shirt); collar.rotation.x = Math.PI / 2 - 0.25; collar.position.set(0, neckY - 0.82, neckZ + 0.05); this.root.add(collar);
    this.pivot.position.set(0, neckY - 0.3, neckZ); this.headG.position.set(0, -(neckY - 0.3), -neckZ);
    this._pv = [neckY - 0.3, neckZ];
  }

  // creases sit in shade: darken vertices that lie below their neighbours
  _occlusion() {
    const { N, base, relief, nbr, ao } = this, z = i => base[3 * i + 2] + relief[i] * this.reliefT;
    for (let i = 0; i < N; i++) {
      const L = nbr[i]; if (!L.length) continue; let avg = 0; for (const j of L) avg += z(j);
      ao[i] = 1 - clamp((avg / L.length - z(i)) * 5, 0, 0.3);
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
      this.relief[i] = diff * 0.65 * Math.min(1, alpha[i] * 1.2);
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
    const { N, base, off, vel, bruise, soft } = this, sig = 0.5, s = this.spring;
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, d2 = (base[i3] + off[i3] - x) ** 2 + (base[i3 + 1] + off[i3 + 1] - y) ** 2;
      const w = Math.exp(-d2 / (sig * sig)), lag = soft[i] * strength;
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
      bump[i] = Math.max(bump[i], Math.exp(-d2 / 0.07));
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
    const { N, base, off, vel, nbr, bruise, bump, colors, soft, relief, alpha, ao } = this, s = this.spring;
    const sub = 2, h = dt / sub;
    if (dt > 0) for (let q = 0; q < sub; q++) {
      for (let i = 0; i < N; i++) {
        const L = nbr[i], n = L.length || 1, i3 = 3 * i, k = K * (1.3 - 0.75 * soft[i]), c = C * (1.15 - 0.45 * soft[i]);
        let ax = 0, ay = 0, az = 0;
        for (let j = 0; j < L.length; j++) { const j3 = 3 * L[j]; ax += off[j3]; ay += off[j3 + 1]; az += off[j3 + 2]; }
        vel[i3] += (-k * off[i3] - c * vel[i3] + KN * (ax / n - off[i3])) * h;
        vel[i3 + 1] += (-k * off[i3 + 1] - c * vel[i3 + 1] + KN * (ay / n - off[i3 + 1])) * h;
        vel[i3 + 2] += (-k * off[i3 + 2] - c * vel[i3 + 2] + KN * (az / n - off[i3 + 2])) * h;
      }
      for (let i = 0; i < 3 * N; i++) off[i] += vel[i] * h;
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
      pos[i3 + 2] = base[i3 + 2] + off[i3 + 2] + relief[i] * ra + bz * 0.2 + b * 0.05 + 0.16 * w.puff * rPuff[i] - 0.05 * w.jaw * j;
      if (dt > 0) bruise[i] = Math.max(0, b - dt * 0.03);
      // bruises: a dull red-purple under the skin, deeper where it swells
      const m = Math.min(1, b * 0.9 + Math.max(0, bz) * 0.7), a = ao[i], c4 = 4 * i;
      colors[c4] = a * (1 - 0.2 * m); colors[c4 + 1] = a * (1 - 0.52 * m); colors[c4 + 2] = a * (1 - 0.36 * m); colors[c4 + 3] = alpha[i];
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();

    // eyeballs: follow the socket, never the lids; on a KO they roll
    const roll = w.dizzy, ex = roll * Math.sin(this.t * 5) * 0.035, ey = roll * (0.05 + Math.cos(this.t * 5) * 0.02);
    for (const eye of this.eyes) {
      const ep = eye.g.attributes.position.array, ring = eye.ring, n = ring.length; let cx = 0, cy = 0, cz = 0;
      for (const v of ring) { cx += base[3 * v] + off[3 * v]; cy += base[3 * v + 1] + off[3 * v + 1]; cz += base[3 * v + 2] + off[3 * v + 2] + relief[v] * ra; }
      cx /= n; cy /= n; cz /= n;
      ep[0] = cx + ex; ep[1] = cy + ey; ep[2] = cz - 0.02;
      ring.forEach((v, k) => { const o = 3 * (k + 1); ep[o] = cx + (base[3 * v] + off[3 * v] - cx) * 1.5 + ex; ep[o + 1] = cy + (base[3 * v + 1] + off[3 * v + 1] - cy) * 1.5 + ey; ep[o + 2] = cz - 0.07; });
      eye.g.attributes.position.needsUpdate = true; eye.g.computeVertexNormals();
    }
    // mouth cavity and teeth hang behind the lips
    const cp = this.cavGeo.attributes.position.array, mx = (pos[3 * 78] + pos[3 * 308]) / 2;
    for (let k = 0; k < 11; k++) {
      const u = 3 * LIP_UP_IN[k], l = 3 * LIP_LO_IN[k];
      cp[3 * k] = mx + (pos[u] - mx) * 1.12; cp[3 * k + 1] = pos[u + 1] + 0.03; cp[3 * k + 2] = pos[u + 2] - 0.16;
      cp[3 * (11 + k)] = mx + (pos[l] - mx) * 1.12; cp[3 * (11 + k) + 1] = pos[l + 1] - 0.03; cp[3 * (11 + k) + 2] = pos[l + 2] - 0.13;
    }
    this.cavGeo.attributes.position.needsUpdate = true;
    [LIP_UP_IN, LIP_LO_IN].forEach((chain, r) => {
      const tp = this.teeth[r].attributes.position.array, dir = r ? 1 : -1;
      for (let k = 0; k < 9; k++) {
        const v = 3 * chain[k + 1], prof = 0.55 + 0.45 * Math.sin(k / 8 * Math.PI), x = mx + (pos[v] - mx) * 0.94, z = pos[v + 2] - (r ? 0.1 : 0.07);
        const lipY = pos[v + 1] - dir * 0.012;
        tp[3 * k] = x; tp[3 * k + 1] = r ? lipY + 0.075 * prof : lipY; tp[3 * k + 2] = z;                 // row 0..8: gum side for uppers, tip side for lowers
        tp[3 * (9 + k)] = x; tp[3 * (9 + k) + 1] = r ? lipY - 0.02 : lipY - 0.095 * prof; tp[3 * (9 + k) + 2] = z;
      }
      this.teeth[r].attributes.position.needsUpdate = true; this.teeth[r].computeVertexNormals();
    });

    // rigid motion: rock on the neck, fall, swap, a little breathing sway
    const f = this.fallP, sw = this.swap, [py, pz] = this._pv;
    this.pivot.rotation.set(clamp(s.rx, -0.34, 0.34) * 0.8 - f * 0.5 + Math.sin(this.t * 1.1) * 0.012, clamp(s.ry, -0.42, 0.42) * 0.8 + Math.sin(this.t * 0.8) * 0.03, clamp(s.rz, -0.3, 0.3) * 0.7 + f * 0.2);
    this.headG.position.set(s.px * 0.4, -py + s.py * 0.4, -pz + s.pz * 0.8);
    this.root.position.set(this.swapDir * sw * 9, -f * 1.15, -f * 0.8 - sw * 2);
    this.root.rotation.set(-f * 0.3, sw * this.swapDir * 2.4, f * 0.1);
  }

  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== undefined && o.material.dispose) o.material.dispose(); });
    if (this.tex) this.tex.dispose();
    this.root.removeFromParent();
  }
}
