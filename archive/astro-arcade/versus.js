// Mode 2 joueurs (sans DOM) : deux parties indépendantes côte à côte, le meilleur score gagne.
(function (root) {
  const DURATION = 90;

  function newMatch(L) {
    return { p: [L.newState(), L.newState()], time: DURATION, over: false, votes: [0, 0] };
  }

  // Le match se termine quand le temps est écoulé ou que les deux joueurs sont éliminés.
  function stepMatch(L, m, dt, in1, in2) {
    if (m.over) return m;
    m.time = Math.max(0, m.time - dt);
    [in1, in2].forEach((inp, i) => { if (!m.p[i].over) L.step(m.p[i], dt, inp); });
    if (m.time <= 0 || (m.p[0].over && m.p[1].over)) m.over = true;
    return m;
  }

  // 0 = joueur 1, 1 = joueur 2, -1 = égalité (ou match pas fini).
  function winner(m) {
    if (!m.over) return -1;
    const a = m.p[0].score, b = m.p[1].score;
    return a === b ? -1 : a > b ? 0 : 1;
  }

  function vote(m, i) { if (m.over && (i === 0 || i === 1)) { m.votes[i]++; return true; } return false; }

  const api = { newMatch, stepMatch, winner, vote, DURATION };
  if (typeof module !== 'undefined') module.exports = api; else root.Versus = api;
})(typeof window !== 'undefined' ? window : globalThis);
