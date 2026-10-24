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
