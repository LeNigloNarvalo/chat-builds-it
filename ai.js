// IA du mode démo (sans DOM) : lit l'état du jeu et renvoie les commandes {left, right, fire}.
(function (root) {
  const W = 480, SPEED = 300, HORIZON = 0.9, STEP = 0.075, MARGIN = 5;

  // Menaces = bombes ennemies + tirs du boss, avec vitesse (px/s).
  function threats(s, boss) {
    const bombVy = 180 + s.level * 15;
    const list = s.bombs.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, vx: 0, vy: bombVy }));
    if (boss && !boss.defeated) {
      boss.shots.forEach(o => list.push(o.type === 'beam'
        ? { x: o.x, y: o.y, w: o.w, h: o.h, vx: 0, vy: 0, beam: true }
        : { x: o.x, y: o.y, w: o.w, h: o.h, vx: o.vx, vy: o.vy }));
    }
    return list;
  }

  // Danger si le vaisseau rejoint la position cx : on simule son déplacement et celui des menaces.
  function danger(s, list, cx) {
    const p = s.player; let d = 0;
    for (let t = 0; t <= HORIZON; t += STEP) {
      const dx = cx - p.x, px = p.x + Math.max(-SPEED * t, Math.min(SPEED * t, dx));
      for (const o of list) {
        const ox = o.x + o.vx * t, oy = o.y + o.vy * t;
        if (ox < px + p.w + MARGIN && ox + o.w > px - MARGIN && oy < p.y + p.h && oy + o.h > p.y)
          d += (o.beam ? 3 : 1) * (1.2 - t);
      }
    }
    return d;
  }

  // Cible à viser : le boss, sinon l'ennemi le plus bas (le plus menaçant), avec anticipation.
  function aimX(s, boss) {
    const p = s.player;
    if (boss && !boss.defeated) return boss.x + boss.w / 2 + boss.dir * 35 * Math.max(0, (p.y - boss.y - boss.h) / 560) * 2;
    if (!s.enemies.length) return p.x + p.w / 2;
    const cfg = { speed: 40 + s.level * 12 };
    const low = s.enemies.reduce((a, e) => (e.y > a.y || (e.y === a.y && Math.abs(e.x - p.x) < Math.abs(a.x - p.x)) ? e : a));
    const t = Math.max(0, (p.y - low.y - low.h) / 520);
    return low.x + low.w / 2 + s.dir * cfg.speed * t;
  }

  function decide(s, boss) {
    const p = s.player, none = { left: 0, right: 0, fire: false };
    if (!s || s.over) return none;
    const list = threats(s, boss), target = aimX(s, boss), pc = p.x + p.w / 2;
    let best = p.x, bestCost = Infinity;
    for (let x = 0; x <= W - p.w; x += 6) {
      const cost = danger(s, list, x) * 100 + Math.abs(x + p.w / 2 - target) * 0.4 + Math.abs(x - p.x) * 0.05;
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    const dx = best - p.x;
    const fireWindow = boss && !boss.defeated ? boss.w / 2 - 6 : 12;
    return {
      left: +(dx < -3), right: +(dx > 3),
      fire: Math.abs(pc - target) < fireWindow || s.enemies.some(e => pc > e.x && pc < e.x + e.w) || !!(boss && !boss.defeated && pc > boss.x && pc < boss.x + boss.w),
    };
  }

  // Relance : à l'écran titre ou après un game over, attend un court délai (pour laisser le score s'enregistrer).
  function shouldRestart(running, over, idle) { return (!running || over) && idle >= 1.5; }

  const api = { decide, threats, danger, aimX, shouldRestart };
  if (typeof module !== 'undefined') module.exports = api; else root.Ai = api;
})(typeof window !== 'undefined' ? window : globalThis);
