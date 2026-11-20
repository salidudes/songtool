  const PIANO_BASE = "piano/";
  const PIANO_CTX = () => ac();
  // =============== Klavier: echte Flügel-Samples (tonejs-instruments, MIT) ===============
  const Piano = (() => {
    const SAMPLES = [["A1",33],["C2",36],["Ds2",39],["Fs2",42],["A2",45],["C3",48],["Ds3",51],["Fs3",54],["A3",57],["C4",60],["Ds4",63],["Fs4",66],["A4",69],["C5",72],["Ds5",75],["Fs5",78],["A5",81],["C6",84]];
    let ctx = null, out = null, buf = {}, loading = null, ok = false;
    let rec = false;
    const ac = () => {
      if (!ctx) { ctx = typeof PIANO_CTX === "function" ? PIANO_CTX() : new (window.AudioContext || window.webkitAudioContext)(); out = ctx.createDynamicsCompressor(); out.threshold.value = -14; out.ratio.value = 3; out.connect(ctx.destination); }
      // iPhone: als Wiedergabe laufen lassen – Lautsprecher statt Hörer, auch bei Stummschalter
      if (!rec) try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
      if (ctx.state !== "running") ctx.resume();
      return ctx;
    };
    // Mikrofon an/aus: iPhone braucht dafür «Aufnahme und Wiedergabe», danach wieder reine Wiedergabe
    function setRec(v) { rec = !!v; try { if (navigator.audioSession) navigator.audioSession.type = v ? "play-and-record" : "playback"; } catch {} }
    // beim Antippen sofort freigeben (iPhone verlangt, dass der erste Ton direkt aus dem Tippen kommt)
    function unlock() { const c = ac(); try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, c.sampleRate); s.connect(c.destination); s.start(0); } catch {} return c; }
    const dec = ab => new Promise((res, rej) => { const p = ac().decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    // fehlt ein Sample, spielt das nächstgelegene; fehlende werden beim nächsten Mal nochmals geholt
    function load() {
      if (!loading) loading = Promise.all(SAMPLES.map(async ([n, m]) => {
        if (buf[m]) return true;
        try { const r = await fetch(PIANO_BASE + n + ".mp3"); if (!r.ok) return false; buf[m] = await dec(await r.arrayBuffer()); return true; } catch { return false; }
      })).then(r => { const k = r.filter(Boolean).length; ok = k >= SAMPLES.length - 4; if (k < SAMPLES.length) loading = null; return k > 0; });
      return loading;
    }
    // Ein Ton: nächstes Sample, Tonhöhe per Abspielgeschwindigkeit; vel 0..1
    function note(m, when, dur, vel = .7) {
      const c = ac(); let best = null;
      for (const [, sm] of SAMPLES) if (buf[sm] && (best == null || Math.abs(sm - m) < Math.abs(best - m))) best = sm;
      if (best == null) {   // Klavier (noch) nicht geladen: einfacher Ton, damit trotzdem etwas klingt
        const o = c.createOscillator(), g0 = c.createGain(), t = Math.max(when, c.currentTime), end = t + Math.max(.15, dur);
        o.type = "triangle"; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
        g0.gain.setValueAtTime(0, t); g0.gain.linearRampToValueAtTime(vel * .35, t + .015); g0.gain.setValueAtTime(vel * .35, end); g0.gain.exponentialRampToValueAtTime(.001, end + .25);
        o.connect(g0); g0.connect(out); o.start(t); o.stop(end + .3); return o;
      }
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf[best]; src.playbackRate.value = Math.pow(2, (m - best) / 12);
      const t = Math.max(when, c.currentTime), end = t + Math.max(.15, dur);
      g.gain.setValueAtTime(vel * vel * .9, t);
      g.gain.setValueAtTime(vel * vel * .9, end); g.gain.exponentialRampToValueAtTime(.001, end + .35);
      src.connect(g); g.connect(out); src.start(t); src.stop(end + .4);
      return src;
    }
    return { load, note, ac, unlock, setRec, ready: () => ok, now: () => ac().currentTime };
  })();

  // Akkordnamen verstehen: Dm, C/E, Fmaj7, Am7, Csus4, G7, Bdim, Eaug, Cadd9, F6 …
  // german=true: B = Bb, H = B (deutsche Schreibweise)
  function chordNotes(name, german) {
    const m = String(name || "").trim().replace(/♯/g, "#").replace(/♭/g, "b").match(/^([A-Ha-h])(#|b|is|es(?!us)|s(?!us))?(.*?)(?:\/([A-Ha-h])(#|b|is|es|s)?)?$/);
    if (!m) return null;
    const pcOf = (L, acc) => {
      L = L.toUpperCase();
      let pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11, B: german ? 10 : 11 }[L];
      if (acc === "#" || acc === "is") pc++; else if (acc === "b" || acc === "es" || acc === "s") pc = L === "B" && german ? pc : pc - 1;
      return ((pc % 12) + 12) % 12;
    };
    const root = pcOf(m[1], m[2]), q = (m[3] || "").replace(/\s/g, "");
    let iv;
    if (/^(m7b5|ø)/.test(q)) iv = [0, 3, 6, 10];
    else if (/^(dim7|°7)/.test(q)) iv = [0, 3, 6, 9];
    else if (/^(dim|°)/.test(q)) iv = [0, 3, 6];
    else if (/^(aug|\+)/.test(q)) iv = [0, 4, 8];
    else if (/^(maj|M|Δ)/.test(q)) iv = [0, 4, 7, 11];
    else if (/^(m|min|-)(?!aj)/.test(q)) iv = [0, 3, 7];
    else iv = [0, 4, 7];
    const rest = q.replace(/^(m7b5|ø|dim7|°7|dim|°|aug|\+|maj|M|Δ|min|m|-)/, "");
    if (/sus2/.test(rest)) iv = iv.map(x => x === 3 || x === 4 ? 2 : x);
    else if (/sus/.test(rest)) iv = iv.map(x => x === 3 || x === 4 ? 5 : x);
    if (/^5$/.test(q)) iv = [0, 7];
    if (/(^|[^0-9])6/.test(rest)) iv.push(9);
    if (/(^|[^1-9])7/.test(rest) && !iv.includes(11)) iv.push(10);
    if (/9/.test(rest)) { if (!/add/.test(rest) && !iv.includes(10) && !iv.includes(11)) iv.push(10); iv.push(14); }
    const bass = m[4] ? pcOf(m[4], m[5]) : root;
    return { root, bass, iv: [...new Set(iv)] };
  }
  // Pianistisch verteilen: Bass tief (C2–H2), Akkord eng um E3–G4
  function voicing(ch) {
    const bass = 36 + ch.bass;
    let base = 52 + ((ch.root - 52 % 12) + 12) % 12; if (base > 59) base -= 12;
    const tones = ch.iv.map(i => base + i).map(n => n > 71 ? n - 12 : n);
    return { bass, tones: [...new Set(tones)].sort((a, b) => a - b) };
  }
  // Ablauf spielen: events = [{t, dur, melody:[midi], chord: name|null}] → Gesamtdauer (s)
  function pianoPlay(events, german, push) {
    const c = Piano.ac(), t0 = c.currentTime + .08; let curChord = null, chordStart = 0, end = 0;
    const flushChord = until => {
      if (!curChord) return;
      const v = voicing(curChord), d = Math.max(.3, until - chordStart);
      const b = Piano.note(v.bass, t0 + chordStart, d, .62); if (b) push(b);
      v.tones.forEach((n, i) => { const s = Piano.note(n, t0 + chordStart + i * .012, d, .5); if (s) push(s); });
    };
    events.forEach(e => {
      if (e.chord) { const ch = typeof e.chord === "string" ? chordNotes(e.chord, german) : chordNotes(e.chord.name, e.chord.german); if (ch) { flushChord(e.t); curChord = ch; chordStart = e.t; } }
      e.melody.forEach((m, i) => { const s = Piano.note(m, t0 + e.t + i * (e.dur / e.melody.length), e.dur / e.melody.length, .78); if (s) push(s); });
      end = Math.max(end, e.t + e.dur);
    });
    if (curChord) end = Math.max(end, chordStart + 1.2);
    flushChord(end);
    return end + .4;
  }
  // =============== Wiedergabe ===============
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); return ctx; };
  function playTone(midi, dur, when, vol = .35) {
    const c = ac(), t0 = when ?? c.currentTime;
    if (Piano.ready()) { const src = Piano.note(midi, t0, dur, Math.min(1, .45 + vol)); if (src) voices.push(src); return; }
    Piano.load();
    const o = c.createOscillator(), o2 = c.createOscillator(), gn = c.createGain(), g2 = c.createGain();
    o.type = "triangle"; o2.type = "sine"; o.frequency.value = midiToFreq(midi); o2.frequency.value = midiToFreq(midi) * 2; g2.gain.value = .15;
    o.connect(gn); o2.connect(g2).connect(gn); gn.connect(c.destination);
    gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol, t0 + .015); gn.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + .05); o2.stop(t0 + dur + .05);
    voices.push(o, o2);
  }
  // Ein Knopf startet die Wiedergabe, derselbe Knopf (■) stoppt sie
  let voices = [], playBtn = null, playTimer = null, curAudio = null;
  function stopAll() {
    voices.forEach(o => { try { o.stop(); } catch {} }); voices = [];
    if (curAudio) { try { curAudio.pause(); } catch {} curAudio = null; }
    clearTimeout(playTimer);
    if (playBtn) { playBtn.innerHTML = playBtn._label; playBtn.classList.remove("primary"); playBtn = null; }
  }
  function togglePlay(btn, fn) {
    if (btn && playBtn === btn) { stopAll(); return; }
    stopAll();
    const dur = fn(); if (!dur || !btn) return;
    playBtn = btn; btn._label = btn.innerHTML; btn.innerHTML = btn.innerHTML.replace("▶", "■"); btn.classList.add("primary");
    playTimer = setTimeout(() => { if (playBtn === btn) { btn.innerHTML = btn._label; btn.classList.remove("primary"); playBtn = null; voices = []; } }, dur * 1000 + 200);
  }
  function playMelody(notes, btn) {
    togglePlay(btn, () => {
      if (!notes.length) return 0; const c = ac(); const t0 = c.currentTime + .05; let t = t0;
      notes.forEach(m => { playTone(m, .45, t); t += .42; });
      return t - t0;
    });
  }
  // Töne mit Start/Ende (aus Memos)
  function playTimed(notes, btn) {
    togglePlay(btn, () => {
      if (!notes.length) return 0; const c = ac(), t0 = c.currentTime + .05, base = notes[0].start;
      notes.forEach(n => playTone(n.m, Math.max(.15, n.end - n.start), t0 + n.start - base, .3));
      return notes[notes.length - 1].end - base + .1;
    });
  }
  function playBlob(blob, btn, t0, t1) {
    togglePlay(btn, () => {
      const a = new Audio(URL.createObjectURL(blob)); curAudio = a;
      a.onended = () => { if (curAudio === a) stopAll(); };
      if (t0) a.currentTime = Math.max(0, t0 - .1);
      a.play().catch(() => { toast("Abspielen nicht möglich"); stopAll(); });
      return t1 != null ? (t1 - (t0 || 0) + .3) : 3600;
    });
  }
  function playChord(c) {
    const name = c.txt != null ? { name: c.txt, german: settings.naming === "de" } : { name: intl(c.r, false) + SUF[c.q], german: false };
    if (Piano.ready()) { stopAll(); const ch = chordNotes(name.name, name.german); if (ch) { const v = voicing(ch), t = ac().currentTime + .02; [v.bass, ...v.tones].forEach((n, i) => { const x = Piano.note(n, t + i * .012, 1.4, i ? .5 : .62); if (x) voices.push(x); }); } return; }
    Piano.load();
    if (c.txt != null) return; const t = ac().currentTime;
    QUAL[c.q].forEach(iv => playTone(48 + c.r + iv, .9, t, .18));
  }

  // =============== Start ===============

  // ---- Zeilen und Teile mit Akkorden + Melodie auf dem Klavier ----
  const chordEvName = c => c.txt != null ? { name: c.txt, german: settings.naming === "de" } : { name: intl(c.r, false) + SUF[c.q], german: false };
  // Töne aufs Raster ziehen. items: [{t, d}] in Sekunden (im Aufnahme-Tempo bpm); anchor: Zeit einer «Eins» (Metronom) oder null
  // grid: "8" = Achtel, sonst Sechzehntel → [{p, l}] in Sechzehnteln ab Takt- bzw. Schlaganfang
  // Wie weit du durchgehend vor/nach dem Klick singst (dein Gefühl), in Sekunden – knapp unter einem halben Rasterschritt.
  // Grob über den Kreis-Mittelwert (verträgt Ausreisser über die Rastergrenze), fein über den Median.
  function feelShift(ts, anchor, g) {
    if (ts.length < 4) return 0;
    let cx = 0, cy = 0; ts.forEach(t => { const w = 2 * Math.PI * (t - anchor) / g; cx += Math.cos(w); cy += Math.sin(w); });
    const o0 = Math.atan2(cy, cx) / (2 * Math.PI);
    const r = ts.map(t => { const v = (t - anchor) / g - o0; return v - Math.round(v); }).sort((a, b) => a - b);
    return Math.max(-.45, Math.min(.45, o0 + r[r.length >> 1])) * g;
  }
  // shift: schon bekannte Verschiebung (aus dem ganzen Durchgang) oder null = aus diesen Tönen schätzen
  function quantize(items, bpm, anchor, grid = "8", bpb = 4, spb = 4, shift = null) {
    if (!items.length) return [];
    const beat = 60 / bpm, g16 = beat / spb;
    const per = grid === "8" ? Math.max(1, spb / 2) : spb, g = beat / per, f = spb / per;
    let ref = anchor;
    if (ref != null) ref += shift != null ? shift : feelShift(items.map(it => it.t), anchor, g);
    if (ref == null) {   // ohne Metronom: das Raster suchen, in das die Einsätze am besten passen
      let bc = 1e9; const b = items[0].t;
      for (let k = 0; k < 24; k++) { const ph = b - k * g / 24; let c = 0; items.forEach(it => { const r = (it.t - ph) / g; c += Math.abs(r - Math.round(r)); }); if (c < bc) { bc = c; ref = ph; } }
    }
    // im Sechzehntel-Raster mit Metronom: knappe Fälle gehen an Schlag oder Achtel statt an eine «krumme» Sechzehntel
    const cost = c => c % spb === 0 ? 0 : spb === 4 && c % 2 === 0 ? .04 : .08;
    const snap = x => f !== 1 ? Math.round(x / f) * f : anchor == null ? Math.round(x) : [Math.floor(x), Math.ceil(x)].reduce((a, c) => Math.abs(x - c) + cost(c) < Math.abs(x - a) + cost(a) ? c : a);
    const x = items.map(it => (it.t - ref) / g16), pos = x.map(snap);
    for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) pos[i] = Math.max(pos[i - 1] + 1, Math.round(x[i]));   // zwei Töne auf einem Platz: nur dieser eine Sechzehntel weiter
    const barU = bpb * spb, start = anchor != null ? Math.floor(pos[0] / barU) * barU : Math.floor(pos[0] / spb) * spb;   // ab Takt- bzw. Schlaganfang
    return items.map((it, i) => {
      if (i + 1 >= items.length) return { p: pos[i] - start, l: Math.max(f, Math.round((it.d || g) / g) * f) };
      const gap = pos[i + 1] - pos[i];
      // gebunden gesungen (klingt fast bis zum nächsten Ton) → ohne Lücke
      const legato = it.d != null && it.d >= (items[i + 1].t - it.t) * .75;
      return { p: pos[i] - start, l: legato ? gap : Math.max(1, Math.min(gap, Math.max(f, Math.round((it.d || g) / g) * f))) };
    });
  }
  // Rhythmus nur verwenden, wenn er aus einem Durchgang stammt (keine Rücksprünge, keine Lücken > 4 s, gleiches Metronom)
  const rhOk = line => {
    const n = line.notes.length, rh = line.rh;
    if (!n || !rh || rh.length < n) return false;
    const r = rh.slice(0, n); if (!r.every(x => x && x.t != null)) return false;
    for (let i = 1; i < n; i++) { const d = r[i].t - r[i - 1].t; if (d <= 0 || d > 4 || r[i].a !== r[0].a || (r[i].b || 0) !== (r[0].b || 0)) return false; }
    return true;
  };
  // Sechzehntel pro Schlag: bei x/4 vier, bei x/8 zwei (der Schlag ist dort eine Achtel)
  const spbOf = s => /\/8$/.test(meterOf(s).sig) ? 2 : 4;
  const hasQ = line => Array.isArray(line.q) && line.notes.length > 0 && line.q.length === line.notes.length;
  // gesungener Rhythmus, im Tempo ausgewertet, in dem er aufgenommen wurde (Metronom) – spätere Tempo-Änderungen verschieben nichts
  function rhQ(s, line) {
    const rh = line.rh.slice(0, line.notes.length), a = rh[0].a, bpm = rh[0].b || s.bpm || 100, grid = s.grid === "16" || s.grid === "off" ? "16" : "8";
    let shift = null;
    if (a != null) {   // Gefühl aus dem ganzen Durchgang (alle Zeilen mit demselben Metronom) – viel verlässlicher als aus einer Zeile
      const ts = []; s.sections.forEach(sec => sec.lines.forEach(l => { if (rhOk(l) && l.rh[0].a === a) l.rh.slice(0, l.notes.length).forEach(x => ts.push(x.t)); }));
      shift = feelShift(ts, a, 60 / bpm / (grid === "8" ? Math.max(1, spbOf(s) / 2) : spbOf(s)));
    }
    return quantize(rh, bpm, a, grid, meterOf(s).beats, spbOf(s), shift);
  }
  // Rhythmus einer Zeile in Sechzehnteln ({p: Position ab Taktanfang, l: Länge}): von Hand bearbeitet oder aus dem Gesang
  function lineQ(s, line) {
    const n = line.notes.length; if (!n) return [];
    if (hasQ(line)) return line.q;
    if (rhOk(line)) return rhQ(s, line);
    const st = Math.max(1, spbOf(s) / 2); return line.notes.map((_, i) => ({ p: i * st, l: st }));   // ohne Rhythmus: gleichmässige Achtel
  }
  function lineEvents(s, line, t0 = 0) {
    const sung = !hasQ(line) && rhOk(line) && (s.bpm || line.rh[0].b);
    if (hasQ(line) || sung) {   // im Taktraster: von Hand bearbeitet oder gesungen
      const g16 = 60 / (s.bpm || (line.rh && line.rh[0] && line.rh[0].b) || 100) / spbOf(s), ev = []; let ni = 0;
      const q = lineQ(s, line);
      let pend = null;   // Akkord auf einer Silbe ohne Ton: kommt mit dem nächsten Ton
      units(line, s.lang).forEach((u, i) => {
        const ch = line.chords[i] ? chordEvName(line.chords[i]) : null;
        if (!u.notes.length) { if (ch) pend = ch; return; }
        u.notes.forEach((m, k) => { const z = q[ni++]; if (!z) return; const c = (k === 0 && ch) || pend; pend = null; ev.push({ t: t0 + z.p * g16, dur: z.l * g16, melody: [m], chord: c }); });
      });
      if (pend && ev.length) { const e = ev[ev.length - 1]; ev.push({ t: e.t + e.dur, dur: 4 * g16, melody: [], chord: pend }); }
      return { ev, t: ev.length ? Math.max(...ev.map(e => e.t + e.dur)) : t0, bar: true };
    }
    const us = units(line, s.lang), mel = line.notes.length > 0, ev = []; let t = t0;
    const e8 = s.bpm ? 30 / s.bpm : 0;   // mit Tempo: jede Silbe/Note eine Achtel
    us.forEach((u, i) => {
      const dur = e8 ? Math.max(1, u.notes.length) * e8 : !mel ? .34 : u.notes.length ? u.notes.length * .42 : .3;
      ev.push({ t, dur, melody: u.notes, chord: line.chords[i] ? chordEvName(line.chords[i]) : null }); t += dur;
    });
    return { ev, t };
  }
  function sectionEvents(s, sec) {
    let ev = [], end = 0, first = true;
    const beat = s.bpm ? 60 / s.bpm : 0;
    sec.lines.filter(l => l.text.trim() || l.notes.length).forEach(l => {
      const r = lineEvents(s, l, 0); if (!r.ev.length) return;
      let off;
      if (r.bar) {
        // im Taktraster: so früh wie möglich auf einen Taktanfang – ein Auftakt darf in den letzten Takt der Zeile davor
        const bar = meterOf(s).beats * (beat || 60 / ((l.rh && l.rh[0] && l.rh[0].b) || 100)), f0 = Math.min(...r.ev.map(e => e.t));
        off = first ? 0 : Math.max(0, Math.ceil((end - f0) / bar - 1e-6)) * bar;
      } else off = first ? 0 : beat ? Math.ceil((end + beat * .5) / beat - 1e-6) * beat : end + .35;   // ohne Rhythmus: nächster Schlag
      r.ev.forEach(e => { e.t += off; ev.push(e); });
      end = Math.max(end, r.t + off); first = false;
    });
    return ev;
  }
  let waitTok = 0;
  function pianoToggle(btn, build) {
    if (btn && (playBtn === btn || btn._wait)) { if (btn._wait) { waitTok++; btn.innerHTML = btn._wait; btn._wait = null; } stopAll(); return; }
    stopAll(); Piano.unlock();   // Ton sofort beim Tippen freigeben (iPhone)
    const go = () => togglePlay(btn, () => {
      const ev = build(); if (!ev.length) { toast("Nichts zum Abspielen"); return 0; }
      const bpm = song().bpm;
      if (!(Metro.on && bpm)) return pianoPlay(ev, false, x => voices.push(x));
      // Metronom: einen Takt einzählen, dann mitklicken
      const M = meterOf(song()), beat = 60 / bpm, pre = M.beats * beat, c = ac(), t0 = c.currentTime + .08;
      ev.forEach(e => e.t += pre);
      const dur = pianoPlay(ev, false, x => voices.push(x));
      for (let i = 0; i * beat < dur - .3; i++) metroBeat(t0 + i * beat, i, M, beat).forEach(o => voices.push(o));
      return dur;
    });
    if (Piano.ready() || !btn) return go();
    // Klavier lädt noch: kurz warten – klappt es nicht, mit einfachem Ton spielen statt gar nicht
    const tok = ++waitTok; btn._wait = btn.innerHTML; btn.innerHTML = "⏳";
    Promise.race([Piano.load(), new Promise(r => setTimeout(() => r(null), 4000))]).then(okk => {
      if (tok !== waitTok || !btn._wait) return;
      btn.innerHTML = btn._wait; btn._wait = null;
      if (!okk) toast("Klavierklang nicht geladen – spiele einfachen Ton");
      go();
    });
  }
  setTimeout(() => Piano.load(), 1500);
