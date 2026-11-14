// Tap, drag and key punches: the no-camera path. Emits the same punch event
// as the hand tracker.
import { emit } from './bus.js';
import { canvas, toPlane } from './arena.js';

let ptr = null;
canvas.addEventListener('pointerdown', e => {
  const p = toPlane(e.clientX, e.clientY);
  ptr = { x: e.clientX, y: e.clientY, t: performance.now() };
  emit('punch', { x: p.x, y: p.y, dx: -p.x * 0.3, dy: 0, strength: 0.9, source: 'tap' });
});
canvas.addEventListener('pointermove', e => {
  if (!ptr || (e.buttons === 0 && e.pointerType === 'mouse')) return;
  const now = performance.now(), dt = (now - ptr.t) / 1000;
  if (dt < 0.03) return;
  const vx = (e.clientX - ptr.x) / dt, vy = (e.clientY - ptr.y) / dt, sp = Math.hypot(vx, vy);
  if (sp > 1300) {
    const p = toPlane(e.clientX, e.clientY);
    emit('punch', { x: p.x, y: p.y, dx: vx / sp, dy: -vy / sp, strength: Math.min(1.8, 0.7 + sp / 2600), source: 'drag' });
  }
  ptr = { x: e.clientX, y: e.clientY, t: now };
});
addEventListener('pointerup', () => { ptr = null; });
addEventListener('pointercancel', () => { ptr = null; });

// keyboard: space or J/K for jabs, L for a heavy one
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k !== ' ' && k !== 'j' && k !== 'k' && k !== 'l') return;
  e.preventDefault();
  const x = (Math.random() - 0.5) * 1.2, y = (Math.random() - 0.5) * 1.4;
  emit('punch', { x, y, dx: k === 'j' ? 0.7 : k === 'k' ? -0.7 : 0, dy: 0, strength: k === 'l' ? 1.5 : 0.9, source: 'key' });
});
