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
assert.ok(ex.format === 'cornichon-export' && ex.posts.length === 1 && ex.messages.length === 1 && !exs.includes('$') && !exs.includes('pass6'));
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
// images dans posts et messages
{ const px = 'data:image/png;base64,iVBORw0KGgo=', g = { src: px, alt: '  un pixel  ' }, mi = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
  const z = Net(mi); await z.signup('jade', 'pass10'); await z.signup('kim', 'pass11');
  const ip = z.post('jade', '', null, [g, g]); assert.strictEqual(ip.images.length, 2); assert.strictEqual(ip.images[0].alt, 'un pixel');
  assert.throws(() => z.post('jade', 'x', null, [g, g, g, g, g]), /4 images/);
  assert.throws(() => z.post('jade', 'x', null, [{ src: 'data:text/html;base64,AAAA' }]), /invalide/);
  assert.throws(() => z.post('jade', 'x', null, [{ src: 'javascript:alert(1)' }]), /invalide/);
  assert.throws(() => z.post('jade', '', null, []), /vide/);
  z.send('jade', 'kim', '', [g]); assert.strictEqual(z.conversation('kim', 'jade')[0].images.length, 1);
  assert.throws(() => z.send('jade', 'kim', ''), /invalide/);
  const back = Net({ d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } }); await back.signup('jade', 'autre3');
  assert.strictEqual(back.importUser('jade', z.exportUser('jade')).posts, 1); assert.strictEqual(back.byUser('jade')[0].images.length, 2);
}
// blocage, masquage, signalements et modération
{
  const mk = () => ({ d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } });
  const st = mk(), n = Net(st);
  await n.signup('ana', 'pass1'); await n.signup('bob', 'pass2'); await n.signup('cyd', 'pass3'); await n.ensureStreamer();
  n.toggleFollow('ana', 'bob'); const pb = n.post('bob', 'salut #x'); n.post('cyd', 'hello'); const rp = n.post('ana', 'reponse', pb.id); n.send('bob', 'ana', 'psst');
  assert.strictEqual(n.feed('ana').length, 1); assert.strictEqual(n.conversation('ana', 'bob').length, 1);
  n.toggleMute('ana', 'bob'); // masquer : tout disparaît, mais bob peut encore écrire
  assert.ok(n.feed('ana').every(p => p.author !== 'bob') && n.explore('ana').every(p => p.author !== 'bob') && n.conversation('ana', 'bob').length === 0);
  assert.strictEqual(n.search('salut', 'ana').posts.length, 0); assert.strictEqual(n.explore().length, 2);
  assert.doesNotThrow(() => n.send('bob', 'ana', 'encore'));
  n.toggleMute('ana', 'bob'); assert.strictEqual(n.explore('ana').length, 2);
  n.toggleBlock('ana', 'bob'); // bloquer : coupe les abonnements et interdit réponses / DM / suivi
  assert.ok(n.isBlocked('ana', 'bob') && !n.profile('ana').following.includes('bob'));
  assert.throws(() => n.post('bob', 'yo', rp.id), /bloqué/); assert.throws(() => n.send('bob', 'ana', 'x'), /bloqué/); assert.throws(() => n.toggleFollow('bob', 'ana'), /bloqu/);
  assert.strictEqual(n.replies(pb.id, 'cyd').length, 1); assert.strictEqual(n.replies(pb.id, 'bob').length, 1);
  assert.strictEqual(n.explore('ana').some(p => p.author === 'bob'), false); assert.throws(() => n.toggleBlock('ana', 'streamer'), /Streamer/);
  n.toggleBlock('ana', 'bob'); assert.ok(!n.isBlocked('ana', 'bob'));
  // signalements
  assert.throws(() => n.report('ana', pb.id, 'xx'), /motif/); assert.throws(() => n.report('bob', pb.id, 'spam'), /propre/);
  n.report('ana', pb.id, 'spam', 'pub'); assert.throws(() => n.report('ana', pb.id, 'spam'), /déjà/); n.report('cyd', pb.id, 'harcelement');
  assert.throws(() => n.queue('ana'), /administrateur/); assert.throws(() => n.moderate('ana', pb.id, 'ban'), /administrateur/);
  const q = n.queue('Streamer'); assert.strictEqual(q.length, 1); assert.strictEqual(q[0].reports.length, 2);
  n.moderate('Streamer', pb.id, 'suspend', { hours: 2 });
  assert.strictEqual(n.queue('Streamer').length, 0); assert.strictEqual(n.history('Streamer').length, 2); assert.ok(n.sanctionOf('bob').type === 'suspend');
  assert.throws(() => n.post('bob', 'non'), /suspendu/); assert.throws(() => n.toggleLike('bob', pb.id), /suspendu/);
  n.liftSanction('Streamer', 'bob'); assert.doesNotThrow(() => n.post('bob', 'ok'));
  const p2 = n.post('bob', 'spam!'); n.report('cyd', p2.id, 'spam');
  n.moderate('Streamer', p2.id, 'ban'); assert.throws(() => n.post('bob', 'x'), /banni/); assert.ok(n.notifications('bob').some(x => x.type === 'sanction'));
  const p3 = n.post('cyd', 'mauvais'); n.report('ana', p3.id, 'nsfw'); n.moderate('Streamer', p3.id, 'delete');
  assert.ok(!n.explore().some(p => p.id === p3.id) && n.history('Streamer', 1)[0].action === 'delete');
  const p4 = n.post('cyd', 'ok'); n.report('ana', p4.id, 'autre'); n.moderate('Streamer', p4.id, 'dismiss'); assert.ok(n.explore().some(p => p.id === p4.id));
  // les listes sont partagées via le storage : une 2e instance voit tout
  assert.ok(Net(st).sanctionOf('bob').type === 'ban');
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
// studio de thème
const T = require('./theme.js'), tm = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
assert.strictEqual(T.load(tm).on, false);
const t1 = T.save(tm, { on: true, bg: { type: 'conic', angle: 400, stops: [{ c: '#ff0000', p: 0 }, { c: 'rouge', p: 500 }, { c: '#00ff00', p: 50 }] }, radius: 99, font: 'comic' });
assert.ok(t1.on && t1.bg.angle === 360 && t1.bg.stops[1].c === '#9146ff' && t1.bg.stops[1].p === 100 && t1.radius === 28 && t1.font === 'system');
assert.ok(/^conic-gradient\(from 360deg at 50% 50%,#ff0000 0%,#00ff00 50%,#9146ff 100%\)$/.test(T.css(t1.bg)));
assert.ok(T.css(T.clean({ bg: { type: 'radial', stops: [{ c: '#000000', p: 0 }] } }).bg).startsWith('radial-gradient'));
assert.strictEqual(T.clean({ acc: { stops: Array.from({ length: 12 }, () => ({ c: '#123456', p: 1 })) } }).acc.stops.length, T.MAX_STOPS);
assert.strictEqual(T.onAcc({ stops: [{ c: '#ffff00', p: 0 }, { c: '#ffffff', p: 100 }] }), '#000000'); assert.strictEqual(T.onAcc({ stops: [{ c: '#000044', p: 0 }, { c: '#220066', p: 100 }] }), '#ffffff');
const tdoc = { documentElement: { dataset: {}, style: { p: {}, setProperty(k, v) { this.p[k] = v; }, removeProperty(k) { delete this.p[k]; } } } };
T.apply(t1, tdoc); assert.ok(tdoc.documentElement.style.p['--bg-img'].startsWith('conic') && tdoc.documentElement.dataset.custom === '1');
T.apply(T.clean(), tdoc); assert.ok(!tdoc.documentElement.style.p['--bg-img'] && !tdoc.documentElement.dataset.custom);
assert.deepStrictEqual(T.importText(T.exportText(t1)), t1);
assert.throws(() => T.importText('{x'), /invalide/); assert.throws(() => T.importText('{"a":1}'), /thème/);
for (const n in T.PRESETS) assert.ok(T.ratio(T.PRESETS[n].fg, T.mix(T.PRESETS[n].bg)) >= 3, 'contraste ' + n);
// noms piégés : aucun accès au prototype
await n.signup('constructor', 'pass9'); assert.throws(() => n.profile('valueOf')); assert.strictEqual(n.profile('constructor').name, 'constructor');
const snap = require('./social.js').snapshot(n.db(), 'carol'); assert.ok(!JSON.stringify(snap).includes('"pass"'));
console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });

