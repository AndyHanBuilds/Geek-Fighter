// Hand tracking -> punch events. One hand; the face tracker runs every 5th frame.
// The rule was tuned on a real laptop camera: the fist must grow toward the
// camera while moving, be past its first frames, and re-arm after each punch.
import { emit } from './bus.js';
import { view } from './arena.js';
import * as tracking from './tracking.js';

const FACE_EVERY = 5, GROW_ON = 1.4, GROW_OFF = 0.4, SPEED_MIN = 0.6, SMOOTH = 0.5, COOLDOWN = 450;
let prev = null, sGrow = 0, sSpeed = 0, armed = true, lastPunch = 0, lastTs = 0, frameNo = 0;

export const state = { enabled: false, liveHead: null };
export const fist = { visible: false, x: 0, y: 0 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// one hand result -> maybe a punch. Kept separate so it can be fed recorded frames.
export function feed(L, ts) {
  if (!L) { prev = null; sGrow = 0; sSpeed = 0; armed = true; fist.visible = false; return false; }
  const scale = dist(L[0], L[9]);                 // wrist to middle knuckle: grows as the hand nears the camera
  const cx = L[9].x, cy = L[9].y;
  const hx = 1 - cx;                              // mirrored, like a mirror
  fist.visible = true; fist.x = (hx - 0.5) * view.w * 0.9; fist.y = -(cy - 0.5) * view.h * 0.9;
  let fired = false;
  if (prev) {
    const dt = (ts - prev.ts) / 1000;
    if (dt > 0.005) {
      const speed = Math.hypot(cx - prev.cx, cy - prev.cy) / dt;     // screen widths per second
      const grow = (scale - prev.scale) / prev.scale / dt;           // relative growth per second
      sGrow = sGrow * (1 - SMOOTH) + grow * SMOOTH; sSpeed = sSpeed * (1 - SMOOTH) + speed * SMOOTH;
      if (!armed && sGrow < GROW_OFF) armed = true;
      if (armed && prev.age > 3 && sGrow > GROW_ON && sSpeed > SPEED_MIN && ts - lastPunch > COOLDOWN) {
        armed = false; lastPunch = ts; fired = true;
        const mx = -(cx - prev.cx), my = -(cy - prev.cy), m = Math.hypot(mx, my) || 1;
        // the fist rarely lines up with the head on screen, so pull the landing point onto the face
        emit('punch', {
          x: Math.max(-0.85, Math.min(0.85, fist.x * 0.7)), y: Math.max(-1.0, Math.min(1.0, fist.y * 0.7)),
          dx: mx / m * 0.6, dy: my / m * 0.6,
          strength: Math.max(0.6, Math.min(1.8, 0.45 + sGrow / 3.2)), source: 'hand',
        });
      }
    }
  }
  prev = { ts, cx, cy, scale, age: prev ? prev.age + 1 : 0 };
  return fired;
}

export function update() {
  if ((!state.enabled && !state.liveHead) || !tracking.ready()) { fist.visible = false; return; }
  const ts = performance.now(); if (ts <= lastTs) return; lastTs = ts; frameNo++;
  if (state.liveHead && frameNo % FACE_EVERY === 0) {
    const r = tracking.liveFace(ts);
    if (r && r.faceLandmarks && r.faceLandmarks.length) {
      const v = tracking.cam.video;
      state.liveHead.setPose(r.faceLandmarks[0].map(p => ({ x: 1 - p.x, y: p.y, z: p.z })), v.videoWidth / v.videoHeight);
    }
  }
  if (!state.enabled) return;
  const r = tracking.hands(ts);
  feed(r && r.landmarks && r.landmarks.length ? r.landmarks[0] : null, ts);
}
