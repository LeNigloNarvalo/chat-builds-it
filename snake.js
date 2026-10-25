(function (root) {
  var W = 20, H = 20;
  function newState(rng) {
    return { w: W, h: H, snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], dir: { x: 1, y: 0 },
      food: null, score: 0, dead: false, rng: rng || Math.random };
  }
  function placeFood(s) {
    var free = [];
    for (var x = 0; x < s.w; x++) for (var y = 0; y < s.h; y++)
      if (!s.snake.some(function (p) { return p.x === x && p.y === y; })) free.push({ x: x, y: y });
    s.food = free.length ? free[Math.floor(s.rng() * free.length)] : null;
  }
  function turn(s, d) { if (d.x + s.dir.x !== 0 || d.y + s.dir.y !== 0) s.dir = d; }
  function hits(s, p, ignoreTail) {
    if (p.x < 0 || p.y < 0 || p.x >= s.w || p.y >= s.h) return true;
    var body = ignoreTail ? s.snake.slice(0, -1) : s.snake;
    return body.some(function (q) { return q.x === p.x && q.y === p.y; });
  }
  function step(s) {
    if (s.dead) return s;
    var h = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
    var eat = s.food && h.x === s.food.x && h.y === s.food.y;
    if (hits(s, h, !eat)) { s.dead = true; return s; }
    s.snake.unshift(h);
    if (eat) { s.score++; placeFood(s); } else s.snake.pop();
    return s;
  }
  // IA : BFS vers la nourriture sans se bloquer, sinon survie
  function autoDir(s) {
    var DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    var head = s.snake[0];
    function free(p, body) {
      return p.x >= 0 && p.y >= 0 && p.x < s.w && p.y < s.h && !body[p.x + ',' + p.y];
    }
    var body = {};
    s.snake.slice(0, -1).forEach(function (p) { body[p.x + ',' + p.y] = 1; });
    var prev = {}, q = [head], seen = {}; seen[head.x + ',' + head.y] = 1;
    while (q.length && s.food) {
      var c = q.shift();
      if (c.x === s.food.x && c.y === s.food.y) break;
      DIRS.forEach(function (d) {
        var n = { x: c.x + d.x, y: c.y + d.y }, k = n.x + ',' + n.y;
        if (!seen[k] && free(n, body)) { seen[k] = 1; prev[k] = c; q.push(n); }
      });
    }
    if (s.food && seen[s.food.x + ',' + s.food.y]) {
      var c2 = s.food;
      while (prev[c2.x + ',' + c2.y] !== head && prev[c2.x + ',' + c2.y]) c2 = prev[c2.x + ',' + c2.y];
      var d0 = { x: c2.x - head.x, y: c2.y - head.y };
      if (d0.x + s.dir.x !== 0 || d0.y + s.dir.y !== 0) return d0;
    }
    // survie : case voisine libre avec le plus d'espace
    var best = null, bestN = -1;
    DIRS.forEach(function (d) {
      if (d.x + s.dir.x === 0 && d.y + s.dir.y === 0) return;
      var n = { x: head.x + d.x, y: head.y + d.y };
      if (!free(n, body)) return;
      var cnt = 0, st = [n], sn = {}; sn[n.x + ',' + n.y] = 1;
      while (st.length && cnt < 200) {
        var p = st.pop(); cnt++;
        DIRS.forEach(function (e) {
          var m = { x: p.x + e.x, y: p.y + e.y }, k = m.x + ',' + m.y;
          if (!sn[k] && free(m, body)) { sn[k] = 1; st.push(m); }
        });
      }
      if (cnt > bestN) { bestN = cnt; best = d; }
    });
    return best || s.dir;
  }
  var api = { newState: newState, placeFood: placeFood, turn: turn, step: step, autoDir: autoDir };
  if (typeof module !== 'undefined') module.exports = api; else root.Snake = api;
})(this);
