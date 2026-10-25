// Comptes privés : demandes d'abonnement, approbation/refus, retrait/blocage d'abonnés, posts réservés aux abonnés validés.
const assert = require('assert'), Social = require('./social.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
const seesPost = (viewer, id) => Social.snapshot(net.db(), viewer).posts.some(p => p.id === id);
(async () => {
  for (const n of ['Alice', 'Bob', 'Carol', 'Dave']) await net.signup(n, 'secret12');
  net.toggleFollow('Bob', 'Alice'); // abonné avant le passage en privé : conservé
  net.setPrivateAccount('Alice', true);
  assert.ok(net.isPrivate('Alice'));
  const p = net.post('Alice', 'secret de cornichon');
  assert.ok(seesPost('Alice', p.id) && seesPost('Bob', p.id) && !seesPost('Carol', p.id));
  assert.ok(Social.snapshot(net.db(), 'Carol').users.alice.lockedPosts);
  assert.ok(!net.explore('Carol').some(x => x.id === p.id) && net.explore('Bob').some(x => x.id === p.id));
  // demande, annulation, nouvelle demande
  assert.strictEqual(net.toggleFollow('Carol', 'Alice'), false);
  assert.ok(net.hasRequested('Carol', 'Alice') && !net.followers('Alice').includes('Carol'));
  net.toggleFollow('Carol', 'Alice'); assert.ok(!net.hasRequested('Carol', 'Alice'));
  net.toggleFollow('Carol', 'Alice'); net.toggleFollow('Dave', 'Alice');
  assert.deepStrictEqual(net.followRequests('Alice').sort(), ['Carol', 'Dave']);
  assert.deepStrictEqual(Social.snapshot(net.db(), 'Carol').users.alice.followReq, ['Carol']); // les demandes des autres restent privées
  assert.throws(() => net.approveFollower('Bob', 'Carol'), /Aucune demande/);
  net.approveFollower('Alice', 'Carol');
  assert.ok(net.followers('Alice').includes('Carol') && seesPost('Carol', p.id));
  net.declineFollower('Alice', 'Dave'); assert.ok(!net.followers('Alice').includes('Dave') && !seesPost('Dave', p.id));
  // retrait puis blocage en un clic
  net.removeFollower('Alice', 'Carol', false); assert.ok(!seesPost('Carol', p.id));
  net.toggleFollow('Carol', 'Alice'); net.approveFollower('Alice', 'Carol');
  net.removeFollower('Alice', 'Bob', true);
  assert.ok(net.isBlocked('Alice', 'Bob') && !seesPost('Bob', p.id));
  assert.throws(() => net.toggleFollow('Bob', 'Alice'), /bloqué/);
  // repasser en public accepte les demandes en attente
  net.toggleFollow('Dave', 'Alice'); net.setPrivateAccount('Alice', false);
  assert.ok(net.followers('Alice').includes('Dave') && !net.isPrivate('Alice') && seesPost('Bob', p.id) === true);
  console.log('test-private ok');
})().catch(e => { console.error(e); process.exit(1); });
