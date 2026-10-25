// Panneau de qualité : tests automatisés (exécutés dans le navigateur sur un stockage isolé), santé du site et rapport d'erreurs.
// Les erreurs du navigateur sont journalisées dans une clé partagée (lecture-modification-écriture) ; les tests n'écrivent jamais dans les vraies données.
(function (root) {
  const ERR_KEY = 'app.quality.errors', RUN_KEY = 'app.quality.runs', MAX_ERR = 50, MAX_RUNS = 10, SLOW_MS = 800;
  const read = (st, k) => { try { const a = JSON.parse(st.getItem(k)); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const write = (st, k, a) => { try { st.setItem(k, JSON.stringify(a)); } catch (e) {} };
  const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').slice(0, n);

  // journal d'erreurs : relit toujours depuis le stockage avant d'écrire ; les doublons consécutifs sont regroupés
  function record(st, where, e, now) {
    const msg = clean((e && e.message) || e, 300), w = clean(where, 80), at = now || Date.now(), a = read(st, ERR_KEY), top = a[0];
    if (top && top.where === w && top.message === msg) { top.count = (top.count || 1) + 1; top.at = at; } else a.unshift({ at, where: w, message: msg, count: 1 });
    write(st, ERR_KEY, a.slice(0, MAX_ERR)); return a[0];
  }
  const errors = st => read(st, ERR_KEY);
  const clearErrors = st => write(st, ERR_KEY, []);
  const runs = st => read(st, RUN_KEY);
  function saveRun(st, res, now) {
    const a = runs(st); a.unshift({ at: now || Date.now(), tests: res.tests.length, failed: res.tests.filter(x => !x.ok).length, health: res.health.length, unhealthy: res.health.filter(x => !x.ok).length });
    write(st, RUN_KEY, a.slice(0, MAX_RUNS)); return a[0];
  }

  // note de santé sur 100 : chaque test ou sonde en échec coûte sa part, chaque erreur récente enlève un peu
  function score(res, errs, now) {
    now = now || Date.now(); const all = res.tests.concat(res.health); if (!all.length) return 0;
    const fails = all.filter(x => !x.ok).length, recent = (errs || []).filter(e => now - e.at < 86400000).length;
    return Math.max(0, Math.round(100 * (1 - fails / all.length) - Math.min(30, recent * 3)));
  }
  const grade = s => s >= 90 ? { label: 'Excellent', icon: '🟢' } : s >= 70 ? { label: 'Correct', icon: '🟡' } : { label: 'À surveiller', icon: '🔴' };

  // tests automatisés : modules purs du site exécutés sur un stockage en mémoire
  function tests(env) {
    const { Social, Stats, I18n, States } = env, mk = () => { const d = {}; return { d, getItem: k => k in d ? d[k] : null, setItem: (k, v) => { d[k] = v; } }; };
    const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (obtenu : ' + a + ', attendu : ' + b + ')'); };
    return [
      ['Comptes : inscription et doublons', async () => { const n = Social.Net(mk()); await n.signup('Alice', 'secret12'); let dup = false; try { await n.signup('ALICE', 'secret12'); } catch (e) { dup = true; } if (!dup) throw new Error('un pseudo en double a été accepté'); return '1 compte, doublon refusé'; }],
      ['Sécurité : mot de passe salé et haché', async () => { const m = mk(), n = Social.Net(m); await n.signup('Alice', 'motdepasse-unique'); const raw = Object.values(m.d).join(''); if (raw.includes('motdepasse-unique')) throw new Error('mot de passe en clair'); if (!/[0-9a-f]{32}\$[0-9a-f]{64}/.test(raw)) throw new Error('format sel$SHA-256 absent'); return 'sel + SHA-256'; }],
      ['Connexion : bon et mauvais mot de passe', async () => { const n = Social.Net(mk()); await n.signup('Alice', 'secret12'); eq(await n.login('alice', 'secret12'), 'Alice', 'connexion'); let bad = false; try { await n.login('alice', 'faux'); } catch (e) { bad = true; } if (!bad) throw new Error('mauvais mot de passe accepté'); return 'OK'; }],
      ['Publications : poster, aimer, répondre', async () => { const n = Social.Net(mk()); await n.signup('Alice', 'secret12'); await n.signup('Bob', 'secret12'); const p = n.post('Alice', 'Salut #test'); n.toggleLike('Bob', p.id); n.post('Bob', 'réponse', p.id); eq(n.replies(p.id).length, 1, 'réponses'); eq(n.notifications('Alice').length >= 2, true, 'notifications'); return 'post, like, réponse, notifications'; }],
      ['Données partagées : deux instances, un seul stockage', async () => { const m = mk(), a = Social.Net(m), b = Social.Net(m); await a.signup('Alice', 'secret12'); b.post('Alice', 'depuis b'); eq(a.explore().length, 1, 'post visible depuis l’autre instance'); return 'lecture-modification-écriture OK'; }],
      ['Compte Streamer : créé une seule fois', async () => { const n = Social.Net(mk()); const a = await n.ensureStreamer(), b = await n.ensureStreamer(); eq(a, b, 'nom'); eq(Object.keys(n.db().users).length, 1, 'comptes'); return a; }],
      ['Statistiques : calcul sur une période', async () => { const n = Social.Net(mk()); await n.signup('Alice', 'secret12'); n.post('Alice', 'x'); const s = Stats.compute(n.db(), [], 'Alice', 7, 0); eq(s.series.length, 7, 'jours'); eq(s.total.posts, 1, 'posts'); return '7 jours, 1 post'; }],
      ['Langues : mêmes clés en fr, en et es', async () => { const ks = l => Object.keys(I18n.DICT[l] || {}).filter(k => !/\.(one|other)$/.test(k)); const fr = ks('fr'), miss = []; for (const l of ['en', 'es']) for (const k of fr) if (!(k in I18n.DICT[l])) miss.push(l + ':' + k); if (miss.length) throw new Error(miss.length + ' clé(s) manquante(s), ex. ' + miss[0]); return fr.length + ' clés × 3 langues'; }],
      ['Pages d’erreur : 404 et 500', async () => { if (!/404/.test(States.notFound()) || !/500/.test(States.serverError())) throw new Error('page d’erreur incomplète'); return '404 et 500 présentes'; }],
      ['Journal d’erreurs : écriture et regroupement', async () => { const m = mk(); record(m, 'test', new Error('boum')); record(m, 'test', new Error('boum')); const a = errors(m); eq(a.length, 1, 'entrées'); eq(a[0].count, 2, 'compteur'); return 'regroupement OK'; }],
    ];
  }

  // sondes de santé du site en direct (serveur, base, sauvegardes, latence, temps réel, synchro)
  function probes(ctx) {
    return [
      ['Serveur et base de données', async () => { const t = Date.now(), j = await ctx.get('/api/health'); if (!j.ok || !j.db) throw new Error('base de données indisponible'); return 'en ligne depuis ' + j.uptime + ' s · ' + (Date.now() - t) + ' ms'; }],
      ['Sauvegardes automatiques', async () => { const j = await ctx.get('/api/health'); if (j.backups === 'late') throw new Error('sauvegarde en retard'); return j.backups === 'off' ? 'désactivées (base en mémoire)' : 'à jour'; }],
      ['Temps de réponse', async () => { const ts = []; for (let i = 0; i < 3; i++) { const t = Date.now(); await ctx.get('/api/health'); ts.push(Date.now() - t); } const avg = Math.round(ts.reduce((a, b) => a + b, 0) / ts.length); if (avg > SLOW_MS) throw new Error('lent : ' + avg + ' ms en moyenne'); return avg + ' ms en moyenne'; }],
      ['Synchronisation des données', async () => { const j = await ctx.get('/api/state?v=-1'); return Object.keys((j.state && j.state.users) || {}).length + ' compte(s), version ' + j.version; }],
      ['Temps réel', async () => { if (!ctx.connected()) throw new Error('flux non connecté (interrogation de secours)'); return 'flux connecté'; }],
      ['Session de cet appareil', async () => { if (!ctx.me()) throw new Error('aucun utilisateur reconnu'); return '@' + ctx.me(); }],
      ['Stockage du navigateur', async () => { const k = 'app.quality.probe'; ctx.store.setItem(k, '1'); if (ctx.store.getItem(k) !== '1') throw new Error('lecture impossible'); ctx.store.removeItem(k); return 'lecture/écriture OK'; }],
    ];
  }

  async function exec(list) {
    const out = [];
    for (const [name, f] of list) { const t = Date.now(); try { out.push({ name, ok: true, detail: await f(), ms: Date.now() - t }); } catch (e) { out.push({ name, ok: false, detail: (e && e.message) || String(e), ms: Date.now() - t }); } }
    return out;
  }
  async function run(ctx, env) {
    const res = { at: Date.now(), tests: await exec(tests(env)), health: await exec(probes(ctx)) };
    res.score = score(res, errors(ctx.store)); return res;
  }

  // rapport texte à copier ou télécharger (erreurs du navigateur + erreurs serveur si l'on est administrateur)
  function report(res, local, server, now) {
    const iso = t => new Date(t).toISOString(), L = [`# Rapport de qualité — ${iso(now || Date.now())}`, ''];
    if (res) {
      L.push(`Note : ${res.score}/100 (${grade(res.score).label})`, '', `## Tests automatisés (${res.tests.filter(x => x.ok).length}/${res.tests.length})`);
      for (const x of res.tests) L.push(`- [${x.ok ? 'OK' : 'ÉCHEC'}] ${x.name} — ${x.detail}`);
      L.push('', `## Santé du site (${res.health.filter(x => x.ok).length}/${res.health.length})`);
      for (const x of res.health) L.push(`- [${x.ok ? 'OK' : 'ÉCHEC'}] ${x.name} — ${x.detail}`);
    } else L.push('Aucun test lancé.');
    L.push('', `## Erreurs du navigateur (${local.length})`); if (!local.length) L.push('Aucune.');
    for (const e of local) L.push(`- ${iso(e.at)} ×${e.count || 1} [${e.where}] ${e.message}`);
    if (server) { L.push('', `## Erreurs du serveur (${server.length})`); if (!server.length) L.push('Aucune.'); for (const e of server) L.push(`- ${iso(e.at)} [${e.where}] ${e.message}`); }
    return L.join('\n');
  }

  const api = { ERR_KEY, RUN_KEY, record, errors, clearErrors, runs, saveRun, score, grade, tests, probes, run, report };
  if (typeof module !== 'undefined') module.exports = api; else root.Quality = api;
})(this);
