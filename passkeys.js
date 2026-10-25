// Clés d'accès (passkeys, WebAuthn niveau 2) côté serveur : enregistrement, connexion sans mot de passe, renommage et révocation.
// Vérification faite à la main avec le module crypto de Node (aucune dépendance) : attestation « none », clés ES256 et RS256.
// Le serveur ne garde que l'identifiant public et la clé publique de chaque clé ; le secret ne quitte jamais l'appareil de la personne.
const crypto = require('crypto');

const CHALLENGE_MS = 5 * 60000, MAX_KEYS = 10, FLAG_UP = 1, FLAG_UV = 4, FLAG_AT = 64;
const sha = b => crypto.createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');
const fromB64u = s => { if (!/^[A-Za-z0-9_-]+$/.test(String(s || ''))) throw new Error('Données de clé invalides'); return Buffer.from(s, 'base64url'); };

// décodeur CBOR minimal (entiers, binaires, textes, tableaux, tables, booléens, null) : suffisant pour l'attestation et la clé COSE
function cbor(buf, pos = 0) {
  const ib = buf[pos++], major = ib >> 5; let info = ib & 31;
  const take = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[pos++]; return v; };
  if (info === 24) info = take(1); else if (info === 25) info = take(2); else if (info === 26) info = take(4); else if (info > 26) throw new Error('CBOR non pris en charge');
  const item = () => { const r = cbor(buf, pos); pos = r.pos; return r.value; };
  let value;
  if (major === 0) value = info; else if (major === 1) value = -1 - info;
  else if (major === 2) { value = buf.subarray(pos, pos + info); pos += info; }
  else if (major === 3) { value = buf.subarray(pos, pos + info).toString('utf8'); pos += info; }
  else if (major === 4) { value = []; for (let i = 0; i < info; i++) value.push(item()); }
  else if (major === 5) { value = new Map(); for (let i = 0; i < info; i++) { const k = item(); value.set(k, item()); } }
  else if (major === 7) value = info === 20 ? false : info === 21 ? true : null;
  else throw new Error('CBOR non pris en charge');
  if (pos > buf.length) throw new Error('CBOR tronqué');
  return { value, pos };
}

// clé COSE -> JWK (ES256 : EC P-256 ; RS256 : RSA)
function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg: -257, jwk: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  throw new Error('Algorithme de clé non pris en charge (ES256 ou RS256 attendu)');
}

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('Données de l\'authentificateur trop courtes');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], counter: ad.readUInt32BE(33), rest: ad.subarray(37) };
  return out;
}

