  const PIANO_BASE = "piano/";
  const PIANO_CTX = () => ac();
  // =============== Klavier: echte Flügel-Samples (tonejs-instruments, MIT) ===============
  const Piano = (() => {
    const SAMPLES = [["A1",33],["C2",36],["Ds2",39],["Fs2",42],["A2",45],["C3",48],["Ds3",51],["Fs3",54],["A3",57],["C4",60],["Ds4",63],["Fs4",66],["A4",69],["C5",72],["Ds5",75],["Fs5",78],["A5",81],["C6",84]];
    let ctx = null, out = null, buf = {}, loading = null, ok = false;
    const ac = () => {
      if (!ctx) { ctx = typeof PIANO_CTX === "function" ? PIANO_CTX() : new (window.AudioContext || window.webkitAudioContext)(); out = ctx.createDynamicsCompressor(); out.threshold.value = -14; out.ratio.value = 3; out.connect(ctx.destination); }
      if (ctx.state !== "running") ctx.resume();
      return ctx;
    };
    const dec = ab => new Promise((res, rej) => { const p = ac().decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    function load() {
      if (!loading) loading = Promise.all(SAMPLES.map(async ([n, m]) => {
        const r = await fetch(PIANO_BASE + n + ".mp3"); if (!r.ok) throw new Error(n);
        buf[m] = await dec(await r.arrayBuffer());
      })).then(() => (ok = true)).catch(() => { loading = null; return false; });
      return loading;
    }
    // Ein Ton: nächstes Sample, Tonhöhe per Abspielgeschwindigkeit; vel 0..1
    function note(m, when, dur, vel = .7) {
      const c = ac(); let best = null;
      for (const [, sm] of SAMPLES) if (buf[sm] && (best == null || Math.abs(sm - m) < Math.abs(best - m))) best = sm;
      if (best == null) return null;
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf[best]; src.playbackRate.value = Math.pow(2, (m - best) / 12);
      const t = Math.max(when, c.currentTime), end = t + Math.max(.15, dur);
      g.gain.setValueAtTime(vel * vel * .9, t);
      g.gain.setValueAtTime(vel * vel * .9, end); g.gain.exponentialRampToValueAtTime(.001, end + .35);
      src.connect(g); g.connect(out); src.start(t); src.stop(end + .4);
      return src;
    }
    return { load, note, ac, ready: () => ok, now: () => ac().currentTime };
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
  // Töne aufs Raster ziehen. items: [{t, d}] in Sekunden; anchor: Zeit einer «Eins» (Metronom) oder null
  // grid: "8" = Achtel, "16" = Sechzehntel, "off" = wie gesungen
  function quantize(items, bpm, anchor, grid = "8", bpb = 4, spb = 4) {
    if (!items.length) return [];
    const beat = 60 / bpm;
    if (grid === "off") {   // nicht einrasten – nur ab Takt-/Schlaganfang ausrichten
      const ref = anchor != null ? anchor + Math.floor((items[0].t - anchor) / (bpb * beat)) * bpb * beat : items[0].t;
      return items.map((it, i) => ({ t: it.t - ref, dur: Math.max(.08, Math.min(it.d || beat / 2, i + 1 < items.length ? items[i + 1].t - it.t : 9)) }));
    }
    const per = grid === "16" ? spb : Math.max(1, spb / 2), g = beat / per;
    let ref = anchor;
    if (ref == null) {   // ohne Metronom: das Raster suchen, in das die Einsätze am besten passen
      let bc = 1e9; const b = items[0].t;
      for (let k = 0; k < 24; k++) { const ph = b - k * g / 24; let c = 0; items.forEach(it => { const r = (it.t - ph) / g; c += Math.abs(r - Math.round(r)); }); if (c < bc) { bc = c; ref = ph; } }
    }
    // Positionen in Sechzehnteln rechnen; aufs gewählte Raster gerundet
    const g16 = beat / spb, f = spb / per;
    const pos = items.map(it => Math.round((it.t - ref) / g) * f);
    for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) {
      // zwei Töne auf demselben Platz: nur diesen Ton auf die nächste Sechzehntel – keine Kettenreaktion
      pos[i] = Math.max(pos[i - 1] + 1, Math.round((items[i].t - ref) / g16));
    }
    const barU = bpb * spb, start = anchor != null ? Math.floor(pos[0] / barU) * barU : Math.floor(pos[0] / spb) * spb;   // ab Takt- bzw. Schlaganfang
    return items.map((it, i) => {
      let len = Math.max(f, Math.round((it.d || g) / g) * f);
      if (i + 1 < items.length) len = Math.max(1, Math.min(len, pos[i + 1] - pos[i]));
      return { t: (pos[i] - start) * g16, dur: len * g16 };
    });
  }
  // Rhythmus nur verwenden, wenn er aus einem Durchgang stammt (keine Rücksprünge, keine Lücken > 4 s, gleiches Raster)
  const rhOk = line => {
    const n = line.notes.length, rh = line.rh;
    if (!n || !rh || rh.length < n) return false;
    const r = rh.slice(0, n); if (!r.every(x => x && x.t != null)) return false;
    for (let i = 1; i < n; i++) { const d = r[i].t - r[i - 1].t; if (d <= 0 || d > 4 || r[i].a !== r[0].a) return false; }
    return true;
  };
  // Sechzehntel pro Schlag: bei x/4 vier, bei x/8 zwei (der Schlag ist dort eine Achtel)
  const spbOf = s => /\/8$/.test(meterOf(s).sig) ? 2 : 4;
  const hasQ = line => Array.isArray(line.q) && line.notes.length > 0 && line.q.length === line.notes.length;
  // Rhythmus einer Zeile in Sechzehnteln ({p: Position ab Taktanfang, l: Länge}): von Hand bearbeitet oder aus dem Gesang
  function lineQ(s, line) {
    const n = line.notes.length; if (!n) return [];
    if (hasQ(line)) return line.q;
    const bpm = s.bpm || 100, spb = spbOf(s), g16 = 60 / bpm / spb;
    if (rhOk(line)) {
      const rh = line.rh.slice(0, n), a = rh[0].a, grid = s.grid === "16" ? "16" : s.grid === "off" ? "16" : "8";
      return quantize(rh.map(x => ({ t: x.t, d: x.d })), bpm, a != null && rh.every(x => x.a === a) ? a : null, grid, meterOf(s).beats, spb)
        .map(z => ({ p: Math.round(z.t / g16), l: Math.max(1, Math.round(z.dur / g16)) }));
    }
    const st = Math.max(1, spb / 2); return line.notes.map((_, i) => ({ p: i * st, l: st }));   // ohne Rhythmus: gleichmässige Achtel
  }
  function lineEvents(s, line, t0 = 0) {
    if (hasQ(line)) {   // von Hand im Taktraster bearbeitet
      const g16 = 60 / (s.bpm || 100) / spbOf(s), q = line.q, ev = []; let ni = 0;
      units(line, s.lang).forEach((u, i) => u.notes.forEach((m, k) => { const z = q[ni++]; if (z) ev.push({ t: t0 + z.p * g16, dur: z.l * g16, melody: [m], chord: k === 0 && line.chords[i] ? chordEvName(line.chords[i]) : null }); }));
      return { ev, t: ev.length ? Math.max(...ev.map(e => e.t + e.dur)) : t0, bar: true };
    }
    if (s.bpm && rhOk(line)) {
      const n = line.notes.length, rh = line.rh.slice(0, n), a = rh[0].a;
      const q = quantize(rh.map(x => ({ t: x.t, d: x.d })), s.bpm, a != null && rh.every(x => x.a === a) ? a : null, s.grid || "8", meterOf(s).beats, spbOf(s));
      const ev = []; let ni = 0;
      units(line, s.lang).forEach((u, i) => u.notes.forEach((m, k) => { const z = q[ni++]; if (z) ev.push({ t: t0 + z.t, dur: z.dur, melody: [m], chord: k === 0 && line.chords[i] ? chordEvName(line.chords[i]) : null }); }));
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
    let ev = [], t = 0;
    const beat = s.bpm ? 60 / s.bpm : 0;
    sec.lines.filter(l => l.text.trim() || l.notes.length).forEach(l => {
      const r = lineEvents(s, l, t); ev = ev.concat(r.ev);
      // mit Tempo: nächste Zeile auf dem nächsten Schlag – bei echtem Rhythmus auf dem nächsten Takt
      const bar = meterOf(s).beats * beat;
      t = r.bar ? Math.ceil((r.t + .01) / bar) * bar : beat ? Math.ceil((r.t + beat * .5) / beat) * beat : r.t + .35;
    });
    return ev;
  }
  async function pianoToggle(btn, build) {
    if (btn && playBtn === btn) { stopAll(); return; }
    stopAll();
    if (!Piano.ready()) {
      const lbl = btn.innerHTML; btn.innerHTML = "⏳"; const ok = await Piano.load(); btn.innerHTML = lbl;
      if (!ok) { toast("Klavier konnte nicht geladen werden"); return; }
    }
    togglePlay(btn, () => {
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
  }
  setTimeout(() => Piano.load(), 1500);
