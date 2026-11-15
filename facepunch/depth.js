// Optional face relief: a small depth model runs once per scan in the browser and the result
// is handed to the head, which fits it to the landmark depth. The landmark head always shows first.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/+esm';
const MODEL = 'onnx-community/depth-anything-v2-small';
export const settings = { on: true };
let pipePromise = null, lastInfo = { state: 'idle' };
export const info = () => lastInfo;

function loadPipe(report) {
  if (!pipePromise) pipePromise = (async () => {
    const t0 = performance.now();
    const T = await import(LIB);
    T.env.allowLocalModels = false;
    const device = navigator.gpu ? 'webgpu' : 'wasm';
    const make = dev => T.pipeline('depth-estimation', MODEL, { device: dev, dtype: 'q8', progress_callback: p => { if (p.status === 'progress') report('Depth relief ' + Math.round(p.progress) + '%'); } });
    let pipe; try { pipe = await make(device); } catch (e) { if (device === 'wasm') throw e; pipe = await make('wasm'); }
    lastInfo.loadMs = Math.round(performance.now() - t0); lastInfo.device = device;
    return pipe;
  })().catch(e => { pipePromise = null; throw e; });
  return pipePromise;
}

// head: a Head built from landmarks; source: the picture it came from. Returns a promise, never throws.
export async function addRelief(head, source, report = () => {}) {
  if (!settings.on) return { ok: false, why: 'off' };
  try {
    lastInfo = { ...lastInfo, state: 'loading' };
    const pipe = await loadPipe(report);
    lastInfo.state = 'running'; report('Depth relief');
    const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    // crop to the face box plus a margin so the model sees the face large
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (let i = 0; i < head.imgX.length; i++) { const x = head.imgX[i], y = head.imgY[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const mx = (x1 - x0) * 0.35, my = (y1 - y0) * 0.35;
    x0 = Math.max(0, x0 - mx); x1 = Math.min(1, x1 + mx); y0 = Math.max(0, y0 - my); y1 = Math.min(1, y1 + my);
    const cw = Math.max(16, Math.round((x1 - x0) * w)), ch = Math.max(16, Math.round((y1 - y0) * h));
    const scale = Math.min(1, 640 / Math.max(cw, ch));
    const c = document.createElement('canvas'); c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
    c.getContext('2d').drawImage(source, x0 * w, y0 * h, cw, ch, 0, 0, c.width, c.height);
    const t0 = performance.now();
    const out = await pipe(c.toDataURL('image/jpeg', 0.9));
    const d = out.predicted_depth, dw = d.dims[d.dims.length - 1], dh = d.dims[d.dims.length - 2], data = d.data;
    lastInfo.runMs = Math.round(performance.now() - t0);
    const sample = (u, v) => {
      const px = Math.min(dw - 1.001, Math.max(0, ((u - x0) / (x1 - x0)) * dw - 0.5)), py = Math.min(dh - 1.001, Math.max(0, ((v - y0) / (y1 - y0)) * dh - 0.5));
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, i = iy * dw + ix;
      return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + dw] * (1 - fx) + data[i + dw + 1] * fx) * fy;
    };
    const res = head.applyDepth(sample);
    lastInfo.state = res.ok ? 'applied' : 'rejected'; lastInfo.r = res.r;
    return res;
  } catch (e) { lastInfo = { ...lastInfo, state: 'failed', error: String(e && e.message || e) }; return { ok: false, why: lastInfo.error }; }
}
