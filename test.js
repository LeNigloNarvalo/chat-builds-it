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
console.log('OK');
