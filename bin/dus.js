#!/usr/bin/env node
'use strict';
const { sizes, format } = require('../lib');

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: dus [dir] [-n <count>] [--json] [--exclude <glob>]...\nList the biggest entries of a directory (default: .).');
  process.exit(0);
}
let top = 10, json = false, exclude = [], dir = '.';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-n') top = parseInt(args[++i], 10) || top;
  else if (args[i] === '--exclude') { if (args[i + 1] === undefined) { console.error('dus: --exclude needs a pattern'); process.exit(1); } exclude.push(args[++i]); }
  else if (args[i] === '--json') json = true;
  else dir = args[i];
}
try {
  const list = sizes(dir, { exclude }).slice(0, top);
  if (json) console.log(JSON.stringify(list, null, 2));
  else for (const e of list) console.log(format(e.size).padStart(9) + '  ' + e.name + (e.dir ? '/' : ''));
} catch (err) {
  console.error('dus: ' + err.message);
  process.exit(1);
}
