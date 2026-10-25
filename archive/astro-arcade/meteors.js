// Tempête de météorites : boules de feu en diagonale, traînées lumineuses, explosions d'étincelles.
(function (root) {
  const COLORS = ['#fff3b0', '#ffd23f', '#ff9f43', '#ff4d6d', '#ff6b35'];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function newStorm() { return { active: 0, spawn: 0, meteors: [], sparks: [], flash: 0 }; }
  function start(st, seconds) { st.active = seconds || 8; st.spawn = 0; }
  function spawn(st, w, h) {
    const r = 6 + Math.random() * 12, sp = 350 + Math.random() * 350, ang = Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    st.meteors.push({ x: Math.random() * (w + h * 0.5), y: -30, vx: Math.cos(ang) * -sp * 0.6, vy: sp, r, trail: [], boomY: h * (0.35 + Math.random() * 0.6) });
  }
  function explode(st, m) {
    const n = 14 + Math.floor(m.r * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 320;
      st.sparks.push({ x: m.x, y: m.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.6, color: pick(COLORS) });
    }
    st.flash = Math.min(0.6, st.flash + m.r / 40);
  }
  function step(st, dt, w, h) {
    if (st.active > 0) {
      st.active -= dt; st.spawn -= dt;
      while (st.spawn <= 0) { spawn(st, w, h); st.spawn += 0.12 + Math.random() * 0.25; }
    }
    st.meteors = st.meteors.filter(m => {
      m.trail.unshift({ x: m.x, y: m.y }); if (m.trail.length > 18) m.trail.pop();
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y >= m.boomY || m.y > h) { explode(st, m); return false; }
      return true;
    });
    st.sparks = st.sparks.filter(p => { p.life -= dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.life > 0; });
    st.flash = Math.max(0, st.flash - dt * 2);
  }
  function draw(g, st) {
    g.save(); g.globalCompositeOperation = 'lighter';
    st.meteors.forEach(m => {
      m.trail.forEach((t, i) => { const k = 1 - i / m.trail.length; g.globalAlpha = k * 0.6; g.fillStyle = i < 6 ? '#ffb347' : '#ff4d6d'; g.beginPath(); g.arc(t.x, t.y, m.r * k, 0, 6.3); g.fill(); });
      g.globalAlpha = 1; g.fillStyle = '#ff9f43'; g.beginPath(); g.arc(m.x, m.y, m.r, 0, 6.3); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(m.x, m.y, m.r * 0.5, 0, 6.3); g.fill();
    });
    st.sparks.forEach(p => { g.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5)); g.fillStyle = p.color; g.fillRect(p.x - 2, p.y - 2, 4, 4); });
    g.restore();
    if (st.flash > 0) { g.fillStyle = `rgba(255,150,60,${st.flash * 0.15})`; g.fillRect(0, 0, g.canvas.width, g.canvas.height); }
  }
  const api = { newStorm, start, step, draw, spawn, explode };
  if (typeof module !== 'undefined') module.exports = api; else root.Meteors = api;
})(typeof window !== 'undefined' ? window : globalThis);
