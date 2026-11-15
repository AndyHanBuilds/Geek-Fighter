// Sound. play(name) picks a file by situation or kind from the two manifests;
// if nothing is loaded yet, hits fall back to a thump made in the browser.
// Chain: voices -> master gain -> limiter -> speakers.
const SETS = [{ dir: 'assets/audio/', gain: 1 }, { dir: 'assets/sfx/', gain: 1 }];
const LOUD = { 'brainrot_boom.wav': 0.5, 'cartoon_slide_whistle_down.wav': 0.5, 'brainrot_airhorn.wav': 0.5, 'brainrot_record_scratch.wav': 0.5 };
// long clips are kept away from ordinary hits
const LONG = new Set(['brainrot_sad_trombone.wav', 'cartoon_slide_whistle_down.wav', 'brainrot_boom.wav', 'brainrot_airhorn.wav', 'cartoon_boing.wav', 'brainrot_record_scratch.wav']);
// a very loud room: no music, no announcer, no long clips. Only short, sharp sounds are ever loaded.
const MAX_LEN = 0.95;
const PUNCH_GAIN = 0.7;                     // punches carry the room now that the voices are gone

let ctx, master, limiter;
const files = {};                           // file -> {url, kind, situation, gain, buf, loading}
const groups = {};                          // key -> [file]
const lastPick = {};
const channels = {};                        // one voice at a time per channel
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
export const settings = { volume: +(store.get('fp_vol') ?? 0.8), muted: store.get('fp_mute') === '1' };

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 14; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination); apply();
  } catch (e) { ctx = null; }
  return ctx;
}
function apply() { if (master) master.gain.value = settings.muted ? 0 : settings.volume; }
export function setVolume(v) { settings.volume = v; store.set('fp_vol', v); apply(); }
export function setMuted(m) { settings.muted = m; store.set('fp_mute', m ? '1' : '0'); apply(); }
// browsers only allow sound after a tap or key press
export function unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }

const add = (key, f) => { (groups[key] ||= []).push(f); };
export async function loadManifests() {
  for (const set of SETS) {
    try {
      const m = await (await fetch(set.dir + 'manifest.json')).json();
      for (const [name, info] of Object.entries(m.files || {})) {
        if (info.kind === 'music' || info.kind === 'voice' || (info.duration_seconds || 0) > MAX_LEN) continue;
        files[name] = { url: set.dir + name, kind: info.kind, situation: info.situation, gain: (LOUD[name] || 1) * set.gain * (info.kind === 'impact' || info.kind === 'whoosh' ? PUNCH_GAIN : 1) };
        add(name, name); add(name.replace(/\.\w+$/, ''), name);
        if (info.situation) { add(info.situation, name); add(info.kind + ':' + info.situation, name); }
        if (info.kind === 'ouch') add('ouch', name);
        if (info.kind === 'brainrot' && !LONG.has(name)) add('rare', name);
      }
    } catch (e) { /* no files: the thump still works */ }
  }
}
async function load(name) {
  const f = files[name]; if (!f || f.buf || f.loading || !ensure()) return;
  f.loading = true;
  try { f.buf = await ctx.decodeAudioData(await (await fetch(f.url)).arrayBuffer()); } catch (e) { f.failed = true; }
  f.loading = false;
}
// fetch the clips a fight needs, a few at a time
export async function preload(keys) {
  const list = [...new Set(keys.flatMap(k => groups[k] || []))];
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(load));
}

function thump(s = 1) {
  if (!ensure()) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(170 + 60 * s, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.25);
  const nb = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate), d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const ns = ctx.createBufferSource(), ng = ctx.createGain(); ns.buffer = nb; ng.gain.value = 0.25; ns.connect(ng).connect(master); ns.start(t);
}

// play('hit_heavy'), play('ouch', {channel:'ouch'}), play('ko_bell') ...
// opts: gain, channel (cuts the previous clip on that channel), strength (for the fallback), rate
export function play(key, opts = {}) {
  if (!ensure() || settings.muted) return false;
  const list = groups[key];
  if (!list || !list.length) { if (key.startsWith('hit')) thump(opts.strength); return false; }
  let name = list[(Math.random() * list.length) | 0];
  if (list.length > 1 && name === lastPick[key]) name = list[(list.indexOf(name) + 1) % list.length];
  lastPick[key] = name;
  const f = files[name];
  if (!f.buf) { load(name); if (key.startsWith('hit')) thump(opts.strength); return false; }
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = f.buf; src.playbackRate.value = opts.rate || 1; g.gain.value = f.gain * (opts.gain ?? 1);
  src.connect(g).connect(master);
  if (opts.channel) {
    const old = channels[opts.channel];
    if (old) { try { old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.03); old.src.stop(ctx.currentTime + 0.15); } catch (e) {} }
    channels[opts.channel] = { src, g };
  }
  src.start();
  return true;
}
export const stats = () => ({ files: Object.keys(files).length, loaded: Object.values(files).filter(f => f.buf).length, failed: Object.values(files).filter(f => f.failed).length, state: ctx ? ctx.state : 'none' });
