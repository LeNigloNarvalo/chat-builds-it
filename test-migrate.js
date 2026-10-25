// Assistant d'import et d'archivage : CSV/JSON, aperçu avec doublons, import sélectif, archives planifiées, historique, restauration.
const assert = require('assert'), Social = require('./social.js');
let t = 1e12; const mem = {}, net = Social.Net({ getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } }, () => t);
(async () => {
  for (const n of ['Alice', 'Bob', 'Carol']) await net.signup(n, 'secret12');
  net.post('Alice', 'Déjà là');
  // lecture : séparateur détecté, guillemets, en-têtes avec accents, erreurs claires
  const csv = 'Type;Texte;Date;Utilisateur;Liste\npost;"Salut; monde ""cité""";2024-05-01;;\npost;Déjà là;;;\nabonnement;;;@Bob;\nabonnement;;;Zed;\nliste;;;Carol;Amis\nliste;;;Bob;Amis\npost;;;;\n';
  const n = Social.normImport(csv); assert.strictEqual(n.posts[0].text, 'Salut; monde "cité"'); assert.deepStrictEqual(n.lists[0].members, ['Carol', 'Bob']);
  assert.throws(() => Social.normImport('a,b\n1,2'), /En-têtes/); assert.throws(() => Social.normImport('{oups'), /JSON invalide/); assert.throws(() => Social.normImport('  '), /vide/);
  // aperçu : nouveaux / doublons / invalides, sans rien écrire
  const pv = net.previewImport('Alice', csv);
  assert.deepStrictEqual(pv.counts, { new: 3, duplicate: 1, invalid: 2 });
  assert.strictEqual(net.profile('Alice').following.length, 0); assert.strictEqual(net.profile('Alice').lists, undefined);
  // import sélectif : on décoche le post
  const r = await net.applyImport('Alice', csv, pv.items.filter(i => i.status === 'new' && i.kind !== 'post').map(i => i.key), 'amis.csv');
  assert.deepStrictEqual([r.posts, r.follows, r.lists], [0, 1, 1]);
  assert.deepStrictEqual(net.profile('Alice').following, ['Bob']); assert.deepStrictEqual(net.profile('Alice').lists[0].members, ['Carol', 'Bob']);
  // rejouer : tout est doublon, rien à importer
  assert.strictEqual(net.previewImport('Alice', csv).counts.new, 1); // le post daté reste à importer
  assert.strictEqual((await net.applyImport('Alice', csv)).posts, 1);
  assert.strictEqual(net.previewImport('Alice', csv).counts.new, 0); assert.throws(() => net.applyImport('Alice', csv, null), /Rien à importer/);
  // JSON : export Agora ré-importable, tableau de lignes
  const exp = await net.exportUser('Alice'); assert.strictEqual(net.previewImport('Bob', exp).counts.invalid >= 0, true);
  assert.strictEqual(net.previewImport('Alice', JSON.stringify([{ type: 'post', text: 'via json' }, { type: 'follow', user: 'Carol' }])).counts.new, 2);
  // archive : instantané, historique, restauration sélective
  net.post('Alice', 'Second post'); const a = net.archiveCreate('Alice'); assert.strictEqual(a.counts.posts, 3); assert.strictEqual(a.counts.follows, 1);
  assert.strictEqual(net.archivePreview('Alice', a.id).counts.new, 0);
  const full = net.archiveFull('Alice'); assert.strictEqual(full.format, 'agora-archive'); assert.ok(!JSON.stringify(full).includes('"pass"'));
  const alice = () => JSON.parse(mem[Social.KEY]);
  const db = alice(); db.posts = db.posts.filter(p => p.text !== 'Second post'); db.users.alice.following = []; mem[Social.KEY] = JSON.stringify(db); // « perte » de données
  const pr = net.archivePreview('Alice', a.id), miss = pr.items.filter(i => i.status === 'new'); assert.deepStrictEqual(miss.map(i => i.kind).sort(), ['follow', 'post']);
  const rr = net.archiveRestore('Alice', a.id, miss.filter(i => i.kind === 'post').map(i => i.key)); assert.deepStrictEqual([rr.posts, rr.follows], [1, 0]);
  assert.deepStrictEqual(net.profile('Alice').following, []); assert.throws(() => net.archiveRestore('Alice', a.id, []), /Sélectionnez/);
  assert.throws(() => net.archivePreview('Bob', a.id), /introuvable/); assert.throws(() => net.archiveData('Bob', a.id), /introuvable/); // l'archive d'un autre reste privée
  const log = Social.snapshot(JSON.parse(mem[Social.KEY]), 'Alice'); assert.deepStrictEqual(log.archiveLog.map(x => x.type), ['import', 'import', 'manual', 'download', 'restore']);
  assert.strictEqual(log.archives.length, 1); assert.strictEqual(log.archives[0].data, undefined);
  assert.strictEqual(Social.snapshot(JSON.parse(mem[Social.KEY]), 'Bob').archiveLog.length, 0);
  // planification : l'e-mail exige une adresse confirmée ; la tâche crée l'archive due, une seule fois par période
  assert.throws(() => net.setArchiveCfg('Alice', { every: 'weekly', email: true }), /e-mail/); assert.throws(() => net.setArchiveCfg('Alice', { every: 'hourly' }), /Fréquence/);
  net.setArchiveCfg('Alice', { every: 'daily' }); assert.strictEqual(net.archiveJobs('http://x').length, 0);
  let list = Social.snapshot(JSON.parse(mem[Social.KEY]), 'Alice'); assert.ok(list.archiveLog.some(x => x.type === 'auto'));
  const cnt = () => Social.snapshot(JSON.parse(mem[Social.KEY]), 'Alice').archiveLog.filter(x => x.type === 'auto').length;
  net.archiveJobs('http://x'); assert.strictEqual(cnt(), 1); t += 86400000 + 1; net.archiveJobs('http://x'); assert.strictEqual(cnt(), 2);
  for (let i = 0; i < 5; i++) { t += 86400000 + 1; net.archiveJobs('http://x'); } assert.ok(Social.snapshot(JSON.parse(mem[Social.KEY]), 'Alice').archives.length <= 3); // rotation
  // e-mail : archive envoyée à l'adresse confirmée
  const dbm = JSON.parse(mem[Social.KEY]); dbm.users.alice.email = 'alice@example.org'; mem[Social.KEY] = JSON.stringify(dbm);
  net.setArchiveCfg('Alice', { every: 'daily', email: true }); t += 86400000 + 1; const jobs = net.archiveJobs('http://x');
  assert.strictEqual(jobs.length, 1); assert.strictEqual(jobs[0].to, 'alice@example.org'); assert.ok(jobs[0].text.includes('"format":"agora-archive"'));
  net.setArchiveCfg('Alice', { every: 'off' }); t += 9e9; assert.strictEqual(net.archiveJobs('http://x').length, 0);
  net.archiveDelete('Alice', Social.snapshot(JSON.parse(mem[Social.KEY]), 'Alice').archives[0].id);
  console.log('test-migrate: OK');
})().catch(e => { console.error(e); process.exit(1); });
