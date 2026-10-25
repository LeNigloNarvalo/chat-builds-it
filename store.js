// Stockage SQLite indexé de Agora : remplace le gros blob JSON de la table kv par des tables (users, posts, meta).
// Le moteur social.js continue de parler à un « storage » (getItem/setItem) : cet adaptateur découpe l'état en lignes,
// n'écrit que les lignes modifiées, le tout dans UNE transaction, et migre automatiquement l'ancien blob au premier démarrage.
const Store = (db, key, onWrite) => {
  db.exec(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, email TEXT, v TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, author TEXT NOT NULL, reply_to INTEGER, grp INTEGER, at INTEGER NOT NULL, body TEXT NOT NULL, v TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS posts_author ON posts (author COLLATE NOCASE, id);
    CREATE INDEX IF NOT EXISTS posts_feed ON posts (grp, reply_to, id);
    CREATE INDEX IF NOT EXISTS posts_reply ON posts (reply_to) WHERE reply_to IS NOT NULL;
    CREATE INDEX IF NOT EXISTS posts_at ON posts (at);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS store_state (k TEXT PRIMARY KEY, version INTEGER NOT NULL);`);
  const q = s => db.prepare(s);
  // ---- recherche plein texte FTS5 : posts publics (rowid = id du post), membres (rowid = rowid de users), hashtags (rowid = rowid de tags) ----
  // le tokenizer ignore la casse et les accents ; fts_vocab liste les mots indexés (suggestions pendant la frappe)
  const ensureFts = () => db.exec(`CREATE TABLE IF NOT EXISTS tags (tag TEXT PRIMARY KEY, n INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_posts USING fts5(body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_users USING fts5(name, display, bio, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_tags USING fts5(tag, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_vocab USING fts5vocab(fts_posts, 'row');`);
  ensureFts();
  const indexable = p => !p.group && !p.hidden;
  const tagsOf = text => new Set(String(text || '').toLowerCase().match(/#\w{1,60}/g) || []);
  const ftsWords = text => (String(text || '').match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 8);
  // chaque mot est un préfixe (« corn » trouve « cornichon ») ; tous doivent apparaître
  const ftsQuery = text => { const w = ftsWords(text); return w.length ? w.map(x => '"' + x + '"*').join(' ') : null; };
  let depth = 0;
  const tx = fn => { if (depth) return fn(); depth++; db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (e2) { /* déjà annulée */ } throw e; } finally { depth--; } };
  const getVer = q('SELECT version FROM store_state WHERE k = ?'), setVer = q(`INSERT INTO store_state (k, version) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET version = excluded.version`);
  const lc = s => String(s || '').toLowerCase();
  let cache = null; // dernier état sérialisé (invalidé à chaque écriture)
  let rows = null;  // empreintes des lignes déjà en base : { users: Map, posts: Map, meta: Map }

  const readAll = () => {
    const state = { users: {}, posts: [], meta: {} };
    for (const r of q('SELECT name, v FROM users').all()) state.users[r.name] = JSON.parse(r.v);
    for (const r of q('SELECT v FROM posts ORDER BY id').all()) state.posts.push(JSON.parse(r.v));
    for (const r of q('SELECT k, v FROM meta').all()) state.meta[r.k] = JSON.parse(r.v);
    return Object.assign({}, state.meta, { users: state.users, posts: state.posts });
  };
  const snapshot = () => {
    rows = { users: new Map(), posts: new Map(), meta: new Map() };
    for (const r of q('SELECT name, v FROM users').all()) rows.users.set(r.name, r.v);
    for (const r of q('SELECT id, v FROM posts').all()) rows.posts.set(r.id, r.v);
    for (const r of q('SELECT k, v FROM meta').all()) rows.meta.set(r.k, r.v);
    rows.tags = new Map(q('SELECT tag, n FROM tags').all().map(r => [r.tag, r.n]));
  };
  const write = obj => {
    if (!rows) snapshot();
    const { users = {}, posts = [], ...rest } = obj;
    const upU = q(`INSERT INTO users (name, email, v) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET email = excluded.email, v = excluded.v`), delU = q('DELETE FROM users WHERE name = ?');
    const upP = q(`INSERT INTO posts (id, author, reply_to, grp, at, body, v) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET author = excluded.author, reply_to = excluded.reply_to, grp = excluded.grp, at = excluded.at, body = excluded.body, v = excluded.v`), delP = q('DELETE FROM posts WHERE id = ?');
    const upM = q(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`), delM = q('DELETE FROM meta WHERE k = ?');
    const next = { users: new Map(), posts: new Map(), meta: new Map() };
    const dFp = q('DELETE FROM fts_posts WHERE rowid = ?'), iFp = q('INSERT INTO fts_posts (rowid, body) VALUES (?, ?)'), rowU = q('SELECT rowid FROM users WHERE name = ?');
    const dFu = q('DELETE FROM fts_users WHERE rowid = ?'), iFu = q('INSERT INTO fts_users (rowid, name, display, bio) VALUES (?, ?, ?, ?)');
    let postsChanged = false;
    tx(() => {
      for (const [n, u] of Object.entries(users)) { const s = JSON.stringify(u); next.users.set(n, s); if (rows.users.get(n) !== s) { upU.run(n, u.email ? lc(u.email) : null, s); const id = rowU.get(n).rowid; dFu.run(id); iFu.run(id, n, String(u.display || ''), String(u.bio || '')); } }
      for (const n of rows.users.keys()) if (!next.users.has(n)) { const r = rowU.get(n); if (r) dFu.run(r.rowid); delU.run(n); }
      for (const p of posts) { const s = JSON.stringify(p); next.posts.set(p.id, s); if (rows.posts.get(p.id) !== s) { upP.run(p.id, p.author, p.replyTo || null, p.group || null, p.at, String(p.text || ''), s); dFp.run(p.id); if (indexable(p)) iFp.run(p.id, String(p.text || '')); postsChanged = true; } }
      for (const i of rows.posts.keys()) if (!next.posts.has(i)) { delP.run(i); dFp.run(i); postsChanged = true; }
      if (postsChanged) next.tags = syncTags(posts.filter(indexable)); else next.tags = rows.tags;
      for (const [k, v] of Object.entries(rest)) { const s = JSON.stringify(v); next.meta.set(k, s); if (rows.meta.get(k) !== s) upM.run(k, s); }
      for (const k of rows.meta.keys()) if (!next.meta.has(k)) delM.run(k);
      setVer.run(key, ((getVer.get(key) || { version: 0 }).version) + 1);
    });
    rows = next;
  };
  // hashtags des posts publics : table tags (tag, n) + index fts_tags, mis à jour par différence
  const syncTags = list => {
    const cur = new Map(), old = rows.tags;
    for (const p of list) for (const t of tagsOf(p.text)) cur.set(t, (cur.get(t) || 0) + 1);
    const ins = q('INSERT INTO tags (tag, n) VALUES (?, ?)'), upd = q('UPDATE tags SET n = ? WHERE tag = ?'), del = q('DELETE FROM tags WHERE tag = ?'), rid = q('SELECT rowid FROM tags WHERE tag = ?');
    const dF = q('DELETE FROM fts_tags WHERE rowid = ?'), iF = q('INSERT INTO fts_tags (rowid, tag) VALUES (?, ?)');
    for (const [t, n] of cur) { if (!old.has(t)) { ins.run(t, n); iF.run(rid.get(t).rowid, t); } else if (old.get(t) !== n) upd.run(n, t); }
    for (const t of old.keys()) if (!cur.has(t)) { dF.run(rid.get(t).rowid); del.run(t); }
    return cur;
  };
  // reconstruit tout l'index depuis les tables (premier démarrage avec FTS, restauration d'une sauvegarde plus ancienne)
  const reindex = () => tx(() => {
    ensureFts(); rows = null;
    for (const t of ['fts_posts', 'fts_users', 'fts_tags', 'tags']) db.exec('DELETE FROM ' + t);
    const iFp = q('INSERT INTO fts_posts (rowid, body) VALUES (?, ?)'), iFu = q('INSERT INTO fts_users (rowid, name, display, bio) VALUES (?, ?, ?, ?)'), list = [];
    for (const r of q('SELECT id, v FROM posts ORDER BY id').all()) { const p = JSON.parse(r.v); if (indexable(p)) { iFp.run(r.id, String(p.text || '')); list.push(p); } }
    for (const r of q('SELECT rowid, v FROM users').all()) { const u = JSON.parse(r.v); iFu.run(r.rowid, u.name || '', String(u.display || ''), String(u.bio || '')); }
    snapshot(); rows.tags = new Map(); syncTags(list); snapshot();
    setVer.run('fts:' + key, 1);
  });

  // migration automatique : l'ancien blob kv devient des lignes, puis est conservé sous « <clé>.migrated » (jamais supprimé)
  const migrate = () => {
    const old = q('SELECT v, version FROM kv WHERE k = ?').get(key);
    if (!old || getVer.get(key)) return false;
    const obj = JSON.parse(old.v);
    tx(() => { setVer.run(key, old.version); write(obj); setVer.run(key, old.version);
      q('INSERT OR REPLACE INTO kv (k, v, version) VALUES (?, ?, ?)').run(key + '.migrated', old.v, old.version); q('DELETE FROM kv WHERE k = ?').run(key); });
    return true;
  };
  const migrated = (() => { try { return db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('kv') ? migrate() : false; } catch (e) { throw new Error('Migration SQLite échouée (données intactes) : ' + e.message); } })();

  if (!getVer.get('fts:' + key)) reindex();

  return {
    migrated,
    // après une restauration : repart des tables, ou migre à nouveau si la sauvegarde restaurée contient l'ancien blob
    reload: () => { cache = null; rows = null; ensureFts(); const old = q('SELECT 1 FROM kv WHERE k = ?').get(key);
      if (old) { tx(() => { for (const t of ['users', 'posts', 'meta']) db.exec('DELETE FROM ' + t); q('DELETE FROM store_state WHERE k = ?').run(key); }); migrate(); }
      reindex(); },
    version: () => (getVer.get(key) || { version: 0 }).version,
    storage: {
      getItem: k => { if (k !== key) { const r = q('SELECT v FROM meta WHERE k = ?').get('raw:' + k); return r ? r.v : null; }
        if (!getVer.get(key)) return null; return cache || (cache = JSON.stringify(readAll())); },
      setItem: (k, v) => { if (k !== key) { q(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run('raw:' + k, String(v)); return; }
        cache = null; write(JSON.parse(v)); onWrite && onWrite(); },
    },
    // ---- requêtes indexées (sans relire tout l'état) ----
    // fil d'un auteur / fil général : posts racines hors communautés, du plus récent au plus ancien, pagination par curseur d'id
    feedIds: ({ authors, before, limit = 20 } = {}) => {
      const a = authors ? authors.map(lc) : null, ph = a ? ' AND lower(author) IN (' + a.map(() => '?').join(',') + ')' : '';
      return q(`SELECT id FROM posts WHERE grp IS NULL AND reply_to IS NULL${before ? ' AND id < ?' : ''}${ph} ORDER BY id DESC LIMIT ?`).all(...(before ? [+before] : []), ...(a || []), limit).map(r => r.id);
    },
    replyIds: postId => q('SELECT id FROM posts WHERE reply_to = ? ORDER BY id').all(+postId).map(r => r.id),
    // recherche : tous les mots doivent apparaître (insensible à la casse), joker LIKE échappé
    searchIds: (text, { limit = 50, before } = {}) => {
      const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8); if (!words.length) return [];
      return q(`SELECT id FROM posts WHERE ${words.map(() => `lower(body) LIKE ? ESCAPE '\\'`).join(' AND ')}${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
        .all(...words.map(w => '%' + w.replace(/[\\%_]/g, c => '\\' + c) + '%'), ...(before ? [+before] : []), limit).map(r => r.id);
    },
    // ---- recherche plein texte (FTS5) : classement par pertinence (bm25), extraits où les mots trouvés sont entourés de \u0001 … \u0002 ----
    // posts publics ; filtres : author (pseudo exact), since / until (ms, until exclu) ; la visibilité par lecteur est appliquée par le moteur
    ftsPosts: (text, { author, since, until, limit = 50, offset = 0 } = {}) => {
      const m = ftsQuery(text); if (!m) return [];
      return q(`SELECT p.id id, p.author author, p.at at, bm25(fts_posts) rank, snippet(fts_posts, 0, char(1), char(2), '…', 18) snippet FROM fts_posts JOIN posts p ON p.id = fts_posts.rowid
        WHERE fts_posts MATCH ?${author ? ' AND lower(p.author) = ?' : ''}${since != null ? ' AND p.at >= ?' : ''}${until != null ? ' AND p.at < ?' : ''} ORDER BY rank, p.id DESC LIMIT ? OFFSET ?`)
        .all(m, ...(author ? [lc(author)] : []), ...(since != null ? [+since] : []), ...(until != null ? [+until] : []), limit, offset);
    },
    ftsUsers: (text, limit = 10) => {
      const m = ftsQuery(text); if (!m) return [];
      return q(`SELECT u.name name, highlight(fts_users, 0, char(1), char(2)) hname, highlight(fts_users, 1, char(1), char(2)) hdisplay, snippet(fts_users, 2, char(1), char(2), '…', 12) hbio
        FROM fts_users JOIN users u ON u.rowid = fts_users.rowid WHERE fts_users MATCH ? ORDER BY bm25(fts_users, 10, 5, 1), u.name LIMIT ?`).all(m, limit);
    },
    ftsTags: (text, limit = 10) => {
      const m = ftsQuery(text); if (!m) return [];
      return q(`SELECT t.tag tag, t.n n, highlight(fts_tags, 0, char(1), char(2)) htag FROM fts_tags JOIN tags t ON t.rowid = fts_tags.rowid WHERE fts_tags MATCH ? ORDER BY t.n DESC, t.tag LIMIT ?`).all(m, limit);
    },
    // suggestions pendant la frappe, d'après le dernier mot saisi : mots les plus fréquents, hashtags, membres
    ftsSuggest: (text, limit = 5) => {
      const w = ftsWords(text).pop(); if (!w) return { words: [], tags: [], users: [] };
      const lo = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return {
        words: q('SELECT term, doc FROM fts_vocab WHERE term >= ? AND term < ? ORDER BY doc DESC, term LIMIT ?').all(lo, lo + '\uffff', limit).filter(r => r.term !== lo || r.doc > 0).map(r => r.term),
        tags: q('SELECT t.tag tag FROM fts_tags JOIN tags t ON t.rowid = fts_tags.rowid WHERE fts_tags MATCH ? ORDER BY t.n DESC, t.tag LIMIT ?').all('"' + w + '"*', limit).map(r => r.tag),
        users: q('SELECT u.name name FROM fts_users JOIN users u ON u.rowid = fts_users.rowid WHERE fts_users MATCH ? ORDER BY bm25(fts_users, 10, 5, 1), u.name LIMIT ?').all('{name display} : "' + w + '"*', limit).map(r => r.name),
      };
    },
    userByEmail: email => { const r = q('SELECT v FROM users WHERE email = ?').get(lc(email)); return r ? JSON.parse(r.v) : null; },
    counts: () => ({ users: q('SELECT COUNT(*) n FROM users').get().n, posts: q('SELECT COUNT(*) n FROM posts').get().n }),
    transaction: tx,
  };
};
module.exports = { Store };
