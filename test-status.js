// Annonces de l'équipe, page de statut, incidents et mode maintenance (lecture seule pour les membres).
const assert = require('assert'), Social = require('./social.js');
const mem = {}; let t = 1e12;
const net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } }, () => t);
(async () => {
  await net.signup('Mia', 'secret12'); const boss = await net.ensureStreamer();
  assert.deepStrictEqual(net.statusBoard().components, { feed: 'ok', dm: 'ok', media: 'ok', login: 'ok', api: 'ok' });
  // réservé à l'équipe
  assert.throws(() => net.announce('Mia', { title: 'Salut', level: 'info' }), /équipe/);
  assert.throws(() => net.setMaintenance('Mia', { on: true }), /équipe/);
  assert.throws(() => net.reportIncident('Mia', { title: 'x y z', component: 'feed', impact: 'outage' }), /équipe/);
  // annonces : validation, épinglage, expiration, masquage individuel
  assert.throws(() => net.announce(boss, { title: 'ab', level: 'info' }), /Titre/);
  assert.throws(() => net.announce(boss, { title: 'Bienvenue', level: 'rose' }), /Niveau/);
  const a1 = net.announce(boss, { title: 'Nouveau thème', text: 'Allez voir !', level: 'success', hours: 1 });
  const a2 = net.announce(boss, { title: 'Règles mises à jour', level: 'warning', pinned: true });
  const a3 = net.announce(boss, { title: 'Alerte sécurité', level: 'critical' });
  assert.strictEqual(net.statusBoard().announcements[0].id, a2.id); // épinglée d'abord
  net.dismissAnnouncement('Mia', a1.id); assert.ok(Social.snapshot(net.db(), 'Mia').users.mia.annSeen.includes(a1.id));
  assert.ok(!('annSeen' in Social.snapshot(net.db(), 'Mia').users.streamer)); // les masquages des autres restent privés
  assert.throws(() => net.dismissAnnouncement('Mia', a3.id), /urgente/);
  t += 2 * 3600000; assert.ok(!net.statusBoard().announcements.some(a => a.id === a1.id)); // expirée
  net.deleteAnnouncement(boss, a2.id); assert.ok(!net.statusBoard().announcements.some(a => a.id === a2.id));
  // incidents : composants dégradés, mises à jour, résolution
  const inc = net.reportIncident(boss, { title: 'Messages lents', component: 'dm', impact: 'degraded', text: 'On regarde.' });
  net.reportIncident(boss, { title: 'Médias HS', component: 'media', impact: 'outage' });
  assert.strictEqual(net.statusBoard().components.dm, 'degraded'); assert.strictEqual(net.statusBoard().components.media, 'outage'); assert.strictEqual(net.statusBoard().components.feed, 'ok');
  assert.ok(Social.snapshot(net.db(), 'Mia').status.incidents.length === 2);
  net.updateIncident(boss, inc.id, 'resolved', 'Corrigé.');
  assert.strictEqual(net.statusBoard().components.dm, 'ok'); assert.throws(() => net.updateIncident(boss, inc.id, 'monitoring'), /résolu/);
  // maintenance : lecture seule pour les membres, équipe exemptée, fin automatique
  const p0 = net.post('Mia', 'avant');
  net.setMaintenance(boss, { on: true, message: 'Migration', minutes: 30 });
  assert.ok(net.statusBoard().maintenance && Object.values(net.statusBoard().components).includes('maintenance'));
  assert.throws(() => net.post('Mia', 'pendant'), /Maintenance en cours.*Migration/);
  assert.throws(() => net.toggleLike('Mia', p0.id), /lecture seule/);
  assert.ok(net.post(boss, 'annonce de la team')); assert.ok(net.feed('Mia').length >= 1); // lecture et équipe : OK
  assert.ok(net.openTicket('Mia', 'question', 'Quand ça revient ?', 'Pouvez-vous me dire quand ?')); // le support reste ouvert
  t += 31 * 60000; assert.strictEqual(net.statusBoard().maintenance, null); assert.ok(net.post('Mia', 'après'));
  net.setMaintenance(boss, { on: true }); assert.throws(() => net.post('Mia', 'x'), /lecture seule/);
  net.setMaintenance(boss, { on: false }); assert.ok(net.post('Mia', 'rétabli'));
  assert.ok(net.db().audit.some(e => e.type === 'maintenance-on') && net.db().audit.some(e => e.type === 'maintenance-off'));
  console.log('test-status ok');
})().catch(e => { console.error(e); process.exit(1); });
