// Effects: hit-stop, shake, pop text, sound.
const $ = id => document.getElementById(id);
export const fx = { hitStop: 0, shake: 0 };
let actx;
export function thud(s) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(170 + 60 * s, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.25);
    const nb = actx.createBuffer(1, actx.sampleRate * 0.08, actx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const ns = actx.createBufferSource(), ng = actx.createGain(); ns.buffer = nb; ng.gain.value = 0.35; ns.connect(ng).connect(actx.destination); ns.start(t);
  } catch (e) {}
}
// fx.sound(name): hook for real files in assets/audio; for now everything is the synth thump.
export function sound(name, s = 1) { thud(s); }
let popTimer = 0;
export function pop(text, ms = 420) { const m = $('msg'); m.textContent = text; m.style.opacity = 1; m.style.transform = `scale(${1 + Math.random() * .25}) rotate(${(Math.random() - .5) * 14}deg)`; clearTimeout(popTimer); popTimer = setTimeout(() => m.style.opacity = 0, ms); }
export function impact(strength) { fx.hitStop = 0.05 + 0.04 * strength; fx.shake = 0.12 * strength; }
