// Tests du stockage SQLite : migration du blob existant, transactions, requêtes indexées, cohérence avec le moteur.
const assert = require('assert'), { DatabaseSync } = require('node:sqlite'), { Store } = require('./store.js'), Social = require('./social.js');
const KEY = Social.KEY;
const mk = () => { const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0)'); return db; };

// 1. migration automatique d'un ancien blob (via le moteur, sur un storage « fichier » de l'ancienne génération)
const old = {}; const legacy = { getItem: k => old[k] || null, setItem: (k, v) => { old[k] = v; } };
(async () => {
const a = Social.Net(legacy); await a.signup('Alice', 'pw1234'); await a.signup('Bob', 'pw1234');
a.post('Alice', 'Bonjour le Cornichon 100% frais'); a.post('Bob', 'salut tout le monde'); const first = a.db().posts[0].id; a.post('Bob', 'réponse', first);
const db = mk(); db.prepare('INSERT INTO kv (k, v, version) VALUES (?, ?, 7)').run(KEY, old[KEY]);
const s = Store(db, KEY);
assert.ok(s.migrated, 'migration déclenchée'); assert.strictEqual(s.version(), 7);
assert.deepStrictEqual(s.counts(), { users: 2, posts: 3 });
assert.ok(db.prepare('SELECT 1 FROM kv WHERE k = ?').get(KEY + '.migrated'), 'ancien blob conservé');
assert.ok(!db.prepare('SELECT 1 FROM kv WHERE k = ?').get(KEY));
assert.deepStrictEqual(JSON.parse(s.storage.getItem(KEY)).users, JSON.parse(old[KEY]).users, 'aller-retour identique');
assert.strictEqual(Store(db, KEY).migrated, false, 'migration idempotente');

// 2. le moteur fonctionne sur les tables
const net = Social.Net(s.storage); const v0 = s.version();
net.post('Alice', 'nouveau post cornichon'); assert.ok(s.version() > v0);
assert.strictEqual(net.db().posts.length, 4);
assert.strictEqual(Social.Net(s.storage).db().posts.length, 4, 'relecture');

// 3. requêtes indexées = résultats du moteur
const all = net.db().posts;
assert.deepStrictEqual(s.feedIds({ limit: 10 }), all.filter(p => !p.replyTo && !p.group).map(p => p.id).sort((x, y) => y - x));
assert.deepStrictEqual(s.feedIds({ authors: ['bob'] }), all.filter(p => !p.replyTo && p.author === 'Bob').map(p => p.id));
assert.deepStrictEqual(s.replyIds(first), all.filter(p => p.replyTo === first).map(p => p.id));
assert.deepStrictEqual(s.searchIds('CORNICHON'), all.filter(p => /cornichon/i.test(p.text)).map(p => p.id).sort((x, y) => y - x));
assert.strictEqual(s.searchIds('100%').length, 1, 'joker échappé'); assert.strictEqual(s.searchIds('%').length, 1);
assert.strictEqual(s.feedIds({ before: all[all.length - 1].id, limit: 1 }).length, 1);

// 4. suppression et transaction atomique : une erreur annule tout
net.deletePost('Alice', all[3].id); assert.strictEqual(s.counts().posts, 3);
assert.throws(() => s.transaction(() => { db.prepare('DELETE FROM posts').run(); throw new Error('boom'); }), /boom/);
assert.strictEqual(s.counts().posts, 3, 'rollback');
assert.throws(() => s.storage.setItem(KEY, JSON.stringify({ users: { x: { name: 'x', email: 'a@b.c' }, y: { name: 'y', email: 'a@b.c' } }, posts: [] })), /UNIQUE/);
assert.strictEqual(s.counts().users, 2, 'écriture refusée : état précédent intact');
assert.strictEqual(Social.Net(s.storage).db().posts.length, 3);
console.log('ok stockage SQLite');
})().catch(e => { console.error(e); process.exit(1); });
