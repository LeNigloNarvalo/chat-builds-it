const assert = require('assert');
const Q = require('./quality.js'), Social = require('./social.js'), Stats = require('./stats.js'), I18n = require('./i18n.js'), States = require('./states.js');
I18n.set('fr');
const mk = () => { const d = {}; return { d, getItem: k => k in d ? d[k] : null, setItem: (k, v) => { d[k] = v; }, removeItem: k => { delete d[k]; } }; };
(async () => {
  // journal : regroupement, plafond, relecture du stockage partagé
  const m = mk(); Q.record(m, 'a', new Error('x'), 1); Q.record(m, 'a', new Error('x'), 2); Q.record(m, 'b', 'y', 3);
  assert.deepStrictEqual(Q.errors(m).map(e => [e.where, e.count]), [['b', 1], ['a', 2]]);
  for (let i = 0; i < 80; i++) Q.record(m, 'w' + i, 'm', 10 + i); assert.strictEqual(Q.errors(m).length, 50);
  m.d[Q.ERR_KEY] = 'pas du json'; assert.deepStrictEqual(Q.errors(m), []); Q.record(m, 'z', 'ok'); assert.strictEqual(Q.errors(m).length, 1);
  Q.clearErrors(m); assert.strictEqual(Q.errors(m).length, 0);
  // note et appréciation
  assert.strictEqual(Q.score({ tests: [{ ok: true }, { ok: true }], health: [] }, [], 1), 100);
  assert.strictEqual(Q.score({ tests: [{ ok: true }, { ok: false }], health: [] }, [], 1), 50);
  assert.strictEqual(Q.score({ tests: [{ ok: true }], health: [] }, [{ at: 1 }, { at: 1 }], 2), 94);
  assert.strictEqual(Q.grade(95).label, 'Excellent'); assert.strictEqual(Q.grade(40).icon, '🔴');
  // la suite automatisée complète passe, sans toucher au stockage de l'appelant
  const store = mk(), ctx = { store, get: async p => p.startsWith('/api/health') ? { ok: true, db: true, backups: 'ok', uptime: 5 } : { state: { users: { a: 1 } }, version: 3 }, me: () => 'alice', connected: () => true };
  const res = await Q.run(ctx, { Social, Stats, I18n, States });
  assert.deepStrictEqual(res.tests.filter(x => !x.ok), []); assert.deepStrictEqual(res.health.filter(x => !x.ok), []);
  assert.ok(res.tests.length >= 10 && res.score === 100);
  assert.deepStrictEqual(Object.keys(store.d), []);
  // un échec est détecté et signalé
  const bad = await Q.run(Object.assign({}, ctx, { connected: () => false, get: async () => { throw new Error('hors-ligne'); } }), { Social, Stats, I18n, States });
  assert.ok(bad.health.filter(x => !x.ok).length >= 5 && bad.score < 75);
  // historique et rapport
  Q.saveRun(store, bad, 5); assert.strictEqual(Q.runs(store)[0].unhealthy, bad.health.filter(x => !x.ok).length);
  const rep = Q.report(bad, [{ at: 0, where: 'w', message: 'm', count: 2 }], [{ at: 0, where: 's', message: 'n' }], 0);
  assert.ok(/ÉCHEC/.test(rep) && /×2 \[w\] m/.test(rep) && /serveur \(1\)/.test(rep));
  console.log('qualité OK');
})().catch(e => { console.error(e); process.exit(1); });
