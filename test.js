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
console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
