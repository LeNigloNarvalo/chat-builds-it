// Anti-spam de Cornichon : plafonds par IP et par compte (inscription, connexion, posts, messages), ralentissement progressif,
// blocages temporaires de plus en plus longs, défi anti-robot à l'inscription et période probatoire des nouveaux comptes.
// Tout est gardé en mémoire (fenêtres glissantes bornées) : seules des adresses réseau et des pseudos y transitent, rien de personnel n'est stocké.
const crypto = require('crypto');

const MIN = 60000, HOUR = 3600000;
const PROBATION_MS = 24 * HOUR; // un compte de moins de 24 h est « à l'essai » : quotas réduits
const PROBATION_FACTOR = 0.4;
// règle → { ip: [max, fenêtre], acct: [max, fenêtre] } ; label sert à l'écran admin
const RULES = {
  signup: { label: 'Inscription', ip: [5, HOUR] },
  login: { label: 'Connexion', ip: [20, 10 * MIN], acct: [10, 10 * MIN] },
  post: { label: 'Posts', ip: [60, 10 * MIN], acct: [20, 10 * MIN] },
  message: { label: 'Messages', ip: [90, 10 * MIN], acct: [30, 10 * MIN] },
  captcha: { label: 'Défi anti-robot', ip: [30, 10 * MIN] },
};
const SOFT = 0.6; // au-delà de 60 % du plafond, chaque action est ralentie
const STEP_MS = 400, MAX_DELAY_MS = 3000;
const BASE_BLOCK_MS = MIN, MAX_BLOCK_MS = 24 * HOUR, STRIKE_MEMORY_MS = 24 * HOUR;
const MAX_KEYS = 20000, MAX_CAPTCHAS = 2000, CAPTCHA_TTL = 10 * MIN;

class Limited extends Error { constructor(msg, retry) { super(msg); this.code = 429; this.retry = retry; } }

// masque la dernière partie d'une adresse pour l'affichage (a.b.c.• / abcd:ef01:…:•)
const mask = ip => { ip = String(ip || ''); const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/.exec(ip); if (v4) return v4[1] + '.•'; const p = ip.split(':'); return p.length > 2 ? p.slice(0, 3).join(':') + ':…:•' : ip; };

