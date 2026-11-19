/* Sport — timer da allenamento (EMOM, Tabata/Intervalli, AMRAP, For Time) con allenamenti salvati */
(() => {
  'use strict';
  const VERSION = '0.3.0';           // tenere uguale a VERSION in sw.js
  const RING = 578.05;               // 2 * PI * 92 (raggio dell'anello)
  const PREP = 10;                   // secondi per prepararsi
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const root = $('app');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= Dati (solo nel telefono) ================= */
  const KEY = 'sport.data.v1';
  const data = (() => {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : {};
    d.saved = Array.isArray(d.saved) ? d.saved : [];
    d.history = Array.isArray(d.history) ? d.history : [];
    d.last = d.last || null;
    return d;
  })();
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* memoria piena o bloccata */ } }
  const pref = (k, d) => { try { return localStorage.getItem('sport.' + k) || d; } catch (e) { return d; } };
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
      name: 'EMOM', desc: 'Ogni minuto un round', color: '#FF9F0A',
      def: { every: 60, rounds: 10 },
      fields: [
        { k: 'every', label: 'Ogni', kind: 'time', min: 10, max: 600 },
        { k: 'rounds', label: 'Round', kind: 'int', min: 1, max: 99 },
      ],
      summary: (c) => fmtShort(c.every) + ' × ' + c.rounds,
      total: (c) => c.every * c.rounds,
    },
    tabata: {
      name: 'Tabata', desc: 'Lavoro e riposo', color: '#FF453A',
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
      name: 'AMRAP', desc: 'Più round possibili', color: '#FF375F',
      def: { dur: 600 },
      fields: [{ k: 'dur', label: 'Durata', kind: 'time', min: 60, max: 5400, step: 60 }],
      summary: (c) => fmtShort(c.dur),
      total: (c) => c.dur,
    },
    fortime: {
      name: 'For Time', desc: 'Più veloce possibile', color: '#7D7AFF',
      def: { cap: 900 },
      fields: [{ k: 'cap', label: 'Tempo limite', kind: 'time', min: 0, max: 5400, step: 60, zero: 'nessuno' }],
      summary: (c) => (c.cap ? 'limite ' + fmtShort(c.cap) : 'senza limite'),
      total: (c) => c.cap,
    },
  };
  const label = (type, cfg) => TYPES[type].name + ' ' + TYPES[type].summary(cfg);

  // Sequenza di blocchi: preparati, poi lavoro/riposo
  function timeline(type, c) {
    const seg = [{ kind: 'prep', secs: PREP }];
    if (type === 'emom') {
      for (let i = 1; i <= c.rounds; i++) seg.push({ kind: 'work', secs: c.every, round: i, of: c.rounds });
    } else if (type === 'tabata') {
      for (let i = 1; i <= c.rounds; i++) {
        seg.push({ kind: 'work', secs: c.work, round: i, of: c.rounds });
        if (i < c.rounds && c.rest > 0) seg.push({ kind: 'rest', secs: c.rest, round: i, of: c.rounds });
      }
    } else if (type === 'amrap') {
      seg.push({ kind: 'work', secs: c.dur });
    } else {
      seg.push({ kind: 'work', secs: c.cap || Infinity, up: true });
    }
    return seg;
  }

  /* ================= Audio (solo bip) ================= */
  const audio = { ctx: null, ready: false, els: {} };
  const SOUNDS = { short: [880, 0.2], long: [1320, 0.7], half: [660, 0.35], tic: [1040, 0.09] };

  function wavUrl(freq, secs, vol) {
    const rate = 44100, n = Math.floor(rate * secs);
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.01) * Math.min(1, (secs - t) / 0.06);
      const s = 0.6 * Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(4 * Math.PI * freq * t);
      v.setInt16(44 + i * 2, s * env * vol * 32767, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // Da chiamare dentro un tocco: iOS sblocca l'audio solo così
  function unlockAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = pref('asess', 'auto'); } catch (e) { /* niente */ }
    try {
      if (pref('amode', 'wa') === 'wa') {
        if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.ctx.state !== 'running') audio.ctx.resume();
        const b = audio.ctx.createBuffer(1, 1, 22050), s = audio.ctx.createBufferSource();
        s.buffer = b; s.connect(audio.ctx.destination); s.start(0);
      } else {
        for (const k in SOUNDS) {
          if (!audio.els[k]) audio.els[k] = new Audio(wavUrl(SOUNDS[k][0], SOUNDS[k][1], 0.8));
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
    const [freq, secs] = SOUNDS[kind];
    if (pref('amode', 'wa') === 'wa' && audio.ctx) {
      if (audio.ctx.state !== 'running') audio.ctx.resume();
      // nota + ottava sopra: suono pieno e udibile dall'altoparlante del telefono
      const t = audio.ctx.currentTime, g = audio.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.008);
      g.gain.setValueAtTime(1, t + secs * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
      g.connect(audio.ctx.destination);
      [[freq, 'square', 0.35], [freq * 2, 'sine', 0.5]].forEach(([f, type, lvl]) => {
        const o = audio.ctx.createOscillator(), og = audio.ctx.createGain();
        o.type = type; o.frequency.value = f; og.gain.value = lvl;
        o.connect(og); og.connect(g); o.start(t); o.stop(t + secs + 0.03);
      });
    } else if (audio.els[kind]) {
      const el = audio.els[kind];
      el.currentTime = 0;
      el.play().catch(() => {});
    }
  }
  const beeps = (kind, times, gap) => { for (let k = 0; k < times; k++) setTimeout(() => beep(kind), k * gap); };

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

  function tick() {
    if (!run || run.over) return;
    const el = elapsed();
    const w = locate(el);
    if (!w) return finish(true);
    const { i, s, left, into } = w;
    const finite = isFinite(s.secs);

    // segnali sonori
    if (i > 0) cue('s' + i, s.secs - 0.05, left, () => { beep(s.kind === 'rest' ? 'half' : 'long'); pulse(true); });
    if (finite && s.secs >= 4) for (const n of [3, 2, 1]) cue(i + ':' + n, n, left, () => { beep('short'); pulse(false); });
    if (finite && s.kind === 'work' && s.secs >= 30) {
      cue(i + ':h', s.secs / 2, left, () => beep('half'));
      cue(i + ':10', 10, left, () => beeps('tic', 2, 140));
    }

    // schermo
    if (run.lastKind !== s.kind) {
      body.classList.remove('prep', 'work', 'rest');
      body.classList.add(s.kind);
      run.lastKind = s.kind;
    }
    $('phase').textContent = KIND_LABEL[s.kind];
    $('time').textContent = s.up ? fmt(into) : fmt(left);
    const frac = s.up ? (finite ? into / s.secs : (into % 60) / 60) : left / s.secs;
    $('prog').style.strokeDashoffset = String(RING * (1 - frac));
    $('rRound').textContent = s.round ? 'Round ' + s.round + '/' + s.of : run.type === 'amrap' ? run.rounds + ' round' : '';
    const nx = run.seg[i + 1];
    $('next').textContent = run.paused ? 'In pausa · tocca per riprendere'
      : nx ? 'poi: ' + KIND_LABEL[nx.kind].toLowerCase() + ' ' + fmtShort(nx.secs)
      : s.up ? (finite ? 'limite ' + fmtShort(s.secs) : 'tocca FINITO quando hai finito')
      : run.type === 'amrap' ? 'tocca +1 a ogni round finito' : 'ultimo blocco';
    const act = $('act');
    if (act) act.disabled = s.kind !== 'work';

    if (!run.paused) run.raf = requestAnimationFrame(tick);
  }

  function start(type, cfg, name, savedId) {
    unlockAudio();
    run = {
      type, cfg: { ...cfg }, name: name || label(type, cfg), savedId: savedId || null,
      seg: timeline(type, cfg), start: Date.now(), paused: false, pausedAt: 0,
      fired: new Set(), rounds: 0, splits: [], lastKind: null, over: false,
    };
    data.last = { type, cfg: { ...cfg }, name: run.name, savedId: run.savedId };
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
    const el = Math.max(0, elapsed() - PREP);
    const at = locate(elapsed());
    run.reached = at && at.s.round ? at.s.round : 0;
    run.over = true;
    cancelAnimationFrame(run.raf); clearInterval(run.iv);
    releaseAwake();
    const total = TYPES[run.type].total(run.cfg);
    const secs = run.type === 'fortime' ? Math.min(el, run.cfg.cap || el) : completed ? total : el;
    run.result = { secs, completed };
    if (el > 0) {
      data.history.unshift({
        at: Date.now(), type: run.type, name: run.name, cfg: run.cfg, secs: Math.round(secs),
        rounds: run.type === 'amrap' ? run.rounds : undefined, splits: run.splits.length ? run.splits : undefined, completed,
      });
      data.history = data.history.slice(0, 500);
      persist();
    }
    if (completed) { beep('long'); setTimeout(() => beep('long'), 260); }
    view = 'done';
    render();
    if (wantReload) setTimeout(() => { if (view !== 'run') location.reload(); }, 4000);
  }

  /* ================= Schermate ================= */
  let view = 'home';
  let cur = null;          // impostazioni in modifica: { type, cfg, savedId }

  function render() {
    body.className = '';
    if (view === 'home') root.innerHTML = homeHTML();
    else if (view === 'config') root.innerHTML = configHTML();
    else if (view === 'run') { body.className = 'running'; root.innerHTML = runHTML(); bindRun(); }
    else if (view === 'done') { body.className = run.result.completed ? 'done' : 'stopped'; root.innerHTML = doneHTML(); }
    window.scrollTo(0, 0);
  }

  function homeHTML() {
    const l = data.last;
    const repeat = l && TYPES[l.type] ? `
      <button class="repeat" data-act="repeat" style="--c:${TYPES[l.type].color}">
        <span class="play">▶</span>
        <span class="rtxt"><b>Ripeti</b><small>${esc(l.name)}</small></span>
      </button>` : '';
    const mine = data.saved.length
      ? `<div class="chips">${data.saved.map((s) => `
          <button class="chip" data-act="openSaved" data-id="${esc(s.id)}" style="--c:${TYPES[s.type].color}">
            <b>${esc(s.name)}</b><small>${esc(TYPES[s.type].name + ' · ' + TYPES[s.type].summary(s.cfg))}</small>
          </button>`).join('')}</div>`
      : '<p class="hint">Imposta un timer e tocca ☆ per salvarlo qui.</p>';
    const tiles = Object.entries(TYPES).map(([k, t]) => `
      <button class="tile" data-act="new" data-type="${k}" style="--c:${t.color}">
        <i></i><b>${t.name}</b><small>${t.desc}</small>
      </button>`).join('');
    return `
      <header class="top"><h1>Sport</h1><button class="ver" id="ver">v${VERSION}</button></header>
      ${repeat}
      <h2>I miei</h2>${mine}
      <h2>Nuovo</h2><div class="tiles">${tiles}</div>`;
  }

  function fieldDisp(f, v) { return f.kind === 'int' ? String(v) : f.zero && !v ? f.zero : fmt(v); }

  function configHTML() {
    const t = TYPES[cur.type];
    const saved = cur.savedId && data.saved.find((s) => s.id === cur.savedId);
    const total = t.total(cur.cfg);
    return `
      <header class="bar" style="--c:${t.color}">
        <button class="icon" data-act="home" aria-label="Indietro">‹</button>
        <h1>${t.name}</h1>
        <button class="icon star${saved ? ' on' : ''}" data-act="star" aria-label="Salva">${saved ? '★' : '☆'}</button>
      </header>
      ${saved ? `<p class="sub">${esc(saved.name)}</p>` : `<p class="sub muted">${t.desc}</p>`}
      <div class="fields">${t.fields.map((f) => `
        <div class="field">
          <span class="lab">${f.label}</span>
          <button class="step" data-act="dec" data-k="${f.k}" aria-label="Meno">−</button>
          <input class="val" data-k="${f.k}" inputmode="${f.kind === 'int' ? 'numeric' : 'text'}" enterkeyhint="done" autocomplete="off" value="${esc(fieldDisp(f, cur.cfg[f.k]))}">
          <button class="step" data-act="inc" data-k="${f.k}" aria-label="Più">+</button>
        </div>`).join('')}
      </div>
      <p class="total">Totale <b id="total">${total ? fmt(total) : '—'}</b></p>
      <button class="btn primary go" data-act="go" style="--c:${t.color}">VIA</button>`;
  }

  function runHTML() {
    const t = TYPES[run.type];
    const act = run.type === 'amrap' ? '<button class="btn big" id="act">+1 ROUND</button><button class="undo" id="undo" hidden>annulla ultimo round</button>'
      : run.type === 'fortime' ? '<button class="btn big" id="act">FINITO</button>' : '';
    return `
      <div class="rtop"><span>${esc(run.name)}</span><span id="rRound"></span></div>
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
        <button class="btn hold" id="stop"><span class="fill"></span><span class="lbl">Tieni premuto per fermare</span></button>
      </div>`;
  }

  function doneHTML() {
    const r = run.result;
    const bits = [];
    if (run.type === 'fortime') bits.push(r.completed && r.secs < (run.cfg.cap || Infinity) ? 'Tempo ' + fmt(r.secs) : 'Tempo limite raggiunto');
    else bits.push(fmt(r.secs));
    if (run.type === 'amrap') bits.push(run.rounds + ' round');
    if (run.type === 'emom' || run.type === 'tabata') bits.push(r.completed ? run.cfg.rounds + ' round' : 'round ' + run.reached + '/' + run.cfg.rounds);
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
  function setField(k, v) {
    const f = TYPES[cur.type].fields.find((x) => x.k === k);
    v = Math.round(Math.min(f.max, Math.max(f.min, v)));
    cur.cfg[k] = v;
    const inp = root.querySelector('.val[data-k="' + k + '"]');
    if (inp) inp.value = fieldDisp(f, v);
    const tot = TYPES[cur.type].total(cur.cfg);
    $('total').textContent = tot ? fmt(tot) : '—';
  }
  function stepField(k, dir) {
    const f = TYPES[cur.type].fields.find((x) => x.k === k);
    const v = cur.cfg[k];
    let st = f.kind === 'int' ? 1 : f.step || ((dir > 0 ? v : v - 1) < 60 ? 5 : 15);
    let nv = v + dir * st;
    if (f.kind !== 'int' && !f.step) nv = Math.round(nv / st) * st;   // resta su multipli puliti
    setField(k, nv);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'home') { view = 'home'; render(); }
    else if (a === 'new') { cur = { type: b.dataset.type, cfg: { ...TYPES[b.dataset.type].def }, savedId: null }; view = 'config'; render(); }
    else if (a === 'openSaved') {
      const s = data.saved.find((x) => x.id === b.dataset.id);
      if (s) { cur = { type: s.type, cfg: { ...TYPES[s.type].def, ...s.cfg }, savedId: s.id }; view = 'config'; render(); }
    }
    else if (a === 'repeat' && data.last) { const l = data.last; start(l.type, { ...TYPES[l.type].def, ...l.cfg }, l.name, l.savedId); }
    else if (a === 'go') {
      const s = cur.savedId && data.saved.find((x) => x.id === cur.savedId);
      start(cur.type, cur.cfg, s ? s.name : null, s ? s.id : null);
    }
    else if (a === 'star') {
      const s = cur.savedId && data.saved.find((x) => x.id === cur.savedId);
      openSheet(s ? s.name : label(cur.type, cur.cfg), !!s, (res, name) => {
        if (res === 'del') {
          data.saved = data.saved.filter((x) => x.id !== s.id);
          if (data.last && data.last.savedId === s.id) data.last.savedId = null;
          cur.savedId = null;
        } else if (s) { s.name = name; s.cfg = { ...cur.cfg }; }
        else { const id = uid(); data.saved.push({ id, name, type: cur.type, cfg: { ...cur.cfg } }); cur.savedId = id; }
        persist(); render();
      });
    }
    else if (a === 'saveDone') {
      openSheet(run.name, false, (res, name) => {
        const id = uid();
        data.saved.push({ id, name, type: run.type, cfg: { ...run.cfg } });
        run.savedId = id; run.name = name;
        data.last = { type: run.type, cfg: { ...run.cfg }, name, savedId: id };
        persist(); render();
      });
    }
  });

  // Tasti − / + : tocco singolo, oppure tieni premuto per scorrere veloce
  let rep = { t: 0, iv: 0 };
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.step');
    if (!b) return;
    e.preventDefault();
    const k = b.dataset.k, dir = b.dataset.act === 'inc' ? 1 : -1;
    stepField(k, dir);
    rep.t = setTimeout(() => { rep.iv = setInterval(() => stepField(k, dir), 90); }, 420);
  });
  const repStop = () => { clearTimeout(rep.t); clearInterval(rep.iv); };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => root.addEventListener(ev, repStop));
  // il clic dopo pointerdown non deve contare due volte
  root.addEventListener('click', (e) => { if (e.target.closest('.step')) e.stopImmediatePropagation(); }, true);

  // Scrivere il valore a mano: "1:30", "90", "130"
  root.addEventListener('focusin', (e) => { if (e.target.classList.contains('val')) setTimeout(() => e.target.select(), 30); });
  root.addEventListener('change', (e) => {
    const inp = e.target.closest('.val');
    if (!inp) return;
    const f = TYPES[cur.type].fields.find((x) => x.k === inp.dataset.k);
    const txt = inp.value.trim().toLowerCase();
    const v = f.kind === 'int' ? parseInt(txt, 10) : f.zero && (txt === '' || txt === f.zero || txt === '0') ? 0 : parseTime(txt);
    if (v === null || isNaN(v)) setField(f.k, cur.cfg[f.k]); else setField(f.k, v);
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('val')) e.target.blur(); });

  function bindRun() {
    $('stage').addEventListener('click', togglePause);
    const act = $('act');
    if (act && run.type === 'amrap') {
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

    // Fermare = tieni premuto 1 secondo (niente stop per sbaglio con le mani sudate)
    const hb = $('stop');
    let holdT = 0;
    const end = () => { clearTimeout(holdT); hb.classList.remove('holding'); };
    hb.addEventListener('pointerdown', (e) => {
      e.preventDefault(); hb.classList.add('holding');
      holdT = setTimeout(() => { end(); finish(false); }, 1000);
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
