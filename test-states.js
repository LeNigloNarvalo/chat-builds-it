const assert = require('assert');
const S = require('./states.js'), I = require('./i18n.js');
I.set('fr');
assert.strictEqual(S.kind(new Error('Serveur injoignable : réessayez dans un instant')), 'network');
assert.strictEqual(S.kind('Erreur interne du serveur : réessayez'), 'server');
assert.strictEqual(S.kind('Route inconnue'), 'notfound'); assert.strictEqual(S.kind('Pseudo pris'), 'other');
assert.ok(/data-retry/.test(S.error('Serveur injoignable')) && /role="alert"/.test(S.error('x')));
assert.ok(!/data-retry/.test(S.error('x', { retry: false })) && /<script/.test(S.error('<script>')) === false);
assert.ok(/404/.test(S.notFound()) && /data-page="feed"/.test(S.notFound()) && /500/.test(S.serverError()) && /data-retry/.test(S.serverError()));
assert.ok(/aria-busy/.test(S.loading()) && /role="status"/.test(S.empty('🫙', 'Vide')));
assert.ok(/<title>404/.test(S.page(404)) && /Réessayer/.test(S.page(500)));
// la saisie est conservée (hors mots de passe) puis restaurée après un nouveau rendu
const mk = (type, id, value, checked) => ({ type, id, value, checked });
const f = [mk('text', 'a', 'bonjour'), mk('password', 'pw', 'secret'), mk('checkbox', 'c', 'on', true)];
const snap = S.snapshot({ querySelectorAll: () => f });
assert.deepStrictEqual(snap, [['a', 'bonjour'], ['c', true]]);
const fresh = { a: mk('text', 'a', ''), c: mk('checkbox', 'c', 'on', false) };
S.restore({ getElementById: id => fresh[id] }, snap); assert.strictEqual(fresh.a.value, 'bonjour'); assert.strictEqual(fresh.c.checked, true);
console.log('états OK');
