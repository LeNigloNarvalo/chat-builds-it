// Sauvegarde des records (meilleur score + top 5) dans le stockage du navigateur.
(function (root) {
  var KEY = 'neon-snake-scores', MAX = 5;
  function load(store) {
    try {
      var d = JSON.parse(store.getItem(KEY));
      if (d && typeof d.best === 'number' && Array.isArray(d.top)) return d;
    } catch (e) {}
    return { best: 0, top: [] };
  }
  function save(store, d) { try { store.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  // Enregistre un score de fin de partie ; renvoie les données à jour.
  function record(store, score, who) {
    var d = load(store);
    if (score > 0) {
      d.top.push({ score: score, who: who || 'Joueur', date: Date.now() });
      d.top.sort(function (a, b) { return b.score - a.score; });
      d.top = d.top.slice(0, MAX);
    }
    d.best = Math.max(d.best, score);
    save(store, d);
    return d;
  }
  var api = { load: load, record: record, KEY: KEY, MAX: MAX };
  if (typeof module !== 'undefined') module.exports = api; else root.Scores = api;
})(this);
