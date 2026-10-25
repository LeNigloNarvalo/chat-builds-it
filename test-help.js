const assert = require('assert');
const H = require('./help.js'), { Net } = require('./social.js');
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
// recherche FAQ : sans accents ni casse, tous les mots requis
assert.strictEqual(H.search('').length, H.FAQ.length);
assert.ok(H.search('MOT DE PASSE oublié').length >= 1 && H.search('zzzzqq').length === 0);
assert.ok(H.search('sombre').some(i => /sombre/i.test(H.FAQ[i][1])));
// palette et thème par appareil
assert.ok(H.filter('theme').some(c => c[0] === 'theme') && H.filter('raccourcis').some(c => c[0] === 'go:help:shortcuts') && H.filter('xyzxyz').length === 0);
assert.deepStrictEqual(['auto', 'dark', 'light'].map(H.nextTheme), ['dark', 'light', 'auto']);
// visite : état par appareil
assert.strictEqual(H.load(mem).tour, ''); H.save(mem, { tour: 'done' }); assert.strictEqual(H.load(mem).tour, 'done'); mem.d[H.KEY] = '{oops'; assert.strictEqual(H.load(mem).tour, '');
// support avec suivi
(async () => {
  const n = Net({ d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } });
  await n.signup('alice', 'pass1'); await n.signup('bob', 'pass2'); await n.ensureStreamer();
  assert.throws(() => n.openTicket('alice', 'bug', 'x', 'trop court'), /Sujet/);
  const tk = n.openTicket('alice', 'bug', 'Image bloquée', 'Mon image ne se charge pas depuis hier');
  assert.strictEqual(tk.status, 'open'); assert.strictEqual(n.tickets('alice').length, 1); assert.strictEqual(n.tickets('bob').length, 0); assert.strictEqual(n.tickets('Streamer').length, 1);
  assert.throws(() => n.replyTicket('bob', tk.id, 'intrus ici'), /introuvable/);
  n.replyTicket('Streamer', tk.id, 'Essayez de recharger la page'); assert.strictEqual(n.tickets('alice')[0].status, 'answered');
  n.replyTicket('alice', tk.id, 'Merci, ça marche'); assert.strictEqual(n.tickets('alice')[0].status, 'open');
  n.closeTicket('alice', tk.id); assert.strictEqual(n.tickets('alice')[0].status, 'closed'); assert.throws(() => n.replyTicket('alice', tk.id, 'encore'), /clôturée/);
  console.log('aide OK');
})().catch(e => { console.error(e); process.exit(1); });
