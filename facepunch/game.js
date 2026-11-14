// The rules: health, combos, KO and bounce back, the solo rush, and
// turn-based two player with the booboo turn switch.
import { on } from './bus.js';
import * as arena from './arena.js';
import * as fx from './fx.js';
import * as gloves from './gloves.js';
import * as ui from './ui.js';

const RED = '#e23b4a', BLUE = '#2f7bff';
const SOLO_TIME = 40, TURN_TIME = 6;
export const G = { mode: null, phase: 'menu', heads: [], hp: [100, 100], max: [100, 100], atk: 0, combo: 0, lastHit: 0, lastPunch: 0, lastOuch: 0, score: 0, kos: 0, hits: 0, clock: 0, turnT: 0, nearKo: false, turns: 0 };

let timers = [];
const after = (s, fn) => timers.push({ t: s, fn });
const tIdx = () => (G.mode === 'pvp' ? 1 - G.atk : 0);
const target = () => G.heads[tIdx()];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function resetHead(h, visible) {
  h.bruise.fill(0); h.off.fill(0); h.vel.fill(0); h.fallT = 0; h.fallP = 0; h.fallV = 0; h.bumpT = 0; h.bumpP = 0; h.bumpTimer = 0;
  h.setIdle('neutral'); h.setExpr('neutral', 0);
  h.swap = visible ? 0 : 1; h.swapT = h.swap; h.root.visible = visible;
  h.onPop = () => fx.sound('cartoon_boing', { gain: 0.7, rate: 1.5, channel: 'boing' });
}

export function start(mode, heads) {
  timers = []; fx.dizzy(null); ui.koFx(false); arena.zoom(0);
  for (const h of G.heads) if (!heads.includes(h)) h.dispose();
  G.mode = mode; G.heads = heads; G.atk = 0; G.combo = 0; G.score = 0; G.kos = 0; G.hits = 0; G.turns = 0; G.nearKo = false;
  G.hp = [100, 100]; G.max = [100, 100]; G.clock = SOLO_TIME; G.turnT = TURN_TIME;
  heads.forEach(h => { if (!h.root.parent) arena.scene.add(h.root); });
  ui.show('hud'); ui.combo(0); gloves.setVisible(true);
  if (mode === 'solo') {
    resetHead(heads[0], true); gloves.setColor(RED);
    ui.names(heads[0].name, ''); ui.bar(0, 1); ui.active(-1); ui.turn('SCORE 0');
    ui.hint('Tap the face to punch. Drag fast for a heavy hit.');
    intro('ROUND 1', 'PUNCH!');
  } else {
    resetHead(heads[0], false); resetHead(heads[1], true); gloves.setColor(RED);
    ui.names(heads[0].name, heads[1].name); ui.bar(0, 1); ui.bar(1, 1); ui.active(0); ui.clock('VS');
    ui.hint('Take turns. Punch the other player\'s face. First face flattened loses.');
    intro('PLAYER 1 PUNCHES FIRST', 'PUNCH!');
  }
}
function intro(a, b) {
  G.phase = 'intro'; ui.banner(a, 1200); fx.sound('voice:round_start', { channel: 'vo' });
  after(1.3, () => { ui.banner(b, 700); G.phase = 'fight'; fx.sound('ko_bell', { gain: 0.5, rate: 1.4 }); });
}
export function quit() {
  timers = []; G.phase = 'menu'; fx.dizzy(null); ui.koFx(false); arena.zoom(0); fx.slowmo(1, 0);
  G.heads.forEach(h => h.dispose()); G.heads = []; G.mode = null; gloves.setVisible(false); ui.show('menu');
}

// ---------- the one event every input source sends ----------
on('punch', p => {
  if (G.phase !== 'fight') return;
  const now = performance.now(); if (now - G.lastPunch < 150) return; G.lastPunch = now;
  const miss = Math.abs(p.x) > 1.45 || Math.abs(p.y) > 1.8;
  fx.sound('swing', { gain: 0.8 });
  gloves.punch(clamp(p.x, -3, 3), clamp(p.y, -2.6, 2.6), () => (miss ? whiff(p) : land(p)));
});

function whiff(p) {
  G.combo = 0; ui.combo(0); fx.word('MISS', p.x, p.y, 0.6, 'miss');
  if (Math.random() < 0.25) fx.sound('voice:whiff', { channel: 'vo' });
}

function land(p) {
  if (G.phase !== 'fight') return;
  const head = target(), i = tIdx(), s = clamp(p.strength, 0.35, 1.8), now = performance.now();
  head.hit(p);
  G.combo = now - G.lastHit < 1000 ? G.combo + 1 : 1; G.lastHit = now; G.hits++;
  const dmg = s * (G.mode === 'pvp' ? 2.1 : 5) * (1 + Math.min(G.combo, 20) * 0.02);
  G.hp[i] = Math.max(0, G.hp[i] - dmg);
  G.score += Math.round(s * 100 * (1 + G.combo * 0.1));
  fx.impact(p.x, p.y, s, G.combo); fx.hitStop(s > 1.15 ? 0.11 : 0.045);
  arena.addTrauma(0.16 + s * 0.24); arena.kick((p.dx || 0) - p.x * 0.3, p.dy || 0, s);
  if (s > 1.15) arena.crowdPop(8);
  // sound: the punch sits under the voice; one hit in ten swaps the ouch for a rare line
  fx.sound(s > 1.15 ? 'hit_heavy' : s > 0.75 ? (Math.random() < 0.25 ? 'hit_squish' : 'hit_medium') : 'hit_light', { strength: s });
  if (now - G.lastOuch > 380) { G.lastOuch = now; fx.sound(Math.random() < 0.1 ? 'rare' : 'ouch', { channel: 'ouch' }); }
  if (G.hits === 1) fx.sound('voice:first_hit', { channel: 'vo' });
  else if (G.combo === 12) { fx.sound('voice:big_combo', { channel: 'vo' }); arena.crowdPop(20); }
  else if (!G.nearKo && G.hp[i] > 0 && G.hp[i] < G.max[i] * 0.25) { G.nearKo = true; fx.sound('voice:near_ko', { channel: 'vo' }); }
  ui.bar(i, G.hp[i] / G.max[i]); ui.combo(G.combo);
  head.setIdle(G.hp[i] < G.max[i] * 0.4 ? 'hurt' : 'neutral');
  if (G.hp[i] <= 0) ko();
}

