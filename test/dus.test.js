'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sizes, format } = require('../lib');

test('format', () => {
  assert.strictEqual(format(512), '512B');
  assert.strictEqual(format(1536), '1.5K');
});

test('sizes sorts biggest first and recurses', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dus-'));
  fs.writeFileSync(path.join(d, 'small'), 'a');
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'sub', 'big'), 'x'.repeat(100));
  const r = sizes(d);
  assert.deepStrictEqual(r.map((e) => e.name), ['sub', 'small']);
  assert.strictEqual(r[0].size, 100);
  fs.rmSync(d, { recursive: true });
});

test('site vitrine mentionne la commande et les options', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.match(html, /<title>dus/);
  for (const s of ['bin/dus.js', '--json', 'npm test']) assert.ok(html.includes(s), s);
});

test('exclude ignore les motifs (nom, chemin relatif, taille du parent)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dus-'));
  fs.mkdirSync(path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'node_modules', 'x'), 'x'.repeat(500));
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'a.js'), 'a'.repeat(10));
  fs.writeFileSync(path.join(d, 'src', 'a.log'), 'l'.repeat(50));
  const names = (o) => sizes(d, o).map((e) => e.name);
  assert.deepStrictEqual(names({ exclude: ['node_modules'] }), ['src']);
  assert.strictEqual(sizes(d, { exclude: ['*.log', 'node_modules'] })[0].size, 10);
  assert.strictEqual(sizes(d, { exclude: ['src/*.log', 'node_modules'] })[0].size, 10);
  assert.strictEqual(sizes(d).length, 2);
  fs.rmSync(d, { recursive: true });
});

test('depth ajoute des enfants sur N niveaux', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dus-'));
  fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(d, 'a', 'b', 'f'), 'x'.repeat(20));
  fs.writeFileSync(path.join(d, 'a', 'g'), 'y');
  assert.strictEqual(sizes(d)[0].children, undefined);
  const two = sizes(d, { depth: 2 })[0];
  assert.deepStrictEqual(two.children.map((e) => e.name), ['b', 'g']);
  assert.strictEqual(two.children[0].children, undefined);
  assert.deepStrictEqual(sizes(d, { depth: 3 })[0].children[0].children.map((e) => e.name), ['f']);
  fs.rmSync(d, { recursive: true });
});

test('sort par taille, nom ou type, croissant ou décroissant', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dus-'));
  fs.writeFileSync(path.join(d, 'b'), 'x'.repeat(5));
  fs.writeFileSync(path.join(d, 'a'), 'x'.repeat(50));
  fs.mkdirSync(path.join(d, 'z'));
  fs.writeFileSync(path.join(d, 'z', 'f'), 'x'.repeat(10));
  const names = (sort) => sizes(d, { sort }).map((e) => e.name);
  assert.deepStrictEqual(names(), ['a', 'z', 'b']);
  assert.deepStrictEqual(names('size:asc'), ['b', 'z', 'a']);
  assert.deepStrictEqual(names('name'), ['a', 'b', 'z']);
  assert.deepStrictEqual(names('name:desc'), ['z', 'b', 'a']);
  assert.deepStrictEqual(names('type'), ['z', 'a', 'b']);
  assert.deepStrictEqual(names('type:desc'), ['a', 'b', 'z']);
  assert.throws(() => sizes(d, { sort: 'foo' }));
  fs.rmSync(d, { recursive: true });
});
