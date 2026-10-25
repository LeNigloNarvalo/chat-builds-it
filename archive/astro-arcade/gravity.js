// Zone de Gravité Inversée : pendant quelques secondes, loot et pièces flottent vers le haut, avec des ondes de couleur (logique pure, testable avec Node).
(function (root) {
  const W = 480, H = 640, DURATION = 10, FALL = 110, RISE = 90, COIN_PTS = 50, WAVE_EVERY = 0.45;

  function newGravity() { return { on: false, t: 0, left: 0, coins: [], waves: [], waveT: 0, collected: 0, hue: 0 }; }

  function start(z) { z.on = true; z.left = DURATION; z.waveT = 0; z.collected = 0; }
  function stop(z) { z.on = false; z.left = 0; z.coins = []; z.waves = []; }

  // Appelé après Logic.step : annule la chute du loot (110 px/s) et le fait monter ; gère pièces et ondes.
  function step(z, s, dt, rnd) {
    rnd = rnd || Math.random;
    z.t += dt; z.hue = (z.hue + dt * 120) % 360;
    z.waves.forEach(w => { w.r += 220 * dt; w.life -= dt; });
    z.waves = z.waves.filter(w => w.life > 0);
    if (!z.on) return;
    z.left -= dt;
    if (z.left <= 0) { z.on = false; z.coins = []; return; }
    s.loot.forEach(l => { l.y -= (FALL + RISE) * dt; });
    s.loot = s.loot.filter(l => l.y > -40);
    z.waveT -= dt;
    if (z.waveT <= 0) { z.waveT = WAVE_EVERY; z.waves.push({ x: rnd() * W, y: H * (0.3 + rnd() * 0.6), r: 4, life: 1.6, hue: (z.hue + rnd() * 90) % 360 }); }
    if (rnd() < dt * 3) z.coins.push({ x: 20 + rnd() * (W - 60), y: H + 10, w: 20, h: 20, v: RISE * (0.7 + rnd() * 0.8), ph: rnd() * 6 });
    const p = s.player;
    z.coins.forEach(c => { c.y -= c.v * dt; });
    z.coins = z.coins.filter(c => {
      if (!s.over && c.x < p.x + p.w && c.x + c.w > p.x && c.y < p.y + p.h && c.y + c.h > p.y) { s.score += COIN_PTS; z.collected++; return false; }
      return c.y > -30;
    });
  }

  const api = { DURATION, COIN_PTS, newGravity, start, stop, step };
  if (typeof module !== 'undefined') module.exports = api; else root.Gravity = api;
})(this);
