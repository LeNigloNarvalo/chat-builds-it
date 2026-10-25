// Communautés avancées : règles à accepter, rôles et permissions, adhésion sur demande avec questions, wiki épinglé, journal de l'équipe.
const assert = require('assert'), Social = require('./social.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
(async () => {
  for (const n of ['Owen', 'Mia', 'Zed', 'Lou', 'Ana']) await net.signup(n, 'secret12');
  const g = net.createGroup('Owen', 'Les Cornichons', 'desc', '1. Pas de spoil', true);
  net.updateGroup('Owen', g.id, { approval: true, questions: 'Pourquoi nous rejoindre ?\nTon jeu préféré ?' });

  // règles à accepter, puis demande avec réponses obligatoires
  assert.throws(() => net.joinGroup('Zed', g.id), /règles/);
  assert.throws(() => net.joinGroup('Zed', g.id, { accepted: true }), /question 1/);
  assert.throws(() => net.joinGroup('Zed', g.id, { accepted: true, answers: ['parce que', ''] }), /question 2/);
  assert.strictEqual(net.joinGroup('Zed', g.id, { accepted: true, answers: ['parce que', 'Zelda'] }), 'pending');
  assert.strictEqual(net.groupRole('Zed', g.id), 'pending');
  assert.deepStrictEqual(net.groupAnswers('Owen', g.id, 'Zed'), ['parce que', 'Zelda']);
  assert.throws(() => net.groupAnswers('Zed', g.id, 'Zed'), /modérateurs/);
  assert.throws(() => net.handleRequest('Zed', g.id, 'Zed', true), /modérateurs/);
  net.joinGroup('Lou', g.id, { accepted: true, answers: ['a', 'b'] });
  assert.strictEqual(net.handleRequest('Owen', g.id, 'Zed', true), true); assert.strictEqual(net.groupRole('Zed', g.id), 'member');
  assert.strictEqual(net.handleRequest('Owen', g.id, 'Lou', false), false); assert.strictEqual(net.groupRole('Lou', g.id), null);
  assert.deepStrictEqual(net.groupAnswers('Owen', g.id, 'Lou'), []);
  assert.ok(net.db().notifs.some(n => n.to === 'Lou' && n.what === 'declined'));

  // mode libre : plus de demande, les demandes en attente sont acceptées
  net.joinGroup('Ana', g.id, { accepted: true, answers: ['x', 'y'] });
  net.updateGroup('Owen', g.id, { approval: false }); assert.strictEqual(net.groupRole('Ana', g.id), 'member');
  net.updateGroup('Owen', g.id, { approval: true });
  assert.throws(() => net.updateGroup('Owen', g.id, { questions: '1\n2\n3\n4\n5\n6' }), /5 questions/);

  // rôles et permissions
  net.joinGroup('Mia', g.id, { accepted: true, answers: ['a', 'b'] }); net.handleRequest('Owen', g.id, 'Mia', true); net.setGroupMod('Owen', g.id, 'Mia', true);
  assert.strictEqual(net.groupPerms(g.id).mod.approve, true); assert.strictEqual(net.groupPerms(g.id).member.wiki, false);
  assert.throws(() => net.setGroupPerm('Mia', g.id, 'mod', 'ban', false), /propriétaire/);
  assert.throws(() => net.setGroupPerm('Owen', g.id, 'member', 'ban', true), /inconnue/);
  net.setGroupPerm('Owen', g.id, 'mod', 'ban', false);
  assert.throws(() => net.removeFromGroup('Mia', g.id, 'Zed', true), /bannir/i);
  net.removeFromGroup('Mia', g.id, 'Ana', false); assert.strictEqual(net.groupRole('Ana', g.id), null);
  net.setGroupPerm('Owen', g.id, 'member', 'post', false);
  assert.throws(() => net.post('Zed', 'salut', null, [], null, g.id), /ne peuvent pas publier/);
  net.post('Mia', 'annonce', null, [], null, g.id);
  net.setGroupPerm('Owen', g.id, 'member', 'post', true); net.post('Zed', 'salut', null, [], null, g.id);

  // wiki : permission, épinglage, limites, lecture publique
  assert.throws(() => net.wikiSave('Zed', g.id, { title: 'FAQ', body: 'x' }), /wiki/i);
  const faq = net.wikiSave('Mia', g.id, { title: 'FAQ', body: 'Comment ça marche ?' });
  net.wikiSave('Owen', g.id, { title: 'Guide', body: 'Bienvenue' });
  assert.throws(() => net.wikiSave('Owen', g.id, { title: 'faq', body: 'doublon' }), /déjà/);
  assert.throws(() => net.wikiSave('Owen', g.id, { title: '', body: 'x' }), /Titre/);
  net.wikiPin('Mia', g.id, faq.id, true);
  assert.deepStrictEqual(net.wiki('Lou', g.id).map(p => p.title + (p.pinned ? '*' : '')), ['FAQ*', 'Guide']);
  net.wikiSave('Owen', g.id, { id: faq.id, title: 'FAQ', body: 'Mis à jour' }); assert.strictEqual(net.wiki('Zed', g.id)[0].rev, 2);
  net.setGroupPerm('Owen', g.id, 'member', 'wiki', true); net.wikiSave('Zed', g.id, { title: 'Astuces', body: 'ok' });
  net.wikiDelete('Owen', g.id, net.wiki('Owen', g.id).find(p => p.title === 'Astuces').id);
  const priv = net.createGroup('Owen', 'Secret', '', '', false); net.wikiSave('Owen', priv.id, { title: 'Privé', body: 'x' });
  assert.throws(() => net.wiki('Lou', priv.id), /privée/);

  // journal de l'équipe : réservé aux modérateurs, complet, plus récent d'abord
  assert.throws(() => net.groupLog('Zed', g.id), /modérateurs/);
  const kinds = net.groupLog('Mia', g.id).map(l => l.kind);
  for (const k of ['create', 'approval', 'questions', 'approve', 'decline', 'promote', 'perm', 'remove', 'wiki-new', 'wiki-pin', 'wiki-edit', 'wiki-del']) assert.ok(kinds.includes(k), 'journal : ' + k);
  assert.strictEqual(kinds[0], 'wiki-del');
  const view = Social.snapshot(JSON.parse(mem[Social.KEY]), 'Zed', Date.now()), vg = view.groups.find(x => x.id === g.id);
  assert.deepStrictEqual(vg.log, []); assert.deepStrictEqual(vg.answers, {}); assert.ok(vg.wiki.pages.length >= 2);
  console.log('ok communautés avancées');
})().catch(e => { console.error(e); process.exit(1); });
