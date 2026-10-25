// Sauvegardes de la base SQLite : copies cohérentes (VACUUM INTO) dans data/backups/, une par jour automatiquement,
// rotation des plus anciennes, téléchargement et restauration. Les sessions en cours sont conservées à la restauration.
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DAY = 86400000, NAME = /^cornichon-\d{8}-\d{6}-\d{3}-(auto|manual|pre)\.db$/, MIN_KEEP = 1, MAX_KEEP = 90;
const pad = (n, l = 2) => String(n).padStart(l, '0');
const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`;
const parse = f => { const m = /^cornichon-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{3})-(\w+)\.db$/.exec(f); return m ? { at: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]), kind: m[8] } : null; };

function Backups(db, dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const cfgFile = path.join(dir, 'config.json');
  const clampKeep = n => Math.min(MAX_KEEP, Math.max(MIN_KEEP, Math.floor(+n) || 7));
  let keep = clampKeep(opts.keep || 7);
  try { keep = clampKeep(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).keep); } catch (e) {}
  const every = Math.max(1, +opts.everyMs || DAY);
  let last = 0; // garantit des noms de fichiers uniques même dans la même milliseconde

  const list = () => fs.readdirSync(dir).filter(f => NAME.test(f)).map(f => {
    const st = fs.statSync(path.join(dir, f)), p = parse(f);
    return { id: f, kind: p.kind, at: p.at, size: st.size };
  }).sort((a, b) => b.at - a.at);
  const file = id => { if (!NAME.test(String(id))) throw new Error('Sauvegarde inconnue'); const f = path.join(dir, id); if (!fs.existsSync(f)) throw new Error('Sauvegarde inconnue'); return f; };

  // rotation : seules les sauvegardes automatiques excédentaires sont supprimées (les manuelles et « avant restauration » sont gardées jusqu'à suppression explicite)
  function rotate() {
    const auto = list().filter(b => b.kind === 'auto'); let n = 0;
    for (const b of auto.slice(keep)) { fs.unlinkSync(path.join(dir, b.id)); n++; }
    return n;
  }
  function create(kind) {
    const at = Math.max(Date.now(), last + 1); last = at;
    const id = `cornichon-${stamp(new Date(at))}-${kind}.db`, f = path.join(dir, id);
    db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    fs.chmodSync(f, 0o600);
    if (kind === 'auto') rotate();
    return list().find(b => b.id === id);
  }
  // sauvegarde planifiée (24 h par défaut, BACKUP_EVERY_HOURS) : crée une sauvegarde si aucune sauvegarde automatique n'est plus récente que l'intervalle
  function daily() {
    const a = list().find(b => b.kind === 'auto');
    if (a && Date.now() - a.at < every) return null;
    return create('auto');
  }
  function check(f) { // un fichier abîmé ne doit jamais remplacer la base vivante
    const t = new DatabaseSync(f, { readOnly: true });
    try { const r = t.prepare('PRAGMA integrity_check').get(); if (!r || r.integrity_check !== 'ok') throw new Error('Sauvegarde corrompue : restauration refusée'); t.prepare('SELECT 1 FROM kv LIMIT 1').get(); }
    catch (e) { throw e.message.startsWith('Sauvegarde') ? e : new Error('Fichier de sauvegarde invalide : restauration refusée'); }
    finally { t.close(); }
  }
  // restauration : filet de sécurité (sauvegarde « pre ») puis remplacement atomique du contenu, sessions exceptées
  function restore(id) {
    const f = file(id); check(f);
    const safety = create('pre');
    db.exec(`ATTACH DATABASE '${f.replace(/'/g, "''")}' AS bk`);
    try {
      // l'index de recherche (fts_*, tags) n'est jamais copié : store.reload() le reconstruit depuis les posts restaurés
      const tables = db.prepare("SELECT name FROM bk.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'sessions' AND name <> 'tags' AND name NOT LIKE 'fts\\_%' ESCAPE '\\'").all().map(r => r.name);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const t of tables) {
          const cols = db.prepare(`PRAGMA main.table_info("${t}")`).all().map(c => c.name), bc = new Set(db.prepare(`PRAGMA bk.table_info("${t}")`).all().map(c => c.name));
          const shared = cols.filter(c => bc.has(c)).map(c => `"${c}"`).join(',');
          if (!cols.length || !shared) continue;
          db.exec(`DELETE FROM main."${t}"; INSERT INTO main."${t}" (${shared}) SELECT ${shared} FROM bk."${t}"`);
        }
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch (x) {} throw e; }
    } finally { db.exec('DETACH DATABASE bk'); }
    return { restored: id, safety: safety.id };
  }
  function remove(id) { fs.unlinkSync(file(id)); }
  function setKeep(n) {
    keep = clampKeep(n); fs.writeFileSync(cfgFile, JSON.stringify({ keep }), { mode: 0o600 });
    return rotate();
  }
  return { list, create, daily, rotate, restore, remove, file, setKeep, keep: () => keep, every: () => every, MIN_KEEP, MAX_KEEP };
}

module.exports = { Backups, NAME };
