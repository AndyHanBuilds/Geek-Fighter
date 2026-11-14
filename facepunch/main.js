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
const SKINS = ['#ffcf5a', '#8fe3b0'];
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

// average colour of a cheek, used for the neck and shoulders
function skinOf(source, lm) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d');
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    g.drawImage(source, lm[50].x * w - w * 0.02, lm[50].y * h - h * 0.02, w * 0.04, h * 0.04, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; return `rgb(${r / n | 0},${gg / n | 0},${b / n | 0})`;
  } catch (e) { return '#e8b48c'; }
}
function headFrom(source, opts) {
  const lm = tracking.detectFace(source); if (!lm) return null;
  const tex = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
  return Head.fromLandmarks(lm, w / h, tex, { ...opts, skin: skinOf(source, lm) });
}
async function headFromUrl(url, opts) {
  await tracking.loadFace(progress);
  progress('Building the head', null);
  const img = new Image(); img.src = url; await img.decode();
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
    $('bToon').onclick = () => done(Head.cartoon(opts));
    $('bPickBack').onclick = () => done(null);
    $('file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      try {
        const head = await headFromUrl(url, opts);
        if (head) done(head); else msg('No face found in that photo. Try a clear, front-facing one.');
      } catch (err) { ui.loaded(); msg('That did not work (' + (err.message || err) + '). Try the cartoon face.'); }
      URL.revokeObjectURL(url);
    };
    $('bCam').onclick = async () => {
      try {
        await tracking.startCamera($('cam'), progress, true); ui.loaded();
        $('cam').hidden = false; $('bScan').hidden = false; msg('Look at the camera, then press Scan.');
      } catch (err) { ui.loaded(); msg('No camera (' + (err.name || err) + '). Pick a photo or the cartoon face.'); }
    };
    $('bScan').onclick = () => {
      const head = headFrom(tracking.snapshot(), opts);
      if (head) { fx.sound('voice:scan_complete', { channel: 'vo' }); done(head); } else msg('No face found. Move closer and face the camera.');
    };
  });
}

let lastSetup = null;
async function quickPlay() { lastSetup = quickPlay; game.start('solo', [Head.cartoon({ corner: BLUE, skin: SKINS[0], name: 'JELLY JOE' })]); }
async function myFace() {
  const head = await pickFace('PICK THE FACE TO PUNCH', { corner: BLUE, skin: SKINS[0], name: 'THE FACE' });
  if (!head) return ui.show('menu');
  lastSetup = () => game.start('solo', [head]); lastSetup();
}
async function twoPlayers() {
  const a = await pickFace('PLAYER 1: PICK YOUR FACE', { corner: RED, skin: SKINS[0], name: 'PLAYER 1' });
  if (!a) return ui.show('menu');
  const b = await pickFace('PLAYER 2: PICK YOUR FACE', { corner: BLUE, skin: SKINS[1], name: 'PLAYER 2' });
  if (!b) { a.dispose(); return ui.show('menu'); }
  lastSetup = () => game.start('pvp', [a, b]); lastSetup();
}
$('bQuick').onclick = quickPlay; $('bFace').onclick = myFace; $('bPvp').onclick = twoPlayers;
$('bAgain').onclick = () => lastSetup && lastSetup();
$('bMenu').onclick = () => game.quit();

// ---------- settings ----------
const refreshMute = () => { $('bMute').classList.toggle('off', snd.settings.muted); };
$('vol').value = snd.settings.volume; refreshMute();
$('bMute').onclick = () => { snd.setMuted(!snd.settings.muted); refreshMute(); };
$('vol').oninput = e => { snd.setVolume(+e.target.value); if (snd.settings.muted) { snd.setMuted(false); refreshMute(); } };
$('bGear').onclick = () => { $('panel').hidden = !$('panel').hidden; };
$('bQuit').onclick = () => { $('panel').hidden = true; game.quit(); };
const QUAL = ['auto', 'high', 'low'];
$('bQual').onclick = () => {
  const m = QUAL[(QUAL.indexOf(arena.quality.mode) + 1) % 3]; arena.quality.mode = m;
  if (m !== 'auto') arena.setQuality(m === 'low');
  $('bQual').textContent = 'QUALITY: ' + m.toUpperCase();
};
$('bHands').onclick = async () => {
  if (hands.state.enabled) { hands.state.enabled = false; gloves.follow(null); tracking.stopCamera(); $('bHands').textContent = 'HAND PUNCHES: OFF'; return; }
  try {
    await tracking.startCamera($('cam'), progress, false); ui.loaded();
    hands.state.enabled = true; $('bHands').textContent = 'HAND PUNCHES: ON';
    ui.hint('Punch toward the camera with one hand. Taps still work.');
  } catch (err) { ui.loaded(); $('bHands').textContent = 'NO CAMERA FOUND'; }
};

// ---------- frame loop ----------
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 60, slowFor = 0;
function frame(ts) {
  const real = Math.min(0.05, Math.max(0, (ts - last) / 1000)); last = ts;
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
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// small test hooks
window.__fp = { game, arena, snd, hands, fps: () => fps, photo: async url => { const h = await headFromUrl(url, { corner: BLUE, name: 'THE FACE' }); if (h) { lastSetup = () => game.start('solo', [h]); lastSetup(); } return !!h; }, headFromUrl, Head };
