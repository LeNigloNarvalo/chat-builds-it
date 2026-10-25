// Page « Vérification » : teste en direct que tout fonctionne (serveur, session, synchro, fil, temps réel, navigateur).
// Chaque test est une fonction async qui renvoie un détail ou lève une erreur ; rien n'est écrit dans les données.
(function (root) {
  async function run(ctx) {
    const tests = [
      ['Stockage du navigateur', async () => { const k = 'app.diag.' + Math.random(); ctx.store.setItem(k, '1'); if (ctx.store.getItem(k) !== '1') throw new Error('lecture impossible'); ctx.store.removeItem(k); return 'lecture/écriture OK'; }],
      ['Chiffrement (SHA-256)', async () => { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cornichon')); return new Uint8Array(h).length * 8 + ' bits'; }],
      ['Serveur joignable', async () => { const t = Date.now(); const j = await ctx.get('/api/health'); if (!j.ok) throw new Error('réponse inattendue'); return (Date.now() - t) + ' ms'; }],
      ['Session de cet appareil', async () => { if (!ctx.me()) throw new Error('aucun utilisateur reconnu'); return '@' + ctx.me(); }],
      ['Synchronisation des données', async () => { const j = await ctx.get('/api/state?v=-1'); const n = Object.keys((j.state && j.state.users) || {}).length; return n + ' compte(s), version ' + j.version; }],
      ['Fil paginé', async () => { const j = await ctx.get('/api/feed?scope=explore&limit=1'); return j.posts.length + ' post(s) lu(s)'; }],
      ['Temps réel', async () => { if (!ctx.connected()) throw new Error('flux non connecté (interrogation de secours active)'); return 'flux connecté'; }],
      ['Événement « storage »', async () => typeof root.addEventListener === 'function' && 'onstorage' in root ? 'écouté' : (() => { throw new Error('non disponible'); })()],
    ];
    const out = [];
    for (const [name, f] of tests) { try { out.push({ name, ok: true, detail: await f() }); } catch (e) { out.push({ name, ok: false, detail: e.message }); } }
    return out;
  }
  const summary = r => { const bad = r.filter(x => !x.ok).length; return bad ? `${bad} test${bad > 1 ? 's' : ''} en échec sur ${r.length}` : `Tout est fonctionnel ✔ (${r.length}/${r.length})`; };
  const exported = { run, summary };
  if (typeof module !== 'undefined') module.exports = exported; else root.Diag = exported;
})(this);
