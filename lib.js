'use strict';
const fs = require('fs');
const path = require('path');

// Glob (* ? and literal rest) to RegExp; "*" does not cross "/".
function globToRegExp(glob) {
  const src = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp('^' + src + '$');
}

// Returns a predicate: does an entry (name, path relative to the root) match any pattern?
function excluder(patterns = []) {
  const res = patterns.map(globToRegExp);
  return (name, rel) => res.some((re) => re.test(name) || re.test(rel));
}

// Total size in bytes of a file or directory tree (symlinks are not followed).
// Entries matching opts.exclude (array of globs) are skipped.
function total(p, opts = {}, root = p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  const skip = opts.skip || excluder(opts.exclude);
  let sum = 0;
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    if (skip(name, path.relative(root, full).split(path.sep).join('/'))) continue;
    try { sum += total(full, { skip }, root); } catch { /* unreadable entry */ }
  }
  return sum;
}

// Entries of dir sorted by size, biggest first. With opts.depth > 1, directories
// get a `children` list (same shape) down to that many levels.
function sizes(dir, opts = {}) {
  const skip = opts.skip || excluder(opts.exclude);
  const root = opts.root || dir;
  const depth = opts.depth || 1;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => !skip(d.name, path.relative(root, path.join(dir, d.name)).split(path.sep).join('/')))
    .map((d) => {
      const full = path.join(dir, d.name);
      const e = { name: d.name, dir: d.isDirectory(), size: total(full, { skip }, root) };
      if (e.dir && depth > 1) {
        try { e.children = sizes(full, { skip, root, depth: depth - 1 }); } catch { e.children = []; }
      }
      return e;
    })
    .sort((a, b) => b.size - a.size);
}

function format(n) {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1) : String(n)) + units[i];
}

module.exports = { total, sizes, format, excluder };
