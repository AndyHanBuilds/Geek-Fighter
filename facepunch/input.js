// Tap, mouse and drag punches (the no-camera path). Emits `punch`.
import { emit } from './bus.js';
export function initInput(canvas, toPlane) {
  let ptr = null;
  canvas.addEventListener('pointerdown', e => {
    const p = toPlane(e.clientX, e.clientY); ptr = { x: e.clientX, y: e.clientY, t: performance.now() };
    emit('punch', { x: p.x, y: p.y, dx: 0, dy: 0, strength: 0.9, source: 'tap' });
  });
  canvas.addEventListener('pointermove', e => {
    if (!ptr || e.buttons === 0 && e.pointerType === 'mouse') return;
    const now = performance.now(), dt = (now - ptr.t) / 1000;
    const vx = (e.clientX - ptr.x) / dt, vy = (e.clientY - ptr.y) / dt, sp = Math.hypot(vx, vy);
    if (sp > 1400 && dt > 0.03) {
      const p = toPlane(e.clientX, e.clientY);
      emit('punch', { x: p.x, y: p.y, dx: vx / sp, dy: -vy / sp, strength: sp / 1600, source: 'drag' });
    }
    ptr = { x: e.clientX, y: e.clientY, t: now };
  });
  addEventListener('pointerup', () => { ptr = null; });
}
