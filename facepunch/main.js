// Boot, menus, the face picker and the frame loop.
import * as THREE from 'three';
import * as arena from './arena.js';
import * as fx from './fx.js';
import * as snd from './sound.js';
import * as gloves from './gloves.js';
import * as ui from './ui.js';
import * as game from './game.js';
import * as tracking from './tracking.js';
import * as hands from './hands.js';
import './input.js';
import { Head } from './head.js';

const { $ } = ui;
const RED = '#e23b4a', BLUE = '#2f7bff';
const CORE_SOUNDS = ['hit_light', 'hit_medium', 'hit_heavy', 'hit_squish', 'swing', 'ouch', 'rare', 'ko_bell', 'voice:ko', 'crowd_gasp', 'brainrot_boom',
  'bounce_back_sting', 'cartoon_boing', 'voice:bounce_back', 'voice:round_start', 'voice:first_hit', 'voice:big_combo', 'voice:near_ko', 'voice:whiff',
  'crowd_cheer', 'brainrot_airhorn', 'brainrot_record_scratch', 'voice:turn_swap', 'brainrot_sad_trombone', 'ui_click', 'ui_confirm'];

gloves.setVisible(false);
snd.loadManifests();
let soundsWanted = false;
addEventListener('pointerdown', () => { snd.unlock(); if (!soundsWanted) { soundsWanted = true; snd.preload(CORE_SOUNDS); } }, true);
addEventListener('keydown', () => snd.unlock(), true);
document.addEventListener('click', e => { if (e.target.closest('button, label.big')) fx.sound('ui_click', { gain: 0.6 }); }, true);

// ---------- building heads ----------
const progress = (text, frac) => ui.loading(text, frac);

function headFrom(source, opts) {
  const lm = tracking.detectFace(source); if (!lm) return null;
  return Head.fromLandmarks(lm, source, opts);
}
async function headFromUrl(url, opts) {
  await tracking.loadFace(progress);
  progress('Building the head', null);
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('could not read that picture')); img.src = url; });
  const head = headFrom(img, opts); ui.loaded(); return head;
}

// ---------- the face picker: resolves with a head, or null on Back ----------
function pickFace(title, opts) {
  return new Promise(resolve => {
    ui.show('pick'); $('pickTitle').textContent = title;
    const msg = t => { $('pickMsg').textContent = t; };
    msg('A photo or a scan becomes a 3D head. It never leaves this device.');
    $('cam').hidden = true; $('bScan').hidden = true;
    const done = head => { $('cam').hidden = true; $('bScan').hidden = true; $('file').value = ''; resolve(head); };
    $('bPickBack').onclick = () => done(null);
    $('file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      try {
        const head = await headFromUrl(url, opts);
        if (head) done(head); else msg('No face found in that photo. Try a clear, front-facing one.');
      } catch (err) { ui.loaded(); msg('That did not work (' + (err.message || err) + '). Try another photo.'); }
      URL.revokeObjectURL(url);
    };
    $('bCam').onclick = async () => {
      try {
        await tracking.startCamera($('cam'), progress, { face: true }); ui.loaded();
        $('cam').hidden = false; $('bScan').hidden = false; msg('Look at the camera, then press Scan.');
      } catch (err) { ui.loaded(); msg('No camera (' + (err.name || err) + '). Pick a photo instead.'); }
    };
    $('bScan').onclick = () => {
      const head = headFrom(tracking.snapshot(), opts);
      if (head) { head.live = true; fx.sound('voice:scan_complete', { channel: 'vo' }); done(head); } else msg('No face found. Move closer and face the camera.');
    };
  });
}

