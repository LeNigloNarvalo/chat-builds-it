const assert = require('assert');
const S = require('./snake.js');
let s = S.newState(() => 0.5); S.placeFood(s);
s.food = { x: 11, y: 10 }; S.step(s);
assert.strictEqual(s.score, 1); assert.strictEqual(s.snake.length, 4);
S.turn(s, { x: -1, y: 0 }); assert.strictEqual(s.dir.x, 1, 'demi-tour interdit');
s = S.newState(); s.snake = [{ x: 19, y: 5 }, { x: 18, y: 5 }]; S.step(s);
assert(s.dead, 'mur');
// l'IA doit manger au moins 20 pommes sans mourir
s = S.newState(() => Math.random()); S.placeFood(s);
for (let i = 0; i < 5000 && !s.dead && s.score < 20; i++) { S.turn(s, S.autoDir(s)); S.step(s); }
assert(s.score >= 20, 'IA score ' + s.score);
console.log('ok');
// sauvegarde des records
const Sc = require('./scores.js');
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
Sc.record(mem, 5, 'a'); Sc.record(mem, 12, 'b'); Sc.record(mem, 7, 'c');
const re = Sc.load(mem); // « redémarrage » : relecture du stockage
assert.strictEqual(re.best, 12); assert.deepStrictEqual(re.top.map(r => r.score), [12, 7, 5]);
for (let i = 0; i < 10; i++) Sc.record(mem, i + 1);
assert.strictEqual(Sc.load(mem).top.length, Sc.MAX);
assert.strictEqual(Sc.load({ getItem: () => 'junk' }).best, 0);
console.log('ok scores');
