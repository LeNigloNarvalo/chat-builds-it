// Logique pure du jeu (sans DOM) : testable avec Node.
(function (root) {
  const W = 480, H = 640;

  function levelConfig(level) {
    return {
      rows: Math.min(3 + Math.floor(level / 2), 6),
      cols: Math.min(6 + level, 10),
      speed: 40 + level * 12,
      fireRate: Math.max(0.4, 1.6 - level * 0.15),
    };
  }

  function makeWave(level) {
    const c = levelConfig(level), enemies = [];
    for (let r = 0; r < c.rows; r++)
      for (let i = 0; i < c.cols; i++)
        enemies.push({ x: 40 + i * 42, y: 50 + r * 36, w: 28, h: 22, row: r, hp: 1 });
    return enemies;
  }

  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Points : plus la rangée est haute, plus ça rapporte; combo multiplie.
  function points(row, combo) {
    return (10 + (5 - Math.min(row, 5)) * 5) * Math.max(1, combo);
  }

  function newState() {
    return {
      level: 1, score: 0, lives: 3, combo: 0, dir: 1, over: false,
      player: { x: W / 2 - 16, y: H - 50, w: 32, h: 20 },
      enemies: makeWave(1), bullets: [], bombs: [], particles: [], loot: [], pac: 0, pacEaten: 0,
      cooldown: 0, bombTimer: 1, shake: 0, flash: '',
    };
  }

  function burst(s, x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = 40 + Math.random() * 160;
      s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, color });
    }
  }

  // Loot aléatoire : un ennemi tué lâche parfois un ❤ (+1 vie) ou un PAC (Pac-Man qui mange les bombes ; 3 bombes avalées = +1 vie).
  const MAX_LIVES = 5, LOOT_CHANCE = 0.25, PAC_TIME = 6, PAC_REACH = 22;
  function dropLoot(s, e, rnd) {
    rnd = rnd || Math.random;
    if (rnd() >= LOOT_CHANCE) return null;
    const l = { type: rnd() < 0.5 ? 'heart' : 'pac', x: e.x + e.w / 2 - 10, y: e.y, w: 20, h: 20 };
    s.loot.push(l); return l;
  }
  function heal(s) { if (s.lives < MAX_LIVES) s.lives++; burst(s, s.player.x + 16, s.player.y, '#ff6bd6', 16); }

  function step(s, dt, input) {
    if (s.over) return s;
    const cfg = levelConfig(s.level), p = s.player;
    p.x = Math.max(0, Math.min(W - p.w, p.x + (input.right - input.left) * 300 * dt));
    s.cooldown -= dt;
    if (input.fire && s.cooldown <= 0) {
      s.bullets.push({ x: p.x + p.w / 2 - 2, y: p.y - 8, w: 4, h: 12 });
      s.cooldown = 0.28;
    }
    s.bullets.forEach(b => (b.y -= 520 * dt));
    s.bullets = s.bullets.filter(b => b.y > -20);

    // Ennemis : défilent et descendent aux bords.
    let edge = false;
    s.enemies.forEach(e => (e.x += s.dir * cfg.speed * dt));
    s.enemies.forEach(e => { if (e.x < 6 || e.x + e.w > W - 6) edge = true; });
    if (edge) { s.dir *= -1; s.enemies.forEach(e => (e.y += 14)); }

    s.bombTimer -= dt;
    if (s.bombTimer <= 0 && s.enemies.length) {
      const e = s.enemies[Math.floor(Math.random() * s.enemies.length)];
      s.bombs.push({ x: e.x + e.w / 2 - 3, y: e.y + e.h, w: 6, h: 12 });
      s.bombTimer = cfg.fireRate * (0.5 + Math.random());
    }
    s.bombs.forEach(b => (b.y += (180 + s.level * 15) * dt));
    s.bombs = s.bombs.filter(b => b.y < H + 20);

    // Tirs vs ennemis
    for (const b of s.bullets) {
      const e = s.enemies.find(e => hit(b, e));
      if (e) {
        b.y = -100; e.hp = 0;
        s.combo++; s.score += points(e.row, s.combo);
        burst(s, e.x + e.w / 2, e.y + e.h / 2, '#ffd23f', 14);
        dropLoot(s, e, s.rnd);
        s.shake = 0.1;
      }
    }
    s.enemies = s.enemies.filter(e => e.hp > 0);

    // Loot : tombe, se ramasse au contact.
    s.loot.forEach(l => (l.y += 110 * dt));
    for (const l of s.loot) {
      if (!hit(l, p)) continue;
      l.y = H + 100;
      if (l.type === 'heart') heal(s); else { s.pac = PAC_TIME; s.pacEaten = 0; burst(s, p.x + 16, p.y, '#ffe600', 20); }
    }
    s.loot = s.loot.filter(l => l.y < H + 20);
    if (s.pac > 0) {
      s.pac -= dt;
      const mouth = { x: p.x - PAC_REACH, y: p.y - PAC_REACH * 2, w: p.w + PAC_REACH * 2, h: p.h + PAC_REACH * 2 };
      for (const b of s.bombs) {
        if (!hit(b, mouth)) continue;
        b.y = H + 100; burst(s, b.x, b.y > H ? p.y - 20 : b.y, '#ffe600', 6);
        if (++s.pacEaten % 3 === 0) heal(s);
      }
    }

    // Bombes vs joueur
    for (const b of s.bombs) {
      if (hit(b, p)) {
        b.y = H + 100; s.lives--; s.combo = 0; s.shake = 0.4;
        burst(s, p.x + p.w / 2, p.y, '#ff4d6d', 30);
        if (s.lives <= 0) s.over = true;
      }
    }
    if (s.enemies.some(e => e.y + e.h >= p.y)) { s.lives = 0; s.over = true; }

    if (!s.enemies.length) {
      s.level++; s.score += 100 * s.level; s.enemies = makeWave(s.level);
      s.bullets = []; s.bombs = []; s.loot = []; s.dir = 1; s.flash = 'NIVEAU ' + s.level; s.flashT = 1.5;
    }
    s.particles.forEach(q => { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; });
    s.particles = s.particles.filter(q => q.life > 0);
    s.shake = Math.max(0, s.shake - dt);
    if (s.flashT > 0) { s.flashT -= dt; if (s.flashT <= 0) s.flash = ''; }
    return s;
  }

  // Classement permanent : liste triée {name, score, level, date}, top 10.
  const MAX_SCORES = 10;

  function cleanName(name) {
    const n = String(name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
    return n || 'ANONYME';
  }

  function addScore(board, name, score, level, date) {
    const entry = { name: cleanName(name), score: Math.floor(score) || 0, level: level || 1, date: date || Date.now() };
    const list = (Array.isArray(board) ? board : []).concat(entry)
      .sort((a, b) => b.score - a.score || a.date - b.date).slice(0, MAX_SCORES);
    return { board: list, rank: list.indexOf(entry) + 1 };
  }

  function loadBoard(storage) {
    try {
      const b = JSON.parse(storage.getItem('astro-board'));
      return Array.isArray(b) ? b.filter(e => e && typeof e.score === 'number').slice(0, MAX_SCORES) : [];
    } catch (e) { return []; }
  }

  function saveBoard(storage, board) {
    try { storage.setItem('astro-board', JSON.stringify(board)); } catch (e) {}
  }

  // Défi entre amis : "#defi=NOM:SCORE" dans le lien partagé.
  function challengeHash(name, score) { return '#defi=' + encodeURIComponent(cleanName(name)) + ':' + Math.floor(score); }
  function parseChallenge(hash) {
    const m = /^#defi=([^:]+):(\d+)$/.exec(hash || '');
    return m ? { name: cleanName(decodeURIComponent(m[1])), score: +m[2] } : null;
  }

  // Célébrations : confettis + feux d'artifice (victoire de vague, nouveau record).
  const FX_COLORS = ['#ff4d6d', '#ff9f43', '#ffd23f', '#2ed573', '#00e5ff', '#a55eea', '#ffffff'];
  const pick = rnd => FX_COLORS[Math.floor(rnd() * FX_COLORS.length)];

  function newFx() { return { confetti: [], sparks: [], rockets: [], flash: 0, t: 0 }; }

  // Pluie de confettis depuis le haut de l'écran, plus quelques canons latéraux.
  function confettiRain(fx, n, w, rnd) {
    rnd = rnd || Math.random;
    for (let i = 0; i < n; i++) {
      const cannon = i % 4 === 0, left = rnd() < 0.5;
      fx.confetti.push({
        x: cannon ? (left ? 0 : w) : rnd() * w, y: cannon ? 500 + rnd() * 100 : -20 - rnd() * 200,
        vx: cannon ? (left ? 1 : -1) * (200 + rnd() * 400) : (rnd() - 0.5) * 120,
        vy: cannon ? -(500 + rnd() * 500) : 80 + rnd() * 200,
        rot: rnd() * 6.283, vr: (rnd() - 0.5) * 18, size: 6 + rnd() * 8, color: pick(rnd), life: 4 + rnd() * 2 });
    }
  }

  function fireworkBurst(fx, x, y, rnd) {
    rnd = rnd || Math.random;
    const color = pick(rnd), n = 32;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283, v = 120 + rnd() * 200;
      fx.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.2 + rnd() * 0.6, max: 1.8, color: rnd() < 0.3 ? '#fff' : color });
    }
    fx.flash = Math.min(1, fx.flash + 0.5);
  }

  function launchRocket(fx, w, h, rnd) {
    rnd = rnd || Math.random;
    fx.rockets.push({ x: 60 + rnd() * (w - 120), y: h, vy: -(500 + rnd() * 200), top: 100 + rnd() * 250 });
  }

  // intensity 1 = victoire de vague, 2 = nouveau record (le grand spectacle).
  function celebrate(fx, intensity, w, h, rnd) {
    confettiRain(fx, 70 * intensity, w, rnd);
    for (let i = 0; i < 2 + 4 * (intensity - 1) + 1; i++) launchRocket(fx, w, h, rnd);
    fx.flash = Math.min(1, fx.flash + 0.4 * intensity);
  }

  function stepFx(fx, dt, h, rnd) {
    fx.t += dt;
    fx.confetti.forEach(c => { c.vy += 260 * dt; c.vx *= 1 - 0.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.life -= dt; });
    fx.confetti = fx.confetti.filter(c => c.life > 0 && c.y < (h || 640) + 30);
    fx.rockets.forEach(r => (r.y += r.vy * dt));
    fx.rockets.filter(r => r.y <= r.top).forEach(r => fireworkBurst(fx, r.x, r.y, rnd));
    fx.rockets = fx.rockets.filter(r => r.y > r.top);
    fx.sparks.forEach(p => { p.vy += 120 * dt; p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 1.2 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    fx.sparks = fx.sparks.filter(p => p.life > 0).slice(-260);
    fx.flash = Math.max(0, fx.flash - dt * 1.5);
    return fx;
  }

  const api = { newFx, confettiRain, fireworkBurst, launchRocket, celebrate, stepFx, W, H, levelConfig, makeWave, hit, points, newState, step, dropLoot, MAX_LIVES, PAC_TIME,
    MAX_SCORES, cleanName, addScore, loadBoard, saveBoard, challengeHash, parseChallenge };
  if (typeof module !== 'undefined') module.exports = api; else root.Logic = api;
})(this);