let lastSetup = null;
// Quick Play uses the bundled default face when the file is there; otherwise it asks for a photo or a scan.
const DEFAULT_FACE = 'assets/default_face.jpg';
let hasDefault = null;
async function quickPlay() {
  if (hasDefault === null) hasDefault = await fetch(DEFAULT_FACE, { method: 'HEAD' }).then(r => r.ok && /image/.test(r.headers.get('content-type') || ''), () => false);
  if (!hasDefault) return myFace('PHOTO OR CAMERA FIRST');
  try {
    const head = await headFromUrl(DEFAULT_FACE, { corner: BLUE, name: 'THE FACE' });
    if (!head) throw new Error('no face');
    lastSetup = () => game.start('solo', [head]); lastSetup();
  } catch (e) { ui.loaded(); hasDefault = false; myFace('PHOTO OR CAMERA FIRST'); }
}
async function myFace(title) {
  const head = await pickFace(typeof title === 'string' ? title : 'PICK THE FACE TO PUNCH', { corner: BLUE, name: 'THE FACE' });
  if (!head) return ui.show('menu');
  lastSetup = () => game.start('solo', [head]); lastSetup();
  // a scanned face keeps copying the real one while the camera is on (solo only)
  if (head.live && tracking.cam.on) tracking.loadLiveFace(progress).then(() => { ui.loaded(); hands.state.liveHead = head; }).catch(() => ui.loaded());
}
async function twoPlayers() {
  const a = await pickFace('PLAYER 1: PICK YOUR FACE', { corner: RED, name: 'PLAYER 1' });
  if (!a) return ui.show('menu');
  const b = await pickFace('PLAYER 2: PICK YOUR FACE', { corner: BLUE, name: 'PLAYER 2' });
  if (!b) { a.dispose(); return ui.show('menu'); }
  if (!hands.state.enabled) tracking.stopCamera();      // the scans are done: the camera goes off
  lastSetup = () => game.start('pvp', [a, b]); lastSetup();
}
$('bQuick').onclick = quickPlay; $('bFace').onclick = () => myFace(); $('bPvp').onclick = twoPlayers;
$('bAgain').onclick = () => lastSetup && lastSetup();
const leave = () => { hands.state.liveHead = null; if (!hands.state.enabled) tracking.stopCamera(); game.quit(); };
$('bMenu').onclick = leave;

// ---------- settings ----------
const refreshMute = () => { $('bMute').classList.toggle('off', snd.settings.muted); };
$('vol').value = snd.settings.volume; refreshMute();
$('bMute').onclick = () => { snd.setMuted(!snd.settings.muted); refreshMute(); };
$('vol').oninput = e => { snd.setVolume(+e.target.value); if (snd.settings.muted) { snd.setMuted(false); refreshMute(); } };
$('bGear').onclick = () => { $('panel').hidden = !$('panel').hidden; };
$('bQuit').onclick = () => { $('panel').hidden = true; leave(); };
const QUAL = ['auto', 'high', 'low'];
$('bQual').onclick = () => {
  const m = QUAL[(QUAL.indexOf(arena.quality.mode) + 1) % 3]; arena.quality.mode = m;
  if (m !== 'auto') arena.setQuality(m === 'low');
  $('bQual').textContent = 'QUALITY: ' + m.toUpperCase();
};
$('bHands').onclick = async () => {
  if (hands.state.enabled) { hands.state.enabled = false; hands.state.liveHead = null; gloves.follow(null); tracking.stopCamera(); $('bHands').textContent = 'HAND PUNCHES: OFF'; return; }
  try {
    await tracking.startCamera($('cam'), progress, { hand: true }); ui.loaded();
    hands.state.enabled = true; $('bHands').textContent = 'HAND PUNCHES: ON';
    ui.hint('Punch toward the camera with one hand. Taps still work.');
  } catch (err) { ui.loaded(); $('bHands').textContent = 'NO CAMERA FOUND'; }
};

// ---------- frame loop ----------
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 60, slowFor = 0;
function frame(ts) {
  if (!window.__fp.paused) step(Math.min(0.1, Math.max(0, (ts - last) / 1000))); last = ts;
  requestAnimationFrame(frame);
}
function step(real) {
  const dt = fx.tick(real);
  hands.update();
  gloves.follow(hands.fist.visible ? hands.fist : null);
  game.update(dt, real);
  for (const h of game.G.heads) if (h.root.visible) h.update(dt);
  gloves.update(real);
  fx.update(dt, real);
  arena.update(real);
  arena.render();
  // frame rate, and the automatic drop to low quality
  fpsN++; fpsT += real;
  if (fpsT >= 0.5) {
    fps = fpsN / fpsT; fpsN = 0; fpsT = 0; $('fps').textContent = Math.round(fps) + ' fps' + (arena.quality.low ? ' (low)' : '');
    if (arena.quality.mode === 'auto' && !arena.quality.low) { slowFor = fps < 31 ? slowFor + 0.5 : 0; if (slowFor >= 2.5) arena.setQuality(true); }
    else if (arena.quality.mode === 'auto' && arena.quality.scale === 1) { slowFor = fps < 26 ? slowFor + 0.5 : 0; if (slowFor >= 5) { arena.quality.scale = 0.7; arena.resize(); } }
  }
}
requestAnimationFrame(frame);

// small test hooks
window.__fp = { step, game, arena, snd, hands, fps: () => fps, photo: async url => { const h = await headFromUrl(url, { corner: BLUE, name: 'THE FACE' }); if (h) { lastSetup = () => game.start('solo', [h]); lastSetup(); } return !!h; }, headFromUrl, Head };
