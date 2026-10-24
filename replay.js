// Replay du Chat (sans DOM sauf drawFrame qui reçoit un contexte 2D) : enregistre une partie,
// repère les exploits (combos, niveaux, boss), calcule ralenti + zoom, et sérialise pour un lien à partager.
(function (root) {
  const W = 480, H = 640, DT = 1 / 30, MAX_FRAMES = 6000;
  const ROW_COLORS = ['#ff4d6d', '#ff9f43', '#ffd23f', '#2ed573', '#1e90ff', '#a55eea'];
  const flat = (list, f) => { const out = []; list.forEach(o => f(o, out)); return out; };
  const r = Math.round;

  function newRecorder() { return { frames: [], acc: DT, score: 0 }; }

  // Appelé à chaque image du jeu : n'échantillonne qu'à 30 Hz.
  function capture(rec, s, boss, dt) {
    rec.acc += dt;
    if (rec.acc < DT) return false;
    rec.acc -= DT; if (rec.acc > DT) rec.acc = 0;
    const b = boss && !boss.defeated ? boss : null;
    rec.frames.push({
      px: r(s.player.x), sc: s.score, lv: s.level, li: s.lives, cb: s.combo,
      e: flat(s.enemies, (e, o) => o.push(r(e.x), r(e.y), e.row)),
      b: flat(s.bullets, (u, o) => o.push(r(u.x), r(u.y))),
      o: flat(s.bombs, (u, o) => o.push(r(u.x), r(u.y))),
      bo: b ? [r(b.x), r(b.y), r(b.w), r(b.h), r(b.hp), b.max] : null,
      bs: b ? flat(b.shots, (u, o) => o.push(r(u.x), r(u.y), r(u.w), r(u.h), u.type === 'beam' && u.warn > 0 ? 1 : 0)) : [],
    });
    if (rec.frames.length > MAX_FRAMES) rec.frames.shift();
    rec.score = s.score;
    return true;
  }

  // Exploits : combo qui grimpe (≥ 4), gros gain de score, nouveau niveau, coup au boss, boss vaincu.
  function markers(frames) {
    const out = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], f = frames[i];
      const gain = f.sc - a.sc;
      let kind = null;
      if (f.lv > a.lv) kind = 'NIVEAU ' + f.lv;
      else if (f.cb >= 4 && f.cb > a.cb) kind = 'COMBO x' + f.cb;
      else if (gain >= 150) kind = '+' + gain;
      else if (a.bo && f.bo && f.bo[4] < a.bo[4] - 0) kind = 'COUP AU BOSS';
      else if (a.bo && !f.bo && f.sc > a.sc) kind = 'BOSS VAINCU';
      if (kind) out.push({ i, kind, score: gain });
    }
    return out;
  }

  // Fenêtre (en images) qui contient le plus de points gagnés : le "meilleur moment".
  function bestWindow(frames, seconds) {
    const n = Math.round(seconds / DT);
    if (frames.length <= n) return [0, frames.length];
    let bi = 0, bg = -1;
    for (let i = 0; i + n <= frames.length; i += 5) {
      const g = frames[i + n - 1].sc - frames[i].sc;
      if (g > bg) { bg = g; bi = i; }
    }
    return [bi, bi + n];
  }

  // Vitesse de lecture et zoom à l'image i : ralenti + zoom autour des exploits (0.6 s avant, 1.2 s après).
  function focusAt(marks, i, dt) {
    dt = dt || DT;
    let near = null, best = Infinity;
    for (const m of marks) {
      const d = (i - m.i) * dt, k = d < 0 ? -d / 0.6 : d / 1.2;
      if (d >= -0.6 && d <= 1.2 && k < best) { best = k; near = m; }
    }
    return near ? { speed: 0.3 + 0.7 * Math.min(1, best) * 0.5, zoom: 1.7 - 0.5 * best, mark: near } : { speed: 1, zoom: 1, mark: null };
  }

  // Sérialisation compacte (JSON) : sous-échantillonnée pour tenir dans un lien.
  function pack(frames, every) {
    every = every || 1;
    return JSON.stringify({ v: 1, k: every, f: frames.filter((_, i) => i % every === 0).map(f => [f.px, f.sc, f.lv, f.li, f.cb, f.e, f.b, f.o, f.bo, f.bs]) });
  }
  function unpack(str) {
    const d = JSON.parse(str);
    if (!d || d.v !== 1 || !Array.isArray(d.f) || d.f.length > MAX_FRAMES) throw new Error('replay invalide');
    const num = a => Array.isArray(a) && a.every(x => typeof x === 'number');
    const frames = d.f.map(a => {
      if (!Array.isArray(a) || !num(a.slice(0, 5)) || !num(a[5]) || !num(a[6]) || !num(a[7]) || !num(a[9]) || (a[8] && !num(a[8]))) throw new Error('replay invalide');
      return { px: a[0], sc: a[1], lv: a[2], li: a[3], cb: a[4], e: a[5], b: a[6], o: a[7], bo: a[8], bs: a[9] };
    });
    return { frames, step: DT * (+d.k > 0 ? +d.k : 1) };
  }

  function drawFrame(g, f, t) {
    g.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % W, (i * 53 + t * 40 * (1 + i % 3)) % H, 2, 2);
    for (let i = 0; i < f.e.length; i += 3) {
      const x = f.e[i], y = f.e[i + 1]; g.fillStyle = ROW_COLORS[f.e[i + 2] % 6]; g.fillRect(x, y, 28, 22);
      g.fillStyle = '#000'; g.fillRect(x + 6, y + 6, 4, 4); g.fillRect(x + 18, y + 6, 4, 4);
    }
    if (f.bo) {
      const [x, y, w, h, hp, max] = f.bo; g.fillStyle = '#8e44ad'; g.fillRect(x, y + 20, w, h - 20); g.fillRect(x + 20, y, w - 40, 30);
      g.fillStyle = '#300'; g.fillRect(40, 56, 400, 8); g.fillStyle = '#ff4d6d'; g.fillRect(40, 56, 400 * hp / max, 8);
    }
    for (let i = 0; i < f.bs.length; i += 5) { g.fillStyle = f.bs[i + 4] ? '#ffff5044' : '#ff9f43'; g.fillRect(f.bs[i], f.bs[i + 1], f.bs[i + 2], f.bs[i + 3]); }
    g.fillStyle = '#00e5ff'; g.beginPath(); g.moveTo(f.px + 16, H - 50); g.lineTo(f.px + 32, H - 30); g.lineTo(f.px, H - 30); g.fill();
    g.fillStyle = '#fff'; for (let i = 0; i < f.b.length; i += 2) g.fillRect(f.b[i], f.b[i + 1], 4, 12);
    g.fillStyle = '#ff4d6d'; for (let i = 0; i < f.o.length; i += 2) g.fillRect(f.o[i], f.o[i + 1], 6, 12);
  }

  function drawHud(g, f, label, speed) {
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = '16px monospace';
    g.fillText('SCORE ' + f.sc, 10, 22); g.fillText('NIV ' + f.lv, 200, 22);
    g.textAlign = 'right'; g.fillText('♥'.repeat(Math.max(0, f.li)), 470, 22);
    g.textAlign = 'center'; g.font = 'bold 14px monospace'; g.fillStyle = '#ff4d6d'; g.fillText('● REPLAY' + (speed < 0.95 ? ' · RALENTI x' + speed.toFixed(2) : ''), 240, 620);
    if (label) { g.font = 'bold 30px monospace'; g.fillStyle = '#ffd23f'; g.fillText(label, 240, 120); }
  }

  const api = { newRecorder, capture, markers, bestWindow, focusAt, pack, unpack, drawFrame, drawHud, DT, W, H };
  if (typeof module !== 'undefined') module.exports = api; else root.Replay = api;
})(typeof window !== 'undefined' ? window : globalThis);
