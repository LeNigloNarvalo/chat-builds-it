const assert = require('assert');
const L = require('./logic.js');
const s = L.newState();
const none = { left: 0, right: 0, fire: false };
assert.strictEqual(s.level, 1); assert.strictEqual(s.lives, 3);
assert(L.levelConfig(5).speed > L.levelConfig(1).speed, 'difficulté croissante');
assert(L.points(0, 3) > L.points(0, 1), 'combo');
// un tir sur un ennemi donne du score
const e = s.enemies[0];
s.bullets.push({ x: e.x + 5, y: e.y + 5, w: 4, h: 12 });
L.step(s, 0.001, none);
assert(s.score > 0 && s.enemies.length < L.makeWave(1).length);
// vider la vague passe au niveau suivant
s.enemies = [{ x: 100, y: 100, w: 28, h: 22, row: 0, hp: 1 }];
s.bullets = [{ x: 105, y: 105, w: 4, h: 12 }];
L.step(s, 0.001, none);
assert.strictEqual(s.level, 2);
// perdre toutes les vies = game over
s.lives = 1; s.bombs = [{ x: s.player.x, y: s.player.y, w: 6, h: 12 }];
L.step(s, 0.001, none);
assert(s.over);
// classement : tri, top 10, pseudo nettoyé, persistance, défi
let r = { board: [] };
for (let i = 1; i <= 12; i++) r = L.addScore(r.board, 'J' + i, i * 10, 1, i);
assert.strictEqual(r.board.length, 10); assert.strictEqual(r.board[0].score, 120);
r = L.addScore(r.board, '<b>Zoé!</b>', 75, 2, 99);
assert.strictEqual(r.board[r.rank - 1].name, 'bZoéb'); assert.strictEqual(r.rank, 6);
assert.strictEqual(L.cleanName('   '), 'ANONYME');
const mem = {}; const st = { getItem: k => mem[k] || null, setItem: (k, v) => (mem[k] = v) };
L.saveBoard(st, r.board); assert.deepStrictEqual(L.loadBoard(st), r.board);
assert.deepStrictEqual(L.loadBoard({ getItem: () => 'pas du json' }), []);
assert.deepStrictEqual(L.parseChallenge(L.challengeHash('Léa', 420)), { name: 'Léa', score: 420 });
assert.strictEqual(L.parseChallenge('#x'), null);
// célébrations : confettis + feux d'artifice
const fx = L.newFx(); let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
L.celebrate(fx, 2, 480, 640, rnd);
assert(fx.confetti.length >= 140 && fx.rockets.length > 0 && fx.flash > 0);
for (let i = 0; i < 120; i++) L.stepFx(fx, 0.02, 640, rnd);
assert(fx.sparks.length > 0, 'les fusées explosent en étincelles');
for (let i = 0; i < 600; i++) L.stepFx(fx, 0.02, 640, rnd);
assert(fx.confetti.length === 0 && fx.sparks.length === 0, 'tout disparaît à la fin');
// mode boss : Konami, votes du chat, attaques, victoire
const B = require('./boss.js');
const kt = B.konamiTracker(); let fired = 0;
['ArrowUp','ArrowUp','ArrowDown','ArrowUp','ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'].forEach(c => { if (kt(c)) fired++; });
assert.strictEqual(fired, 1, 'Konami détecté une fois');
assert.strictEqual(B.parseVote('!Spirale'), 'spirale'); assert.strictEqual(B.parseVote('3'), 'spirale'); assert.strictEqual(B.parseVote('bonjour'), null);
const bs = L.newState(), boss = B.newBoss(); bs.enemies = [];
assert(B.castVote(boss, 'laser', 'a') && B.castVote(boss, 'chaos', 'b') && B.castVote(boss, 'chaos', 'a'));
assert.deepStrictEqual([boss.votes.laser, boss.votes.chaos], [0, 2], 'un vote par spectateur');
let seen = {}; for (let i = 0; i < 100; i++) { B.step(boss, bs, 0.1, none, rnd); boss.events.forEach(e => (seen[e] = 1)); bs.lives = 3; }
assert(seen.attack && seen['vote-start'], 'le boss alterne vote et attaque');
assert(!B.castVote(B.newBoss(), 'inconnu', 'x'), 'attaque inconnue refusée');
const b2 = B.newBoss(); b2.hp = 1; bs.bullets = []; b2.bullets.push({ x: b2.x + 10, y: b2.y + 10, w: 4, h: 12 });
B.step(b2, bs, 0.001, none, rnd); assert(b2.defeated && bs.score >= 5000, 'boss vaincu');
const b3 = B.newBoss(); b3.phase = 'attack'; b3.attack = 'pluie'; b3.timer = 9;
b3.shots.push({ type: 'meteor', x: bs.player.x, y: bs.player.y, w: 24, h: 24, vx: 0, vy: 0 });
const lv = bs.lives; B.step(b3, bs, 0.001, none, rnd); assert.strictEqual(bs.lives, lv - 1, 'un météore touche le joueur');
console.log('OK');
// IA du mode démo : esquive, vise, relance
const A = require('./ai.js');
const as = L.newState(); as.enemies = [{ x: 300, y: 100, w: 28, h: 22, row: 0, hp: 1 }]; as.player.x = 100;
assert(A.decide(as).right === 1 && A.decide(as).left === 0, "l'IA se place sous l'ennemi");
as.player.x = 300 + 14 - 16; assert(A.decide(as).fire, "l'IA tire quand elle est alignée");
as.bombs = [{ x: as.player.x + 13, y: as.player.y - 60, w: 6, h: 12 }];
const mv = A.decide(as); assert(mv.left + mv.right === 1, "l'IA esquive une bombe");
as.over = true; assert(!A.decide(as).fire, "rien à faire si la partie est finie");
assert(A.shouldRestart(true, true, 2) && !A.shouldRestart(true, true, 0.1) && !A.shouldRestart(true, false, 9), "relance après game over");
// simulation : l'IA survit bien plus longtemps qu'un joueur immobile
function play(ai) { const g = L.newState(); for (let i = 0; i < 60 * 40 && !g.over; i++) L.step(g, 1 / 60, ai ? A.decide(g) : none); return g; }
const bot = play(true), idle = play(false);
assert(bot.score > idle.score * 3 && bot.level >= 3, 'IA efficace: score ' + bot.score + ' niv ' + bot.level);
// contre le boss
const gb = L.newState(), bb = B.newBoss(); gb.enemies = [];
for (let i = 0; i < 60 * 60 && !gb.over && !bb.defeated; i++) B.step(bb, gb, 1 / 60, A.decide(gb, bb), rnd);
assert(bb.hp < bb.max, "l'IA blesse le boss");
console.log('OK IA');
// --- Versus 2 joueurs ---
const V = require('./versus.js');
{
  const m = V.newMatch(L);
  assert(m.p[0] !== m.p[1] && m.p.length === 2, 'deux états indépendants');
  V.stepMatch(L, m, 0.5, { left: 0, right: 1, fire: true }, { left: 1, right: 0, fire: false });
  assert(m.p[0].player.x > m.p[1].player.x, 'chaque joueur a ses propres commandes');
  assert(V.winner(m) === -1 && !V.vote(m, 0), 'pas de gagnant ni de vote avant la fin');
  m.p[0].score = 100; m.p[1].score = 50; V.stepMatch(L, m, V.DURATION, none, none);
  assert(m.over && V.winner(m) === 0, 'le meilleur score gagne');
  assert(V.vote(m, 1) && m.votes[1] === 1, 'le chat peut voter à la fin');
  const m2 = V.newMatch(L); m2.p[0].over = m2.p[1].over = true; V.stepMatch(L, m2, 0.01, none, none);
  assert(m2.over && V.winner(m2) === -1, 'fin si les deux sont éliminés, égalité');
  console.log('OK versus');
}
// tempête de météorites : spawn, traînée, explosion en étincelles
const M = require('./meteors.js'); const ms = M.newStorm(); M.start(ms, 1);
let sawSparks = false; for (let i = 0; i < 120; i++) { M.step(ms, 0.016, 800, 600); if (ms.sparks.length) sawSparks = true; }
assert(sawSparks, 'les météorites explosent en étincelles');
assert(ms.meteors.length === 0 || ms.meteors[0].trail.length > 0, 'traînée');
// Replay du Chat : enregistrement, exploits, ralenti/zoom, sérialisation
{
  const R = require('./replay.js');
  const st = L.newState(), rec = R.newRecorder();
  for (let i = 0; i < 90; i++) {
    st.score += i === 40 ? 200 : 0; st.combo = i > 50 ? 5 : 0; if (i === 60) st.combo = 6;
    R.capture(rec, st, null, 1 / 30);
  }
  assert(rec.frames.length >= 85, 'images enregistrées à 30 Hz');
  const marks = R.markers(rec.frames);
  assert(marks.some(m => /COMBO/.test(m.kind)) && marks.some(m => m.kind === '+200'), 'exploits repérés');
  const m = marks[0], f = R.focusAt(marks, m.i);
  assert(f.speed < 1 && f.zoom > 1, 'ralenti + zoom sur un exploit');
  assert.strictEqual(R.focusAt(marks, 0, 1 / 30).zoom >= 1, true);
  const far = R.focusAt([{ i: 0, kind: 'x' }], 500);
  assert(far.speed === 1 && far.zoom === 1, 'vitesse normale hors exploit');
  const back = R.unpack(R.pack(rec.frames, 3));
  assert.strictEqual(back.frames.length, Math.ceil(rec.frames.length / 3));
  assert.strictEqual(back.frames[0].e.length, rec.frames[0].e.length);
  assert.throws(() => R.unpack('{"v":1,"f":[[1]]}'), /invalide/);
  const [a, b] = R.bestWindow(rec.frames, 1); assert(b - a === 30 && rec.frames[b - 1].sc - rec.frames[a].sc === 200);
}
console.log('replay OK');

