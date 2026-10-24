#!/usr/bin/env node
'use strict';
const { sizes, total, format, parseSort, parseSize, bestiole } = require('../lib');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: dus [dir] [-n <count>] [--json] [--profondeur <N>] [--exclude <glob>]... [--tri size|name|type[:asc|:desc]] [--exclure-vide] [--min-taille <size>] [--bestiole]\nList the biggest entries of a directory (default: .).');
  process.exit(0);
}
let depth = 1, top = 10, json = false, pet = false, excludeEmpty = false, minSize = 0, exclude = [], sort = 'size', dir = '.';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-n') top = parseInt(args[++i], 10) || top;
  else if (args[i] === '--exclude') { if (args[i + 1] === undefined) { console.error('dus: --exclude needs a pattern'); process.exit(1); } exclude.push(args[++i]); }
  else if (args[i] === '--profondeur') {
    depth = parseInt(args[++i], 10);
    if (!(depth >= 1)) { console.error('dus: --profondeur needs an integer >= 1'); process.exit(1); }
  }
  else if (args[i] === '--tri') {
    sort = args[++i];
    try { parseSort(sort); } catch (err) { console.error('dus: --tri: ' + err.message); process.exit(1); }
  }
  else if (args[i] === '--min-taille') {
    try { minSize = parseSize(args[++i]); } catch (err) { console.error('dus: --min-taille: ' + err.message); process.exit(1); }
  }
  else if (args[i] === '--exclure-vide') excludeEmpty = true;
  else if (args[i] === '--bestiole') pet = true;
  else if (args[i] === '--json') json = true;
  else dir = args[i];
}
const STATE = '.dus-bestiole';
if (pet) exclude.push(STATE);
try {
  const list = sizes(dir, { exclude, depth, sort, excludeEmpty, minSize }).slice(0, top);
  if (json) console.log(JSON.stringify(list, null, 2));
  else {
    const show = (entries, indent) => {
      for (const e of entries) {
        console.log(format(e.size).padStart(9) + '  ' + indent + e.name + (e.dir ? '/' : ''));
        if (e.children) show(e.children.slice(0, top), indent + '  ');
      }
    };
    show(list, '');
  }
  if (pet) {
    const file = path.join(dir, STATE);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')).size; } catch { /* first meeting */ }
    const b = bestiole(total(dir, { exclude }), prev);
    fs.writeFileSync(file, JSON.stringify({ size: b.size }));
    (json ? console.error : console.log)('\n' + b.face + ' (' + b.stage + ') ' + b.msg);
  }
} catch (err) {
  console.error('dus: ' + err.message);
  process.exit(1);
}
