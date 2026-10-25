const assert = require('assert');
const I = require('./i18n.js');
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
(async () => {
// les dictionnaires ont exactement les mêmes clés
const keys = l => Object.keys(I.DICT[l]).sort();
for (const l of Object.keys(I.LANGS)) assert.deepStrictEqual(keys(l), keys('fr'), 'clés manquantes en ' + l);
// aucun paramètre {x} perdu en traduction
for (const k of Object.keys(I.DICT.fr)) for (const l of Object.keys(I.LANGS)) assert.deepStrictEqual((I.DICT[l][k].match(/\{\w+\}/g) || []).sort(), (I.DICT.fr[k].match(/\{\w+\}/g) || []).sort(), k + ' / ' + l);
// détection du navigateur et réglage
assert.strictEqual(I.detect(['de-DE', 'en-US']), 'en'); assert.strictEqual(I.detect(['es']), 'es'); assert.strictEqual(I.detect(['ja']), 'fr'); assert.strictEqual(I.detect(undefined), 'fr');
assert.strictEqual(I.load(mem), 'auto'); assert.strictEqual(I.save(mem, 'en'), 'en'); assert.strictEqual(I.load(mem), 'en'); assert.strictEqual(I.save(mem, 'xx'), 'auto');
assert.strictEqual(I.resolve('auto', ['es-MX']), 'es'); assert.strictEqual(I.resolve('fr', ['es-MX']), 'fr');
// textes, pluriels, dates et nombres localisés
I.set('en'); assert.strictEqual(I.t('nav.feed'), '🏠 My feed'); assert.strictEqual(I.t('post.edited', { n: 3 }), 'edited · v3'); assert.strictEqual(I.t('inconnu'), 'inconnu');
assert.strictEqual(I.tn('new', 1), '⬆ 1 new post'); assert.strictEqual(I.tn('new', 1234), '⬆ 1,234 new posts');
I.set('fr'); assert.strictEqual(I.tn('new', 1), '⬆ 1 nouveau post'); assert.strictEqual(I.tn('new', 0), '⬆ 0 nouveau post'); assert.strictEqual(I.tn('new', 2), '⬆ 2 nouveaux posts');
const ms = Date.UTC(2026, 2, 5, 12);
assert.ok(/mars/.test(I.date(ms, { dateStyle: 'long', timeZone: 'UTC' })) && /^1\s234\s567,89$/.test(I.num(1234567.89).replace(/[  ]/g, ' ')));
I.set('en'); assert.ok(/March/.test(I.date(ms, { dateStyle: 'long', timeZone: 'UTC' })) && I.num(1234567.89) === '1,234,567.89');
I.set('es'); assert.ok(/marzo/.test(I.date(ms, { dateStyle: 'long', timeZone: 'UTC' }))); assert.strictEqual(I.ago(Date.now() - 5 * 3600000), '5 h');
// traduction d'un post (glossaire hors-ligne, sans API navigateur)
assert.strictEqual(I.guess('Bonjour le monde, je suis très content'), 'fr'); assert.strictEqual(I.guess('the world is very good'), 'en');
let r = await I.translate('Bonjour le monde #live', 'en'); assert.strictEqual(r.text, 'Hello the world #live'); assert.ok(r.approx && r.from === 'fr');
r = await I.translate('Hello my friends', 'es'); assert.strictEqual(r.text, 'Hola my amigos');
assert.ok((await I.translate('Le café', 'fr')).same);
await assert.rejects(() => I.translate('zzz qqq', 'en', 'fr'));
console.log('i18n OK');
})().catch(e => { console.error(e); process.exit(1); });
