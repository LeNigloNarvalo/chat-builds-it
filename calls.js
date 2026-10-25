// Appels audio/vidéo 1-à-1 (WebRTC) depuis la messagerie privée. Le flux audio/vidéo passe directement de navigateur à navigateur ;
// le serveur temps réel (SSE + POST /api/rtc) ne relaie que la signalisation (offre, réponse, candidats ICE) et refuse les comptes bloqués.
const Calls = (function () {
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  let sync = null, shown = n => n, onEnd = () => {}, st = null, box = null, ring = null, tick = null;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const supported = () => typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const busy = () => !!st;
  const sig = (type, extra) => sync.send('/api/rtc', Object.assign({ to: st.peer, type }, extra || {}));

  // ---- sonnerie (oscillateur Web Audio, aucun fichier) ----
  function ringStart() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = new AC(); let on = true;
      const beep = () => { if (!on) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 440; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4); };
      beep(); const iv = setInterval(beep, 1800); ring = () => { on = false; clearInterval(iv); try { ctx.close(); } catch (e) {} };
    } catch (e) { ring = null; }
  }
  const ringStop = () => { if (ring) { ring(); ring = null; } };

  // ---- interface : fenêtre modale propre à l'appel, indépendante du rendu de l'application ----
  function ui() {
    if (!box) {
      box = document.createElement('div'); box.id = 'callbox'; box.className = 'callbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'false');
      box.addEventListener('click', ev => { const b = ev.target.closest('[data-cl]'); if (b) act(b.dataset.cl); });
      document.body.appendChild(box);
    }
    if (!st) { box.hidden = true; return; }
    box.hidden = false; box.setAttribute('aria-label', 'Appel avec ' + shown(st.peer));
    const who = esc(shown(st.peer)), k = st.kind === 'video' ? 'vidéo' : 'audio';
    const status = { ringing: `Appel ${k} vers ${who}… ça sonne`, incoming: `📞 ${who} vous appelle (${k})`, connecting: 'Connexion…', live: '', over: st.msg || 'Appel terminé' }[st.phase];
    const live = st.phase === 'live' || st.phase === 'connecting';
    box.innerHTML = `<div class="callin"><b>${who}</b> <span id="callstatus" role="status" aria-live="polite">${st.phase === 'live' ? '<span id="calltime">00:00</span>' : status}</span>
      <div class="callvids"><video id="callremote" autoplay playsinline muted ${st.hasRemoteVideo ? '' : 'hidden'}></video><video id="calllocal" autoplay playsinline muted ${st.camOn || st.screenOn ? '' : 'hidden'}></video>${st.hasRemoteVideo ? '' : `<div class="callava" aria-hidden="true">${st.kind === 'video' ? '📹' : '🎧'}</div>`}</div>
      <div class="row callbtns">${st.phase === 'incoming' ? `<button data-cl="accept" class="callok">✅ Accepter</button><button data-cl="decline" class="callko">❌ Refuser</button>`
        : st.phase === 'over' ? `<button data-cl="close">Fermer</button>`
        : `${live ? `<button data-cl="mic" aria-pressed="${!st.micOn}">${st.micOn ? '🎤 Couper le micro' : '🔇 Réactiver le micro'}</button>${st.kind === 'video' ? `<button data-cl="cam" aria-pressed="${!st.camOn}">${st.camOn ? '📷 Couper la caméra' : '🚫 Réactiver la caméra'}</button>` : ''}${navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? `<button data-cl="screen" aria-pressed="${!!st.screenOn}">${st.screenOn ? '⏹ Arrêter le partage' : '🖥 Partager l’écran'}</button>` : ''}` : ''}<button data-cl="hang" class="callko">📵 ${st.phase === 'ringing' ? 'Annuler' : 'Raccrocher'}</button>`}</div></div>`;
    attach();
  }
  function attach() {
    const r = box.querySelector('#callremote'), l = box.querySelector('#calllocal');
    if (r && st.remote && r.srcObject !== st.remote) r.srcObject = st.remote;
    if (l) { const s = st.screenOn ? st.screen : st.local; if (s && l.srcObject !== s) l.srcObject = s; }
    if (st.remote && !box.querySelector('#callaudio')) { const a = document.createElement('audio'); a.id = 'callaudio'; a.autoplay = true; a.srcObject = st.remote; box.appendChild(a); }
  }
  function timer() { clearInterval(tick); tick = setInterval(() => { const e = document.getElementById('calltime'); if (e && st && st.at2) { const s = Math.floor((Date.now() - st.at2) / 1000); e.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); } }, 500); }

  // ---- cycle de vie ----
  function cleanup(msg) {
    ringStop(); clearInterval(tick);
    if (st) { for (const s of [st.local, st.screen]) if (s) s.getTracks().forEach(t => t.stop()); if (st.pc) { try { st.pc.close(); } catch (e) {} } }
    const box2 = document.getElementById('callaudio'); if (box2) box2.remove();
    if (msg && st) { st = { peer: st.peer, kind: st.kind, phase: 'over', msg }; ui(); setTimeout(() => { if (st && st.phase === 'over') { st = null; ui(); } }, 4000); } else { st = null; ui(); }
    onEnd();
  }
  async function media(kind) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' }); }
    catch (e) { throw new Error(kind === 'video' ? 'Caméra ou micro inaccessible : autorisez-les dans le navigateur' : 'Micro inaccessible : autorisez-le dans le navigateur'); }
  }
  function makePc() {
    const pc = new RTCPeerConnection(ICE); st.pc = pc; st.pending = []; st.remote = new MediaStream(); st.polite = st.role === 'callee'; st.making = false;
    pc.ontrack = ev => { if (!st) return; st.remote.addTrack(ev.track); const upd = () => { if (!st) return; st.hasRemoteVideo = st.remote.getVideoTracks().some(t => t.readyState === 'live' && !t.muted); ui(); };
      if (ev.track.kind === 'video') { ev.track.onmute = upd; ev.track.onunmute = upd; ev.track.onended = upd; } upd(); };
    pc.onicecandidate = ev => { if (ev.candidate && st) sig('ice', { cand: ev.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => { if (!st) return; if (pc.connectionState === 'connected' && st.phase !== 'live') { st.phase = 'live'; st.at2 = st.at2 || Date.now(); ui(); timer(); } else if (pc.connectionState === 'failed') { sig('end').catch(() => {}); cleanup('La connexion a échoué'); } };
    pc.onnegotiationneeded = async () => { if (!st || !st.ready) return; try { st.making = true; await pc.setLocalDescription(); await sig('offer', { sdp: pc.localDescription }); } catch (e) {} finally { if (st) st.making = false; } };
    for (const t of st.local.getTracks()) pc.addTrack(t, st.local);
    return pc;
  }
  async function start(peer, kind) {
    if (!supported()) throw new Error('Ce navigateur ne gère pas les appels (WebRTC)');
    if (st) throw new Error('Un appel est déjà en cours');
    kind = kind === 'video' ? 'video' : 'audio';
    const local = await media(kind);
    st = { peer, kind, role: 'caller', phase: 'ringing', local, micOn: true, camOn: kind === 'video', screenOn: false }; ui(); ringStart();
    try { const r = await sig('invite', { kind }); if (!r.ringing) { cleanup(`${shown(peer)} n’est pas connecté·e : appel manqué enregistré dans la conversation`); } }
    catch (e) { const m = e.message; cleanup(m); throw e; }
  }
  async function accept() {
    if (!st || st.phase !== 'incoming') return;
    try { st.local = await media(st.kind); } catch (e) { await sig('decline').catch(() => {}); cleanup(e.message); return; }
    ringStop(); st.micOn = true; st.camOn = st.kind === 'video'; st.phase = 'connecting'; st.ready = false; makePc(); ui();
    try { await sig('accept'); } catch (e) { cleanup(e.message); }
  }
  async function onSignal(d) {
    const t = d.type;
    if (t === 'invite') { // un autre appel déjà en cours : le serveur l'empêche, on ignore par prudence
      if (st) return; st = { peer: d.from, kind: d.kind === 'video' ? 'video' : 'audio', role: 'callee', phase: 'incoming' }; ui(); ringStart(); return;
    }
    if (!st || d.from !== st.peer) return;
    if (t === 'timeout') return cleanup(st.role === 'caller' ? `${shown(st.peer)} n’a pas répondu` : 'Appel manqué');
    if (t === 'cancel') return cleanup(`Appel manqué de ${shown(st.peer)}`);
    if (t === 'decline') return cleanup(`${shown(st.peer)} a refusé l’appel`);
    if (t === 'end') return cleanup('Appel terminé');
    if (t === 'accept' && st.role === 'caller') { ringStop(); st.phase = 'connecting'; makePc(); st.ready = true; ui(); try { st.making = true; await st.pc.setLocalDescription(); await sig('offer', { sdp: st.pc.localDescription }); } catch (e) { cleanup('Connexion impossible'); } finally { st.making = false; } return; }
    if (!st.pc) return;
    const pc = st.pc;
    try {
      if (t === 'offer' && d.sdp) {
        if (st.making || pc.signalingState !== 'stable') { if (!st.polite) return; await pc.setLocalDescription({ type: 'rollback' }); }
        await pc.setRemoteDescription(d.sdp); await drain(); await pc.setLocalDescription(); st.ready = true; await sig('answer', { sdp: pc.localDescription });
      } else if (t === 'answer' && d.sdp) { await pc.setRemoteDescription(d.sdp); await drain(); }
      else if (t === 'ice' && d.cand) { if (pc.remoteDescription) await pc.addIceCandidate(d.cand).catch(() => {}); else st.pending.push(d.cand); }
    } catch (e) { /* signal obsolète : ignoré */ }
  }
  async function drain() { const p = st.pending; st.pending = []; for (const c of p) await st.pc.addIceCandidate(c).catch(() => {}); }

  // ---- commandes de la fenêtre ----
  async function act(a) {
    if (!st) return;
    if (a === 'close') return cleanup();
    if (a === 'accept') return accept();
    if (a === 'decline') { sig('decline').catch(() => {}); return cleanup(); }
    if (a === 'hang') { sig(st.phase === 'ringing' ? 'cancel' : 'end').catch(() => {}); return cleanup(); }
    if (a === 'mic') { st.micOn = !st.micOn; st.local.getAudioTracks().forEach(t => { t.enabled = st.micOn; }); ui(); }
    else if (a === 'cam') { st.camOn = !st.camOn; st.local.getVideoTracks().forEach(t => { t.enabled = st.camOn; }); ui(); }
    else if (a === 'screen') {
      if (st.screenOn) return stopScreen();
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true }), tr = s.getVideoTracks()[0]; st.screen = s; st.screenOn = true;
        const sender = st.pc.getSenders().find(x => x.track && x.track.kind === 'video') || st.pc.getSenders().find(x => !x.track && x.dtmf === undefined);
        if (sender) await sender.replaceTrack(tr); else st.pc.addTrack(tr, s);
        tr.onended = () => { if (st && st.screenOn) stopScreen(); }; ui();
      } catch (e) { if (st) { st.screenOn = false; st.screen = null; ui(); } }
    }
  }
  async function stopScreen() {
    if (!st || !st.screenOn) return;
    const cam = st.local.getVideoTracks()[0], sender = st.pc.getSenders().find(x => x.track && st.screen && st.screen.getTracks().includes(x.track));
    st.screen.getTracks().forEach(t => t.stop()); st.screen = null; st.screenOn = false;
    if (sender) await sender.replaceTrack(cam || null).catch(() => {});
    ui();
  }
  function init(o) { sync = o.sync; shown = o.shown || shown; onEnd = o.onEnd || onEnd; ui(); }
  return { init, start, onSignal, busy, supported, hangup: () => st && act('hang') };
})();
if (typeof module !== 'undefined') module.exports = Calls;
