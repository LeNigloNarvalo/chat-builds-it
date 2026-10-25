// Préférences d'accessibilité (thème, taille du texte) : propres à chaque visiteur, clé « app.prefs » (pas de données partagées).
(function (root) {
  const KEY = 'app.prefs', THEMES = ['auto', 'dark', 'light'], SIZES = [85, 100, 115, 130, 150];
  const clean = p => ({ theme: THEMES.includes(p && p.theme) ? p.theme : 'auto', size: SIZES.includes(p && p.size) ? p.size : 100 });
  const load = st => { try { return clean(JSON.parse(st.getItem(KEY))); } catch (e) { return clean(); } };
  const save = (st, patch) => { const p = clean(Object.assign(load(st), patch)); st.setItem(KEY, JSON.stringify(p)); return p; };
  // thème effectif : « auto » suit la préférence du système
  const resolve = (p, systemDark) => p.theme === 'auto' ? (systemDark ? 'dark' : 'light') : p.theme;
  const apply = (p, doc, systemDark) => {
    doc.documentElement.dataset.theme = resolve(p, systemDark);
    doc.documentElement.style.fontSize = p.size + '%';
  };
  const exported = { KEY, THEMES, SIZES, load, save, resolve, apply, clean };
  if (typeof module !== 'undefined') module.exports = exported; else root.A11y = exported;
})(this);
