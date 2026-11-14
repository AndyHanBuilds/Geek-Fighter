// A punchable head: a jelly face (from a photo, a scan, or drawn), reaction
// expressions, bruises that turn into booboos, plus skull, headgear, neck and body.
import * as THREE from 'three';
import Delaunator from 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';

const K = 150, C = 5.5, KN = 70;          // jelly spring, damping, neighbour coupling

// face landmark groups (same numbering on every face)
const LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const LIP_UP_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const LIP_LO_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const EYES = [
  { up: [246, 161, 160, 159, 158, 157, 173], lo: [7, 163, 144, 145, 153, 154, 155], top: 159, bot: 145 },
  { up: [466, 388, 387, 386, 385, 384, 398], lo: [249, 390, 373, 374, 380, 381, 382], top: 386, bot: 374 },
];
const BROWS = [[70, 63, 105, 66, 107, 55, 65, 52, 53, 46], [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]];
const CHEEKS = [50, 280];

// expression presets: jaw drop, eye squeeze, brows up, determined brow, cheek puff, dizzy eyes
const EXPR = {
  neutral: { jaw: 0, squint: 0, brow: 0, grit: 0, puff: 0, dizzy: 0 },
  hurt: { jaw: 0.12, squint: 0.25, brow: 0.5, grit: 0, puff: 0, dizzy: 0 },
  hit: { jaw: 0.6, squint: 0.85, brow: 0.7, grit: 0, puff: 0.15, dizzy: 0 },
  heavy: { jaw: 1, squint: 1, brow: 1, grit: 0, puff: 1, dizzy: 0 },
  ko: { jaw: 0.9, squint: 0.2, brow: 0.4, grit: 0, puff: 0.2, dizzy: 1 },
  grit: { jaw: 0, squint: 0.3, brow: 0, grit: 1, puff: 0, dizzy: 0 },
};
const KEYS = ['jaw', 'squint', 'brow', 'grit', 'puff', 'dizzy'];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const std = (color, rough = 0.55) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let spiralTex, plasterTex;
function sharedTextures() {
  spiralTex ||= canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, 6.3); g.fill();
    g.strokeStyle = '#1b1b2a'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath();
    for (let a = 0; a < 15; a += 0.15) { const r = a * 3.6; g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); }
    g.stroke();
  });
  plasterTex ||= canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2);
    for (const rot of [0.6, -0.6]) {
      g.save(); g.rotate(rot); g.fillStyle = '#f2c79a'; g.strokeStyle = '#b98857'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(-56, -17, 112, 34, 16); g.fill(); g.stroke();
      g.fillStyle = '#fbe6cc'; g.fillRect(-17, -13, 34, 26);
      g.fillStyle = '#b98857'; for (const x of [-40, -30, 30, 40]) { g.beginPath(); g.arc(x, 0, 2.5, 0, 6.3); g.fill(); }
      g.restore();
    }
  });
}

export class Head {
  constructor(opts = {}) {
    sharedTextures();
    this.corner = opts.corner || '#e23b4a';
    this.skin = opts.skin || '#e8b48c';
    this.name = opts.name || 'FACE';
    this.root = new THREE.Group();         // whole fighter: fall and swap animations
    this.pivot = new THREE.Group();        // neck base: the head bobbles around it
    this.headG = new THREE.Group();        // the head itself
    this.pivot.position.set(0, -1.7, -0.75); this.headG.position.set(0, 1.7, 0.75);
    this.root.add(this.pivot); this.pivot.add(this.headG);
    this.spring = { rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, vpx: 0, vpy: 0, vpz: 0 };
    this.w = { ...EXPR.neutral }; this.wT = { ...EXPR.neutral }; this.exprHold = 0; this.idle = 'neutral';
    this.skew = 0;
    this.fallV = 0; this.fallP = 0; this.fallT = 0;      // 0 standing, 1 knocked down
    this.swap = 0; this.swapT = 0; this.swapDir = 1;     // 0 on stage, 1 off stage
    this.bumpP = 0; this.bumpV = 0; this.bumpT = 0; this.bumpTimer = 0; this.decals = [];
    this.t = Math.random() * 10;
    this.live = false;
  }

