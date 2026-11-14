// Rules: health, combo, KO and the "bounce back" refill. Listens for `punch`.
import { on } from './bus.js';
import * as Head from './head.js';
import * as FX from './fx.js';
const $ = id => document.getElementById(id);
export const game = { hp: 100, combo: 0, lastHit: 0, ko: 0 };
export function reset() { game.hp = 100; game.ko = 0; $('hpbar').style.width = '100%'; }
on('punch', p => {
  if (!Head.state.ready || game.ko > 0) return;
  const strength = Math.max(0.35, Math.min(1.8, p.strength));
  Head.hit({ ...p, strength });
  FX.impact(strength);
  const now = performance.now(); game.combo = now - game.lastHit < 900 ? game.combo + 1 : 1; game.lastHit = now;
  game.hp = Math.max(0, game.hp - strength * 9); $('hpbar').style.width = game.hp + '%';
  FX.pop(['POW!', 'BAM!', 'WHAM!', 'BONK!', 'SMACK!'][(Math.random() * 5) | 0] + (game.combo > 2 ? ` x${game.combo}` : ''));
  FX.sound('punch', strength);
  if (game.hp <= 0) { game.ko = 2.2; FX.pop('K.O.!', 1800); Head.knock(-8, 14); }
});
export function update(dt) {
  if (game.ko > 0) { game.ko -= dt; if (game.ko <= 0) { reset(); FX.pop('BOUNCE BACK!', 1400); Head.knock(6, 0); } }
}
