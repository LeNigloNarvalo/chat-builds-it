// Appels audio/vidéo : signalisation relayée par le flux temps réel, blocages respectés, historique des appels manqués.
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
const { createServer } = require('./server.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cornichon-call-')), server = createServer({ spam: false, db: path.join(dir, 't.db'), authPerMin: 1000, ringMs: 300 });
(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (p, tok, data) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
  const rtc = (tok, to, type, extra) => call('/api/rtc', tok, Object.assign({ to, type }, extra));
  const listen = async tok => { // lecteur SSE : renvoie les événements « call » reçus
    const ac = new AbortController(), got = [], r = await fetch(base + '/api/stream', { headers: { Authorization: 'Bearer ' + tok }, signal: ac.signal }), rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const e = /^event: (.+)$/m.exec(b), d = /^data: (.+)$/m.exec(b); if (e && e[1] === 'call') got.push(JSON.parse(d[1])); } } } catch (e) {} })();
    return { got, stop: () => ac.abort() };
  };
  const wait = ms => new Promise(ok => setTimeout(ok, ms)), msgs = async tok => (await call('/api/state?v=-1', tok)).state.messages;
  const a = (await call('/api/signup', null, { name: 'alice', password: 'secret1' })).token, b = (await call('/api/signup', null, { name: 'bob', password: 'secret2' })).token, c = (await call('/api/signup', null, { name: 'carol', password: 'secret3' })).token;
  const lb = await listen(b); await wait(100);
  // appel accepté : sonnerie, offre/réponse/ICE relayés, historique « terminé »
  assert.strictEqual((await rtc(a, 'bob', 'invite', { kind: 'video' })).ringing, true);
  assert.strictEqual((await rtc(c, 'alice', 'invite')).status, 409); // alice est déjà en appel
  assert.strictEqual((await rtc(a, 'bob', 'offer', { sdp: { type: 'offer', sdp: 'x' } })).status, 409); // pas encore accepté
  assert.strictEqual((await rtc(b, 'alice', 'accept')).status, 200);
  await rtc(a, 'bob', 'offer', { sdp: { type: 'offer', sdp: 'v=0' } }); await rtc(a, 'bob', 'ice', { cand: { candidate: 'c1' } });
  await wait(100);
  assert.deepStrictEqual(lb.got.map(e => e.type), ['invite', 'offer', 'ice']); assert.strictEqual(lb.got[0].kind, 'video'); assert.strictEqual(lb.got[1].sdp.sdp, 'v=0');
  assert.strictEqual((await rtc(b, 'alice', 'end')).status, 200);
  let m = (await msgs(a)).filter(x => x.call); assert.strictEqual(m.length, 1); assert.strictEqual(m[0].call.status, 'ended'); assert.strictEqual(m[0].call.kind, 'video');
  // refus
  await rtc(a, 'bob', 'invite', { kind: 'audio' }); await rtc(b, 'alice', 'decline');
  assert.strictEqual((await msgs(b)).filter(x => x.call && x.call.status === 'declined').length, 1);
  // annulé par l'appelant = manqué pour bob
  await rtc(a, 'bob', 'invite'); await rtc(a, 'bob', 'cancel');
  // sans réponse : expiration
  await rtc(a, 'bob', 'invite'); await wait(500);
  m = (await msgs(b)).filter(x => x.call && x.call.status === 'missed'); assert.strictEqual(m.length, 2);
  assert.ok(lb.got.some(e => e.type === 'timeout'));
  // destinataire hors ligne : appel manqué enregistré directement
  assert.strictEqual((await rtc(a, 'carol', 'invite')).ringing, false);
  assert.strictEqual((await msgs(c)).filter(x => x.call && x.call.status === 'missed').length, 1);
  // blocages respectés dans les deux sens
  await call('/api/call', b, { method: 'toggleBlock', args: ['alice'] });
  assert.strictEqual((await rtc(a, 'bob', 'invite')).status, 403); assert.strictEqual((await rtc(b, 'alice', 'invite')).status, 403);
  assert.strictEqual((await rtc(a, 'alice', 'invite')).status, 400); assert.strictEqual((await rtc(a, 'bob', 'nope')).status, 400);
  assert.strictEqual((await call('/api/rtc', null, { to: 'bob', type: 'invite' })).status, 401);
  lb.stop(); server.close(); console.log('test-calls OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
