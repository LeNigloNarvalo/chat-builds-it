// Comptes supervisés : âge, restrictions des mineurs, lien parent, validations, horaires, mots masqués et résumé.
const assert = require('assert'), Social = require('./social.js');
const mem = {}; let t = Date.UTC(2026, 5, 15, 12, 0, 0);
const net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } }, () => t);
const iso = yrs => `${new Date(t).getUTCFullYear() - yrs}-01-01`;
(async () => {
  await assert.rejects(() => net.signup('Bad', 'secret12', '', '2026-13-40'), /naissance/);
  await assert.rejects(() => net.signup('Fut', 'secret12', '', '2999-01-01'), /naissance/);
  await net.signup('Maman', 'secret12', '', iso(40)); await net.signup('Lea', 'secret12', '', iso(14)); await net.signup('Tom', 'secret12', '', iso(30)); await net.signup('Zoe', 'secret12', '', iso(15)); await net.signup('Old', 'secret12');
  assert.ok(net.isMinor('Lea') && !net.isMinor('Maman') && !net.isMinor('Old') && [13, 14].includes(net.ageOf('Lea')));
  assert.ok(net.isPrivate('Lea') && !net.isPrivate('Maman')); assert.throws(() => net.setPrivateAccount('Lea', false), /mineur/);
  // date de naissance : une seule fois, jamais visible des autres
  assert.throws(() => net.setBirthDate('Lea', iso(30)), /déjà/); net.setBirthDate('Old', iso(50)); assert.throws(() => net.setBirthDate('Old', iso(10)), /déjà/);
  const snap = Social.snapshot(net.db(), 'Tom', t); assert.ok(snap.users.lea.minor && snap.users.lea.birth === undefined && snap.users.lea.sup === undefined);
  // sans parent : messages privés seulement entre abonnements mutuels, pas d'appels
  assert.throws(() => net.send('Tom', 'Lea', 'salut'), /mutuel/); assert.throws(() => net.send('Lea', 'Tom', 'salut'), /mutuel/);
  assert.throws(() => net.logCall('Tom', 'Lea', 'audio', 'ended', 3), /direct/);
  net.toggleFollow('Lea', 'Tom');  // Tom est public : suivi direct
  assert.throws(() => net.send('Tom', 'Lea', 'salut'), /mutuel/); net.toggleFollow('Tom', 'Lea'); net.approveFollower('Lea', 'Tom'); net.send('Tom', 'Lea', 'salut'); assert.strictEqual(net.conversation('Lea', 'Tom').length, 1);
  assert.throws(() => net.createRoom('Lea', 'Club', ['Tom']), /majeurs/);
  // lien parent : demande, acceptation, un seul parent
  assert.throws(() => net.requestParentLink('Lea', 'Zoe'), /majeur/); assert.throws(() => net.requestParentLink('Maman', 'Tom'), /mineur/);
  net.requestParentLink('Maman', 'Lea'); assert.throws(() => net.requestParentLink('Maman', 'Lea'), /déjà/);
  assert.throws(() => net.answerParentLink('Lea', 'Tom', true), /Aucune/); net.answerParentLink('Lea', 'Maman', true);
  assert.strictEqual(net.parentOf('Lea'), 'Maman'); assert.throws(() => net.requestParentLink('Tom', 'Lea'), /parent/);
  assert.throws(() => net.unlinkParent('Lea', 'Lea'), /parent/);
  // avec parent : contact existant non validé → demande, message retenu puis livré à l'acceptation
  assert.throws(() => net.send('Lea', 'Tom', 'coucou'), /parent doit/);
  let kid = net.parentalView('Maman').children[0]; assert.strictEqual(kid.pending.length, 1); assert.strictEqual(kid.pending[0].text, 'coucou');
  assert.ok(net.notifications('Maman').some(n => n.type === 'parental'));
  assert.throws(() => net.parentAnswer('Tom', 'Lea', kid.pending[0].id, true), /supervisez/);
  net.parentAnswer('Maman', 'Lea', kid.pending[0].id, true); assert.ok(net.conversation('Tom', 'Lea').some(m => m.text === 'coucou')); net.send('Lea', 'Tom', 'ok');
  assert.throws(() => net.send('Zoe', 'Lea', 'hello'), /mutuel|parent/); // Zoe : mineure non validée
  net.toggleFollow('Zoe', 'Lea'); // abonnement à un compte privé
  // abonnements du mineur : validés par le parent
  assert.strictEqual(net.toggleFollow('Lea', 'Old'), false); assert.ok(!net.profile('Lea').following.includes('Old'));
  kid = net.parentalView('Maman').children[0]; const f = kid.pending.find(p => p.kind === 'follow'); assert.ok(f);
  net.parentAnswer('Maman', 'Lea', f.id, true); assert.ok(net.profile('Lea').following.includes('Old'));
  net.toggleFollow('Lea', 'Zoe'); net.parentAnswer('Maman', 'Lea', net.parentalView('Maman').children[0].pending.find(p => p.other === 'Zoe').id, false); assert.ok(!net.profile('Lea').following.includes('Zoe'));
  // nouveaux abonnés : seul le parent décide
  await net.signup('Max', 'secret12', '', iso(33)); net.toggleFollow('Max', 'Lea');
  assert.ok(net.parentalView('Maman').children[0].followReq.includes('Max')); assert.throws(() => net.approveFollower('Lea', 'Max'), /parent/);
  net.parentAnswerFollower('Maman', 'Lea', 'Max', true); assert.ok(net.followers('Lea').includes('Max'));
  // horaires : plage qui passe minuit, appliquée à toute action d'écriture
  assert.throws(() => net.setSupervision('Tom', 'Lea', { hours: null }), /supervisez/); assert.throws(() => net.setSupervision('Maman', 'Lea', { hours: { start: '25:00', end: '08:00', tz: 0 } }), /Heure/);
  net.setSupervision('Maman', 'Lea', { hours: { start: '07:00', end: '21:00', tz: 0 } }); assert.ok(net.allowedNow('Lea')); net.post('Lea', 'bonjour');
  t = Date.UTC(2026, 5, 15, 22, 30); assert.ok(!net.allowedNow('Lea')); assert.throws(() => net.post('Lea', 'trop tard'), /horaires/);
  net.setSupervision('Maman', 'Lea', { hours: { start: '20:00', end: '06:00', tz: 0 } }); assert.ok(net.allowedNow('Lea')); // nuit autorisée
  net.setSupervision('Maman', 'Lea', { hours: { start: '07:00', end: '21:00', tz: 120 } }); assert.ok(net.allowedNow('Lea')); // 20:30 locale (UTC−2)
  t = Date.UTC(2026, 5, 15, 12, 0); net.setSupervision('Maman', 'Lea', { hours: null });
  // contenu sensible et mots masqués
  const sp = net.post('Tom', 'images choquantes', null, null, null, null, 'violent'), wp = net.post('Tom', 'parlons de crypto'), ok = net.post('Tom', 'rien de spécial');
  net.setSupervision('Maman', 'Lea', { words: 'Crypto, bourse' });
  const v = Social.snapshot(net.db(), 'Lea', t).posts, g = id => v.find(p => p.id === id);
  assert.strictEqual(g(sp.id).masked, 'sensitive'); assert.strictEqual(g(sp.id).text, ''); assert.strictEqual(g(wp.id).masked, 'word'); assert.strictEqual(g(ok.id).masked, undefined);
  assert.strictEqual(Social.snapshot(net.db(), 'Max', t).posts.find(p => p.id === sp.id).masked, undefined); // adultes : inchangé
  // résumé d'activité : compteurs sans contenu des messages
  const w = net.parentalView('Maman').children[0].week; assert.ok(w.posts >= 1 && w.sent >= 2 && w.contacts.some(c => c.name === 'Tom') && w.days.length === 7);
  assert.deepStrictEqual(Social.snapshot(net.db(), 'Lea', t).users.lea.sup.pending.every(p => p.text === undefined), true);
  // majeur à 18 ans : restrictions levées ; le parent peut délier ; retrait du lien
  t += 5 * 365.25 * 86400000; assert.ok(!net.isMinor('Lea')); net.send('Lea', 'Old', 'libre'); // majeur : mais Old n'est pas un contact validé ; plus aucune restriction
  
  net.unlinkParent('Maman', 'Lea'); assert.strictEqual(net.parentOf('Lea'), null);
  console.log('ok comptes supervisés');
})().catch(e => { console.error(e); process.exit(1); });
