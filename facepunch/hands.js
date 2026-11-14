// Hand tracking results to punch events. Not yet tested with a real camera.
import { emit } from './bus.js';
export const fist = { visible: false, x: 0, y: 0, scale: 1 };
let prev = null, lastPunch = 0;
// L = 21 hand landmarks (already mirrored), viewW/viewH = size of the head plane on screen
export function feed(L, ts, viewW, viewH) {
  if (!L) { fist.visible = false; prev = null; return; }
  const hx = L[9].x, hy = L[9].y, scale = Math.hypot(L[0].x - L[9].x, L[0].y - L[9].y);
  const sx = (hx - 0.5) * viewW, sy = -(hy - 0.5) * viewH;
  fist.visible = true; fist.x = sx; fist.y = sy; fist.scale = 0.6 + scale * 6;
  if (prev) {
    const dt = (ts - prev.ts) / 1000;
    if (dt > 0.005) {
      const sp = Math.hypot(hx - prev.x, hy - prev.y) / dt, gr = (scale - prev.s) / prev.s / dt;
      if ((sp > 2.2 || gr > 2.0) && ts - lastPunch > 450) {
        lastPunch = ts; const dx = hx - prev.x, dy = -(hy - prev.y), m = Math.hypot(dx, dy) || 1;
        emit('punch', { x: sx, y: sy, dx: dx / m * 0.5, dy: dy / m * 0.5, strength: Math.max(sp / 3, gr / 3), source: 'hand' });
      }
    }
  }
  prev = { ts, x: hx, y: hy, s: scale };
}
