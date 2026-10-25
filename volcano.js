// Éruption Volcanique Cosmique : un volcan en bas de l'écran crache lave et étincelles qui éclairent le jeu (logique pure, testable avec Node).
(function (root) {
  const W = 480, H = 640, DURATION = 12, GRAVITY = 420, VX = W / 2, RISE = 1;

  function newVolcano() { return { on: false, t: 0, left: 0, rise: 0, glow: 0, lava: [], sparks: [], burstT: 0, bursts: 0 }; }

  function start(v) { v.on = true; v.left = DURATION; v.burstT = 0; }
  function stop(v) { v.on = false; v.left = 0; }

  function burst(v, rnd, n) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 1.1, sp = 380 + rnd() * 330;
      v.lava.push({ x: VX + (rnd() - 0.5) * 30, y: H - 90, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, r: 4 + rnd() * 6, life: 2.6, hue: 10 + rnd() * 35 });
    }
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, sp = 250 + rnd() * 450;
      v.sparks.push({ x: VX + (rnd() - 0.5) * 40, y: H - 90, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + rnd() * 1.2, hue: 35 + rnd() * 25 });
    }
    v.bursts++;
  }

  // Avance le volcan : sort du sol, éclate par salves, fait retomber lave et étincelles. Le glow (0..1) sert à éclairer le jeu.
  function step(v, dt, rnd) {
    rnd = rnd || Math.random;
    v.t += dt;
    v.rise = Math.max(0, Math.min(1, v.rise + (v.on ? dt : -dt) * 1.5));
    if (v.on) {
      v.left -= dt;
      if (v.left <= 0) stop(v);
      else { v.burstT -= dt; if (v.burstT <= 0 && v.rise > 0.8) { v.burstT = 0.35 + rnd() * 0.4; burst(v, rnd, 10 + Math.floor(rnd() * 8)); } }
    }
    const move = q => { q.vy += GRAVITY * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; };
    v.lava.forEach(move); v.sparks.forEach(move);
    v.lava = v.lava.filter(q => q.life > 0 && q.y < H + 20);
    v.sparks = v.sparks.filter(q => q.life > 0 && q.y < H + 20);
    v.glow = Math.min(1, v.rise * 0.35 + Math.min(0.65, v.lava.length / 60));
  }

  const api = { DURATION, newVolcano, start, stop, burst, step };
  if (typeof module !== 'undefined') module.exports = api; else root.Volcano = api;
})(this);
