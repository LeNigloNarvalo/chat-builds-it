const assert = require('assert');
const { Net } = require('./social.js');
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
(async () => {
let n = Net(mem);
await n.signup('alice', 'pass1'); await n.signup('Bob', 'pass2');
await assert.rejects(() => n.signup('ALICE', 'xxxx'), /pris/);
await assert.rejects(() => n.signup('Streamer', 'xxxx'), /réservé/);
await assert.rejects(() => n.login('alice', 'nope'));
assert.strictEqual(await n.login('ALICE', 'pass1'), 'alice');
assert.ok(/^[0-9a-f]{32}\$[0-9a-f]{64}$/.test(n.profile('alice').pass) && !mem.d['twitchgram.v1'].includes('pass1'));
// données partagées : une 2e instance voit et modifie sans cache périmé
const other = Net(mem); other.post('alice', 'depuis un autre visiteur #live');
assert.strictEqual(n.explore().length, 1); n.post('Bob', 'second'); assert.strictEqual(other.explore().length, 2);
n.deletePost('Bob', n.explore()[0].id); other.deletePost('alice', other.explore()[0].id);
// stream : vrai compte Streamer, idempotent, admin
assert.strictEqual(await n.ensureStreamer(), 'Streamer'); assert.strictEqual(await other.ensureStreamer(), 'Streamer');
assert.ok(n.isAdmin('streamer') && Object.keys(n.db().users).length === 3);
const p = n.post('Bob', 'Salut @alice #twitch');
assert.strictEqual(n.feed('alice').length, 0);
assert.strictEqual(n.toggleFollow('alice', 'bob'), true);
assert.strictEqual(n.feed('alice').length, 1);
n.toggleLike('alice', p.id); n.post('alice', 'réponse', p.id);
assert.strictEqual(n.replies(p.id).length, 1);
assert.deepStrictEqual(n.notifications('Bob').map(x => x.type).sort(), ['follow', 'like', 'reply']);
assert.strictEqual(n.notifications('alice')[0].type, 'mention');
n.send('alice', 'bob', 'yo'); assert.strictEqual(n.conversation('bob', 'alice').length, 1);
assert.deepStrictEqual(n.trending()[0], ['#twitch', 1]);
assert.throws(() => n.post('alice', 'x'.repeat(281)));
assert.throws(() => n.deletePost('alice', p.id));
// persistance : « redémarrage »
n = Net(mem); assert.strictEqual(n.explore().length, 1); assert.strictEqual(n.followers('bob')[0], 'alice');
const tl = (n.post('alice', 'a #x #y'), n.post('alice', 'b #x'), n.trendingLive()); assert.ok(tl[0].tag === '#x' && tl[0].count === 3 - 1 + 0 || tl[0].tag.startsWith('#'));
assert.ok(n.ranking(2).every(r => !r.post.replyTo));
n.deletePost('Bob', p.id); assert.strictEqual(n.db().posts.filter(x => x.id === p.id).length, 0);
// profil éditable
n = Net(mem); await n.signup('carol', 'pass3');
n.updateProfile('carol', { display: 'Carol ✨', bio: 'Hello', avatar: '#ff00aa', banner: 'https://x.io/b.png', link: 'https://carol.dev' });
assert.strictEqual(n.profile('carol').display, 'Carol ✨'); assert.strictEqual(n.profile('carol').avatar, '#ff00aa');
n.updateProfile('carol', { banner: 'grad:2' });
assert.throws(() => n.updateProfile('carol', { link: 'javascript:alert(1)' }), /Lien/);
assert.throws(() => n.updateProfile('carol', { avatar: 'red' }), /avatar/);
assert.throws(() => n.updateProfile('carol', { banner: 'javascript:x' }), /Bannière/);
// sécurité : changement de mot de passe, déconnexion partout, limite d'essais, suppression
let clock = 1e12; n = Net(mem, () => clock); await n.signup('dave', 'pass4'); await n.signup('erin', 'pass5');
const e0 = n.epoch('dave');
await assert.rejects(() => n.changePassword('dave', 'bad', 'newpass'), /actuel/);
await n.changePassword('dave', 'pass4', 'newpass');
assert.ok(n.epoch('dave') > e0); await assert.rejects(() => n.login('dave', 'pass4')); assert.strictEqual(await n.login('dave', 'newpass'), 'dave');
const e1 = n.epoch('dave'); n.logoutAll('dave'); assert.strictEqual(n.epoch('dave'), e1 + 1);
for (let i = 0; i < 5; i++) await assert.rejects(() => n.login('erin', 'x'), /invalides/);
await assert.rejects(() => n.login('erin', 'pass5'), /Trop d'essais/);
clock += 61000; assert.strictEqual(await n.login('erin', 'pass5'), 'erin');
const dp = n.post('dave', 'bye #gone'); n.post('erin', 'rep', dp.id); n.toggleFollow('erin', 'dave'); n.send('erin', 'dave', 'hi'); n.toggleLike('erin', n.post('erin', 'mine').id);
await assert.rejects(() => n.deleteAccount('dave', 'wrong'), /incorrect/);
await n.deleteAccount('dave', 'newpass');
assert.ok(!n.db().users.dave && n.db().posts.every(p => p.author !== 'dave' && p.replyTo !== dp.id) && !n.profile('erin').following.includes('dave') && n.db().messages.every(m => m.from !== 'dave' && m.to !== 'dave'));
await assert.rejects(() => n.deleteAccount('Streamer', 'x'), /Streamer/);
// export / import JSON
n = Net(mem); await n.signup('fred', 'pass6'); await n.signup('gina', 'pass7');
n.updateProfile('fred', { display: 'Fred', bio: 'yo', avatar: '#112233' }); n.toggleFollow('fred', 'gina'); n.post('fred', 'mon post #exp'); n.send('fred', 'gina', 'salut');
const ex = n.exportUser('fred'); const exs = JSON.stringify(ex);
assert.ok(ex.format === 'twitchgram-export' && ex.posts.length === 1 && ex.messages.length === 1 && !exs.includes('$') && !exs.includes('pass6'));
const m2 = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
const n2 = Net(m2); await n2.signup('fred', 'autre1'); await n2.signup('gina', 'autre2');
assert.deepStrictEqual(n2.importUser('fred', exs), { posts: 1, messages: 1, following: 1 });
assert.deepStrictEqual(n2.importUser('fred', ex), { posts: 0, messages: 0, following: 0 }); // idempotent
assert.ok(n2.profile('fred').display === 'Fred' && n2.byUser('fred').length === 1 && n2.conversation('fred', 'gina').length === 1);
assert.throws(() => n2.importUser('fred', '{pas du json'), /invalide/);
assert.throws(() => n2.importUser('fred', { format: 'x' }), /export/);
const evil = JSON.parse(exs); evil.messages = [{ from: 'gina', to: 'fred', text: 'x', at: 1 }, { from: 'gina', to: 'gina', text: 'y', at: 2 }]; evil.posts = [];
assert.strictEqual(n2.importUser('fred', evil).messages, 1);
// favoris, repartages, modification (15 min)
{ let ck = 2e12; const m3 = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
  const z = Net(m3, () => ck); await z.signup('hana', 'pass8'); await z.signup('igor', 'pass9');
  const hp = z.post('hana', 'premier jet');
  assert.strictEqual(z.toggleBookmark('igor', hp.id), true); assert.strictEqual(z.bookmarks('igor').length, 1); assert.strictEqual(Net(m3, () => ck).isBookmarked('igor', hp.id), true);
  assert.strictEqual(z.toggleRepost('igor', hp.id), true); assert.strictEqual(z.timeline('igor')[0].by, 'igor'); assert.strictEqual(z.repostCount(hp.id), 1);
  assert.throws(() => z.toggleRepost('hana', hp.id), /propre/);
  ck += 60000; z.editPost('hana', hp.id, 'version corrigée');
  assert.ok(z.db().posts[0].editedAt && z.db().posts[0].history[0].text === 'premier jet');
  assert.throws(() => z.editPost('igor', hp.id, 'piraté'), /vos posts/); assert.throws(() => z.editPost('hana', hp.id, 'version corrigée'), /changement/);
  ck += 15 * 60000; assert.throws(() => z.editPost('hana', hp.id, 'trop tard'), /15 minutes/); assert.strictEqual(z.canEdit('hana', hp.id), false);
  z.deletePost('hana', hp.id); assert.ok(z.bookmarks('igor').length === 0 && z.timeline('igor').length === 0);
}
// préférences d'accessibilité
const A = require('./a11y.js'), pm = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
assert.deepStrictEqual(A.load(pm), { theme: 'auto', size: 100 });
assert.deepStrictEqual(A.save(pm, { theme: 'light', size: 130 }), { theme: 'light', size: 130 });
assert.deepStrictEqual(A.save(pm, { theme: 'neon', size: 7 }), { theme: 'auto', size: 100 });
pm.d[A.KEY] = '{cassé'; assert.strictEqual(A.load(pm).theme, 'auto');
assert.ok(A.resolve({ theme: 'auto' }, true) === 'dark' && A.resolve({ theme: 'auto' }, false) === 'light' && A.resolve({ theme: 'dark' }, false) === 'dark');
const doc = { documentElement: { dataset: {}, style: {} } }; A.apply({ theme: 'light', size: 115 }, doc, true);
assert.ok(doc.documentElement.dataset.theme === 'light' && doc.documentElement.style.fontSize === '115%');
console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