// ---------- KO, then bounce back ----------
function ko() {
  const head = target(), i = tIdx(); G.phase = 'ko'; G.kos++;
  fx.hitStop(0.22); fx.slowmo(0.22, 1.7); fx.flash(0.6);
  arena.zoom(1); arena.addTrauma(0.9); arena.crowdPop(40);
  ui.koFx(true); ui.banner('K.O.!', 1600, 'ko'); ui.combo(0);
  head.knockDown(); fx.dizzy(head);
  fx.sound('ko_bell'); fx.sound('voice:ko', { channel: 'vo' }); fx.sound('crowd_gasp', { gain: 0.7 }); fx.sound('brainrot_boom');
  if (G.mode === 'solo') {
    after(1.9, () => {
      revive(head); G.max[0] = Math.round(G.max[0] * 1.2); G.hp[0] = G.max[0]; G.clock += 4; G.nearKo = false;
      ui.bar(0, 1); head.setIdle('neutral');
      after(0.45, () => { if (G.phase === 'ko') G.phase = 'fight'; });
    });
  } else {
    const winner = G.atk;
    after(1.9, () => {
      ui.koFx(false); arena.zoom(0); ui.banner(`PLAYER ${winner + 1} WINS!`, 1500);
      fx.sound('crowd_cheer'); fx.sound('brainrot_airhorn'); arena.crowdPop(40);
    });
    after(3.5, () => revive(head));
    after(5.3, () => { G.phase = 'over'; ui.over(`PLAYER ${winner + 1} WINS!`, `${G.heads[i].name} got flattened, then bounced right back.\n${G.hits} punches landed in ${G.turns + 1} turns.`); });
  }
}
function revive(head) {
  ui.koFx(false); arena.zoom(0); fx.dizzy(null); fx.slowmo(1, 0);
  head.bounceBack(); arena.kick(0, 1, 1.2); arena.addTrauma(0.4);
  ui.banner('BOUNCE BACK!', 1300, 'bb');
  fx.sound('bounce_back_sting'); fx.sound('cartoon_boing', { gain: 0.8, channel: 'boing' }); fx.sound('voice:bounce_back', { channel: 'vo' });
}

// ---------- two player: bruises become booboos, pop back, then the heads swap ----------
function endTurn() {
  G.phase = 'switch'; G.turns++; ui.combo(0); ui.banner('TIME!', 800);
  const old = target(), wait = old.booboo();
  if (wait) fx.sound('cartoon_boing', { gain: 0.6, rate: 0.8, channel: 'boing' });
  after(wait + 0.15, () => {
    old.swapOut(-1); arena.whip(-1);
    fx.sound('brainrot_record_scratch'); fx.sound('swing'); fx.sound('voice:turn_swap', { channel: 'vo' });
    G.atk = 1 - G.atk; G.nearKo = false;
    const next = target(); next.swapIn(1); gloves.setColor(G.atk === 0 ? RED : BLUE); ui.active(G.atk);
    after(0.75, () => { ui.banner(`PLAYER ${G.atk + 1}: PUNCH!`, 900); G.turnT = TURN_TIME; G.phase = 'fight'; });
  });
}

function endSolo() {
  G.phase = 'over-wait'; ui.banner('TIME!', 1100); fx.sound('ko_bell');
  const rank = G.kos >= 5 ? 'BOUNCE BACK CHAMPION' : G.kos >= 3 ? 'FACE FLATTENER' : G.kos >= 1 ? 'JELLY WOBBLER' : 'PILLOW FISTS';
  after(1.3, () => {
    G.phase = 'over'; fx.sound(G.kos > 0 ? 'crowd_cheer' : 'brainrot_sad_trombone');
    ui.over(rank, `SCORE ${G.score}\n${G.kos} knockouts. The face bounced back ${G.kos} times.`);
  });
}

export function update(dt, real) {
  for (const t of timers.slice()) { t.t -= real; if (t.t <= 0) { timers.splice(timers.indexOf(t), 1); t.fn(); } }
  if (G.phase !== 'fight') return;
  if (performance.now() - G.lastHit > 1100 && G.combo) { G.combo = 0; ui.combo(0); }
  if (G.mode === 'solo') {
    G.clock -= dt; ui.clock(Math.max(0, Math.ceil(G.clock))); ui.turn('SCORE ' + G.score);
    if (G.clock <= 0) endSolo();
  } else {
    G.turnT -= dt; ui.turn(`PLAYER ${G.atk + 1} PUNCHES`, G.turnT / TURN_TIME);
    if (G.turnT <= 0) endTurn();
  }
}
