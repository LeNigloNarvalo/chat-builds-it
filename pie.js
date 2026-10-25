// Tarte aux pommes : recette interactive en étapes, état commun (localStorage « pie.v1 », relu à chaque action).
(function (root) {
  const KEY = 'pie.v1';
  const STEPS = [
    ['🌾', 'Pétrir la pâte', 'Mélange 250 g de farine, 125 g de beurre froid, 1 pincée de sel et 5 cl d’eau.'],
    ['🍎', 'Éplucher les pommes', 'Épluche 5 pommes (Golden ou Canada), coupe-les en fines lamelles.'],
    ['🥧', 'Foncer le moule', 'Étale la pâte, garnis le moule et pique le fond à la fourchette.'],
    ['🍬', 'Disposer et sucrer', 'Range les pommes en rosace, saupoudre de sucre et de cannelle.'],
    ['🔥', 'Enfourner', 'Cuis 35 minutes à 180 °C jusqu’à ce que la tarte soit dorée.'],
    ['😋', 'Déguster', 'Laisse tiédir… et sers (avec une boule de vanille).']
  ];
  const empty = () => ({ step: 0, slices: 8, eaten: 0, bakes: 0 });
  function load(st) { try { const d = JSON.parse(st.getItem(KEY)); return d && typeof d.step === 'number' ? Object.assign(empty(), d) : empty(); } catch (e) { return empty(); } }
  // lecture-modification-écriture : on relit toujours le stockage avant de modifier
  function update(st, fn) { const d = load(st); fn(d); st.setItem(KEY, JSON.stringify(d)); return d; }
  const advance = st => update(st, d => { if (d.step < STEPS.length) d.step++; });
  const eat = st => update(st, d => { if (d.step >= STEPS.length && d.eaten < d.slices) d.eaten++; });
  const restart = st => update(st, d => { if (d.step >= STEPS.length) d.bakes++; d.step = 0; d.eaten = 0; });
  function svg(d) {
    const done = d.step, left = d.slices - d.eaten;
    if (done >= STEPS.length) {
      let s = '<circle cx="100" cy="100" r="90" fill="#c98a3c" stroke="#8a5a1e" stroke-width="4"/>';
      for (let i = 0; i < d.slices; i++) {
        const a = i * 2 * Math.PI / d.slices - Math.PI / 2, b = a + 2 * Math.PI / d.slices;
        if (i >= left) continue;
        s += `<path d="M100 100 L${(100 + 82 * Math.cos(a)).toFixed(1)} ${(100 + 82 * Math.sin(a)).toFixed(1)} A82 82 0 0 1 ${(100 + 82 * Math.cos(b)).toFixed(1)} ${(100 + 82 * Math.sin(b)).toFixed(1)} Z" fill="${i % 2 ? '#e8b04a' : '#f0c36a'}" stroke="#8a5a1e" stroke-width="2"/>`;
      }
      return s;
    }
    return `<circle cx="100" cy="100" r="90" fill="${done >= 3 ? '#c98a3c' : '#e9d3a1'}" stroke="#8a5a1e" stroke-width="4" opacity="${done >= 2 ? 1 : .35}"/>` +
      (done >= 4 ? [0, 1, 2, 3, 4].map(i => `<circle cx="${(100 + 45 * Math.cos(i * 1.2566)).toFixed(1)}" cy="${(100 + 45 * Math.sin(i * 1.2566)).toFixed(1)}" r="24" fill="#d94a3d" opacity=".85"/>`).join('') : '') +
      (done === 1 ? '<text x="100" y="125" font-size="80" text-anchor="middle">🍎</text>' : '');
  }
  const api = { KEY, STEPS, load, update, advance, eat, restart, svg };
  if (typeof module !== 'undefined') module.exports = api; else root.Pie = api;
})(typeof window !== 'undefined' ? window : globalThis);
