// Contacts de confiance, récupération sociale (seuil + délai d'alerte) et compte mémorial / suppression avec export remis à l'héritier.
const assert = require('assert'), Social = require('./social.js');
const mem = {}; let t = Date.UTC(2026, 5, 15, 12, 0, 0); const DAY = 86400000, H = 3600000;
const net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } }, () => t);
(async () => {
  for (const n of ['Ana', 'Bob', 'Cleo', 'Dan', 'Eve', 'Fay', 'Gus']) await net.signup(n, 'secret12');
  // désignation : 2 à 5 contacts, invitation à accepter, pas soi-même
  assert.throws(() => net.circleAdd('Ana', 'Ana'), /propre/);
  for (const n of ['Bob', 'Cleo', 'Dan', 'Eve', 'Fay']) net.circleAdd('Ana', n);
  assert.throws(() => net.circleAdd('Ana', 'Gus'), /maximum/);
  assert.throws(() => net.circleAdd('Ana', 'Bob'), /Déjà/);
  net.circleConfig('Ana', { threshold: 2, delayH: 24 });
  assert.throws(() => net.circleConfig('Ana', { threshold: 6 }), /Seuil/); assert.throws(() => net.circleConfig('Ana', { delayH: 0 }), /Délai/);
  await assert.rejects(() => net.circleRecoverStart('Ana'), /impossible/); // aucun contact n'a encore accepté
  assert.ok(net.circleView('Bob').incoming.some(x => x.owner === 'Ana' && x.status === 'pending'));
  for (const n of ['Bob', 'Cleo', 'Dan']) net.circleAnswer(n, 'Ana', true);
  net.circleAnswer('Eve', 'Ana', false); net.circleLeave('Fay', 'Ana');
  assert.deepStrictEqual(net.circleView('Ana').own.contacts.map(c => c.name), ['Bob', 'Cleo', 'Dan']);
  net.circleConfig('Ana', { threshold: 3, delayH: 12 });
  // les contacts d'autrui restent privés
  const snap = Social.snapshot(net.db(), 'Gus'); assert.ok(snap.users.ana.circle === undefined && snap.circleView.asContact.length === 0);
  // récupération : code secret, seuil d'approbations, puis délai d'alerte
  const { id, code } = await net.circleRecoverStart('Ana');
  assert.strictEqual(net.circleView('Ana').mine.length, 1); assert.strictEqual(net.circleView('Bob').asContact[0].owner, 'Ana');
  assert.ok(net.notifications('Ana').some(n => n.type === 'circle' && n.what === 'alert'));
  await assert.rejects(() => net.circleRecoverStatus(id, 'mauvais'), /introuvable/);
  assert.throws(() => net.circleApprove('Gus', id, true), /pas contact/);
  net.circleApprove('Bob', id, true); assert.throws(() => net.circleApprove('Bob', id, true), /déjà/); net.circleApprove('Cleo', id, true);
  await assert.rejects(() => net.circleRecoverFinish(id, code, 'nouveau1'), /manque/);
  net.circleApprove('Dan', id, true);
  let st = await net.circleRecoverStatus(id, code); assert.strictEqual(st.approvals, 3);
  await assert.rejects(() => net.circleRecoverFinish(id, code, 'nouveau1'), /Délai d’alerte/);
  await assert.rejects(() => net.circleRecoverFinish(id, 'faux', 'nouveau1'), /introuvable/);
  assert.ok(net.circleJobs('http://x').length === 0); // pas d'e-mail vérifié : seulement les notifications
  t += 13 * H; const epoch = net.epoch('Ana');
  await net.circleRecoverFinish(id, code, 'nouveau1');
  assert.strictEqual(await net.login('Ana', 'nouveau1'), 'Ana'); assert.ok(net.epoch('Ana') > epoch);
  await assert.rejects(() => net.circleRecoverFinish(id, code, 'autre123'), /expirée|annulée/);
  // le titulaire peut annuler pendant le délai d'alerte
  const r2 = await net.circleRecoverStart('Ana'); for (const n of ['Bob', 'Cleo', 'Dan']) net.circleApprove(n, r2.id, true);
  net.circleCancel('Ana', r2.id); t += DAY; await assert.rejects(() => net.circleRecoverFinish(r2.id, r2.code, 'nouveau2'), /annulée/);
  // refus en nombre : la demande est rejetée ; expiration au bout de 7 jours
  const r3 = await net.circleRecoverStart('Ana'); net.circleApprove('Bob', r3.id, false); assert.strictEqual((await net.circleRecoverStatus(r3.id, r3.code)).status, 'denied');
  const r4 = await net.circleRecoverStart('Ana'); t += 8 * DAY; assert.strictEqual((await net.circleRecoverStatus(r4.id, r4.code)).status, 'expired');
  // héritier : seulement un contact accepté ; durée bornée
  assert.throws(() => net.circleHeir('Ana', { mode: 'memorial', contact: 'Gus', days: 90 }), /accepté/);
  assert.throws(() => net.circleHeir('Ana', { mode: 'memorial', contact: 'Bob', days: 3 }), /jours/);
  assert.throws(() => net.circleHeir('Ana', { mode: 'burn', contact: 'Bob', days: 90 }), /mémorial/);
  net.post('Ana', 'Mon dernier mot'); net.circleHeir('Ana', { mode: 'memorial', contact: 'Bob', days: 90 }); net.touch('Ana');
  assert.deepStrictEqual(net.dueHeirs(), []);
  t += 85 * DAY; assert.strictEqual(net.circleJobs('http://x').length, 0); assert.deepStrictEqual(net.dueHeirs(), []);
  net.touch('Ana'); t += 80 * DAY; assert.deepStrictEqual(net.dueHeirs(), []); // l'activité repousse l'échéance
  t += 11 * DAY; assert.deepStrictEqual(net.dueHeirs(), ['Ana']);
  const res = net.applyHeir('Ana'); assert.deepStrictEqual(res, { name: 'Ana', mode: 'memorial', contact: 'Bob' });
  assert.ok(net.profile('Ana').memorial && Social.snapshot(net.db(), 'Gus').users.ana.memorial);
  await assert.rejects(() => net.login('Ana', 'nouveau1'), /mémorial/); assert.throws(() => net.epoch('Ana'), /mémorial/);
  await assert.rejects(() => net.circleRecoverStart('Ana'), /impossible/);
  const lg = net.circleView('Bob').legacies; assert.strictEqual(lg.length, 1); assert.strictEqual(lg[0].data, undefined);
  const dump = net.legacyDownload('Bob', lg[0].id); assert.ok(dump.posts.some(p => p.text === 'Mon dernier mot') && dump.account === 'Ana');
  assert.throws(() => net.legacyDownload('Gus', lg[0].id), /introuvable/);
  assert.ok(net.notifications('Bob').some(n => n.type === 'circle' && n.what === 'legacy'));
  // suppression : le compte disparaît, l'export reste au contact
  net.circleAdd('Gus', 'Dan'); net.circleAnswer('Dan', 'Gus', true); net.post('Gus', 'Adieu');
  net.circleHeir('Gus', { mode: 'delete', contact: 'Dan', days: 30 }); t += 31 * DAY;
  assert.ok(net.dueHeirs().includes('Gus')); const del = net.applyHeir('Gus'); assert.strictEqual(del.mode, 'delete');
  assert.throws(() => net.profile('Gus'), /introuvable/);
  const ld = net.circleView('Dan').legacies.find(l => l.owner === 'Gus'); assert.ok(ld && net.legacyDownload('Dan', ld.id).posts.some(p => p.text === 'Adieu'));
  // un héritier qui supprime son compte retire l'héritage prévu
  await net.signup('Hal', 'secret12'); net.circleAdd('Hal', 'Cleo'); net.circleAnswer('Cleo', 'Hal', true); net.circleHeir('Hal', { mode: 'memorial', contact: 'Cleo', days: 30 });
  await net.deleteAccount('Cleo', 'secret12'); assert.strictEqual(net.circleView('Hal').own.heir, null);
  console.log('ok test-circle');
})().catch(e => { console.error(e); process.exit(1); });
