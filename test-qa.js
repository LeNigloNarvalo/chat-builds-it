// Questions-réponses : boîte ouverte/fermée, anonymat protégé, blocage, quotas, réponse publique liée, rejet.
const assert = require('assert'), Social = require('./social.js');
const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
(async () => {
  for (const n of ['Alice', 'Bob', 'Carol']) await net.signup(n, 'secret12');
  assert.throws(() => net.ask('Bob', 'Alice', 'Salut ?', false), /pas ouvert/);
  net.setQuestionBox('Alice', true, false);
  assert.throws(() => net.ask('Bob', 'Alice', 'Anonyme ?', true), /anonymes/);
  assert.throws(() => net.ask('Alice', 'Alice', 'moi ?', false), /vous-même/);
  assert.throws(() => net.ask('Bob', 'Alice', '   ', false), /vide/);
  net.setQuestionBox('Alice', true, true);
  net.ask('Bob', 'Alice', 'Ton plat préféré ?', true); net.ask('Carol', 'Alice', 'Tu dors quand ?', false);
  const inbox = net.questions('Alice', 'open');
  assert.strictEqual(inbox.length, 2);
  assert.strictEqual(inbox.find(q => q.text.startsWith('Ton')).from, null); // anonyme : jamais révélé au propriétaire
  assert.strictEqual(inbox.find(q => q.text.startsWith('Tu')).from, 'Carol');
  assert.ok(!JSON.stringify(Social.snapshot(net.db(), 'Alice').questions).includes('Bob'));
  assert.ok(!JSON.stringify(Social.snapshot(net.db(), 'Carol').questions).includes('Ton plat'));
  assert.throws(() => net.ask('Bob', 'Alice', 'Ton plat préféré ?', true), /déjà en attente/);
  net.ask('Bob', 'Alice', 'q2', true); net.ask('Bob', 'Alice', 'q3', true);
  assert.throws(() => net.ask('Bob', 'Alice', 'q4', true), /3 questions/);
  // réponse publique : post lié, auteur masqué si anonyme
  const q = inbox.find(x => x.text.startsWith('Ton'));
  assert.throws(() => net.answerQuestion('Bob', q.id, 'non'), /introuvable/);
  const p = net.answerQuestion('Alice', q.id, 'Les cornichons.');
  assert.deepStrictEqual(p.question, { id: q.id, text: 'Ton plat préféré ?', from: null });
  assert.strictEqual(net.sentQuestions('Bob').find(x => x.id === q.id).postId, p.id);
  assert.throws(() => net.answerQuestion('Alice', q.id, 'bis'), /déjà traitée/);
  // rejet + blocage de l'expéditeur anonyme sans fuite d'identité
  const open = net.questions('Alice', 'open'), qb = open.find(x => x.anon);
  net.rejectQuestion('Alice', qb.id, true);
  assert.ok(net.isBlocked('Alice', 'Bob'));
  assert.strictEqual(net.questions('Alice', 'open').filter(x => x.anon).length, 0);
  assert.throws(() => net.ask('Bob', 'Alice', 'encore ?', true), /Impossible d’envoyer/);
  // retrait par l'expéditeur
  const c = net.questions('Alice', 'open')[0]; net.withdrawQuestion('Carol', c.id); assert.strictEqual(net.questions('Alice', 'open').length, 0);
  console.log('test-qa ok');
})().catch(e => { console.error(e); process.exit(1); });