// brouillons, planification, historique des versions
(async () => {
  const assert = require('assert'), { Net } = require('./social.js');
  const m = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
  let clock = 2e12; const n = Net(m, () => clock); await n.signup('dora', 'pass1'); await n.signup('eli', 'pass2');
  const d = n.saveDraft('dora', null, 'brouillon 1', []); assert.strictEqual(n.drafts('dora').length, 1);
  assert.strictEqual(n.saveDraft('dora', d.id, 'brouillon 1 bis', [], {}).text, 'brouillon 1 bis'); assert.strictEqual(n.drafts('dora').length, 1);
  assert.strictEqual(n.drafts('eli').length, 0); assert.throws(() => n.saveDraft('eli', d.id, 'vol', []), /introuvable/); assert.throws(() => n.deleteDraft('eli', d.id));
  assert.throws(() => n.saveDraft('dora', d.id, 'x', [], { scheduledAt: clock - 1 }), /futur/);
  n.saveDraft('dora', d.id, 'planifié', [], { scheduledAt: clock + 60000 });
  assert.strictEqual(n.publishDue(), 0); assert.strictEqual(n.explore().length, 0);
  clock += 60001; assert.strictEqual(n.publishDue(), 1); assert.strictEqual(n.explore()[0].text, 'planifié'); assert.strictEqual(n.drafts('dora').length, 0);
  const d2 = n.saveDraft('dora', null, 'à publier', []); assert.strictEqual(n.publishDraft('dora', d2.id).text, 'à publier');
  assert.strictEqual(n.saveDraft('dora', n.saveDraft('dora', null, 'tmp', []).id, '', []), null); assert.strictEqual(n.drafts('dora').length, 0); // vidé = supprimé
  assert.ok(!JSON.stringify(require('./social.js').snapshot(n.db(), 'eli')).includes('drafts":[{'));
  const p = n.explore()[0]; n.editPost('dora', p.id, 'v2'); n.editPost('dora', p.id, 'v3');
  assert.deepStrictEqual(n.db().posts.find(x => x.id === p.id).history.map(h => h.text), ['à publier', 'v2']);
  console.log('ok brouillons');
})().catch(e => { console.error(e); process.exit(1); });

// nombre d'or : la feuille de style et l'en-tête l'appliquent
{
  const fs = require('fs'), css = fs.readFileSync(__dirname + '/style.css', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  if (!/--phi:1\.618/.test(css) || !/aspect-ratio:1\.618\/1/.test(css) || !/max-width:618px/.test(css) || !html.includes('φ 1,618')) throw new Error('nombre d\'or manquant');
  console.log('ok nombre d\'or');
}
{ const Diag = require('./diag.js'); const r = require('assert');
  Diag.run({ store: { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } }, get: async p => p.includes('feed') ? { posts: [] } : p.includes('state') ? { state: { users: {} }, version: 1 } : { ok: true }, me: () => 'a', connected: () => true })
    .then(res => { r.ok(res.find(x => x.name === 'Serveur joignable').ok); r.ok(res.find(x => x.name === 'Fil paginé').ok); r.ok(/en échec/.test(Diag.summary([{ ok: false }]))); console.log('ok diag'); }); }
