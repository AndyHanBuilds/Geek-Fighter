// Loads the face and hand trackers and runs the camera. Everything runs in
// the browser: pictures and video never leave the device.
const V = '0.10.21';   // pinned on purpose: newer web builds send usage logs
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let lib, fileset, faceImage, faceVideo, handVideo, faceBuf, handBuf;
export const cam = { on: false, video: null, stream: null };

// download with a real progress number for the loading bar
async function fetchBuf(url, onProgress) {
  const res = await fetch(url); if (!res.ok) throw new Error('download failed: ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), out = new Uint8Array(total); let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (got + value.length > total) break; out.set(value, got); got += value.length; onProgress(got / total); }
  return got === total ? out : new Uint8Array(await (await fetch(url)).arrayBuffer());
}
async function make(cls, buf, opts) {
  for (const delegate of ['GPU', 'CPU']) {
    try { return await cls.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: buf, delegate }, ...opts }); }
    catch (e) { if (delegate === 'CPU') throw e; }
  }
}
async function core(progress) {
  if (fileset) return;
  progress('Loading the face tracker (1 of 3)', null);
  lib = await import(`${BASE}/vision_bundle.mjs`);
  fileset = await lib.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
}

// the still-photo face tracker (about 14 MB the first time, then cached)
export async function loadFace(progress = () => {}) {
  if (faceImage) return;
  await core(progress);
  faceBuf ||= await fetchBuf(FACE_MODEL, f => progress('Loading the face tracker (2 of 3)', f));
  progress('Starting the face tracker (3 of 3)', null);
  faceImage = await make(lib.FaceLandmarker, faceBuf, { runningMode: 'IMAGE', numFaces: 1 });
}

// image or canvas -> 478 landmarks, or null when no face is found
export function detectFace(source) {
  const r = faceImage.detect(source);
  return r.faceLandmarks && r.faceLandmarks.length ? r.faceLandmarks[0] : null;
}

export async function startCamera(video, progress = () => {}, { face = false, hand = false } = {}) {
  if (!cam.on) {
    progress('Asking for the camera', null);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play();
    cam.on = true; cam.video = video; cam.stream = stream;
  }
  if (face) await loadFace(progress); else await core(progress);
  if (hand && !handVideo) {
    handBuf ||= await fetchBuf(HAND_MODEL, f => progress('Loading the hand tracker', f));
    progress('Starting the hand tracker', null);
    handVideo = await make(lib.HandLandmarker, handBuf, { runningMode: 'VIDEO', numHands: 1 });
  }
}
// live face tracking is only needed for the mirror mode, so it is made on demand
export async function loadLiveFace(progress = () => {}) {
  if (faceVideo) return;
  await loadFace(progress);
  faceVideo = await make(lib.FaceLandmarker, faceBuf, { runningMode: 'VIDEO', numFaces: 1 });
}
export function stopCamera() {
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  if (cam.video) cam.video.srcObject = null;
  cam.on = false; cam.stream = null;
}
export const ready = () => cam.on && cam.video && cam.video.readyState >= 2;
export function hands(ts) { return handVideo ? handVideo.detectForVideo(cam.video, ts) : null; }
export function liveFace(ts) { return faceVideo ? faceVideo.detectForVideo(cam.video, ts) : null; }
// mirrored snapshot of the camera, used for a scan
export function snapshot() {
  const v = cam.video, c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(v, 0, 0);
  return c;
}
