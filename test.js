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
assert(fx.confetti.length >= 240 && fx.rockets.length > 0 && fx.flash > 0);
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
