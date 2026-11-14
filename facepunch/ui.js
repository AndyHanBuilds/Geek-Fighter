// Buttons, scan flow and the loading text. Owns the tracking library.
import * as THREE from 'three';
import * as Head from './head.js';
import * as Hands from './hands.js';
import { reset } from './game.js';
const V = '0.10.21';   // pinned: newer web builds send usage logs
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const $ = id => document.getElementById(id);
export const info = t => { $('info').textContent = t; };
let vision, faceLM, handLM, videoLM, video, live = false, mirror;
async function libs() {
  if (vision) return;
  info('Loading tracking data (about 21 MB)...');
  const m = await import(`${BASE}/vision_bundle.mjs`);
  const files = await m.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  const mk = async (cls, model, opts) => { for (const delegate of ['GPU', 'CPU']) { try { return await cls.createFromOptions(files, { baseOptions: { modelAssetPath: model, delegate }, ...opts }); } catch (e) { if (delegate === 'CPU') throw e; } } };
  vision = { m, mk };
  faceLM = await mk(m.FaceLandmarker, FACE_MODEL, { runningMode: 'IMAGE', numFaces: 1 });
}
export async function loadPhoto(url) {
  await libs();
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();
  const r = faceLM.detect(img);
  if (!r.faceLandmarks.length) { info('No face found in that photo. Try a clear, front-facing one.'); return false; }
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  Head.build(r.faceLandmarks[0], img.width / img.height, t); reset();
  info('Head ready. Tap or drag fast across it to punch.'); return true;
}
function mirrored() {   // mirror the camera so left and right feel natural
  mirror = mirror || document.createElement('canvas'); mirror.width = video.videoWidth; mirror.height = video.videoHeight;
  const g = mirror.getContext('2d'); g.setTransform(-1, 0, 0, 1, mirror.width, 0); g.drawImage(video, 0, 0); return mirror;
}
export function initUI() {
  $('file').onchange = e => { const f = e.target.files[0]; if (f) loadPhoto(URL.createObjectURL(f)).catch(err => info('Failed: ' + err)); };
  $('camBtn').onclick = async () => {
    try {
      await libs();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video = $('cam'); video.srcObject = stream; await video.play(); video.style.display = 'block';
      info('Loading live tracking...');
      videoLM = await vision.mk(vision.m.FaceLandmarker, FACE_MODEL, { runningMode: 'VIDEO', numFaces: 1 });
      handLM = await vision.mk(vision.m.HandLandmarker, HAND_MODEL, { runningMode: 'VIDEO', numHands: 1 });
      $('scanBtn').disabled = false; live = true; info('Camera on. Look at the camera and press Scan face.');
    } catch (e) { info('Camera problem: ' + e.name + ' ' + e.message + '\nYou can still use a photo.'); }
  };
  $('scanBtn').onclick = () => {
    const c = document.createElement('canvas'), m = mirrored(); c.width = m.width; c.height = m.height; c.getContext('2d').drawImage(m, 0, 0);
    const r = faceLM.detect(c);
    if (!r.faceLandmarks.length) { info('No face found. Move closer and face the camera.'); return; }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    Head.build(r.faceLandmarks[0], c.width / c.height, t); reset();
    info('Scanned! Move your face, then punch toward the camera.');
  };
}
// called every frame: live expressions and hand punches
export function liveStep(ts, viewW, viewH) {
  if (!live || !Head.state.ready || video.readyState < 2) return;
  const m = mirrored();
  const r = videoLM.detectForVideo(m, ts);
  if (r.faceLandmarks.length) Head.setPose(r.faceLandmarks[0], m.width / m.height);
  const h = handLM.detectForVideo(m, ts);
  Hands.feed(h.landmarks[0] || null, ts, viewW, viewH);
}
