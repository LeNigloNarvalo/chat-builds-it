// Feuille de route : nouveautés datées, idées, votes, commentaires, statuts, suivi et notification de livraison.
const assert = require('assert'), Social = require('./social.js');
const mem = {}; let t = 1e12;
const net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } }, () => t);
(async () => {
  await net.signup('Mia', 'secret12'); await net.signup('Leo', 'secret12'); const boss = await net.ensureStreamer();
  assert.deepStrictEqual(net.roadmapBoard(), { updates: [], ideas: [] });
  // nouveautés : équipe seulement, validées, pastille « nouveau » jusqu'à la visite
  assert.throws(() => net.publishUpdate('Mia', { title: 'Hello', tag: 'new' }), /équipe/);
  assert.throws(() => net.publishUpdate(boss, { title: 'ab', tag: 'new' }), /Titre/);
  assert.throws(() => net.publishUpdate(boss, { title: 'Dark mode', tag: 'zzz' }), /Catégorie/);
  assert.strictEqual(net.roadmapNew('Mia'), false);
  t += 1000; const u1 = net.publishUpdate(boss, { title: 'Thème sombre', text: 'Disponible', tag: 'new' });
  assert.strictEqual(net.roadmapNew('Mia'), true); assert.strictEqual(net.roadmapNew(boss), false);
  t += 1000; net.markRoadmapSeen('Mia'); assert.strictEqual(net.roadmapNew('Mia'), false);
  t += 1000; const u2 = net.publishUpdate(boss, { title: 'Correctif DM', tag: 'fixed' });
  assert.strictEqual(net.roadmapNew('Mia'), true); assert.strictEqual(net.roadmapBoard().updates[0].id, u2.id); // plus récent d'abord
  // idées : proposition, doublon, votes, suivi, commentaires
  assert.throws(() => net.proposeIdea('Mia', { title: 'x' }), /Titre/);
  const i1 = net.proposeIdea('Mia', { title: 'Mode hors-ligne', text: 'Lire sans réseau' });
  assert.strictEqual(i1.status, 'considered'); assert.deepStrictEqual(i1.votes, ['Mia']); assert.deepStrictEqual(i1.followers, ['Mia']);
  assert.throws(() => net.proposeIdea('Leo', { title: 'mode HORS-ligne' }), /existe déjà/);
  assert.strictEqual(net.voteIdea('Leo', i1.id), true); assert.strictEqual(net.roadmapBoard().ideas[0].votes.length, 2);
  assert.strictEqual(net.voteIdea('Leo', i1.id), false); assert.strictEqual(net.roadmapBoard().ideas[0].votes.length, 1);
  net.voteIdea('Leo', i1.id); net.followIdea('Leo', i1.id);
  assert.throws(() => net.commentIdea('Leo', i1.id, '   '), /Commentaire/);
  const c = net.commentIdea('Leo', i1.id, 'Super idée'); assert.strictEqual(net.roadmapBoard().ideas[0].comments.length, 1);
  assert.throws(() => net.deleteIdeaComment('Mia', i1.id, c.id), /autre membre/);
  // statut : équipe seulement ; « livré » prévient tous les suiveurs (pas les autres)
  assert.throws(() => net.setIdeaStatus('Mia', i1.id, 'delivered'), /équipe/);
  assert.throws(() => net.setIdeaStatus(boss, i1.id, 'zzz'), /Statut/);
  net.setIdeaStatus(boss, i1.id, 'progress'); assert.ok(!net.notifications('Mia').some(n => n.type === 'roadmap'));
  const i2 = net.proposeIdea('Leo', { title: 'Raccourcis clavier' });
  net.setIdeaStatus(boss, i1.id, 'delivered');
  for (const who of ['Mia', 'Leo']) { const n = net.notifications(who).filter(n => n.type === 'roadmap'); assert.strictEqual(n.length, 1); assert.strictEqual(n[0].idea, i1.id); assert.strictEqual(n[0].title, 'Mode hors-ligne'); }
  net.followIdea('Leo', i1.id); // plus de suivi → pas de nouvelle notification si re-livrée
  assert.throws(() => net.voteIdea('Mia', i1.id), /livrée/);
  // suppression : auteur seulement tant qu'il n'y a pas d'autres votes
  assert.throws(() => net.deleteIdea('Mia', i2.id), /Seule/);
  net.deleteIdea("Leo", i2.id); assert.strictEqual(net.roadmapBoard().ideas.length, 1);
  // vue d'un compte : roadmap exposée, mais pas la date de visite des autres
  const snap = Social.snapshot(net.db(), 'Mia'); assert.strictEqual(snap.roadmap.ideas.length, 1); assert.ok(snap.users.mia.roadSeen); assert.ok(!('roadSeen' in snap.users.leo));
  // maintenance : lecture seule
  net.setMaintenance(boss, { on: true }); assert.throws(() => net.proposeIdea('Mia', { title: 'Pendant la maintenance' }), /lecture seule/);
  assert.ok(net.proposeIdea(boss, { title: 'Équipe exemptée' }));
  net.deleteUpdate(boss, u1.id); assert.strictEqual(net.roadmapBoard().updates.length, 1);
  console.log('test-roadmap ok');
})().catch(e => { console.error(e); process.exit(1); });
