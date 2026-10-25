// Studio de thème : dégradés multi-couleurs et réglages visuels, propres à chaque visiteur (clé « app.theme »).
(function (root) {
  const KEY = 'app.theme', TYPES = ['linear', 'radial', 'conic'], FONTS = { system: 'system-ui,sans-serif', serif: 'Georgia,"Times New Roman",serif', mono: 'ui-monospace,Menlo,Consolas,monospace', round: '"Trebuchet MS","Segoe UI",system-ui,sans-serif' };
  const MAX_STOPS = 6, HEX = /^#[0-9a-f]{6}$/i;
  const hex = (c, d) => HEX.test(c) ? c.toLowerCase() : d;
  const num = (n, lo, hi, d) => Number.isFinite(+n) && n !== '' && n !== null ? Math.min(hi, Math.max(lo, Math.round(+n))) : d;
  const grad = (g, d) => {
    g = g || {}; let stops = (Array.isArray(g.stops) ? g.stops : []).slice(0, MAX_STOPS).map((s, i) => ({ c: hex(s && s.c, '#9146ff'), p: num(s && s.p, 0, 100, 0) }));
    if (stops.length < 2) stops = d.stops.map(s => ({ ...s }));
    return { type: TYPES.includes(g.type) ? g.type : d.type, angle: num(g.angle, 0, 360, d.angle), stops: stops };
  };
  const DEF = {
    bg: { type: 'linear', angle: 135, stops: [{ c: '#1a0b3b', p: 0 }, { c: '#0b3a5c', p: 50 }, { c: '#0f1115', p: 100 }] },
    acc: { type: 'linear', angle: 90, stops: [{ c: '#9146ff', p: 0 }, { c: '#ff4d8d', p: 100 }] },
  };
  const PRESETS = {
    'Aurore': { bg: { type: 'linear', angle: 160, stops: [{ c: '#0b1d3a', p: 0 }, { c: '#1b6b5a', p: 55 }, { c: '#6a2fd6', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#38ef7d', p: 0 }, { c: '#00c6ff', p: 100 }] }, card: '#0d1b2a', fg: '#eafff6', lnk: '#7dffd0' },
    'Coucher de soleil': { bg: { type: 'linear', angle: 180, stops: [{ c: '#2b0a3d', p: 0 }, { c: '#c0392b', p: 60 }, { c: '#ffb347', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#ff512f', p: 0 }, { c: '#f9d423', p: 100 }] }, card: '#2a1020', fg: '#fff4e6', lnk: '#ffd27d' },
    'Océan': { bg: { type: 'radial', angle: 0, stops: [{ c: '#0072ff', p: 0 }, { c: '#003a7a', p: 55 }, { c: '#001226', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#00c6ff', p: 0 }, { c: '#0072ff', p: 100 }] }, card: '#07203c', fg: '#e6f4ff', lnk: '#7fd4ff' },
    'Arc-en-ciel': { bg: { type: 'conic', angle: 0, stops: [{ c: '#ff0040', p: 0 }, { c: '#ffd000', p: 20 }, { c: '#20e070', p: 40 }, { c: '#00b4ff', p: 60 }, { c: '#8a2be2', p: 80 }, { c: '#ff0040', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#ff0040', p: 0 }, { c: '#ffd000', p: 33 }, { c: '#20e070', p: 66 }, { c: '#00b4ff', p: 100 }] }, card: '#101018', fg: '#ffffff', lnk: '#ffe27a' },
    'Barbe à papa': { bg: { type: 'linear', angle: 45, stops: [{ c: '#ffd1f0', p: 0 }, { c: '#c9d6ff', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#ff4d8d', p: 0 }, { c: '#7a5cff', p: 100 }] }, card: '#ffffff', fg: '#2a2140', lnk: '#b01e6a' },
    'Matrix': { bg: { type: 'linear', angle: 180, stops: [{ c: '#000000', p: 0 }, { c: '#012a0f', p: 100 }] }, acc: { type: 'linear', angle: 90, stops: [{ c: '#00ff66', p: 0 }, { c: '#009933', p: 100 }] }, card: '#021a0a', fg: '#b6ffcf', lnk: '#4dff94', font: 'mono' },
  };
  const clean = t => {
    t = t || {}; const d = DEF;
    return {
      on: t.on === true, bg: grad(t.bg, d.bg), acc: grad(t.acc, d.acc),
      card: hex(t.card, '#181b22'), cardAlpha: num(t.cardAlpha, 30, 100, 88), fg: hex(t.fg, '#e8eaf0'), lnk: hex(t.lnk, '#b794ff'),
      radius: num(t.radius, 0, 28, 12), font: FONTS[t.font] ? t.font : 'system', anim: t.anim === true, glow: t.glow === true,
    };
  };
  const load = st => { try { return clean(JSON.parse(st.getItem(KEY))); } catch (e) { return clean(); } };
  const save = (st, t) => { const c = clean(t); st.setItem(KEY, JSON.stringify(c)); return c; };
  const css = g => {
    const s = g.stops.slice().sort((a, b) => a.p - b.p).map(x => `${x.c} ${x.p}%`).join(',');
    return g.type === 'radial' ? `radial-gradient(circle at center,${s})` : g.type === 'conic' ? `conic-gradient(from ${g.angle}deg at 50% 50%,${s})` : `linear-gradient(${g.angle}deg,${s})`;
  };
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = g => '#' + [0, 1, 2].map(i => Math.round(g.stops.reduce((a, s) => a + rgb(s.c)[i], 0) / g.stops.length).toString(16).padStart(2, '0')).join('');
  const rgba = (c, a) => `rgba(${rgb(c).join(',')},${a / 100})`;
  // couleur de texte lisible sur le dégradé d'accent : celle qui contraste le mieux avec la couleur moyenne
  const onAcc = g => { const m = mix(g); return ratio('#ffffff', m) >= ratio('#000000', m) ? '#ffffff' : '#000000'; };
  const VARS = ['--bg-img', '--acc-img', '--bg', '--acc', '--card', '--hdr', '--fg', '--mut', '--lnk', '--bd', '--onacc', '--radius', '--font', '--glow'];
  const apply = (t, doc) => {
    const el = doc.documentElement, s = el.style;
    if (!t.on) { VARS.forEach(v => s.removeProperty(v)); delete el.dataset.custom; delete el.dataset.anim; return; }
    const set = (k, v) => s.setProperty(k, v), bgm = mix(t.bg), accm = mix(t.acc);
    set('--bg-img', css(t.bg)); set('--acc-img', css(t.acc)); set('--bg', bgm); set('--acc', accm);
    set('--card', rgba(t.card, t.cardAlpha)); set('--hdr', rgba(t.card, Math.min(100, t.cardAlpha + 8)));
    set('--fg', t.fg); set('--mut', rgba(t.fg, 72)); set('--lnk', t.lnk); set('--bd', rgba(t.fg, 22));
    set('--onacc', onAcc(t.acc)); set('--radius', t.radius + 'px'); set('--font', FONTS[t.font]);
    set('--glow', t.glow ? `0 0 14px ${accm}` : 'none');
    el.dataset.custom = '1'; if (t.anim) el.dataset.anim = '1'; else delete el.dataset.anim;
  };
  const exportText = t => JSON.stringify({ format: 'twitchgram-theme', theme: clean(Object.assign({}, t, { on: true })) }, null, 2);
  const importText = txt => { let o; try { o = JSON.parse(txt); } catch (e) { throw new Error('JSON invalide'); } if (!o || o.format !== 'twitchgram-theme' || !o.theme) throw new Error('Ce n’est pas un thème TwitchGram'); return clean(Object.assign({}, o.theme, { on: true })); };
  const exported = { KEY, TYPES, FONTS, PRESETS, DEF, MAX_STOPS, clean, load, save, css, apply, mix, ratio, onAcc, exportText, importText };
  if (typeof module !== 'undefined') module.exports = exported; else root.Theme = exported;
})(this);