// loot : cœur = +1 vie (plafonné), PAC = mange les bombes et rend des vies
{
  const q = L.newState(); q.lives = 2;
  assert(L.dropLoot(q, q.enemies[0], () => 0) && q.loot[0].type === 'heart');
  assert.strictEqual(L.dropLoot(q, q.enemies[0], () => 0.99), null);
  q.loot = [{ type: 'heart', x: q.player.x, y: q.player.y, w: 20, h: 20 }];
  L.step(q, 0.001, none); assert.strictEqual(q.lives, 3);
  q.lives = L.MAX_LIVES; q.loot = [{ type: 'heart', x: q.player.x, y: q.player.y, w: 20, h: 20 }];
  L.step(q, 0.001, none); assert.strictEqual(q.lives, L.MAX_LIVES);
  q.lives = 2; q.loot = [{ type: 'pac', x: q.player.x, y: q.player.y, w: 20, h: 20 }];
  L.step(q, 0.001, none); assert(q.pac > 0);
  q.bombs = [0, 1, 2].map(i => ({ x: q.player.x + 10, y: q.player.y - 10 - i * 3, w: 6, h: 12 }));
  L.step(q, 0.001, none);
  assert.strictEqual(q.lives, 3, '3 bombes mangées = +1 vie'); assert(q.pacEaten === 3);
}
// mode disco : chaque beat rapporte des points, bonus si tir sur le beat
const D = require('./disco.js');
{ const d = D.newDisco(), st = L.newState(); d.on = true;
  assert.strictEqual(D.step(d, st, D.BEAT * 2.1, false), 2); assert.strictEqual(st.score, 20);
  D.step(d, st, 0.01, true); D.step(d, st, D.BEAT, true); assert(st.score >= 20 + 25, 'bonus sur le beat');
  const off = D.newDisco(); assert.strictEqual(D.step(off, st, 5, false), 0); }
console.log('disco ok');