  // ---------- builders ----------
  static fromLandmarks(lm, aspect, texture, opts = {}) {
    const h = new Head(opts); h.kind = 'photo';
    const N = 468, pts = new Float64Array(N * 2), uvs = new Float32Array(N * 2);
    let minx = 9, maxx = -9;
    for (let i = 0; i < N; i++) {
      pts[2 * i] = lm[i].x * aspect; pts[2 * i + 1] = lm[i].y;
      uvs[2 * i] = lm[i].x; uvs[2 * i + 1] = 1 - lm[i].y;
      minx = Math.min(minx, pts[2 * i]); maxx = Math.max(maxx, pts[2 * i]);
    }
    h._jelly(N, pts, uvs, 0.30 * (maxx - minx), texture);
    h.setPose(lm, aspect);
    h._rigPhoto();
    h._dress();
    return h;
  }

  static cartoon(opts = {}) {
    const h = new Head({ skin: '#ffcf5a', ...opts }); h.kind = 'cartoon';
    const P = [[0, 0]];
    for (let k = 1; k <= 10; k++) for (let j = 0; j < 6 * k; j++) { const a = j / (6 * k) * Math.PI * 2 + k * 0.2; P.push([Math.cos(a) * k / 10, Math.sin(a) * k / 10]); }
    const N = P.length, pts = new Float64Array(N * 2), uvs = new Float32Array(N * 2);
    h.N = N; h.base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = P[i][0] * 1.0, y = P[i][1] * 1.32, r2 = P[i][0] ** 2 + P[i][1] ** 2;
      pts[2 * i] = x; pts[2 * i + 1] = -y;
      uvs[2 * i] = 0.5 + x / 2.2; uvs[2 * i + 1] = 0.5 + y / 2.9;
      h.base[3 * i] = x; h.base[3 * i + 1] = y;
      h.base[3 * i + 2] = 0.72 * Math.sqrt(Math.max(0, 1 - r2 * 0.94)) - 0.42 + 0.2 * Math.exp(-(x * x + (y + 0.08) ** 2) / 0.035);
    }
    h.faceCanvas = document.createElement('canvas'); h.faceCanvas.width = h.faceCanvas.height = 512;
    const tex = new THREE.CanvasTexture(h.faceCanvas); tex.colorSpace = THREE.SRGBColorSpace;
    const keep = h.base; h._jelly(N, pts, uvs, 9, tex); h.base = keep;
    h.eyeAt = [[-0.38, 0.3, 0.42], [0.38, 0.3, 0.42]];
    h._drawn = ''; h._drawFace();
    h._dress();
    return h;
  }

  _jelly(N, pts, uvs, maxEdge, texture) {
    this.N = N;
    const d = new Delaunator(pts), keep = [];
    const e = (p, q) => Math.hypot(pts[2 * p] - pts[2 * q], pts[2 * p + 1] - pts[2 * q + 1]);
    for (let t = 0; t < d.triangles.length; t += 3) {
      const a = d.triangles[t], b = d.triangles[t + 1], c = d.triangles[t + 2];
      if (Math.max(e(a, b), e(b, c), e(c, a)) < maxEdge) {
        // image space has y down, the scene has y up: flip the winding so normals face the camera
        const area = (pts[2 * b] - pts[2 * a]) * (pts[2 * c + 1] - pts[2 * a + 1]) - (pts[2 * c] - pts[2 * a]) * (pts[2 * b + 1] - pts[2 * a + 1]);
        if (area > 0) keep.push(a, c, b); else keep.push(a, b, c);
      }
    }
    const tri = new Uint32Array(keep);
    this.base = new Float32Array(N * 3); this.off = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.bruise = new Float32Array(N); this.bump = new Float32Array(N); this.colors = new Float32Array(N * 3).fill(1);
    const sets = Array.from({ length: N }, () => new Set());
    for (let t = 0; t < tri.length; t += 3) { const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]]; sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b); }
    this.nbr = sets.map(s => Array.from(s));
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(tri, 1));
    this.tex = texture;
    const mat = new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: 0.62, side: THREE.DoubleSide, emissive: 0x4a4a4a, emissiveMap: texture,
      polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -12000 });   // the face always wins over the helmet behind it
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.headG.add(this.mesh);
  }

  // landmarks -> centred, scaled positions (face width = 2); z grows toward the camera
  setPose(lm, aspect) {
    const N = this.N, base = this.base;
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

  // per-vertex weights for the reaction expressions, measured once on the neutral face
  _rigPhoto() {
    const N = this.N, b = this.base, X = i => b[3 * i], Y = i => b[3 * i + 1];
    const rJaw = this.rJaw = new Float32Array(N), rLid = this.rLid = new Float32Array(N), rLip = this.rLip = new Float32Array(N);
    const rBrow = this.rBrow = new Float32Array(N), rGrit = this.rGrit = new Float32Array(N), rPuff = this.rPuff = new Float32Array(N);
    const mouthY = (Y(13) + Y(14)) / 2, chinY = Y(152), mouthX = X(13), span = mouthY - chinY;
    for (let i = 0; i < N; i++) {
      const t = (mouthY - Y(i)) / span;
      if (t > 0.12) rJaw[i] = smooth(0.12, 0.4, t) * Math.max(0, 1 - ((X(i) - mouthX) / 1.15) ** 2);
    }
    const arc = (list, lo, arr, sign) => list.forEach((v, j) => { const p = Math.sin(j / (list.length - 1) * Math.PI); arr[v] = sign * (lo + (1 - lo) * p); });
    arc(LIP_LO_IN, 0, rJaw, 1); arc(LIP_LO_OUT, 0.25, rJaw, 1);
    arc(LIP_UP_IN, 0, rLip, 1); arc(LIP_UP_OUT, 0, rLip, 0.6);
    for (const v of [78, 308, 61, 291]) rJaw[v] = 0.2;
    for (const eye of EYES) {
      const mid = Y(eye.top) * 0.35 + Y(eye.bot) * 0.65;
      for (const v of eye.up) rLid[v] = (mid - Y(v)) * 0.95;
      for (const v of eye.lo) rLid[v] = (mid - Y(v)) * 0.8;
    }
    for (const brow of BROWS) {
      let far = 0; for (const v of brow) far = Math.max(far, Math.abs(X(v)));
      for (const v of brow) { rBrow[v] = 1; rGrit[v] = 0.07 - 0.22 * (1 - Math.abs(X(v)) / far) ** 1.2; }
    }
    for (const c of CHEEKS) for (let i = 0; i < N; i++) {
      const d2 = (X(i) - X(c)) ** 2 + (Y(i) - (Y(c) - 0.15)) ** 2;
      rPuff[i] = Math.max(rPuff[i], Math.exp(-d2 / 0.12));
    }
    this.eyeIdx = EYES.map(e => [e.top, e.bot]);
    // dark mouth interior, shown when the jaw drops
    const mg = this.mouthGeo = new THREE.BufferGeometry(), idx = [];
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    for (let j = 0; j < 10; j++) idx.push(j, j + 1, 11 + j, j + 1, 12 + j, 11 + j);
    mg.setIndex(idx);
    this.mouth = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x360c18, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -14000 }));
    this.mouth.frustumCulled = false; this.mouth.renderOrder = 2; this.headG.add(this.mouth);
  }

  // skull, padded headgear, neck, body, dizzy eyes, plasters
  _dress() {
    const N = this.N, b = this.base;
    let top = -9, bot = 9, edgeZ = 0, en = 0;
    for (let i = 0; i < N; i++) {
      top = Math.max(top, b[3 * i + 1]); bot = Math.min(bot, b[3 * i + 1]);
      if (Math.abs(b[3 * i]) > 0.8) { edgeZ += b[3 * i + 2]; en++; }
    }
    edgeZ = en ? edgeZ / en : -0.4;
    const mid = (top + bot) / 2, hh = (top - bot) / 2;
    const gear = std(this.corner, 0.32), dark = std(new THREE.Color(this.corner).multiplyScalar(0.62), 0.5);
    const skinM = std(this.skin, 0.7);
    const ball = (m, sx, sy, sz, x, y, z, parent = this.headG) => { const s = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), m); s.scale.set(sx, sy, sz); s.position.set(x, y, z); parent.add(s); return s; };
    // helmet: sits behind the face so its rim wraps the edge of the mask
    const rx = 1.17, rz = 0.92, zc = edgeZ + 0.05 - rz * Math.sqrt(1 - (0.93 / rx) ** 2);
    ball(gear, rx, hh * 1.1 + 0.12, rz, 0, mid + 0.12, zc);
    ball(skinM, 1.0, hh * 0.98, 0.9, 0, mid, zc + 0.02);
    ball(dark, 0.8, 0.2, 0.3, 0, top - 0.06, edgeZ + 0.34);                 // forehead pad
    for (const s of [-1, 1]) {
      ball(dark, 0.2, 0.52, 0.42, s * 1.08, mid - 0.25, edgeZ + 0.12);          // cheek pads
      ball(gear, 0.16, 0.3, 0.3, s * 1.2, mid + 0.25, edgeZ - 0.25);            // ear cups
    }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.075, 8, 24, Math.PI), dark);
    strap.rotation.z = Math.PI; strap.scale.set(1.25, 0.75, 1); strap.position.set(0, bot + 0.42, edgeZ - 0.05); this.headG.add(strap);
    // neck and body stay under the pivot
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.56, 1.3, 18), skinM); neck.position.set(0, -1.9, -0.75); this.root.add(neck);
    this.body = ball(std(this.corner, 0.6), 2.15, 1.25, 1.0, 0, -3.45, -0.85, this.root);
    for (const s of [-1, 1]) ball(skinM, 0.62, 0.6, 0.6, s * 1.9, -3.0, -0.85, this.root);
    // dizzy spirals over the eyes
    this.spirals = [0, 1].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: spiralTex, transparent: true, opacity: 0, depthTest: false }));
      sp.scale.setScalar(0.5); sp.renderOrder = 5; this.headG.add(sp); return sp;
    });
    this.decals = [0, 1, 2].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: plasterTex, transparent: true, depthTest: false }));
      sp.visible = false; sp.renderOrder = 6; this.headG.add(sp); return { sp, v: 0 };
    });
  }

  // ---------- the drawn face ----------
  _drawFace() {
    const w = this.w, key = KEYS.map(k => Math.round(w[k] * 12)).join();
    if (key === this._drawn) return; this._drawn = key;
    const g = this.faceCanvas.getContext('2d'), S = 512;
    const px = x => (0.5 + x / 2.2) * S, py = y => (0.5 - y / 2.9) * S, u = S / 2.2;
    g.fillStyle = this.skin; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,90,110,0.45)';
    for (const s of [-1, 1]) { g.beginPath(); g.arc(px(s * 0.58), py(-0.28), u * (0.17 + 0.1 * w.puff), 0, 6.3); g.fill(); }
    g.lineCap = 'round'; g.strokeStyle = '#2a1a12'; g.fillStyle = '#2a1a12';
    for (const s of [-1, 1]) {
      const ex = px(s * 0.38), ey = py(0.3);
      if (w.squint > 0.6) {                                  // squeezed shut: > <
        g.lineWidth = 13; g.beginPath(); g.moveTo(ex - s * u * 0.17, ey - u * 0.13); g.lineTo(ex + s * u * 0.12, ey); g.lineTo(ex - s * u * 0.17, ey + u * 0.13); g.stroke();
      } else {
        const ry = u * 0.25 * (1 - 0.7 * w.squint);
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, ey, u * 0.19, ry, 0, 0, 6.3); g.fill(); g.lineWidth = 6; g.stroke();
        g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(ex - s * u * 0.05 * w.grit, ey + u * 0.03, u * 0.085, 0, 6.3); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + u * 0.03, ey - u * 0.02, u * 0.028, 0, 6.3); g.fill();
      }
      const by = 0.74 + 0.13 * w.brow;
      g.lineWidth = 17; g.beginPath(); g.moveTo(px(s * 0.62), py(by + 0.07 * w.grit)); g.lineTo(px(s * 0.17), py(by - 0.22 * w.grit + 0.05 * w.brow)); g.stroke();
    }
    g.lineWidth = 7; g.beginPath(); g.arc(px(0), py(-0.02), u * 0.07, 0.3, 2.8); g.stroke();
    const mx = px(this.skew * 0.12), my = py(-0.66);
    if (w.jaw > 0.15) {
      const rx = u * (0.2 + 0.1 * w.jaw), ry = u * (0.05 + 0.3 * w.jaw);
      g.fillStyle = '#3a0d18'; g.beginPath(); g.ellipse(mx, my - u * 0.02 + ry * 0.6, rx, ry, 0, 0, 6.3); g.fill(); g.lineWidth = 7; g.stroke();
      g.save(); g.clip();
      g.fillStyle = '#ff7a8a'; g.beginPath(); g.ellipse(mx, my + ry * 1.5, rx * 0.7, ry * 0.6, 0, 0, 6.3); g.fill();
      g.fillStyle = '#fff'; g.fillRect(mx - rx * 0.6, my - ry * 0.5, rx * 1.2, ry * 0.42);
      g.restore();
    } else if (w.grit > 0.4) {
      g.fillStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.roundRect(mx - u * 0.24, my - u * 0.07, u * 0.48, u * 0.15, 8); g.fill(); g.stroke();
      g.lineWidth = 3; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(mx + k * u * 0.08, my - u * 0.07); g.lineTo(mx + k * u * 0.08, my + u * 0.08); g.stroke(); }
    } else {
      g.lineWidth = 10; g.beginPath();
      if (w.brow > 0.3) g.arc(mx, my + u * 0.22, u * 0.24, 3.9, 5.5); else g.arc(mx, my - u * 0.2, u * 0.26, 0.6, 2.55);
      g.stroke();
    }
    this.tex.needsUpdate = true;
  }

  // ---------- reactions ----------
  setExpr(name, hold = 0.35) { this.wT = EXPR[name] || EXPR.neutral; this.exprHold = hold; }
  setIdle(name) { this.idle = name; if (this.exprHold <= 0) this.wT = EXPR[name]; }

  // apply one blow; x, y in head-plane units
  hit({ x, y, dx = 0, dy = 0, strength = 1 }) {
    strength = Math.max(0.35, Math.min(1.8, strength));
    const { N, base, off, vel, bruise } = this, sig = 0.55, s = this.spring;
    for (let i = 0; i < N; i++) {
      const d2 = (base[3 * i] + off[3 * i] - x) ** 2 + (base[3 * i + 1] + off[3 * i + 1] - y) ** 2;
      const w = Math.exp(-d2 / (sig * sig)); if (w < 0.01) continue;
      vel[3 * i] += dx * strength * w * 6; vel[3 * i + 1] += dy * strength * w * 6; vel[3 * i + 2] -= strength * w * 16;
      bruise[i] = Math.min(1, bruise[i] + w * 0.4 * strength);
    }
    s.vx += -y * strength * 4 - dy * strength * 3 - strength * 2.5;       // tilt away from the blow
    s.vy += x * strength * 5 + dx * strength * 3;
    s.vz += -x * strength * 2.5 - dx * strength * 3;
    s.vpz -= strength * 4; s.vpx += dx * strength * 3; s.vpy += dy * strength * 3;
    this.skew = Math.max(-1, Math.min(1, dx + x * 0.6));
    this.setExpr(strength > 1.15 ? 'heavy' : 'hit', 0.28 + 0.2 * strength);
  }

  knockDown() { this.fallT = 1; this.fallV += 3; this.setExpr('ko', 99); this.spring.vx -= 10; }
  bounceBack() { this.fallT = 0; this.fallV -= 9; this.setExpr('grit', 1.6); this.bruise.fill(0); this.spring.vpy += 7; }

  // bruises swell into booboos with plasters, then pop back; returns seconds until smooth again
  booboo() {
    const { N, base, bruise, bump } = this, picks = [];
    for (let k = 0; k < 3; k++) {
      let best = -1, bv = 0.12;
      for (let i = 0; i < N; i++) {
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
      bump[i] = Math.max(bump[i], Math.exp(-d2 / 0.05));
    }
    this.decals.forEach((d, k) => { d.v = picks[k] ?? -1; d.sp.visible = d.v >= 0; d.sp.material.rotation = (Math.random() - 0.5) * 1.2; });
    this.bumpT = 1; this.bumpV = 9; this.bumpTimer = 1.0;
    this.setExpr('hurt', 1.0);
    return 1.5;
  }

  swapOut(dir = -1) { this.swapT = 1; this.swapDir = dir; }
  swapIn(dir = 1) { this.swap = 1; this.swapT = 0; this.swapDir = dir; this.root.visible = true; }

  // ---------- per frame ----------
  update(dt) {
    dt = Math.min(dt, 1 / 30); this.t += dt;
    const { N, base, off, vel, nbr, bruise, bump, colors } = this, s = this.spring;
    const sub = 2, h = dt / sub;
    if (dt > 0) for (let q = 0; q < sub; q++) {
      for (let i = 0; i < N; i++) {
        const L = nbr[i], n = L.length || 1;
        for (let a = 0; a < 3; a++) {
          const idx = 3 * i + a; let avg = 0;
          for (let j = 0; j < L.length; j++) avg += off[3 * L[j] + a];
          vel[idx] += (-K * off[idx] - C * vel[idx] + KN * (avg / n - off[idx])) * h;
        }
      }
      for (let i = 0; i < 3 * N; i++) off[i] += vel[i] * h;
      s.vx += (-55 * s.rx - 4.2 * s.vx) * h; s.rx += s.vx * h;
      s.vy += (-55 * s.ry - 4.2 * s.vy) * h; s.ry += s.vy * h;
      s.vz += (-55 * s.rz - 4.2 * s.vz) * h; s.rz += s.vz * h;
      s.vpx += (-50 * s.px - 5 * s.vpx) * h; s.px += s.vpx * h;
      s.vpy += (-50 * s.py - 5 * s.vpy) * h; s.py += s.vpy * h;
      s.vpz += (-50 * s.pz - 5 * s.vpz) * h; s.pz += s.vpz * h;
      this.fallV += (-70 * (this.fallP - this.fallT) - 6.5 * this.fallV) * h; this.fallP += this.fallV * h;
      this.bumpV += (-190 * (this.bumpP - this.bumpT) - 9 * this.bumpV) * h; this.bumpP += this.bumpV * h;
    }
    // booboo timeline
    if (this.bumpTimer > 0) { this.bumpTimer -= dt; if (this.bumpTimer <= 0) { this.bumpT = 0; this.bumpV -= 14; this.bruise.fill(0); this.onPop && this.onPop(); } }
    if (this.bumpT === 0 && Math.abs(this.bumpP) < 0.02 && Math.abs(this.bumpV) < 0.3) { this.bumpP = 0; this.decals.forEach(d => { d.sp.visible = false; }); }
    // expression weights ease toward their targets
    if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) this.wT = EXPR[this.idle]; }
    const e = 1 - Math.exp(-dt * 22);
    for (const k of KEYS) this.w[k] += (this.wT[k] - this.w[k]) * e;
    // swap animation
    this.swap += (this.swapT - this.swap) * Math.min(1, dt * 7);
    if (this.swapT === 1 && this.swap > 0.97) this.root.visible = false;

    const w = this.w, bp = this.bumpP, pos = this.geo.attributes.position.array, photo = this.kind === 'photo';
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, bz = bump[i] * bp;
      let x = base[i3] + off[i3], y = base[i3 + 1] + off[i3 + 1], z = base[i3 + 2] + off[i3 + 2] + bz * 0.34;
      if (photo) {
        const j = this.rJaw[i];
        y += -0.4 * w.jaw * j + w.squint * this.rLid[i] + 0.12 * w.brow * this.rBrow[i] + w.grit * this.rGrit[i] + 0.07 * w.jaw * this.rLip[i];
        z += 0.3 * w.puff * this.rPuff[i] - 0.07 * w.jaw * j;
        x += 0.1 * w.puff * this.rPuff[i] * Math.sign(base[i3]) + this.skew * 0.16 * w.jaw * j;
      } else if (w.puff > 0.02) {
        z += 0.22 * w.puff * Math.exp(-((Math.abs(base[i3]) - 0.58) ** 2 + (base[i3 + 1] + 0.28) ** 2) / 0.08);
      }
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
      if (dt > 0) bruise[i] = Math.max(0, bruise[i] - dt * 0.035);
      const b = bruise[i], r = Math.max(0, bz);
      colors[i3] = 1 - 0.18 * b + 0.25 * r; colors[i3 + 1] = 1 - 0.5 * b - 0.45 * r; colors[i3 + 2] = 1 - 0.38 * b - 0.4 * r;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
    if (photo) {
      const mp = this.mouthGeo.attributes.position.array;
      for (let j = 0; j < 11; j++) for (let a = 0; a < 3; a++) {
        mp[3 * j + a] = pos[3 * LIP_UP_IN[j] + a] + (a === 2 ? 0.03 : 0);
        mp[3 * (11 + j) + a] = pos[3 * LIP_LO_IN[j] + a] + (a === 2 ? 0.03 : 0);
      }
      this.mouthGeo.attributes.position.needsUpdate = true;
    } else this._drawFace();
    // dizzy spirals and plasters ride on the face
    this.spirals.forEach((sp, k) => {
      sp.material.opacity = Math.min(1, w.dizzy * 1.3); sp.visible = w.dizzy > 0.03; sp.material.rotation = -this.t * 7 * (k ? 1 : -1);
      if (photo) { const [a, b] = this.eyeIdx[k]; sp.position.set((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, pos[3 * a + 2] + 0.12); }
      else sp.position.set(...this.eyeAt[k]);
    });
    for (const d of this.decals) if (d.sp.visible && d.v >= 0) {
      d.sp.position.set(pos[3 * d.v], pos[3 * d.v + 1], pos[3 * d.v + 2] + 0.1);
      d.sp.scale.setScalar(Math.max(0.001, 0.62 * bp));
    }
    // rigid motion: bobble on the neck, fall, swap spin, idle sway
    const cl = THREE.MathUtils.clamp, f = this.fallP, sw = this.swap;
    const sway = Math.sin(this.t * 1.7) * 0.035;
    this.pivot.rotation.set(cl(s.rx, -0.42, 0.42) * 0.8 - f * 0.55, cl(s.ry, -0.5, 0.5) * 0.8 + sway, cl(s.rz, -0.4, 0.4) * 0.7 + f * 0.22);
    this.headG.position.set(s.px * 0.5, 1.7 + s.py * 0.5 + Math.sin(this.t * 2.3) * 0.02, 0.75 + s.pz);
    this.root.position.set(this.swapDir * sw * 9, -f * 1.25, -f * 0.9 - sw * 2);
    this.root.rotation.set(-f * 0.35, sw * this.swapDir * 5, f * 0.12);
  }

  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (this.tex) this.tex.dispose();
    this.root.removeFromParent();
  }
}
