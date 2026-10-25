const assert = require('assert'), Pie = require('./pie.js');
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
assert.strictEqual(Pie.load(mem).step, 0);
for (let i = 0; i < Pie.STEPS.length + 3; i++) Pie.advance(mem);
assert.strictEqual(Pie.load(mem).step, Pie.STEPS.length);
for (let i = 0; i < 12; i++) Pie.eat(mem);
assert.strictEqual(Pie.load(mem).eaten, 8);
Pie.restart(mem); const d = Pie.load(mem); assert.deepStrictEqual([d.step, d.eaten, d.bakes], [0, 0, 1]);
Pie.eat(mem); assert.strictEqual(Pie.load(mem).eaten, 0); // pas de part avant la cuisson
assert.ok(Pie.svg(d).includes('<circle'));
console.log('pie ok');
