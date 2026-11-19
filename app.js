/* Sport — passo 1: pagina di prova (timer 10 s + 60 s, solo suoni, schermo acceso, offline) */
(() => {
  'use strict';
  const VERSION = '0.2.0';           // tenere uguale a VERSION in sw.js
  const RING = 578.05;               // 2 * PI * 92
  const $ = (id) => document.getElementById(id);
  const body = document.body;

  $('ver').textContent = 'v' + VERSION;

  /* ---------- Preferenze (solo comodità: se la memoria non va, si usano i valori base) ---------- */
  const pref = {
    get(k, d) { try { return localStorage.getItem('sport.' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sport.' + k, v); } catch (e) { /* niente */ } },
  };
  $('amode').value = pref.get('amode', 'wa');
  $('asess').value = pref.get('asess', 'auto');
  $('amode').addEventListener('change', (e) => { pref.set('amode', e.target.value); audio.ready = false; });
  $('asess').addEventListener('change', (e) => { pref.set('asess', e.target.value); applySession(); });

  /* ---------- Controlli ---------- */
  function check(k, state, text) {
    const li = document.querySelector('#checks li[data-k="' + k + '"]');
    if (!li) return;
    li.classList.remove('ok', 'warn', 'bad');
    if (state) li.classList.add(state);
    li.querySelector('span').textContent = text;
  }
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  check('home', standalone ? 'ok' : 'warn', standalone ? 'Sì' : 'No, sei in Safari');

  /* ---------- Audio ---------- */
  const audio = { ctx: null, ready: false, els: {} };

  function applySession() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = $('asess').value;
    } catch (e) { /* non supportato */ }
  }

  // Suono in formato WAV costruito al volo (per il motore "Elemento audio")
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

  const SOUNDS = { short: [880, 0.2], long: [1320, 0.7], half: [660, 0.35], tic: [1040, 0.09] };

  // Da chiamare dentro un tocco: iOS sblocca l'audio solo così
  function unlockAudio() {
    applySession();
    const mode = $('amode').value;
    try {
      if (mode === 'wa') {
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
      setTimeout(() => {
        const ok = mode === 'el' || (audio.ctx && audio.ctx.state === 'running');
        check('audio', ok ? 'ok' : 'bad', ok ? (mode === 'wa' ? 'Web Audio attivo' : 'Elemento audio') : 'Bloccato');
      }, 300);
    } catch (e) {
      check('audio', 'bad', 'Errore: ' + e.name);
    }
  }

  function beep(kind) {
    if (!audio.ready) return;
    const [freq, secs] = SOUNDS[kind];
    if ($('amode').value === 'wa' && audio.ctx) {
      if (audio.ctx.state !== 'running') audio.ctx.resume();
      // nota + ottava sopra: suono più pieno e udibile dall'altoparlante del telefono
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
      el.play().catch(() => check('audio', 'bad', 'Bloccato'));
    }
  }

  // Più suoni in fila (es. doppio tic per «10 secondi»)
  function beeps(kind, times, gap) {
    for (let k = 0; k < times; k++) setTimeout(() => beep(kind), k * gap);
  }

  /* ---------- Schermo sempre acceso ---------- */
  let lock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator)) { check('wake', 'bad', 'Non supportato'); return; }
    try {
      lock = await navigator.wakeLock.request('screen');
      check('wake', 'ok', 'Attivo');
      lock.addEventListener('release', () => { if (run.on) check('wake', 'warn', 'Rilasciato'); });
    } catch (e) {
      check('wake', 'bad', 'Errore: ' + e.name);
    }
  }
  function releaseAwake() { if (lock) { lock.release().catch(() => {}); lock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && run.on) { keepAwake(); tick(); }
  });

  /* ---------- Timer: il tempo viene dall'orologio, non dal conteggio dei tick ---------- */
  const PHASES = [
    { key: 'prep', label: 'Preparati', secs: 10, next: 'poi: lavoro 1:00' },
    { key: 'work', label: 'Lavoro', secs: 60, next: 'ultimo blocco' },
  ];
  const TOTAL = PHASES.reduce((a, p) => a + p.secs, 0);
  const run = { on: false, paused: false, start: 0, pausedAt: 0, fired: new Set(), raf: 0, iv: 0 };

  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function elapsed() { return ((run.paused ? run.pausedAt : Date.now()) - run.start) / 1000; }

  function where(el) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (el < acc + PHASES[i].secs) return { i, p: PHASES[i], left: acc + PHASES[i].secs - el, into: el - acc };
      acc += PHASES[i].secs;
    }
    return null;
  }

  // Segnali: ognuno scatta una volta sola; se si torna dopo un'assenza, quelli vecchi si saltano
  function cue(id, atLeft, left, fn) {
    if (run.fired.has(id)) return;
    if (left <= atLeft) {
      run.fired.add(id);
      if (atLeft - left < 1.2) fn();
    }
  }
  function pulse(flash) {
    body.classList.remove('pulse', 'flash'); void body.offsetWidth;
    body.classList.add('pulse'); if (flash) body.classList.add('flash');
  }

  function tick() {
    if (!run.on) return;
    const el = elapsed();
    const w = where(el);
    if (!w) return finish();
    const { i, p, left } = w;
    body.classList.toggle('prep', p.key === 'prep');
    body.classList.toggle('work', p.key === 'work');
    $('phase').textContent = p.label;
    $('time').textContent = fmt(left);
    $('next').textContent = run.paused ? 'In pausa · tocca per riprendere' : p.next;
    $('prog').style.strokeDashoffset = String(RING * (1 - left / p.secs));

    for (const n of [3, 2, 1]) cue(i + ':' + n, n, left, () => { beep('short'); pulse(n === 1); });
    if (p.key === 'work') {
      cue('work:start', p.secs - 0.05, left, () => { beep('long'); pulse(true); });
      cue('work:half', 30, left, () => beep('half'));
      cue('work:10', 10, left, () => beeps('tic', 2, 140));
    }
    if (!run.paused) run.raf = requestAnimationFrame(tick);
  }

  function start() {
    unlockAudio();
    run.on = true; run.paused = false; run.start = Date.now(); run.fired.clear();
    body.classList.remove('idle', 'done', 'paused'); body.classList.add('running');
    $('go').hidden = true; $('stop').hidden = false;
    keepAwake();
    clearInterval(run.iv); run.iv = setInterval(tick, 250);   // riserva se requestAnimationFrame rallenta
    tick();
  }

  function togglePause() {
    if (!run.on) return;
    if (run.paused) {
      run.start += Date.now() - run.pausedAt; run.paused = false; body.classList.remove('paused');
      unlockAudio();
    } else {
      run.pausedAt = Date.now(); run.paused = true; body.classList.add('paused');
    }
    cancelAnimationFrame(run.raf); tick();
  }

  function finish() {
    stop(true);
    beep('long'); setTimeout(() => beep('long'), 260);
    body.classList.add('done');
    $('phase').textContent = 'Fatto';
    $('time').textContent = fmt(PHASES[PHASES.length - 1].secs);
    $('next').textContent = 'Prova completata · Via per ripetere';
    $('prog').style.strokeDashoffset = '0';
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (wantReload) setTimeout(() => { if (!run.on) location.reload(); }, 4000);
  }

  function stop(completed) {
    run.on = false; run.paused = false;
    if (wantReload && !completed) { location.reload(); return; }
    cancelAnimationFrame(run.raf); clearInterval(run.iv);
    releaseAwake();
    body.classList.remove('running', 'prep', 'work', 'paused', 'pulse', 'flash');
    $('go').hidden = false; $('stop').hidden = true;
    if (!completed) {
      body.classList.add('idle');
      $('phase').textContent = 'Prova 60 s';
      $('time').textContent = '1:00';
      $('next').textContent = 'Fermato · Via per ripartire';
      $('prog').style.strokeDashoffset = '0';
      check('wake', null, 'parte con Via');
    }
  }

  /* ---------- Gesti ---------- */
  $('go').addEventListener('click', () => { body.classList.remove('done'); start(); });
  $('stage').addEventListener('click', togglePause);

  // Fermare = tieni premuto 1 secondo (niente stop per sbaglio con le mani sudate)
  let holdT = 0;
  const holdBtn = $('stop');
  const holdEnd = () => { clearTimeout(holdT); holdBtn.classList.remove('holding'); };
  holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); holdBtn.classList.add('holding');
    holdT = setTimeout(() => { holdEnd(); stop(false); }, 1000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => holdBtn.addEventListener(ev, holdEnd));
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  $('tBeep').addEventListener('click', () => {
    unlockAudio();
    setTimeout(() => beeps('short', 3, 1000), 80);
    setTimeout(() => beep('long'), 3080);
  });

  /* ---------- Offline e aggiornamenti ---------- */
  let wantReload = false;
  if ('serviceWorker' in navigator) {
    // Aggiornamento automatico: la nuova versione si installa da sola e la pagina
    // si ricarica appena il timer è fermo (mai durante un allenamento)
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
    }).catch((e) => check('off', 'bad', 'Errore: ' + e.name));
    navigator.serviceWorker.ready.then(() => {
      const ctrl = !!navigator.serviceWorker.controller;
      check('off', ctrl ? 'ok' : 'warn', ctrl ? 'Pronta' : 'Riapri una volta');
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (navigator.serviceWorker.controller) check('off', 'ok', 'Pronta');
      if (hadController) { if (run.on) wantReload = true; else location.reload(); }
    });
  } else {
    check('off', 'bad', 'Non supportato');
  }
})();
