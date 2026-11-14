// Screens, HUD and banners. Only touches the page, never the 3D scene.
export const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'pick', 'over'];

export function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('hud').hidden = name !== 'hud';
}

let bannerTimer = 0;
export function banner(text, ms = 1100, cls = '') {
  const b = $('banner'); b.className = cls; b.textContent = text;
  void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
}

export function names(a, b) { $('n1').textContent = a; $('n2').textContent = b || ''; document.querySelector('.bar.p2').style.visibility = b ? 'visible' : 'hidden'; }
const last = {};
const setW = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).style.width = v + '%'; } };
export function bar(i, frac) { const v = Math.round(Math.max(0, Math.min(1, frac)) * 100); setW('f' + (i + 1), v); setW('t' + (i + 1), v); }
export function clock(t) { if (last.clock !== t) { last.clock = t; $('clock').textContent = t; } }
export function active(i) { document.querySelector('.bar.p1').classList.toggle('on', i === 0); document.querySelector('.bar.p2').classList.toggle('on', i === 1); }
export function turn(text, frac) {
  const key = text + '|' + (frac == null ? '' : Math.round(frac * 50));
  if (last.turn === key) return; last.turn = key;
  $('turn').innerHTML = ''; $('turn').append(text);
  if (frac != null) { const t = document.createElement('span'); t.className = 't'; const i = document.createElement('i'); i.style.width = Math.max(0, frac * 100) + '%'; t.append(i); $('turn').append(t); }
}
export function combo(n) {
  const c = $('combo');
  if (n >= 3) { c.innerHTML = ''; c.append(n + ' HITS'); const s = document.createElement('small'); s.textContent = 'COMBO!'; c.append(s); c.style.opacity = 1; }
  else c.style.opacity = 0;
}
export const hint = t => { $('hint').textContent = t; };
export const koFx = on => $('kofx').classList.toggle('on', on);

export function over(title, sub) { $('overTitle').textContent = title; $('overSub').textContent = sub; show('over'); }

export function loading(text, frac) {
  $('loading').hidden = false; $('loadText').textContent = text;
  $('loadBar').style.width = (frac == null ? 100 : Math.round(frac * 100)) + '%';
  $('loadBar').style.opacity = frac == null ? 0.35 : 1;
}
export const loaded = () => { $('loading').hidden = true; };
