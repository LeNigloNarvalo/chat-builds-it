// Modération automatique : règles, aperçu, actions (masquer / valider / avertir), journal, annulation, visibilité.
const assert = require('assert'), Social = require('./social.js'), AM = require('./automod.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
(async () => {
  // moteur pur
  assert.ok(AM.match({ type: 'words', value: ['arnaque'] }, { text: 'Quelle ARNAQUÉE… non, une Arnaque !' }));
  assert.strictEqual(AM.match({ type: 'words', value: ['arnaque'] }, { text: 'arnaquer' }), null); // mot entier seulement
  assert.ok(AM.match({ type: 'links', value: [] }, { text: 'va sur http://exemple.fr/x' }));
  assert.strictEqual(AM.match({ type: 'links', value: ['twitch.tv'] }, { text: 'https://www.twitch.tv/moi et clips.twitch.tv/a' }), null);
  assert.ok(AM.match({ type: 'newaccount', value: 24 }, { joined: 1000, now: 1000 + 3600000 }));
  assert.strictEqual(AM.match({ type: 'newaccount', value: 24 }, { joined: 0, now: 48 * 3600000 }), null);
  assert.ok(AM.match({ type: 'reports', value: 3 }, { now: 1e7, reports: [1e7 - 1, 1e7 - 2, 1e7 - 3, 5] }));
  assert.throws(() => AM.clean({ name: 'x', type: 'words', action: 'hide', value: '' }), /mot/);
  assert.throws(() => AM.clean({ name: 'x', type: 'newaccount', action: 'hide', value: 5000 }), /heures/);
  assert.throws(() => AM.clean({ name: 'x', type: 'words', action: 'bannir', value: 'a' }), /Action/);

  for (const n of ['Owen', 'Mia', 'Zed', 'Lou']) await net.signup(n, 'secret12');
  const g = net.createGroup('Owen', 'Les Cornichons', 'desc', '', true);
  for (const n of ['Mia', 'Zed', 'Lou']) net.joinGroup(n, g.id);
  net.setGroupMod('Owen', g.id, 'Mia', true);
  assert.throws(() => net.automod('Zed', g.id), /modérateurs/);
  assert.throws(() => net.automodSave('Zed', g.id, { name: 'a', type: 'words', action: 'hide', value: 'x' }), /modérateurs/);

  // règles + aperçu sur les posts récents (sans effet)
  net.post('Zed', 'Une vraie arnaque ici', null, [], null, g.id); net.post('Lou', 'Bonjour tout le monde', null, [], null, g.id);
  const pv = net.automodPreview('Mia', g.id, { name: 'Spam', type: 'words', action: 'hide', value: 'arnaque, casino' }, 50);
  assert.strictEqual(pv.matches.length, 1); assert.strictEqual(pv.scanned, 2); assert.ok(!net.groupFeed('Lou', g.id).some(p => p.hidden));
  assert.strictEqual(net.automod('Owen', g.id).rules.length, 0);
  const r1 = net.automodSave('Mia', g.id, { name: 'Spam', type: 'words', action: 'hide', value: 'arnaque, casino' });
  assert.throws(() => net.automodSave('Mia', g.id, { name: 'spam', type: 'links', action: 'warn', value: '' }), /déjà/);
  const r2 = net.automodSave('Owen', g.id, { name: 'Liens', type: 'links', action: 'queue', value: 'twitch.tv' });
  const r3 = net.automodSave('Owen', g.id, { name: 'Nouveaux', type: 'newaccount', action: 'warn', value: 1 });

  // masquer : post masqué, auteur prévenu, journal, aucune notification de mention
  const hid = net.post('Zed', 'casino gratuit @Lou', null, [], null, g.id);
  assert.ok(hid.hidden && hid.hidden.auto); assert.ok(!net.notifications('Lou').some(n => n.postId === hid.id));
  // valider avant : invisible des autres membres, visible de l'auteur et des modérateurs
  const q = net.post('Lou', 'regarde https://evil.example.com/x @Zed', null, [], null, g.id);
  assert.ok(q.pending); assert.ok(!net.groupFeed('Zed', g.id).some(p => p.id === q.id));
  assert.ok(net.groupFeed('Lou', g.id).some(p => p.id === q.id) && net.groupFeed('Mia', g.id).some(p => p.id === q.id));
  assert.ok(!Social.snapshot(net.db(), 'Zed').posts.some(p => p.id === q.id)); assert.ok(Social.snapshot(net.db(), 'Mia').posts.some(p => p.id === q.id));
  assert.ok(!net.notifications('Zed').some(n => n.postId === q.id));
  // domaine autorisé : publié normalement ; modérateur exempté
  assert.ok(!net.post('Zed', 'ma chaîne twitch.tv/zed', null, [], null, g.id).pending);
  assert.ok(!net.post('Mia', 'casino ok ?', null, [], null, g.id).hidden);
  // avertir (compte récent, règle 1 h) : le post reste visible
  net.automodSave('Owen', g.id, { id: r2.id, name: 'Liens', type: 'links', action: 'queue', value: 'twitch.tv' });
  const w = net.post('Lou', 'salut', null, [], null, g.id); assert.ok(w.autoWarn && !w.hidden && !w.pending);
  assert.ok(net.notifications('Lou').some(n => n.what === 'automod-warn'));
  // règle désactivée : plus d'effet
  net.automodToggle('Owen', g.id, r3.id, false); assert.ok(!net.post('Lou', 'encore', null, [], null, g.id).autoWarn);
  // journal + annulation en un clic
  const log = net.automod('Mia', g.id).log; assert.deepStrictEqual([...new Set(log.map(l => l.action))].sort(), ['hide', 'queue', 'warn']);
  const eh = log.find(l => l.action === 'hide'), eq = log.find(l => l.action === 'queue');
  net.automodUndo('Mia', g.id, eh.id); assert.ok(!net.db().posts.find(p => p.id === hid.id).hidden);
  assert.throws(() => net.automodUndo('Mia', g.id, eh.id), /déjà/);
  net.automodUndo('Mia', g.id, eq.id); assert.ok(!net.db().posts.find(p => p.id === q.id).pending);
  assert.ok(net.groupFeed('Zed', g.id).some(p => p.id === q.id)); assert.ok(net.notifications('Zed').some(n => n.postId === q.id)); // mention livrée à la libération
  // refus d'un post en attente = suppression
  const q2 = net.post('Lou', 'http://spam.example.org', null, [], null, g.id); const e2 = net.automod('Owen', g.id).log.find(l => l.postId === q2.id);
  net.automodReject('Owen', g.id, e2.id); assert.ok(!net.db().posts.some(p => p.id === q2.id));
  // rafale de signalements : 3 signalements -> masqué
  const rr = net.automodSave('Owen', g.id, { name: 'Rafale', type: 'reports', action: 'hide', value: 3 });
  const t = net.post('Zed', 'post controversé', null, [], null, g.id); assert.ok(!t.hidden);
  net.report('Lou', t.id, 'spam'); net.report('Owen', t.id, 'spam'); assert.ok(!net.db().posts.find(p => p.id === t.id).hidden);
  net.report('Mia', t.id, 'spam'); assert.ok(net.db().posts.find(p => p.id === t.id).hidden.auto);
  // suppression de règle ; le journal est conservé ; un non-modérateur ne reçoit pas les règles dans sa vue
  net.automodDelete('Owen', g.id, rr.id); assert.ok(!net.automod('Owen', g.id).rules.some(r => r.id === rr.id)); assert.ok(net.automod('Owen', g.id).log.length >= 4);
  assert.ok(!Social.snapshot(net.db(), 'Zed').groups[0].automod); assert.ok(Social.snapshot(net.db(), 'Mia').groups[0].automod.rules.length);
  console.log('automod OK');
})().catch(e => { console.error(e); process.exit(1); });
