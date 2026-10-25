// Exploitation : configuration par variables d'environnement et supervision (métriques de requêtes, journal d'erreurs, état).
// Tout est gardé en mémoire (anneau borné) : rien de personnel n'est collecté, seulement des chemins d'API et des durées.
const os = require('os');

const int = (v, d, min, max) => { const n = Math.floor(+v); return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : d; };

// Toute la configuration vient de l'environnement ; chaque valeur invalide retombe sur sa valeur par défaut.
function config(env = process.env) {
  return {
    port: int(env.PORT, 8080, 0, 65535), host: env.HOST || '0.0.0.0',
    db: env.CORNICHON_DB || '', backupDir: env.BACKUP_DIR || '',
    backupKeep: int(env.BACKUP_KEEP, 7, 1, 90), backupEveryHours: int(env.BACKUP_EVERY_HOURS, 24, 1, 24 * 30),
    publicUrl: env.PUBLIC_URL || '', webhookPrivate: env.WEBHOOK_ALLOW_PRIVATE === '1',
  };
}

function Ops(opts = {}) {
  const started = Date.now(), MAX_ERR = 50, MAX_LAT = 500;
  const codes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, routes = new Map(), lat = [], errors = [];
  let total = 0, errorCount = 0;
  // les identifiants numériques sont regroupés (/api/admin/backups/<id>/download → /api/admin/backups/:id/download)
  const norm = p => p.replace(/cornichon-[\w-]+\.db/g, ':id').replace(/\/\d+/g, '/:n').slice(0, 80);
  function request(method, path, status, ms) {
    total++; codes[Math.floor(status / 100) + 'xx'] = (codes[Math.floor(status / 100) + 'xx'] || 0) + 1;
    lat.push(ms); if (lat.length > MAX_LAT) lat.shift();
    if (path.startsWith('/api/') && path !== '/api/stream') {
      const k = method + ' ' + norm(path), r = routes.get(k) || { n: 0, ms: 0, max: 0 };
      r.n++; r.ms += ms; r.max = Math.max(r.max, ms); routes.set(k, r);
      if (routes.size > 200) routes.delete(routes.keys().next().value);
    }
  }
  function error(where, e) {
    errorCount++;
    errors.unshift({ at: Date.now(), where: String(where).slice(0, 80), message: String((e && e.message) || e).slice(0, 300) });
    if (errors.length > MAX_ERR) errors.pop();
  }
  const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10; };
  function metrics() {
    const mem = process.memoryUsage();
    return {
      uptime: Math.round((Date.now() - started) / 1000), started, node: process.version, pid: process.pid,
      requests: { total, codes: Object.assign({}, codes), p50: pct(lat, 0.5), p95: pct(lat, 0.95) },
      routes: [...routes].map(([k, r]) => ({ route: k, n: r.n, avg: Math.round(r.ms / r.n * 10) / 10, max: Math.round(r.max * 10) / 10 })).sort((a, b) => b.n - a.n).slice(0, 12),
      errors: { count: errorCount, recent: errors.slice() },
      memory: { rss: mem.rss, heap: mem.heapUsed }, load: os.loadavg()[0], cpus: os.cpus().length,
    };
  }
  return { request, error, metrics };
}

module.exports = { config, Ops };