function Passkeys(db, opts = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS passkey (id TEXT PRIMARY KEY, name TEXT NOT NULL, label TEXT NOT NULL, jwk TEXT NOT NULL, alg INTEGER NOT NULL, counter INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_used INTEGER);
    CREATE INDEX IF NOT EXISTS passkey_name ON passkey (name);`);
  const getK = db.prepare('SELECT * FROM passkey WHERE id = ?'), listK = db.prepare('SELECT id, label, created, last_used FROM passkey WHERE name = ? ORDER BY created'), cntK = db.prepare('SELECT COUNT(*) n FROM passkey WHERE name = ?'),
    insK = db.prepare('INSERT INTO passkey (id, name, label, jwk, alg, counter, created) VALUES (?, ?, ?, ?, ?, ?, ?)'), useK = db.prepare('UPDATE passkey SET counter = ?, last_used = ? WHERE id = ?'),
    renK = db.prepare('UPDATE passkey SET label = ? WHERE id = ? AND name = ?'), delK = db.prepare('DELETE FROM passkey WHERE id = ? AND name = ?'), delKU = db.prepare('DELETE FROM passkey WHERE name = ?'), idsK = db.prepare('SELECT id FROM passkey WHERE name = ?');
  const pending = new Map(); // défi (base64url) -> { kind, name, exp } : à usage unique
  const newChallenge = (kind, name) => {
    const now = Date.now(); for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
    if (pending.size > 5000) pending.delete(pending.keys().next().value);
    const c = b64u(crypto.randomBytes(32)); pending.set(c, { kind, name, exp: now + CHALLENGE_MS }); return c;
  };
  const takeChallenge = (c, kind) => { const p = pending.get(c); pending.delete(c); if (!p || p.exp < Date.now() || p.kind !== kind) throw new Error('Défi expiré : recommencez'); return p; };
  const cleanLabel = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  // contrôles communs de clientDataJSON et des données de l'authentificateur
  function checkClient(raw, type, rp) {
    let cd; try { cd = JSON.parse(raw.toString('utf8')); } catch (e) { throw new Error('Données client invalides'); }
    if (cd.type !== type) throw new Error('Type de requête WebAuthn inattendu');
    let host; try { host = new URL(String(cd.origin)).hostname; } catch (e) { throw new Error('Origine invalide'); }
    if (host !== rp.id || !/^https?:$/.test(new URL(cd.origin).protocol)) throw new Error('Origine non autorisée pour cette clé');
    if (rp.origin && cd.origin !== rp.origin) throw new Error('Origine non autorisée pour cette clé');
    return cd;
  }
  const checkRp = (ad, rp, needUv) => {
    if (!crypto.timingSafeEqual(ad.rpIdHash, sha(rp.id))) throw new Error('Cette clé appartient à un autre site');
    if (!(ad.flags & FLAG_UP)) throw new Error('Présence de la personne non confirmée');
    if (needUv && !(ad.flags & FLAG_UV)) throw new Error('Vérification biométrique ou code PIN requise');
  };

  const api = {
    count: name => cntK.get(name).n,
    list: name => listK.all(name).map(k => ({ id: k.id, label: k.label, created: k.created, last_used: k.last_used })),
    // options d'enregistrement pour la personne connectée
    registerOptions(name, rp) {
      if (api.count(name) >= MAX_KEYS) throw new Error(`Maximum ${MAX_KEYS} clés d'accès : révoquez-en une d'abord`);
      return {
        challenge: newChallenge('create', name), rp: { id: rp.id, name: 'Agora' }, user: { id: b64u(sha('cornichon:' + name.toLowerCase())), name, displayName: name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 120000, attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: idsK.all(name).map(k => ({ type: 'public-key', id: k.id }))
      };
    },
    register(name, cred, label, rp) {
      if (!cred || typeof cred !== 'object' || !cred.response) throw new Error('Réponse WebAuthn manquante');
      const cd = checkClient(fromB64u(cred.response.clientDataJSON), 'webauthn.create', rp);
      const p = takeChallenge(cd.challenge, 'create'); if (p.name !== name) throw new Error('Défi expiré : recommencez');
      const att = cbor(fromB64u(cred.response.attestationObject)).value; if (!(att instanceof Map)) throw new Error('Attestation invalide');
      const ad = parseAuthData(att.get('authData')); checkRp(ad, rp, true);
      if (!(ad.flags & FLAG_AT) || ad.rest.length < 18) throw new Error('Aucune clé publique reçue');
      const len = ad.rest.readUInt16BE(16), id = ad.rest.subarray(18, 18 + len);
      if (!len || len > 1023 || id.length !== len) throw new Error('Identifiant de clé invalide');
      const { alg, jwk } = coseToJwk(cbor(ad.rest, 18 + len).value);
      if (b64u(id) !== cred.id) throw new Error('Identifiant de clé incohérent');
      if (getK.get(b64u(id))) throw new Error('Cette clé est déjà enregistrée');
      if (api.count(name) >= MAX_KEYS) throw new Error(`Maximum ${MAX_KEYS} clés d'accès`);
      const lab = cleanLabel(label) || 'Clé d\'accès ' + (api.count(name) + 1);
      insK.run(b64u(id), name, lab, JSON.stringify(jwk), alg, ad.counter, Date.now());
      return { id: b64u(id), label: lab };
    },
    // connexion sans nom : la clé « découvrable » désigne elle-même le compte
    loginOptions: rp => ({ challenge: newChallenge('get', null), rpId: rp.id, timeout: 120000, userVerification: 'required', allowCredentials: [] }),
    // vérifie l'assertion ; renvoie le nom du compte
    login(cred, rp) {
      if (!cred || typeof cred !== 'object' || !cred.response) throw new Error('Réponse WebAuthn manquante');
      const k = getK.get(String(cred.id || '')); if (!k) throw new Error('Clé d\'accès inconnue ou révoquée');
      const rawCd = fromB64u(cred.response.clientDataJSON), cd = checkClient(rawCd, 'webauthn.get', rp);
      takeChallenge(cd.challenge, 'get');
      const authData = fromB64u(cred.response.authenticatorData), ad = parseAuthData(authData); checkRp(ad, rp, true);
      const key = crypto.createPublicKey({ key: JSON.parse(k.jwk), format: 'jwk' }), data = Buffer.concat([authData, sha(rawCd)]), sig = fromB64u(cred.response.signature);
      const ok = k.alg === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig) : crypto.verify('sha256', data, key, sig);
      if (!ok) throw new Error('Signature de la clé invalide');
      if ((ad.counter || k.counter) && ad.counter <= k.counter) throw new Error('Clé d\'accès clonée ou rejouée : connexion refusée');
      useK.run(ad.counter, Date.now(), k.id); return k.name;
    },
    rename(name, id, label) { const l = cleanLabel(label); if (!l) throw new Error('Nom vide'); if (!renK.run(l, String(id), name).changes) throw new Error('Clé introuvable'); },
    revoke(name, id) { if (!delK.run(String(id), name).changes) throw new Error('Clé introuvable'); },
    forget: name => delKU.run(name)
  };
  return api;
}

module.exports = { Passkeys, cbor, coseToJwk };
