/* Sport — timer da allenamento: EMOM, Tabata, AMRAP, For Time, Boxe, MIX, Recupero; allenamenti salvati */
(() => {
  'use strict';
  const VERSION = '0.6.2';           // tenere uguale a VERSION in sw.js
  const RING = 578.05;               // 2 * PI * 92 (raggio dell'anello)
  const PREP = 10;                   // secondi per prepararsi
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const root = $('app');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ================= Dati (solo nel telefono) ================= */
  const KEY = 'sport.data.v1';
  const data = (() => {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : {};
    d.saved = Array.isArray(d.saved) ? d.saved : [];
    d.history = Array.isArray(d.history) ? d.history : [];
    d.last = d.last || null;
    d.rec = d.rec || { n: 0, at: 0, secs: 90 };
    d.section = ['train', 'martial', 'diary'].includes(d.section) ? d.section : 'train';
    d.backupAt = d.backupAt || 0;
    d.lastBy = d.lastBy || {};
    return d;
  })();
  if (data.last && TYPES_SEC_OF(data.last.type) && !data.lastBy[TYPES_SEC_OF(data.last.type)]) data.lastBy[TYPES_SEC_OF(data.last.type)] = data.last;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* memoria piena o bloccata */ } }
  function TYPES_SEC_OF(type) { return type === 'boxe' ? 'martial' : type ? 'train' : null; }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ================= Formati ================= */
  function fmt(s) {
    s = Math.max(0, Math.ceil(s - 1e-6));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }
  function fmtShort(s) {
    if (s < 60) return s + '"';
    if (s % 60 === 0) return s / 60 + "'";
    return fmt(s);
  }
  // "1:30" → 90 · "90" → 90 · "130" → 90 (minuti+secondi) · "5" → 5
  function parseTime(txt) {
    txt = String(txt).trim().replace(/[.,']/g, ':').replace(/"/g, '');
    if (!txt) return null;
    if (txt.includes(':')) {
      const [m, s] = txt.split(':');
      const mm = parseInt(m || '0', 10), ss = parseInt(s || '0', 10);
      return isNaN(mm) || isNaN(ss) ? null : mm * 60 + ss;
    }
    if (!/^\d+$/.test(txt)) return null;
    if (txt.length >= 3) return parseInt(txt.slice(0, -2), 10) * 60 + parseInt(txt.slice(-2), 10);
    return parseInt(txt, 10);
  }

  /* ================= Tipi di timer ================= */
  const TYPES = {
    emom: {
      name: 'EMOM', desc: 'Ogni minuto un round', color: '#FF9F0A', sec: 'train',
      def: { every: 60, rounds: 10 },
      fields: [
        { k: 'every', label: 'Ogni', kind: 'time', min: 10, max: 600 },
        { k: 'rounds', label: 'Round', kind: 'int', min: 1, max: 99 },
      ],
      summary: (c) => fmtShort(c.every) + ' × ' + c.rounds,
      total: (c) => c.every * c.rounds,
    },
    tabata: {
      name: 'Tabata', desc: 'Lavoro e riposo', color: '#FF453A', sec: 'train',
      def: { work: 20, rest: 10, rounds: 8 },
      fields: [
        { k: 'work', label: 'Lavoro', kind: 'time', min: 5, max: 900 },
        { k: 'rest', label: 'Riposo', kind: 'time', min: 0, max: 900 },
        { k: 'rounds', label: 'Round', kind: 'int', min: 1, max: 99 },
      ],
      summary: (c) => fmtShort(c.work) + ' / ' + fmtShort(c.rest) + ' × ' + c.rounds,
      total: (c) => c.work * c.rounds + c.rest * (c.rounds - 1),
    },
    amrap: {
      name: 'AMRAP', desc: 'Più round possibili', color: '#FF375F', sec: 'train',
      def: { dur: 600 },
      fields: [{ k: 'dur', label: 'Durata', kind: 'time', min: 60, max: 5400, step: 60 }],
      summary: (c) => fmtShort(c.dur),
      total: (c) => c.dur,
    },
    fortime: {
      name: 'For Time', desc: 'Più veloce possibile', color: '#7D7AFF', sec: 'train',
      def: { cap: 900 },
      fields: [{ k: 'cap', label: 'Tempo limite', kind: 'time', min: 0, max: 5400, step: 60, zero: 'nessuno' }],
      summary: (c) => (c.cap ? 'limite ' + fmtShort(c.cap) : 'senza limite'),
      total: (c) => c.cap,
    },
    boxe: {
      name: 'Round', title: 'Timer a round', desc: 'Round e pausa con campanella', color: '#FFD60A', sec: 'martial',
      def: { round: 180, rest: 60, rounds: 12 },
      fields: [
        { k: 'round', label: 'Round', kind: 'time', min: 30, max: 600 },
        { k: 'rest', label: 'Pausa', kind: 'time', min: 0, max: 300 },
        { k: 'rounds', label: 'Quanti', kind: 'int', min: 1, max: 30 },
      ],
      summary: (c) => fmtShort(c.round) + ' / ' + fmtShort(c.rest) + ' × ' + c.rounds,
      total: (c) => c.round * c.rounds + c.rest * (c.rounds - 1),
    },
    mix: {
      name: 'MIX', desc: 'Più timer in fila', color: '#32D7C6', sec: 'train', wide: true,
      def: { blocks: [{ t: 'emom', every: 60, rounds: 5 }, { t: 'rest', secs: 60 }, { t: 'tabata', work: 20, rest: 10, rounds: 8 }] },
      fields: [],
      summary: (c) => c.blocks.map((b) => BLOCK[b.t].name).join(' → '),
      total: (c) => c.blocks.reduce((a, b) => a + blockTotal(b), 0),
    },
    recupero: {
      name: 'Riposo tra le serie', short: 'Riposo', desc: 'Con i pesi: suona quando riparte la serie', color: '#0A84FF', sec: 'train', hidden: true,
      def: { secs: 90 },
      fields: [{ k: 'secs', label: 'Altro', kind: 'time', min: 10, max: 900 }],
      summary: (c) => fmtShort(c.secs),
      total: (c) => c.secs,
    },
  };
  // Blocchi usabili dentro un MIX
  const BLOCK = {
    emom: { name: 'EMOM', color: TYPES.emom.color, fields: TYPES.emom.fields, def: TYPES.emom.def },
    tabata: { name: 'Tabata', color: TYPES.tabata.color, fields: TYPES.tabata.fields, def: TYPES.tabata.def },
    amrap: { name: 'AMRAP', color: TYPES.amrap.color, fields: TYPES.amrap.fields, def: { dur: 300 } },
    rest: { name: 'Riposo', color: '#0A84FF', fields: [{ k: 'secs', label: 'Durata', kind: 'time', min: 5, max: 900 }], def: { secs: 60 } },
  };
  function blockTotal(b) { return b.t === 'rest' ? b.secs : TYPES[b.t].total(b); }
  const label = (type, cfg) => type === 'mix' ? 'MIX ' + fmtShort(TYPES.mix.total(cfg)) : (TYPES[type].short || TYPES[type].name) + ' ' + TYPES[type].summary(cfg);

  // Blocchi di tempo di un timer (senza la preparazione)
  function segsFor(type, c) {
    const seg = [];
    if (type === 'emom') {
      for (let i = 1; i <= c.rounds; i++) seg.push({ kind: 'work', secs: c.every, round: i, of: c.rounds });
    } else if (type === 'tabata') {
      for (let i = 1; i <= c.rounds; i++) {
        seg.push({ kind: 'work', secs: c.work, round: i, of: c.rounds });
        if (i < c.rounds && c.rest > 0) seg.push({ kind: 'rest', secs: c.rest, round: i, of: c.rounds });
      }
    } else if (type === 'boxe') {
      for (let i = 1; i <= c.rounds; i++) {
        seg.push({ kind: 'work', secs: c.round, round: i, of: c.rounds, label: 'Round', bell: true });
        if (i < c.rounds && c.rest > 0) seg.push({ kind: 'rest', secs: c.rest, round: i, of: c.rounds, label: 'Pausa', bell: true });
      }
    } else if (type === 'amrap') {
      seg.push({ kind: 'work', secs: c.dur, amrap: true });
    } else if (type === 'fortime') {
      seg.push({ kind: 'work', secs: c.cap || Infinity, up: true });
    } else if (type === 'rest') {
      seg.push({ kind: 'rest', secs: c.secs, label: 'Riposo' });
    } else if (type === 'recupero') {
      seg.push({ kind: 'rest', secs: c.secs, label: 'Recupero' });
    } else if (type === 'mix') {
      c.blocks.forEach((b, bi) => segsFor(b.t, b).forEach((s) => { s.b = bi; s.bt = b.t; seg.push(s); }));
    }
    return seg;
  }
  function timeline(type, c) {
    const seg = segsFor(type, c);
    return type === 'recupero' ? seg : [{ kind: 'prep', secs: PREP }].concat(seg);
  }

  /* ================= Audio (solo suoni) ================= */
  const audio = { ctx: null, ready: false, els: {} };
  const AUDIO_MODE = 'wa';           // Web Audio (provato sull'iPhone: va insieme alla musica)
  const SOUNDS = {
    short: { f: 880, d: 0.2 }, long: { f: 1320, d: 0.7 }, half: { f: 660, d: 0.35 }, tic: { f: 1040, d: 0.09 },
    bell: { f: 830, d: 1.8, bell: true },     // campanella del ring
  };
  const BELL = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]];

  function wavUrl(snd, vol) {
    const rate = 44100, n = Math.floor(rate * snd.d);
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      let s, env;
      if (snd.bell) {
        s = BELL.reduce((a, [p, amp]) => a + amp * Math.sin(2 * Math.PI * snd.f * p * t), 0) / 1.87;
        env = Math.min(1, t / 0.005) * Math.exp(-t * 3.2);
      } else {
        s = 0.6 * Math.sin(2 * Math.PI * snd.f * t) + 0.4 * Math.sin(4 * Math.PI * snd.f * t);
        env = Math.min(1, t / 0.01) * Math.min(1, (snd.d - t) / 0.06);
      }
      v.setInt16(44 + i * 2, s * env * vol * 32767, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // Da chiamare dentro un tocco: iOS sblocca l'audio solo così
  function unlockAudio() {
    // «playback»: suona anche col tasto silenzioso (la vecchia scelta della pagina di prova non conta più)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* niente */ }
    try {
      if (AUDIO_MODE === 'wa') {
        if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.ctx.state !== 'running') audio.ctx.resume();
        const b = audio.ctx.createBuffer(1, 1, 22050), s = audio.ctx.createBufferSource();
        s.buffer = b; s.connect(audio.ctx.destination); s.start(0);
      } else {
        for (const k in SOUNDS) {
          if (!audio.els[k]) audio.els[k] = new Audio(wavUrl(SOUNDS[k], 0.8));
          const el = audio.els[k];
          el.muted = true;
          el.play().then(() => { el.pause(); el.currentTime = 0; el.muted = false; }).catch(() => {});
        }
      }
      audio.ready = true;
    } catch (e) { /* senza suono si va avanti lo stesso */ }
  }

  function beep(kind) {
    if (!audio.ready) return;
    const snd = SOUNDS[kind];
    if (AUDIO_MODE === 'wa' && audio.ctx) {
      const ctx = audio.ctx;
      if (ctx.state !== 'running') ctx.resume();
      const t = ctx.currentTime, g = ctx.createGain();
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t);
      if (snd.bell) {
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + snd.d);
        BELL.forEach(([p, amp]) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = snd.f * p; og.gain.value = amp / 1.87;
          o.connect(og); og.connect(g); o.start(t); o.stop(t + snd.d + 0.05);
        });
      } else {
        // nota + ottava sopra: suono pieno e udibile dall'altoparlante del telefono
        g.gain.exponentialRampToValueAtTime(1, t + 0.008);
        g.gain.setValueAtTime(1, t + snd.d * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + snd.d);
        [[snd.f, 'square', 0.35], [snd.f * 2, 'sine', 0.5]].forEach(([f, type, lvl]) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = type; o.frequency.value = f; og.gain.value = lvl;
          o.connect(og); og.connect(g); o.start(t); o.stop(t + snd.d + 0.03);
        });
      }
    } else if (audio.els[kind]) {
      const el = audio.els[kind];
      el.currentTime = 0;
      el.play().catch(() => {});
    }
  }
  const beeps = (kind, times, gap) => { for (let k = 0; k < times; k++) setTimeout(() => beep(kind), k * gap); };

  const HOLD_MS = 450;               // tieni premuto per fermare: breve, ma evita i tocchi per sbaglio

  /* ================= Schermo sempre acceso ================= */
  let lock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    try { lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; }
  }
  function releaseAwake() { if (lock) { lock.release().catch(() => {}); lock = null; } }

  /* ================= Motore: il tempo viene dall'orologio, non dai tick ================= */
  let run = null;

  function elapsed() { return ((run.paused ? run.pausedAt : Date.now()) - run.start) / 1000; }
  function locate(el) {
    let acc = 0;
    for (let i = 0; i < run.seg.length; i++) {
      const s = run.seg[i];
      if (el < acc + s.secs) return { i, s, left: acc + s.secs - el, into: el - acc };
      acc += s.secs;
    }
    return null;
  }
  // Ogni segnale scatta una volta; tornando dopo un'assenza, quelli vecchi si saltano
  function cue(id, atLeft, left, fn) {
    if (run.fired.has(id) || left > atLeft) return;
    run.fired.add(id);
    if (atLeft - left < 1.2) fn();
  }
  function pulse(flash) {
    body.classList.remove('pulse', 'flash'); void body.offsetWidth;
    body.classList.add('pulse'); if (flash) body.classList.add('flash');
  }
  const KIND_LABEL = { prep: 'Preparati', work: 'Lavoro', rest: 'Riposo' };
  const segLabel = (s) => s.label || KIND_LABEL[s.kind];
  const isAmrap = (s) => s && s.kind === 'work' && (s.amrap || s.bt === 'amrap');

  function tick() {
    if (!run || run.over) return;
    const el = elapsed();
    const w = locate(el);
    if (!w) return finish(true);
    const { i, s, left, into } = w;
    const finite = isFinite(s.secs);

    // segnali sonori
    if (i > 0) cue('s' + i, s.secs - 0.05, left, () => {
      if (s.bell) { if (s.kind === 'work') beep('bell'); else beeps('bell', 3, 260); }
      else beep(s.kind === 'rest' ? 'half' : 'long');
      pulse(true);
    });
    const boxRound = s.bell && s.kind === 'work';
    if (finite && s.secs >= 4 && !boxRound) for (const n of [3, 2, 1]) cue(i + ':' + n, n, left, () => { beep('short'); pulse(false); });
    if (finite && s.kind === 'work' && s.secs >= 30) {
      if (!s.bell) cue(i + ':h', s.secs / 2, left, () => beep('half'));
      cue(i + ':10', 10, left, () => beeps('tic', 2, 140));
    }

    // schermo
    if (run.lastKind !== s.kind) {
      body.classList.remove('prep', 'work', 'rest');
      body.classList.add(s.kind);
      run.lastKind = s.kind;
    }
    $('phase').textContent = segLabel(s);
    $('time').textContent = s.up ? fmt(into) : fmt(left);
    const frac = s.up ? (finite ? into / s.secs : (into % 60) / 60) : left / s.secs;
    $('prog').style.strokeDashoffset = String(RING * (1 - frac));

    let rr = '';
    if (s.round) rr = 'Round ' + s.round + '/' + s.of;
    else if (isAmrap(s) || (run.type === 'amrap')) rr = run.rounds + ' round';
    else if (run.type === 'recupero') rr = 'Serie ' + data.rec.n;
    $('rRound').textContent = rr;
    if (run.type === 'mix') {
      const b = s.b === undefined ? run.cfg.blocks[0] : run.cfg.blocks[s.b];
      $('rName').textContent = s.b === undefined ? run.name : (s.b + 1) + '/' + run.cfg.blocks.length + ' · ' + BLOCK[b.t].name;
    }
    const nx = run.seg[i + 1];
    let nxt;
    if (run.paused) nxt = 'In pausa · tocca per riprendere';
    else if (nx && run.type === 'mix' && nx.b !== s.b) nxt = 'poi: ' + BLOCK[run.cfg.blocks[nx.b].t].name + ' ' + fmtShort(blockTotal(run.cfg.blocks[nx.b]));
    else if (nx) nxt = 'poi: ' + segLabel(nx).toLowerCase() + ' ' + fmtShort(nx.secs);
    else if (s.up) nxt = finite ? 'limite ' + fmtShort(s.secs) : 'tocca FINITO quando hai finito';
    else if (isAmrap(s)) nxt = 'tocca +1 a ogni round finito';
    else if (run.type === 'recupero') nxt = 'poi: prossima serie';
    else nxt = 'ultimo blocco';
    $('next').textContent = nxt;
    const act = $('act');
    if (act) act.disabled = run.type === 'fortime' ? s.kind !== 'work' : !isAmrap(s);

    if (!run.paused) run.raf = requestAnimationFrame(tick);
  }

  function start(type, cfg, name, savedId) {
    unlockAudio();
    run = {
      type, cfg: clone(cfg), name: name || label(type, cfg), savedId: savedId || null,
      seg: timeline(type, cfg), start: Date.now(), paused: false, pausedAt: 0,
      fired: new Set(), rounds: 0, splits: [], lastKind: null, over: false,
    };
    if (type === 'recupero') {
      if (Date.now() - data.rec.at > 3 * 3600e3) data.rec.n = 0;   // dopo 3 ore si riparte da zero
      data.rec.n++; data.rec.at = Date.now(); data.rec.secs = cfg.secs;
      beep('tic');
    } else {
      data.last = { type, cfg: clone(cfg), name: run.name, savedId: run.savedId, custom: !!name };
      data.lastBy[TYPES[type].sec] = data.last;
    }
    persist();
    view = 'run';
    render();
    keepAwake();
    clearInterval(run.iv); run.iv = setInterval(tick, 250);   // riserva se l'animazione rallenta
    tick();
  }

  function togglePause() {
    if (!run || run.over) return;
    if (run.paused) { run.start += Date.now() - run.pausedAt; run.paused = false; body.classList.remove('paused'); unlockAudio(); }
    else { run.pausedAt = Date.now(); run.paused = true; body.classList.add('paused'); }
    cancelAnimationFrame(run.raf); tick();
  }

  // completed = finito davvero (tempo scaduto o FINITO); false = fermato
  function finish(completed) {
    if (!run || run.over) return;
    const prep = run.type === 'recupero' ? 0 : PREP;
    const el = Math.max(0, elapsed() - prep);
    const at = locate(elapsed());
    run.reached = at && at.s.round ? at.s.round : 0;
    run.over = true;
    cancelAnimationFrame(run.raf); clearInterval(run.iv);
    releaseAwake();

    if (run.type === 'recupero') {
      if (completed) beeps('long', 2, 300);
      cur = { type: 'recupero', cfg: { secs: data.rec.secs }, savedId: null };
      view = 'recupero'; render();
      return;
    }

    const total = TYPES[run.type].total(run.cfg);
    const secs = run.type === 'fortime' ? Math.min(el, run.cfg.cap || el) : completed ? total : el;
    run.result = { secs, completed };
    if (el > 0) {
      data.history.unshift({
        at: Date.now(), type: run.type, name: run.name, cfg: run.cfg, secs: Math.round(secs),
        rounds: run.rounds || undefined, splits: run.splits.length ? run.splits : undefined, completed,
      });
      data.history = data.history.slice(0, 500);
      persist();
    }
    if (completed) { if (run.type === 'boxe') beeps('bell', 3, 260); else { beep('long'); setTimeout(() => beep('long'), 260); } }
    view = 'done';
    render();
    if (wantReload) setTimeout(() => { if (view !== 'run') location.reload(); }, 4000);
  }

  /* ================= Schermate ================= */
  let view = 'home';
  let cur = null;          // impostazioni in modifica: { type, cfg, savedId }

  function render() {
    body.className = '';
    if (view === 'home') { body.className = 'has-tabs'; root.innerHTML = data.section === 'diary' ? diaryHTML() : homeHTML(); }
    else if (view === 'config') root.innerHTML = cur.type === 'mix' ? mixHTML() : configHTML();
    else if (view === 'recupero') root.innerHTML = recHTML();
    else if (view === 'run') { body.className = 'running'; root.innerHTML = runHTML(); bindRun(); }
    else if (view === 'done') { body.className = run.result.completed ? 'done' : 'stopped'; root.innerHTML = doneHTML(); }
    $('tabbar').hidden = view !== 'home';
    if (view === 'home') $('tabbar').innerHTML = SECTIONS.map((s) => `<button class="${s.k === data.section ? 'on' : ''}" data-act="sec" data-s="${s.k}" role="tab" aria-selected="${s.k === data.section}">${ICONS[s.k]}<span>${s.name}</span></button>`).join('');
    window.scrollTo(0, 0); root.scrollTop = 0;
  }

  // Menu in basso: una voce per sezione (poi Stretching e Diario)
  const ICONS = {
    train: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 2.2M9.5 2.5h5M12 2.5v3.5M18.6 6.4l1.4-1.4"/></svg>',
    martial: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V7.5A4.5 4.5 0 0 1 12.5 3H14a4.5 4.5 0 0 1 4.5 4.5V13a5.5 5.5 0 0 1-5.5 5.5h-1.5A4.5 4.5 0 0 1 7 14v-.5"/><path d="M8 11a2.2 2.2 0 0 0-2.2 2.2v.1A2.2 2.2 0 0 0 8 15.5h3"/><path d="M8.5 18.5V21h8v-2.5M12 7.5h4"/></svg>',
  };
  ICONS.diary = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1"/><circle cx="12" cy="14.5" r="1"/></svg>';
  const SECTIONS = [{ k: 'train', name: 'Allenamento' }, { k: 'martial', name: 'Arti marziali' }, { k: 'diary', name: 'Diario' }];
  function lastName(l) {
    const s = l.savedId && data.saved.find((x) => x.id === l.savedId);
    return s ? s.name : l.custom ? l.name : label(l.type, Object.assign(clone(TYPES[l.type].def), l.cfg));
  }

  function homeHTML() {
    const sec = data.section;
    const l = data.lastBy[sec];
    const repeat = l && TYPES[l.type] ? `
      <button class="repeat" data-act="repeat" style="--c:${TYPES[l.type].color}">
        <span class="play">▶</span>
        <span class="rtxt"><b>Ripeti</b><small>${esc(lastName(l))}</small></span>
      </button>` : '';
    const savedHere = data.saved.filter((s) => TYPES[s.type] && TYPES[s.type].sec === sec);
    const mine = savedHere.length
      ? `<div class="chips">${savedHere.map((s) => `
          <button class="chip" data-act="openSaved" data-id="${esc(s.id)}" style="--c:${TYPES[s.type].color}">
            <b>${esc(s.name)}</b><small>${esc((s.type === 'boxe' ? '' : TYPES[s.type].name + ' · ') + (s.type === 'mix' ? fmtShort(TYPES.mix.total(s.cfg)) : TYPES[s.type].summary(s.cfg)))}</small>
          </button>`).join('')}</div>`
      : '<p class="hint">Qui trovi i timer che salvi.</p>';
    const tile = (k, t) => `
      <button class="tile${t.wide || sec === 'martial' ? ' wide' : ''}" data-act="new" data-type="${k}" style="--c:${t.color}">
        <i></i><span><b>${t.title || t.name}</b><small>${t.desc}</small></span>${t.wide || sec === 'martial' ? '<em>›</em>' : ''}
      </button>`;
    const list = Object.entries(TYPES).filter(([, t]) => t.sec === sec && !t.hidden);
    const grid = list.filter(([, t]) => !t.wide).map(([k, t]) => tile(k, t)).join('');
    const wides = list.filter(([, t]) => t.wide).map(([k, t]) => tile(k, t)).join('');
    const rec = TYPES.recupero;
    const extra = sec === 'train' ? `
      <button class="tile wide" data-act="recupero" style="--c:${rec.color}">
        <i></i><span><b>${rec.name}</b><small>${rec.desc}</small></span><em>›</em>
      </button>` : '';
    return `
      <header class="top"><h1>Sport</h1><button class="ver" id="ver">v${VERSION}</button></header>
      <p class="secname">${SECTIONS.find((s) => s.k === sec).name}</p>
      ${repeat}
      <h2>I miei</h2>${mine}
      <h2>Nuovo</h2><div class="tiles">${grid}${wides}${extra}</div>`;
  }

  /* ================= Diario ================= */
  const SEC_COLOR = { train: '#FF453A', martial: '#FFD60A', stretch: '#BF5AF2' };
  const RING_ORDER = ['stretch', 'martial', 'train'];   // dal cerchio più piccolo al più grande
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const dkey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const secOf = (h) => (TYPES[h.type] && TYPES[h.type].sec) || 'train';
  const diary = { y: new Date().getFullYear(), m: new Date().getMonth(), day: null };
  const sessions = () => data.history.filter((h) => h.secs >= 30);   // sotto i 30 s non conta

  function streak() {
    const days = new Set(sessions().map((h) => dkey(h.at)));
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (!days.has(dkey(d.getTime()))) d.setDate(d.getDate() - 1);   // oggi non ancora: conta da ieri
    let n = 0;
    while (days.has(dkey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  function durTxt(s) { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? m % 60 + ' min' : ''); }

  function diaryHTML() {
    const all = sessions();
    const ws = weekStart();
    const week = all.filter((h) => h.at >= ws);
    const weekMin = Math.round(week.reduce((a, h) => a + h.secs, 0) / 60);
    // calendario del mese
    const byDay = {};
    all.forEach((h) => { const k = dkey(h.at); (byDay[k] = byDay[k] || new Set()).add(secOf(h)); });
    const first = (new Date(diary.y, diary.m, 1).getDay() + 6) % 7;
    const nDays = new Date(diary.y, diary.m + 1, 0).getDate();
    const today = dkey(Date.now());
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span class="day empty"></span>';
    for (let d = 1; d <= nDays; d++) {
      const k = diary.y + '-' + String(diary.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const s = byDay[k];
      let rings = '';
      if (s) {
        // un anello per tipo: dentro stretching, poi arti marziali, fuori allenamento
        const sh = []; let r = 0;
        RING_ORDER.filter((x) => s.has(x)).forEach((x) => { r += 1; sh.push(`0 0 0 ${r}px var(--surface)`); r += 2; sh.push(`0 0 0 ${r}px ${SEC_COLOR[x]}`); });
        rings = sh.join(',');
      }
      cells += `<button class="day${s ? ' has' : ''}${k === today ? ' today' : ''}${k === diary.day ? ' sel' : ''}" data-act="day" data-d="${k}"${s ? ` style="--rings:${rings}"` : ''}><span>${d}</span></button>`;
    }
    // elenco
    const list = diary.day ? all.filter((h) => dkey(h.at) === diary.day) : all.slice(0, 20);
    const dd = diary.day ? new Date(diary.day + 'T12:00:00') : null;
    const ltitle = dd ? GIORNI[dd.getDay()] + ' ' + dd.getDate() + ' ' + MESI[dd.getMonth()] : 'Ultime sessioni';
    const rows = list.length ? list.map((h) => {
      const d = new Date(h.at);
      const when = (diary.day ? '' : d.getDate() + ' ' + MESI[d.getMonth()].slice(0, 3) + ' · ') + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const bits = [when, fmt(h.secs)];
      if (h.rounds) bits.push(h.rounds + ' round');
      return `<button class="hrow" data-act="hdel" data-at="${h.at}" style="--c:${SEC_COLOR[secOf(h)]}">
          <i></i><span><b>${esc(h.name)}</b><small>${bits.join(' · ')}</small></span>${h.completed ? '' : '<em>fermato</em>'}${secOf(h) === 'train' ? `<span class="tt" style="--tc:${TYPES[h.type].color}">${TYPES[h.type].name}</span>` : ''}
        </button>`;
    }).join('') : `<p class="hint">${diary.day ? 'Nessuna sessione in questo giorno.' : 'Le sessioni finite compaiono qui.'}</p>`;
    const days = data.backupAt ? Math.floor((Date.now() - data.backupAt) / 864e5) : null;
    const old = all.length && (days === null || days >= 30);
    return `
      <header class="top"><h1>Diario</h1>
        <button class="icon bk${old ? ' warn' : ''}" data-act="backup" aria-label="Backup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M12 10.5v5.5M9.8 13.8 12 16l2.2-2.2"/></svg></button>
      </header>
      <div class="stats">
        <div class="stat"><b class="num">${streak()}</b><small>giorni di fila</small></div>
        <div class="stat"><b class="num">${weekMin}</b><small>min questa settimana</small></div>
        <div class="stat"><b class="num">${week.length}</b><small>sessioni in settimana</small></div>
      </div>
      <section class="cal">
        <div class="calhead">
          <button class="icon" data-act="mprev" aria-label="Mese prima">‹</button>
          <b>${MESI[diary.m]} ${diary.y}</b>
          <button class="icon" data-act="mnext" aria-label="Mese dopo">›</button>
        </div>
        <div class="dow"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>
        <div class="grid">${cells}</div>
        <div class="legend"><span style="--c:${SEC_COLOR.train}">Allenamento</span><span style="--c:${SEC_COLOR.martial}">Arti marziali</span></div>
      </section>
      <h2>${ltitle}${diary.day ? ' <button class="link" data-act="dayAll">tutte</button>' : ''}</h2>
      <div class="hlist">${rows}</div>
      <input type="file" id="impfile" accept="application/json,.json" hidden>`;
  }

  function openBackup() {
    const days = data.backupAt ? Math.floor((Date.now() - data.backupAt) / 864e5) : null;
    const when = days === null ? 'mai fatto' : days === 0 ? 'oggi' : days === 1 ? 'ieri' : days + ' giorni fa';
    const sh = $('sheet');
    sh.innerHTML = `
      <div class="sbox" role="dialog" aria-label="Backup">
        <h3>Backup</h3>
        <p>I dati stanno solo su questo telefono. Ultimo: <b>${when}</b></p>
        <div class="srow" style="grid-template-columns:1fr 1fr">
          <button class="btn ghost" data-s="imp">Importa</button>
          <button class="btn primary" data-s="exp">Esporta</button>
        </div>
      </div>`;
    sh.hidden = false;
    const close = () => { sh.hidden = true; sh.innerHTML = ''; sh.onclick = null; };
    sh.onclick = (e) => {
      if (e.target === sh) return close();
      const b = e.target.closest('[data-s]');
      if (!b) return;
      close();
      if (b.dataset.s === 'exp') exportData(); else $('impfile').click();
    };
  }

  async function exportData() {
    const txt = JSON.stringify({ app: 'sport', v: VERSION, at: Date.now(), data }, null, 1);
    const name = 'sport-backup-' + dkey(Date.now()) + '.json';
    const file = new File([txt], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Backup Sport' });   // iPhone: «Salva su File»
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      data.backupAt = Date.now(); persist(); render();
    } catch (e) { /* annullato */ }
  }

  function importData(file) {
    const rd = new FileReader();
    rd.onload = () => {
      let inc = null;
      try { inc = JSON.parse(rd.result); } catch (e) { inc = null; }
      const d = inc && inc.app === 'sport' && inc.data;
      if (!d || !Array.isArray(d.history) || !Array.isArray(d.saved)) { openConfirm('Questo file non è un backup di Sport.', 'Ok', null); return; }
      // unisce senza doppioni: sessioni per orario, salvati per id
      const seen = new Set(data.history.map((h) => h.at));
      const newH = d.history.filter((h) => h && h.at && TYPES[h.type] && !seen.has(h.at));
      const ids = new Set(data.saved.map((s) => s.id));
      const newS = d.saved.filter((s) => s && s.id && TYPES[s.type] && !ids.has(s.id));
      data.history = data.history.concat(newH).sort((a, b) => b.at - a.at).slice(0, 500);
      data.saved = data.saved.concat(newS);
      persist(); render();
      openConfirm(`Importati: ${newH.length} ${newH.length === 1 ? 'sessione' : 'sessioni'} e ${newS.length} ${newS.length === 1 ? 'timer salvato' : 'timer salvati'}.`, 'Ok', null);
    };
    rd.readAsText(file);
  }

  // Finestrella di conferma semplice
  function openConfirm(text, okLabel, onOk, danger) {
    const sh = $('sheet');
    sh.innerHTML = `
      <div class="sbox" role="dialog">
        <h3>${esc(text)}</h3>
        <div class="srow${onOk ? '' : ' one'}">
          ${onOk ? '<button class="btn ghost" data-s="no">Annulla</button>' : ''}
          <button class="btn ${danger ? 'ghost danger' : 'primary'}" data-s="ok">${esc(okLabel)}</button>
        </div>
      </div>`;
    sh.hidden = false;
    const close = () => { sh.hidden = true; sh.innerHTML = ''; sh.onclick = null; };
    sh.onclick = (e) => {
      if (e.target === sh) return close();
      const b = e.target.closest('[data-s]');
      if (!b) return;
      close();
      if (b.dataset.s === 'ok' && onOk) onOk();
    };
  }

  function fieldDisp(f, v) { return f.kind === 'int' ? String(v) : f.zero && !v ? f.zero : fmt(v); }
  function fieldRow(f, v, b, small) {
    const bAttr = b === null || b === undefined ? '' : ` data-b="${b}"`;
    return `
      <div class="field${small ? ' sm' : ''}">
        <span class="lab">${f.label}</span>
        <button class="step" data-act="dec" data-k="${f.k}"${bAttr} aria-label="Meno">−</button>
        <input class="val" data-k="${f.k}"${bAttr} inputmode="${f.kind === 'int' ? 'numeric' : 'text'}" enterkeyhint="done" autocomplete="off" value="${esc(fieldDisp(f, v))}">
        <button class="step" data-act="inc" data-k="${f.k}"${bAttr} aria-label="Più">+</button>
      </div>`;
  }
  function headerHTML(t, saved) {
    return `
      <header class="bar" style="--c:${t.color}">
        <button class="icon" data-act="home" aria-label="Indietro">‹</button>
        <h1>${t.title || t.name}</h1>
        <span class="icon"></span>
      </header>
      <p class="sub muted">${t.desc}</p>
      <input class="cname" id="cname" maxlength="40" placeholder="Nome sessione (facoltativo)" autocomplete="off" enterkeyhint="done" value="${esc(cur.name || '')}">`;
  }

  function saveRow(t, saved) {
    return saved
      ? `<button class="saverow on" data-act="star" style="--c:${t.color}">★ <b>${esc(saved.name)}</b><span>modifica</span></button>`
      : `<button class="saverow" data-act="star" style="--c:${t.color}">☆ Salva nei miei</button>`;
  }

  function configHTML() {
    const t = TYPES[cur.type];
    const saved = cur.savedId && data.saved.find((s) => s.id === cur.savedId);
    const total = t.total(cur.cfg);
    return `
      ${headerHTML(t, saved)}
      <div class="fields">${t.fields.map((f) => fieldRow(f, cur.cfg[f.k])).join('')}</div>
      <p class="total">Totale <b id="total">${total ? fmt(total) : '—'}</b></p>
      ${saveRow(t, saved)}
      <button class="btn primary go" data-act="go" style="--c:${t.color}">VIA</button>`;
  }

  function mixHTML() {
    const t = TYPES.mix;
    const saved = cur.savedId && data.saved.find((s) => s.id === cur.savedId);
    const bl = cur.cfg.blocks;
    const cards = bl.map((b, i) => {
      const B = BLOCK[b.t];
      return `
        <div class="block" style="--c:${B.color}">
          <div class="bhead">
            <i></i><b>${i + 1}. ${B.name}</b><span class="bsum" id="bs${i}">${fmt(blockTotal(b))}</span>
            <button class="mini" data-act="bup" data-b="${i}" aria-label="Su"${i === 0 ? ' disabled' : ''}>↑</button>
            <button class="mini" data-act="bdown" data-b="${i}" aria-label="Giù"${i === bl.length - 1 ? ' disabled' : ''}>↓</button>
            <button class="mini" data-act="bdel" data-b="${i}" aria-label="Togli"${bl.length === 1 ? ' disabled' : ''}>✕</button>
          </div>
          ${B.fields.map((f) => fieldRow(f, b[f.k], i, true)).join('')}
        </div>`;
    }).join('');
    const adds = Object.entries(BLOCK).map(([k, B]) => `<button class="addb" data-act="badd" data-t="${k}" style="--c:${B.color}">+ ${B.name}</button>`).join('');
    return `
      ${headerHTML(t, saved)}
      <div class="blocks">${cards}</div>
      <div class="adds">${adds}</div>
      <p class="total">Totale <b id="total">${fmt(t.total(cur.cfg))}</b></p>
      ${saveRow(t, saved)}
      <button class="btn primary go" data-act="go" style="--c:${t.color}">VIA</button>`;
  }

  function recHTML() {
    const t = TYPES.recupero;
    const fresh = Date.now() - data.rec.at <= 3 * 3600e3;
    const n = fresh ? data.rec.n : 0;
    const quick = [60, 90, 120, 180].map((s) => `<button class="tile qt" data-act="rec" data-s="${s}" style="--c:${t.color}"><b>${fmt(s)}</b></button>`).join('');
    return `
      <header class="bar" style="--c:${t.color}">
        <button class="icon" data-act="home" aria-label="Indietro">‹</button>
        <h1>Riposo tra le serie</h1>
        <span class="icon"></span>
      </header>
      <p class="sub muted">Finita una serie, tocca il tempo di riposo: suona quando devi ripartire.</p>
      <p class="sub">Serie fatte: <b class="num">${n}</b>${n ? ' · <button class="link" data-act="recReset">azzera</button>' : ''}</p>
      <div class="tiles">${quick}</div>
      <div class="fields" style="margin-top:10px">${fieldRow(t.fields[0], cur.cfg.secs)}</div>
      <button class="btn primary go" data-act="recGo" style="--c:${t.color}">▶ <span id="recGo">${fmt(cur.cfg.secs)}</span></button>`;
  }

  function runHTML() {
    const t = TYPES[run.type];
    const hasAmrap = run.type === 'amrap' || (run.type === 'mix' && run.cfg.blocks.some((b) => b.t === 'amrap'));
    const act = hasAmrap ? '<button class="btn big" id="act">+1 ROUND</button><button class="undo" id="undo" hidden>annulla ultimo round</button>'
      : run.type === 'fortime' ? '<button class="btn big" id="act">FINITO</button>' : '';
    return `
      <div class="rtop"><span id="rName">${esc(run.name)}</span><span id="rRound"></span></div>
      <section class="stage" id="stage">
        <div class="phase" id="phase"></div>
        <div class="dial">
          <svg viewBox="0 0 200 200" class="ring" aria-hidden="true">
            <defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="g1"/><stop offset="1" class="g2"/></linearGradient></defs>
            <circle class="track" cx="100" cy="100" r="92"/>
            <circle class="prog" id="prog" cx="100" cy="100" r="92"/>
          </svg>
          <div class="time" id="time"></div>
        </div>
        <div class="next" id="next"></div>
      </section>
      <div class="ractions" style="--c:${t.color}">
        ${act}
        <button class="btn hold" id="stop"><span class="fill"></span><span class="lbl">${run.type === 'recupero' ? 'Tieni premuto per saltare' : 'Tieni premuto per fermare'}</span></button>
      </div>`;
  }

  function doneHTML() {
    const r = run.result;
    const bits = [];
    if (run.type === 'fortime') bits.push(r.completed && r.secs < (run.cfg.cap || Infinity) ? 'Tempo ' + fmt(r.secs) : 'Tempo limite raggiunto');
    else bits.push(fmt(r.secs));
    if (run.rounds) bits.push(run.rounds + ' round');
    if (run.cfg.rounds) bits.push(r.completed ? run.cfg.rounds + ' round' : 'round ' + run.reached + '/' + run.cfg.rounds);
    if (run.type === 'mix') bits.push(run.cfg.blocks.length + ' blocchi');
    return `
      <section class="donebox">
        <div class="badge">${r.completed ? '✓' : '■'}</div>
        <h1>${r.completed ? 'Fatto' : 'Fermato'}</h1>
        <p class="dname">${esc(run.name)}</p>
        <p class="dstats">${bits.join(' · ')}</p>
      </section>
      <div class="dactions">
        ${run.savedId ? '' : '<button class="btn ghost" data-act="saveDone">☆ Salva allenamento</button>'}
        <button class="btn primary" data-act="home">Home</button>
      </div>`;
  }

  /* ================= Finestrella per salvare ================= */
  function openSheet(defName, existing, onDone) {
    const sh = $('sheet');
    sh.innerHTML = `
      <div class="sbox" role="dialog" aria-label="Salva allenamento">
        <h3>${existing ? 'Allenamento salvato' : 'Salva allenamento'}</h3>
        <input id="sname" maxlength="40" value="${esc(defName)}" autocomplete="off" enterkeyhint="done">
        <div class="srow">
          ${existing ? '<button class="btn ghost danger" data-s="del">Elimina</button>' : '<button class="btn ghost" data-s="no">Annulla</button>'}
          <button class="btn primary" data-s="ok">${existing ? 'Salva modifiche' : 'Salva'}</button>
        </div>
      </div>`;
    sh.hidden = false;
    const inp = $('sname');
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const close = () => { sh.hidden = true; sh.innerHTML = ''; sh.onclick = null; };
    sh.onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (e.target === sh) return close();
      if (!b) return;
      const a = b.dataset.s;
      if (a === 'no') return close();
      if (a === 'del') { onDone('del'); return close(); }
      const name = inp.value.trim() || defName;
      onDone('ok', name); close();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') sh.querySelector('[data-s="ok"]').click(); });
  }

  /* ================= Gesti ================= */
  // A quale oggetto appartiene un campo: le impostazioni del timer o un blocco del MIX
  function ctxOf(el) {
    const b = el.dataset.b;
    if (b !== undefined && b !== '') { const blk = cur.cfg.blocks[+b]; return { obj: blk, fields: BLOCK[blk.t].fields, b: +b }; }
    return { obj: cur.cfg, fields: TYPES[cur.type].fields, b: null };
  }
  function refreshTotals() {
    const tot = TYPES[cur.type].total(cur.cfg);
    const t = $('total'); if (t) t.textContent = tot ? fmt(tot) : '—';
    if (cur.type === 'mix') cur.cfg.blocks.forEach((bk, i) => { const s = $('bs' + i); if (s) s.textContent = fmt(blockTotal(bk)); });
    const g = $('recGo'); if (g) g.textContent = fmt(cur.cfg.secs);
  }
  function setField(ctx, k, v) {
    const f = ctx.fields.find((x) => x.k === k);
    v = Math.round(Math.min(f.max, Math.max(f.min, v)));
    ctx.obj[k] = v;
    const sel = '.val[data-k="' + k + '"]' + (ctx.b === null ? ':not([data-b])' : '[data-b="' + ctx.b + '"]');
    const inp = root.querySelector(sel);
    if (inp) inp.value = fieldDisp(f, v);
    refreshTotals();
  }
  function stepField(ctx, k, dir) {
    const f = ctx.fields.find((x) => x.k === k);
    const v = ctx.obj[k];
    const st = f.kind === 'int' ? 1 : f.step || ((dir > 0 ? v : v - 1) < 60 ? 5 : 15);
    let nv = v + dir * st;
    if (f.kind !== 'int' && !f.step) nv = Math.round(nv / st) * st;   // resta su multipli puliti
    setField(ctx, k, nv);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'home') { view = 'home'; render(); }
    else if (a === 'new') { cur = { type: b.dataset.type, cfg: clone(TYPES[b.dataset.type].def), savedId: null, name: '' }; view = 'config'; render(); }
    else if (a === 'openSaved') {
      const s = data.saved.find((x) => x.id === b.dataset.id);
      if (s) { cur = { type: s.type, cfg: Object.assign(clone(TYPES[s.type].def), clone(s.cfg)), savedId: s.id, name: s.name }; view = 'config'; render(); }
    }
    else if (a === 'repeat') {
      const l = data.lastBy[data.section];
      if (l && TYPES[l.type]) { const s = l.savedId && data.saved.find((x) => x.id === l.savedId); start(l.type, Object.assign(clone(TYPES[l.type].def), clone(l.cfg)), s ? s.name : l.custom ? l.name : null, s ? s.id : null); }
    }
    else if (a === 'sec') { data.section = b.dataset.s; persist(); render(); }
    else if (a === 'go') {
      const s = cur.savedId && data.saved.find((x) => x.id === cur.savedId);
      const nm = (cur.name || '').trim();
      start(cur.type, cur.cfg, nm || (s ? s.name : null), s ? s.id : null);
    }
    else if (a === 'recupero') { cur = { type: 'recupero', cfg: { secs: data.rec.secs || 90 }, savedId: null }; view = 'recupero'; render(); }
    else if (a === 'rec') { cur.cfg.secs = +b.dataset.s; start('recupero', cur.cfg); }
    else if (a === 'recGo') start('recupero', cur.cfg);
    else if (a === 'recReset') { data.rec.n = 0; persist(); render(); }
    else if (a === 'badd') { cur.cfg.blocks.push(Object.assign({ t: b.dataset.t }, clone(BLOCK[b.dataset.t].def))); render(); window.scrollTo(0, document.body.scrollHeight); }
    else if (a === 'bdel') { cur.cfg.blocks.splice(+b.dataset.b, 1); render(); }
    else if (a === 'bup' || a === 'bdown') {
      const i = +b.dataset.b, j = a === 'bup' ? i - 1 : i + 1, bl = cur.cfg.blocks;
      [bl[i], bl[j]] = [bl[j], bl[i]]; render();
    }
    else if (a === 'star') {
      const s = cur.savedId && data.saved.find((x) => x.id === cur.savedId);
      openSheet((cur.name || '').trim() || (s ? s.name : label(cur.type, cur.cfg)), !!s, (res, name) => {
        if (res === 'del') {
          data.saved = data.saved.filter((x) => x.id !== s.id);
          [data.last, data.lastBy.train, data.lastBy.martial].forEach((l) => { if (l && l.savedId === s.id) l.savedId = null; });
          cur.savedId = null;
        } else if (s) { s.name = name; s.cfg = clone(cur.cfg); }
        else { const id = uid(); data.saved.push({ id, name, type: cur.type, cfg: clone(cur.cfg) }); cur.savedId = id; }
        cur.name = res === 'del' ? cur.name : name;
        persist(); render();
      });
    }
    else if (a === 'mprev' || a === 'mnext') {
      diary.m += a === 'mnext' ? 1 : -1;
      if (diary.m < 0) { diary.m = 11; diary.y--; } else if (diary.m > 11) { diary.m = 0; diary.y++; }
      diary.day = null; render();
    }
    else if (a === 'day') { diary.day = diary.day === b.dataset.d ? null : b.dataset.d; render(); }
    else if (a === 'dayAll') { diary.day = null; render(); }
    else if (a === 'hdel') {
      const at = +b.dataset.at;
      openConfirm('Togliere questa sessione dal diario?', 'Togli', () => { data.history = data.history.filter((h) => h.at !== at); persist(); render(); }, true);
    }
    else if (a === 'backup') openBackup();
    else if (a === 'saveDone') {
      openSheet(run.name, false, (res, name) => {
        const id = uid();
        data.saved.push({ id, name, type: run.type, cfg: clone(run.cfg) });
        run.savedId = id; run.name = name;
        data.last = { type: run.type, cfg: clone(run.cfg), name, savedId: id };
        data.lastBy[TYPES[run.type].sec] = data.last;
        persist(); render();
      });
    }
  });

  // Tasti − / + : tocco singolo, oppure tieni premuto per scorrere veloce
  const rep = { t: 0, iv: 0 };
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.step');
    if (!b) return;
    e.preventDefault();
    const ctx = ctxOf(b), k = b.dataset.k, dir = b.dataset.act === 'inc' ? 1 : -1;
    stepField(ctx, k, dir);
    rep.t = setTimeout(() => { rep.iv = setInterval(() => stepField(ctx, k, dir), 90); }, 420);
  });
  const repStop = () => { clearTimeout(rep.t); clearInterval(rep.iv); };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, repStop));
  // il clic dopo pointerdown non deve contare due volte
  root.addEventListener('click', (e) => { if (e.target.closest('.step')) e.stopImmediatePropagation(); }, true);

  // Scrivere il valore a mano: "1:30", "90", "130"
  root.addEventListener('focusin', (e) => { if (e.target.classList.contains('val')) setTimeout(() => e.target.select(), 30); });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'impfile') { const f = e.target.files && e.target.files[0]; if (f) importData(f); e.target.value = ''; return; }
    const inp = e.target.closest('.val');
    if (!inp) return;
    const ctx = ctxOf(inp);
    const f = ctx.fields.find((x) => x.k === inp.dataset.k);
    const txt = inp.value.trim().toLowerCase();
    const v = f.kind === 'int' ? parseInt(txt, 10) : f.zero && (txt === '' || txt === f.zero || txt === '0') ? 0 : parseTime(txt);
    setField(ctx, f.k, v === null || isNaN(v) ? ctx.obj[f.k] : v);
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target.classList.contains('val') || e.target.id === 'cname')) e.target.blur(); });
  root.addEventListener('input', (e) => { if (e.target.id === 'cname' && cur) cur.name = e.target.value; });
  $('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="sec"]');
    if (b) { data.section = b.dataset.s; persist(); render(); }
  });

  function bindRun() {
    $('stage').addEventListener('click', togglePause);
    const act = $('act');
    if (act && run.type !== 'fortime') {
      let undoT = 0;
      act.addEventListener('click', () => {
        if (act.disabled || run.paused) return;
        run.rounds++; run.splits.push(Math.round(elapsed() - PREP));
        beep('tic'); pulse(false); tick();
        const u = $('undo'); u.hidden = false; clearTimeout(undoT); undoT = setTimeout(() => { u.hidden = true; }, 4000);
      });
      $('undo').addEventListener('click', () => {
        if (run.rounds > 0) { run.rounds--; run.splits.pop(); }
        $('undo').hidden = true; tick();
      });
    }
    if (act && run.type === 'fortime') act.addEventListener('click', () => { if (!act.disabled) finish(true); });

    // Fermare = tieni premuto un attimo (niente stop per sbaglio con le mani sudate)
    const hb = $('stop');
    let holdT = 0;
    const end = () => { clearTimeout(holdT); hb.classList.remove('holding'); };
    hb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); hb.classList.add('holding');
      holdT = setTimeout(() => { end(); finish(false); }, HOLD_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hb.addEventListener(ev, end));
    hb.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && run && !run.over && view === 'run') { keepAwake(); tick(); }
  });

  /* ================= Offline e aggiornamenti automatici ================= */
  let wantReload = false;
  if ('serviceWorker' in navigator) {
    // la nuova versione si installa da sola; la pagina si ricarica solo a timer fermo
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
      // tocco sulla versione = cerca subito una versione nuova
      document.addEventListener('click', (e) => {
        const v = e.target.closest('#ver');
        if (!v) return;
        v.textContent = 'controllo…';
        reg.update().then(() => setTimeout(() => {
          const el = $('ver');
          if (el && !reg.installing && !reg.waiting) el.textContent = 'v' + VERSION + ' ✓ aggiornata';
        }, 1500)).catch(() => { const el = $('ver'); if (el) el.textContent = 'v' + VERSION + ' · offline'; });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (view === 'run') wantReload = true; else location.reload();
    });
  }

  render();
})();
