'use strict';
const fs = require('fs');
const path = require('path');

// Total size in bytes of a file or directory tree (symlinks are not followed).
function total(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const name of fs.readdirSync(p)) {
    try { sum += total(path.join(p, name)); } catch { /* unreadable entry */ }
  }
  return sum;
}

// Entries of dir sorted by size, biggest first.
function sizes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .map((d) => ({ name: d.name, dir: d.isDirectory(), size: total(path.join(dir, d.name)) }))
    .sort((a, b) => b.size - a.size);
}

function format(n) {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1) : String(n)) + units[i];
}

module.exports = { total, sizes, format };