function Guard(opts = {}) {
  const now = opts.now || Date.now, on = opts.enabled !== false;
  const minFill = opts.minFillMs == null ? 1500 : opts.minFillMs;
  const limits = {}; // plafonds effectifs (surchargeables pour les tests)
  for (const [r, def] of Object.entries(RULES)) limits[r] = {
    ip: def.ip && [Math.max(1, (opts.limits && opts.limits[r] && opts.limits[r].ip) || def.ip[0]), def.ip[1]],
    acct: def.acct && [Math.max(1, (opts.limits && opts.limits[r] && opts.limits[r].acct) || def.acct[0]), def.acct[1]],
  };
  const wins = new Map(); // "règle|scope|clé" → [horodatages]
  const blocks = new Map(); // même clé → { id, rule, scope, key, until, since, strikes, hits }
  const strikes = new Map(); // "scope|clé" → { n, at }
  const captchas = new Map(); // id → { answer, at }
  const stat = { captchaIssued: 0, captchaOk: 0, captchaFail: 0, blocked: 0, slowed: 0 };
  let seq = 1;

  const prune = () => {
    const t = now();
    if (wins.size > MAX_KEYS) for (const [k, w] of wins) if (!w.length || w[w.length - 1] < t - HOUR) wins.delete(k);
    if (strikes.size > MAX_KEYS) for (const [k, s] of strikes) if (s.at < t - STRIKE_MEMORY_MS) strikes.delete(k);
    for (const [k, b] of blocks) if (b.until <= t) blocks.delete(k);
  };

  // enregistre une action ; lève Limited (429) au-delà du plafond, sinon renvoie le ralentissement (ms) à appliquer
  // who = { ip, acct, probation }
  function hit(rule, who) {
    if (!on || !limits[rule]) return 0;
    const t = now(); prune();
    let delay = 0;
    for (const scope of ['ip', 'acct']) {
      const lim = limits[rule][scope], key = scope === 'ip' ? who.ip : who.acct;
      if (!lim || !key) continue;
      const k = `${rule}|${scope}|${String(key).toLowerCase()}`;
      const b = blocks.get(k);
      if (b && b.until > t) { b.hits++; throw new Limited(`Trop d'actions (${RULES[rule].label.toLowerCase()}) : réessayez dans ${Math.ceil((b.until - t) / 1000)} s`, Math.ceil((b.until - t) / 1000)); }
      const max = scope === 'acct' && who.probation ? Math.max(2, Math.floor(lim[0] * PROBATION_FACTOR)) : lim[0];
      const w = (wins.get(k) || []).filter(x => x > t - lim[1]);
      w.push(t); wins.set(k, w);
      if (w.length > max) {
        const sk = `${scope}|${String(key).toLowerCase()}`, s = strikes.get(sk);
        const n = s && s.at > t - STRIKE_MEMORY_MS ? s.n + 1 : 1;
        strikes.set(sk, { n, at: t });
        const ms = Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** (n - 1));
        blocks.set(k, { id: seq++, rule, scope, key: String(key), until: t + ms, since: t, strikes: n, hits: 1, probation: scope === 'acct' && !!who.probation });
        wins.delete(k); stat.blocked++;
        throw new Limited(`Trop d'actions (${RULES[rule].label.toLowerCase()}) : bloqué pendant ${Math.ceil(ms / 1000)} s`, Math.ceil(ms / 1000));
      }
      const soft = Math.ceil(max * SOFT);
      if (w.length > soft) delay = Math.max(delay, Math.min(MAX_DELAY_MS, (w.length - soft) * STEP_MS));
    }
    if (delay) stat.slowed++;
    return delay;
  }

  // ---- défi anti-robot : question de comptage de cornichons, à usage unique, avec champ piège et délai minimal de remplissage ----
  function challenge() {
    const t = now();
    for (const [id, c] of captchas) if (c.at < t - CAPTCHA_TTL) captchas.delete(id);
    if (captchas.size >= MAX_CAPTCHAS) captchas.delete(captchas.keys().next().value);
    const a = crypto.randomInt(2, 9), b = crypto.randomInt(1, 7), sub = crypto.randomInt(0, 2) === 1 && a > b;
    const id = crypto.randomBytes(12).toString('hex');
    captchas.set(id, { answer: String(sub ? a - b : a + b), at: t }); stat.captchaIssued++;
    return { id, question: `🥒 Combien font ${a} cornichons ${sub ? 'moins' : 'plus'} ${b} cornichons ?`, minFillMs: minFill };
  }
  function verify(c) {
    if (!on) return;
    c = c || {};
    const e = captchas.get(String(c.id || '')); captchas.delete(String(c.id || ''));
    const fail = m => { stat.captchaFail++; throw Object.assign(new Error(m), { code: 400 }); };
    if (c.website) fail('Défi anti-robot échoué'); // champ piège : invisible pour un humain
    if (!e || e.at < now() - CAPTCHA_TTL) fail('Défi anti-robot expiré : un nouveau est proposé');
    if (now() - e.at < minFill) fail('Trop rapide pour un humain : patientez une seconde et réessayez');
    if (String(c.answer || '').trim() !== e.answer) fail('Mauvaise réponse au défi anti-robot');
    stat.captchaOk++;
  }

  // ---- écran admin ----
  const active = () => { prune(); return [...blocks.values()].sort((a, b) => b.since - a.since); };
  const list = () => active().map(b => ({ id: b.id, rule: b.rule, label: RULES[b.rule].label, scope: b.scope, who: b.scope === 'ip' ? mask(b.key) : b.key, until: b.until, since: b.since, strikes: b.strikes, hits: b.hits, probation: b.probation }));
  function unblock(id) {
    for (const [k, b] of blocks) if (b.id === +id) { blocks.delete(k); strikes.delete(`${b.scope}|${b.key.toLowerCase()}`); wins.delete(k); return true; }
    return false;
  }
  const summary = () => ({
    enabled: on, probationHours: PROBATION_MS / HOUR, probationPct: Math.round(PROBATION_FACTOR * 100), softPct: Math.round(SOFT * 100),
    rules: Object.entries(limits).map(([r, l]) => ({ rule: r, label: RULES[r].label, ip: l.ip && { max: l.ip[0], perMin: Math.round(l.ip[1] / MIN) }, acct: l.acct && { max: l.acct[0], perMin: Math.round(l.acct[1] / MIN), probationMax: Math.max(2, Math.floor(l.acct[0] * PROBATION_FACTOR)) } })),
    stats: Object.assign({}, stat), blocks: list(),
  });
  return { hit, challenge, verify, list, unblock, summary, Limited, enabled: on };
}

// adresse du client : X-Forwarded-For uniquement s'il vient d'un relais local (reverse proxy sur la même machine)
function clientIp(req) {
  const ip = req.socket.remoteAddress || '', local = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip), xff = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return local && /^[0-9a-fA-F:.]{3,45}$/.test(xff) ? xff : ip;
}

module.exports = { Guard, Limited, clientIp, mask, RULES, PROBATION_MS };
