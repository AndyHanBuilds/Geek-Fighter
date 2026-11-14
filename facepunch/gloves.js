// The player's two cartoon boxing gloves. They rest at the bottom of the
// screen (or follow a tracked hand) and lunge at the face on every punch.
import * as THREE from 'three';
import { scene, view } from './arena.js';

const std = (color, rough) => new THREE.MeshStandardMaterial({ color, roughness: rough });
const gloveMat = std('#e23b4a', 0.3), cuffMat = std('#f6f6fa', 0.6), laceMat = std('#1b1b2a', 0.6);

function makeGlove(side) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), gloveMat); fist.scale.set(1, 0.9, 1.08); inner.add(fist);
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), gloveMat); knuckle.scale.set(1.05, 0.8, 0.7); knuckle.position.set(0, 0.12, -0.3); inner.add(knuckle);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), gloveMat); thumb.scale.set(1, 1.5, 1.1); thumb.position.set(-side * 0.42, -0.02, -0.12); inner.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.5, 18), cuffMat); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.62; inner.add(cuff);
  const lace = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 18), laceMat); lace.position.z = 0.5; inner.add(lace);
  scene.add(g);
  return { g, inner, side, phase: 0, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), rest: new THREE.Vector3(), follow: null, onLand: null, bob: Math.random() * 6 };
}
const gloves = [makeGlove(-1), makeGlove(1)];
let next = 0;
const OUT = 0.085, HOLD = 0.05, BACK = 0.2;

export function setColor(c) { gloveMat.color.set(c); }
export function setVisible(v) { gloves.forEach(gl => { gl.g.visible = v; }); }
// a tracked hand drags one glove around; pass null to let it rest again
export function follow(pos) { gloves[1].follow = pos; }
export const busy = () => gloves.every(gl => gl.phase !== 0);

// lunge at (x, y) on the head plane; onLand runs at the moment of contact
export function punch(x, y, onLand) {
  let gl = gloves[x < -0.25 ? 0 : x > 0.25 ? 1 : next];
  if (gloves[1].follow) gl = gloves[1];
  if (gl.phase !== 0) gl = gloves[1 - gloves.indexOf(gl)];
  if (gl.phase !== 0) { if (gl.onLand) { const f = gl.onLand; gl.onLand = null; f(); } }
  next = 1 - gloves.indexOf(gl);
  gl.from.copy(gl.g.position); gl.to.set(x, y, 0.72); gl.phase = 1; gl.t = 0; gl.onLand = onLand;
}

export function update(dt) {
  const rx = Math.min(1.75, view.w * 0.2);
  for (const gl of gloves) {
    gl.bob += dt * 3;
    if (gl.follow) gl.rest.set(gl.follow.x, gl.follow.y, 2.4);
    else gl.rest.set(gl.side * rx, -1.72 + Math.sin(gl.bob) * 0.05, 2.7);
    const p = gl.g.position;
    if (gl.phase === 0) {
      p.lerp(gl.rest, Math.min(1, dt * 14)); gl.inner.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 12));
      gl.g.rotation.set(0.95, gl.side * -0.25, gl.side * 0.25);
    } else if (gl.phase === 1) {
      gl.t += dt / OUT; const k = Math.min(1, gl.t), e = k * k;
      p.lerpVectors(gl.from, gl.to, e); p.y += Math.sin(k * Math.PI) * 0.25;
      gl.inner.scale.set(0.85, 0.85, 1.45);
      gl.g.lookAt(gl.to.x, gl.to.y, -3); gl.g.rotateY(Math.PI);
      if (k >= 1) { gl.phase = 2; gl.t = 0; gl.inner.scale.set(1.35, 1.35, 0.6); const f = gl.onLand; gl.onLand = null; if (f) f(); }
    } else if (gl.phase === 2) {
      gl.t += dt / HOLD; if (gl.t >= 1) { gl.phase = 3; gl.t = 0; gl.from.copy(p); }
    } else {
      gl.t += dt / BACK; const k = Math.min(1, gl.t), e = 1 - (1 - k) ** 3;
      p.lerpVectors(gl.from, gl.rest, e); gl.inner.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 16));
      if (k >= 1) gl.phase = 0;
    }
  }
}
