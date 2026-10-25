// Double authentification (côté serveur) : codes TOTP (RFC 6238, SHA-1, 6 chiffres, 30 s), codes de secours à usage unique et appareils de confiance.
// Le secret TOTP doit être relu par le serveur pour vérifier les codes, il est donc stocké tel quel (jamais envoyé après l'activation) ;
// codes de secours et jetons d'appareil de confiance ne sont stockés que sous forme de hachage SHA-256.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', STEP = 30, DIGITS = 6, DRIFT = 1, BACKUPS = 10, TRUST_MS = 30 * 86400000, MAX_DEVICES = 10, MAX_FAILS = 5, LOCK_MS = 60000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const b32enc = buf => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32dec = s => { let bits = ''; for (const c of String(s).replace(/[\s=-]/g, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) throw new Error('Secret invalide'); bits += i.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const newSecret = () => b32enc(crypto.randomBytes(20));
// code TOTP pour un instant donné (ms)
const code = (secret, at = Date.now()) => {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / STEP)));
  const h = crypto.createHmac('sha1', b32dec(secret)).update(ctr).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 10 ** DIGITS)).padStart(DIGITS, '0');
};
// pas de temps accepté (ou -1) : tolère ±1 pas d'horloge ; compare en temps constant
const match = (secret, input, at = Date.now()) => {
  const s = String(input || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(s)) return -1;
  let hit = -1;
  for (let d = -DRIFT; d <= DRIFT; d++) { const t = at + d * STEP * 1000, c = code(secret, t); if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(s))) hit = Math.floor(t / 1000 / STEP); }
  return hit;
};
const uri = (name, secret) => `otpauth://totp/Cornichon:${encodeURIComponent(name)}?secret=${secret}&issuer=Cornichon&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
const makeBackups = () => Array.from({ length: BACKUPS }, () => { const r = crypto.randomBytes(5).toString('hex'); return r.slice(0, 5) + '-' + r.slice(5); });
const normBackup = s => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const deviceLabel = ua => {
  ua = String(ua || '');
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'appareil inconnu';
  return br + ' · ' + os;
};

function Totp(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS totp (name TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS totp_backup (hash TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS totp_device (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER, expires INTEGER NOT NULL);`);
  const getU = db.prepare('SELECT * FROM totp WHERE name = ?'), putU = db.prepare(`INSERT INTO totp (name, secret, enabled, last_step, created) VALUES (?, ?, 0, 0, ?)
    ON CONFLICT(name) DO UPDATE SET secret = excluded.secret, enabled = 0, last_step = 0, created = excluded.created`),
    enableU = db.prepare('UPDATE totp SET enabled = 1 WHERE name = ?'), stepU = db.prepare('UPDATE totp SET last_step = ? WHERE name = ?'), delU = db.prepare('DELETE FROM totp WHERE name = ?');
  const insB = db.prepare('INSERT INTO totp_backup (hash, name, created) VALUES (?, ?, ?)'), delB = db.prepare('DELETE FROM totp_backup WHERE hash = ? AND name = ?'),
    delBU = db.prepare('DELETE FROM totp_backup WHERE name = ?'), cntB = db.prepare('SELECT COUNT(*) n FROM totp_backup WHERE name = ?');
  const insD = db.prepare('INSERT INTO totp_device (hash, name, label, created, last_used, expires) VALUES (?, ?, ?, ?, ?, ?)'), getD = db.prepare('SELECT * FROM totp_device WHERE hash = ? AND name = ?'),
    useD = db.prepare('UPDATE totp_device SET last_used = ? WHERE id = ?'), listD = db.prepare('SELECT id, hash, label, created, last_used, expires FROM totp_device WHERE name = ? AND expires > ? ORDER BY created DESC'),
    delD = db.prepare('DELETE FROM totp_device WHERE id = ? AND name = ?'), delDU = db.prepare('DELETE FROM totp_device WHERE name = ?'), purgeD = db.prepare('DELETE FROM totp_device WHERE expires < ?'),
    trimD = db.prepare('DELETE FROM totp_device WHERE id IN (SELECT id FROM totp_device WHERE name = ? ORDER BY created DESC LIMIT -1 OFFSET ?)');
  const fails = new Map(); // nom -> { n, until } : verrou temporaire après trop de codes faux
  const lockLeft = name => { const f = fails.get(name); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
  const fail = name => { const f = fails.get(name) || { n: 0, until: 0 }; if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; } if (++f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; } fails.set(name, f); };

  const api = {
    enabled: name => { const r = getU.get(name); return !!(r && r.enabled); },
    // nouveau secret en attente (écrase un éventuel essai précédent) ; refusé si la double authentification est déjà active
    setup(name) {
      if (api.enabled(name)) throw new Error('La double authentification est déjà activée');
      const secret = newSecret(); putU.run(name, secret, Date.now()); return { secret, uri: uri(name, secret) };
    },
    pending(name) { const r = getU.get(name); return r && !r.enabled ? { secret: r.secret, uri: uri(name, r.secret) } : null; },
    // vérifie un code TOTP (anti-rejeu : un pas de temps ne sert qu'une fois) ; true/false
    checkCode(name, input) {
      const s = lockLeft(name); if (s) throw new Error(`Trop de codes faux : réessayez dans ${s} s`);
      const r = getU.get(name); const step = r ? match(r.secret, input) : -1;
      if (step < 0 || step <= r.last_step) { fail(name); return false; }
      stepU.run(step, name); fails.delete(name); return true;
    },
    // code TOTP ou code de secours (consommé) ; renvoie 'totp' | 'backup' | null
    verify(name, input) {
      if (/^\s*\d{3}\s?\d{3}\s*$/.test(String(input || ''))) return api.checkCode(name, input) ? 'totp' : null;
      const s = lockLeft(name); if (s) throw new Error(`Trop de codes faux : réessayez dans ${s} s`);
      const n = normBackup(input);
      if (n.length === 10 && delB.run(sha(n), name).changes) { fails.delete(name); return 'backup'; }
      fail(name); return null;
    },
    // active après un premier code valide ; renvoie les codes de secours (affichés une seule fois)
    enable(name, input) {
      const r = getU.get(name); if (!r || r.enabled) throw new Error('Aucune configuration en attente');
      if (!api.checkCode(name, input)) throw new Error('Code incorrect : vérifiez l\'heure de votre téléphone');
      enableU.run(name); return api.regenerate(name);
    },
    regenerate(name) { delBU.run(name); const codes = makeBackups(), now = Date.now(); for (const c of codes) insB.run(sha(normBackup(c)), name, now); return codes; },
    backupLeft: name => cntB.get(name).n,
    disable(name) { delU.run(name); delBU.run(name); delDU.run(name); },
    // appareils de confiance : jeton aléatoire gardé par le navigateur, hachage côté serveur
    trust(name, ua) {
      const token = crypto.randomBytes(32).toString('hex'), now = Date.now(); purgeD.run(now);
      insD.run(sha(token), name, deviceLabel(ua), now, now, now + TRUST_MS); trimD.run(name, MAX_DEVICES); return token;
    },
    isTrusted(name, token) {
      if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return false;
      const d = getD.get(sha(token), name); if (!d || d.expires < Date.now()) return false;
      useD.run(Date.now(), d.id); return true;
    },
    devices: (name, current) => listD.all(name, Date.now()).map(d => ({ id: d.id, label: d.label, created: d.created, last_used: d.last_used, expires: d.expires, current: !!current && d.hash === sha(String(current)) })),
    revokeDevice(name, id) { if (!delD.run(+id, name).changes) throw new Error('Appareil introuvable'); },
    revokeDevices: name => delDU.run(name),
    forget(name) { api.disable(name); }
  };
  return api;
}

module.exports = { Totp, code, match, b32enc, b32dec, newSecret, uri, deviceLabel };
