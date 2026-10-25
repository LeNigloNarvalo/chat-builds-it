// Messagerie enrichie : réponses, réactions, modification, suppression, recherche, lecture horodatée (1-à-1 et groupes).
const assert = require('assert'), Social = require('./social.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
(async () => {
  for (const n of ['Alice', 'Bob', 'Carol']) await net.signup(n, 'secret12');
  await net.send('Alice', 'Bob', 'Salut Bob, café ?');
  const m1 = net.conversation('Alice', 'Bob')[0];
  await net.send('Bob', 'Alice', 'Oui, à 15h', [], m1.id);
  const m2 = net.conversation('Alice', 'Bob')[1];
  assert.strictEqual(m2.replyTo, m1.id);
  assert.throws(() => net.send('Bob', 'Alice', 'x', [], 99999), /introuvable/);
  assert.throws(() => net.send('Carol', 'Alice', 'x', [], m1.id), /introuvable/); // pas dans leur échange
  // réactions : bascule, refus d'emoji inconnu, étranger exclu
  await net.reactMessage('Alice', null, m2.id, '👍'); await net.reactMessage('Bob', null, m2.id, '👍');
  assert.deepStrictEqual(net.conversation('Alice', 'Bob')[1].reactions, { '👍': ['Alice', 'Bob'] });
  await net.reactMessage('Alice', null, m2.id, '👍'); assert.deepStrictEqual(net.conversation('Alice', 'Bob')[1].reactions, { '👍': ['Bob'] });
  assert.throws(() => net.reactMessage('Alice', null, m2.id, '💩'), /inconnue/);
  assert.throws(() => net.reactMessage('Carol', null, m2.id, '👍'), /introuvable/);
  // accusés de lecture horodatés
  assert.strictEqual(net.peerReadAt('Bob', 'Alice'), 0);
  net.markDmRead('Alice', 'Bob'); net.markDmRead('Bob', 'Alice');
  assert.ok(net.peerReadAt('Bob', 'Alice') > 0 && net.peerRead('Bob', 'Alice') >= m1.id);
  // modification / suppression : auteur seulement
  assert.throws(() => net.editMessage('Alice', null, m2.id, 'hack'), /vos messages/);
  await net.editMessage('Bob', null, m2.id, 'Oui, à 16h');
  const e = net.conversation('Alice', 'Bob')[1]; assert.strictEqual(e.text, 'Oui, à 16h'); assert.ok(e.editedAt);
  // recherche (sans accents ni casse)
  assert.strictEqual(net.searchMessages('Alice', 'Bob', 'CAFE').length, 1);
  assert.strictEqual(net.searchMessages('Alice', 'Bob', '16h')[0].id, m2.id);
  assert.throws(() => net.deleteMessage('Alice', null, m2.id), /vos messages/);
  await net.deleteMessage('Bob', null, m2.id);
  const d = net.conversation('Alice', 'Bob')[1]; assert.ok(d.deleted && d.text === '' && !d.reactions && d.replyTo === m1.id);
  assert.strictEqual(net.searchMessages('Alice', 'Bob', '16h').length, 0);
  assert.throws(() => net.reactMessage('Alice', null, m2.id, '🔥'), /réaction/);
  // groupe
  const rid = await net.createRoom('Alice', 'Trio', ['Bob', 'Carol']);
  await net.sendRoom('Alice', rid, 'Réunion demain');
  const g1 = net.roomMessages('Alice', rid)[0];
  await net.sendRoom('Bob', rid, 'Ok pour moi', [], g1.id);
  assert.strictEqual(net.roomMessages('Carol', rid)[1].replyTo, g1.id);
  await net.reactMessage('Carol', rid, g1.id, '🎉'); assert.deepStrictEqual(net.roomMessages('Alice', rid)[0].reactions, { '🎉': ['Carol'] });
  assert.strictEqual(net.unreadDm('Carol').rooms[rid], 2);
  net.markRoomRead('Carol', rid); assert.ok(net.room('Carol', rid).readAt.carol > 0); assert.strictEqual(net.unreadDm('Carol').rooms[rid], undefined);
  await net.editMessage('Alice', rid, g1.id, 'Réunion demain à 9h');
  assert.strictEqual(net.searchMessages('Bob', '#' + rid, 'reunion')[0].text, 'Réunion demain à 9h');
  await net.deleteMessage('Alice', rid, g1.id); assert.ok(net.roomMessages('Bob', rid)[0].deleted);
  // blocage : plus de réaction
  await net.toggleBlock('Bob', 'Alice');
  assert.throws(() => net.reactMessage('Alice', null, m1.id, '👍'), /bloqué/);
  console.log('test-msgs OK');
})().catch(e => { console.error(e); process.exit(1); });
