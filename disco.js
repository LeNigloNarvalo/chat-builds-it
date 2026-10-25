// Mode Disco Musical : horloge de beats, mélodie 8-bit, points par beat (logique pure, testable avec Node).
(function (root) {
  const BPM = 128, BEAT = 60 / BPM;
  const BASS = [110, 110, 165, 110, 131, 131, 196, 131];
  const LEAD = [523, 659, 784, 659, 587, 698, 880, 698, 523, 784, 1047, 784, 659, 988, 784, 659];
  const PALETTE = ['#ff4d6d', '#ff9f43', '#ffd23f', '#2ed573', '#00e5ff', '#a55eea', '#ff6bd6'];

  function newDisco() { return { on: false, t: 0, beat: 0, pulse: 0, hue: 0, total: 0, streak: 0, fired: false, events: [] }; }

  // Avance l'horloge ; renvoie le nombre de beats franchis. Chaque beat rapporte des points
  // (10 de base, +15 si on a tiré sur le beat, x série) et déclenche une note.
  function step(d, s, dt, fired) {
    d.events = [];
    if (!d.on) return 0;
    d.t += dt; d.pulse = Math.max(0, d.pulse - dt / BEAT * 1.4); d.hue = (d.hue + dt * 90) % 360;
    if (fired) d.fired = true;
    let n = 0;
    while (d.t >= BEAT) {
      d.t -= BEAT; d.beat++; n++; d.pulse = 1;
      if (s && !s.over) {
        const onBeat = d.fired; d.streak = onBeat ? d.streak + 1 : 0;
        const pts = (10 + (onBeat ? 15 : 0)) * Math.min(5, 1 + Math.floor(d.streak / 4));
        s.score += pts; d.total += pts;
        d.events.push({ beat: d.beat, pts, onBeat, bass: BASS[d.beat % BASS.length], lead: LEAD[d.beat % LEAD.length] });
      }
      d.fired = false;
    }
    return n;
  }

  function color(d, i) { return PALETTE[(i + d.beat) % PALETTE.length]; }
  function scale(d) { return 1 + 0.25 * d.pulse; }

  const api = { BPM, BEAT, BASS, LEAD, PALETTE, newDisco, step, color, scale };
  if (typeof module !== 'undefined') module.exports = api; else root.Disco = api;
})(this);
