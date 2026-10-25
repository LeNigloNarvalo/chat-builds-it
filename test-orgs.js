// Pages d'organisation : création, équipe, brouillons partagés, file de validation, journal, transfert de propriété.
const assert = require('assert'), Social = require('./social.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
(async () => {
  for (const n of ['Alice', 'Bob', 'Carol', 'Dave']) await net.signup(n, 'secret12');
  assert.throws(() => net.createOrg('Alice', { handle: 'ab', title: 'X', kind: 'brand' }), /Identifiant/);
  assert.throws(() => net.createOrg('Alice', { handle: 'Bob', title: 'X', kind: 'brand' }), /déjà pris/); // distinct d'un profil perso
  const g = net.createOrg('Alice', { handle: 'cornichons', title: 'Les Cornichons', kind: 'media', bio: 'Journal' });
  assert.throws(() => net.createOrg('Bob', { handle: 'CORNICHONS', title: 'Y', kind: 'asso' }), /déjà pris/);
  // équipe : invitation à accepter, rôles
  assert.throws(() => net.inviteToOrg('Bob', g.id, 'Carol', 'editor'), /propriétaire/);
  net.inviteToOrg('Alice', g.id, 'Bob', 'editor'); net.inviteToOrg('Alice', g.id, 'Carol', 'reviewer');
  assert.strictEqual(net.orgInvites('Bob').length, 1); assert.strictEqual(net.orgRole('Bob', g.id), null);
  net.respondOrgInvite('Bob', g.id, true); net.respondOrgInvite('Carol', g.id, true);
  assert.strictEqual(net.orgRole('Bob', g.id), 'editor'); assert.strictEqual(net.orgRole('Carol', g.id), 'reviewer');
  // brouillon partagé : visible et modifiable par l'équipe, invisible des tiers
  const d = net.saveOrgDraft('Bob', g.id, null, 'Premier jet');
  net.saveOrgDraft('Carol', g.id, d.id, 'Premier jet corrigé');
  assert.deepStrictEqual(net.orgPosts('Alice', g.id, 'draft').map(p => p.text), ['Premier jet corrigé']);
  assert.strictEqual(net.orgPosts('Dave', g.id).length, 0);
  assert.throws(() => net.saveOrgDraft('Dave', g.id, null, 'intrus'), /équipe/);
  assert.throws(() => net.orgLog('Dave', g.id), /équipe/);
  // validation : le rédacteur soumet, ne peut pas publier ni valider ; le relecteur valide
  net.submitOrgPost('Bob', g.id, d.id);
  assert.strictEqual(net.orgPosts('Bob', g.id, 'pending').length, 1); assert.strictEqual(net.orgPosts('Dave', g.id, 'published').length, 0);
  assert.throws(() => net.decideOrgPost('Bob', g.id, d.id, true), /relecteurs/);
  assert.throws(() => net.decideOrgPost('Carol', g.id, d.id, false, ''), /motif/);
  net.decideOrgPost('Carol', g.id, d.id, false, 'Titre à revoir');
  assert.ok(net.orgPosts('Bob', g.id, 'draft')[0].note.includes('Titre à revoir'));
  net.submitOrgPost('Bob', g.id, d.id); net.decideOrgPost('Carol', g.id, d.id, true);
  const pubd = net.orgPosts('Dave', g.id); assert.strictEqual(pubd.length, 1); assert.strictEqual(pubd[0].publishedBy, 'Carol'); // visible de tous
  // pas d'auto-validation d'un relecteur
  const d2 = net.saveOrgDraft('Carol', g.id, null, 'Texte de Carol'); net.saveOrgDraft('Bob', g.id, null, 'x');
  net.submitOrgPost('Carol', g.id, d2.id); assert.strictEqual(net.orgPosts('Carol', g.id, 'published').length, 2); // un relecteur publie directement
  // journal des auteurs
  const log = net.orgLog('Alice', g.id).map(l => l.action);
  for (const a of ['create', 'invite', 'join', 'draft', 'edit', 'submit', 'reject', 'publish']) assert.ok(log.includes(a), a);
  // snapshot : un tiers ne reçoit ni journal ni brouillons
  const snap = Social.snapshot(net.db(), 'Dave');
  assert.strictEqual(snap.orgs[0].log.length, 0); assert.ok(snap.orgPosts.every(p => p.status === 'published'));
  assert.ok(Social.snapshot(net.db(), 'Bob').orgs[0].log.length > 0);
  // transfert de propriété en deux temps
  assert.throws(() => net.proposeOrgTransfer('Alice', g.id, 'Dave'), /faire partie/);
  net.proposeOrgTransfer('Alice', g.id, 'Carol');
  assert.throws(() => net.respondOrgTransfer('Bob', g.id, true), /Aucun transfert/);
  net.respondOrgTransfer('Carol', g.id, true);
  assert.strictEqual(net.orgRole('Carol', g.id), 'owner'); assert.strictEqual(net.orgRole('Alice', g.id), 'reviewer');
  assert.throws(() => net.updateOrg('Alice', g.id, { title: 'Z' }), /propriétaire/);
  assert.throws(() => net.removeFromOrg('Carol', g.id, 'Carol'), /transférer/);
  net.removeFromOrg('Bob', g.id, 'Bob'); assert.strictEqual(net.orgRole('Bob', g.id), null);
  net.deleteOrg('Carol', g.id); assert.strictEqual(net.orgs().length, 0);
  console.log('test-orgs ok');
})().catch(e => { console.error(e); process.exit(1); });
