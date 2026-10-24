// Mode Boss Secret (sans DOM) : Konami Code, boss géant, attaques votées par le chat.
(function (root) {
  const W = 480, H = 640;
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

  // Les attaques que le chat peut voter (touches 1-4 / boutons / messages !laser etc.).
  const ATTACKS = [
    { key: 'laser', label: 'LASER', emoji: '⚡', cmd: '!laser' },
    { key: 'pluie', label: 'PLUIE DE METEORES', emoji: '☄', cmd: '!pluie' },
    { key: 'spirale', label: 'SPIRALE', emoji: '🌀', cmd: '!spirale' },
    { key: 'chaos', label: 'CHAOS TOTAL', emoji: '💥', cmd: '!chaos' },
  ];
  const VOTE_TIME = 5, ATTACK_TIME = 3.5;

  // Suit les touches : renvoie true quand la séquence complète vient d'être tapée.
  function konamiTracker() {
    let buf = [];
    return code => {
      buf.push(code); if (buf.length > KONAMI.length) buf.shift();
      if (buf.join() !== KONAMI.join()) return false;
      buf = []; return true;
    };
  }

  function newBoss() {
    return {
      hp: 120, max: 120, x: W / 2 - 110, y: 60, w: 220, h: 100, t: 0, dir: 1, hurt: 0,
      phase: 'vote', timer: VOTE_TIME, votes: { laser: 0, pluie: 0, spirale: 0, chaos: 0 }, voters: {},
      attack: null, shots: [], spawnT: 0, round: 0, defeated: false, bullets: [], events: [],
    };
  }

  // Un spectateur = un vote (il peut changer d'avis). Renvoie false si vote invalide.
  function castVote(b, attack, voter) {
    if (b.phase !== 'vote' || !(attack in b.votes)) return false;
    const who = voter || 'anon';
    if (b.voters[who]) b.votes[b.voters[who]]--;
    b.voters[who] = attack; b.votes[attack]++;
    return true;
  }

  // "!laser", "spirale"… -> clé d'attaque ou null.
  function parseVote(msg) {
    const m = String(msg || '').trim().toLowerCase().replace(/^!/, '');
    const a = ATTACKS.find((a, i) => a.key === m || String(i + 1) === m);
    return a ? a.key : null;
  }

  function winner(votes, rnd) {
    rnd = rnd || Math.random;
    const max = Math.max(...Object.values(votes));
    const tied = Object.keys(votes).filter(k => votes[k] === max);
    return max === 0 ? 'chaos' : tied[Math.floor(rnd() * tied.length)];
  }

  function spawn(b, kind, rnd, ev) {
    const cx = b.x + b.w / 2, cy = b.y + b.h;
    if (kind === 'laser') { // faisceau vertical qui balaie, annoncé par un avertissement
      b.shots.push({ type: 'beam', x: ev.px - 18, y: cy, w: 36, h: H, warn: 0.9, life: 0.7 });
    } else if (kind === 'pluie') {
      b.shots.push({ type: 'meteor', x: rnd() * (W - 24), y: -20, w: 24, h: 24, vx: (rnd() - .5) * 60, vy: 220 + rnd() * 160 });
    } else if (kind === 'spirale') {
      const a = b.t * 7;
      for (let k = 0; k < 3; k++) {
        const an = a + k * 2.094;
        b.shots.push({ type: 'orb', x: cx - 6, y: cy - 20, w: 12, h: 12, vx: Math.cos(an) * 150, vy: Math.sin(an) * 150 + 90 });
      }
    }
  }

  const overlap = (a, c) => a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;

  // Fait avancer le boss ET le vaisseau du joueur s (même forme que Logic.newState()).
  // Les événements ('vote-end','laser','hit','boss-hit','win'…) sont dans b.events pour les sons/FX.
  function step(b, s, dt, input, rnd) {
    rnd = rnd || Math.random; b.events = [];
    if (b.defeated || s.over) return b;
    b.t += dt; b.hurt = Math.max(0, b.hurt - dt);
    const p = s.player;
    p.x = Math.max(0, Math.min(W - p.w, p.x + (input.right - input.left) * 300 * dt));
    s.cooldown -= dt;
    if (input.fire && s.cooldown <= 0) { b.bullets.push({ x: p.x + p.w / 2 - 2, y: p.y - 8, w: 4, h: 12 }); s.cooldown = 0.2; b.events.push('shoot'); }
    b.bullets.forEach(u => (u.y -= 560 * dt));
    b.bullets = b.bullets.filter(u => u.y > -20);

    const speed = b.attack === 'chaos' ? 160 : 70;
    b.x += b.dir * speed * dt;
    if (b.x < 10 || b.x + b.w > W - 10) { b.dir *= -1; b.x = Math.max(10, Math.min(W - 10 - b.w, b.x)); }

    b.timer -= dt;
    if (b.phase === 'vote') {
      if (b.timer <= 0) {
        b.attack = winner(b.votes, rnd); b.phase = 'attack'; b.timer = ATTACK_TIME; b.spawnT = 0; b.round++;
        b.events.push('attack');
      }
    } else {
      b.spawnT -= dt;
      if (b.spawnT <= 0) {
        const kinds = b.attack === 'chaos' ? ['laser', 'pluie', 'spirale', 'pluie', 'spirale'] : [b.attack];
        const rate = { laser: 1.1, pluie: 0.12, spirale: 0.22, chaos: 0.09 }[b.attack];
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        spawn(b, kind, rnd, { px: p.x + p.w / 2 });
        if (kind === 'laser') b.events.push('laser');
        b.spawnT = rate;
      }
      if (b.timer <= 0) {
        b.phase = 'vote'; b.timer = VOTE_TIME; b.attack = null;
        b.votes = { laser: 0, pluie: 0, spirale: 0, chaos: 0 }; b.voters = {};
        b.events.push('vote-start');
      }
    }

    b.shots.forEach(o => {
      if (o.type === 'beam') { if (o.warn > 0) o.warn -= dt; else o.life -= dt; }
      else { o.x += o.vx * dt; o.y += o.vy * dt; }
    });
    b.shots = b.shots.filter(o => (o.type === 'beam' ? o.life > 0 : o.y < H + 30 && o.x > -40 && o.x < W + 40));
    for (const o of b.shots) {
      if (o.hit || (o.type === 'beam' && o.warn > 0)) continue;
      if (overlap(o, p)) {
        if (o.type !== 'beam') o.y = H + 100; else o.hit = true;
        s.lives--; s.combo = 0; s.shake = 0.4; b.events.push('hit');
        if (s.lives <= 0) s.over = true;
      }
    }

    for (const u of b.bullets) {
      if (overlap(u, b)) {
        u.y = -100; b.hp = Math.max(0, b.hp - 1); b.hurt = 0.12; s.score += 25; s.shake = 0.08; b.events.push('boss-hit');
      }
    }
    if (b.hp <= 0) { b.defeated = true; s.score += 5000; b.shots = []; b.events.push('win'); }
    s.shake = Math.max(0, s.shake - dt);
    return b;
  }

  const api = { KONAMI, ATTACKS, VOTE_TIME, ATTACK_TIME, konamiTracker, newBoss, castVote, parseVote, winner, step };
  if (typeof module !== 'undefined') module.exports = api; else root.Boss = api;
})(typeof window !== 'undefined' ? window : globalThis);
