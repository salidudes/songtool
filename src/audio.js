  // =============== Tonerkennung (YIN) ===============
  const MIN_F = 60, MAX_F = 1200;
  let yinBuf = null;
  function detectPitch(buf, sr) {
    let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.0025) return { f: 0, rms };
    const W = Math.floor(buf.length / 2);
    const tauMin = Math.floor(sr / MAX_F), tauMax = Math.min(W - 1, Math.floor(sr / MIN_F));
    if (!yinBuf || yinBuf.length !== W) yinBuf = new Float32Array(W);
    const d = yinBuf; d[0] = 1; let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
      running += s; d[tau] = running ? s * tau / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < 0.15) { while (t + 1 <= tauMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) return { f: 0, rms };
    let better = tau;
    if (tau > 1 && tau < tauMax) { const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b; if (den) better = tau + (a - c) / (2 * den); }
    return { f: sr / better, rms };
  }

  // =============== Glättung: Ton-Segmente ===============
  // Solange die Stimme in der Nähe des laufenden Mittelwerts bleibt (±0.7 Halbtöne, deckt Vibrato ab),
  // wird gemittelt. Ein neuer Ton startet erst, wenn die Abweichung ~90 ms stabil anhält oder nach einer Pause.
  const SEG_TOL = 0.85, SWITCH_MS = 90, SILENCE_MS = 120;
  let seg = null, cand = [], lastVoice = 0, segCount = 0;
  const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  function trimmedMean(a) {
    const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length * 0.2);
    const t = s.slice(k, s.length - k || undefined); return t.reduce((x, y) => x + y, 0) / t.length;
  }
  // Dauer des laufenden Tons festhalten, wenn er endet (für den Rhythmus)
  function endSeg(t) { if (seg && seg.rh && seg.rh.d == null) seg.rh.d = Math.max(.05, (t - seg.start) / 1000); }
  function newSeg(vals, start, onset) { if (onset && calRun && !onsetNode) calRun.on.push(ctxAt(start) - lagNow()); endSeg(start); segCount++; seg = { vals, start, center: trimmedMean(vals), added: false, id: segCount }; cand = []; }
  let inTol = 0;
  function segFeed(m, now) {
    if (!seg) { newSeg([m], now, true); return; }
    if (Math.abs(m - seg.center) < SEG_TOL) {
      seg.vals.push(m); if (seg.vals.length > 60) seg.vals.shift();
      seg.center = trimmedMean(seg.vals);
      if (++inTol >= 2) cand = [];          // erst nach 2 Treffern zurück zum alten Ton
    } else {
      inTol = 0;
      cand.push({ m, t: now });
      cand = cand.filter(c => now - c.t <= 220);
      if (cand.length >= 3 && now - cand[0].t >= SWITCH_MS) {
        const recent = cand.filter(c => now - c.t <= 160).map(c => c.m);
        const cm = median(recent);
        const spread = median(recent.map(v => Math.abs(v - cm)));
        if (spread < 0.4) newSeg(recent, cand[0].t);   // stabil genug → neuer Ton (sonst: noch im Gleiten)
      }
    }
  }

  // =============== Einsätze sample-genau (AudioWorklet, eigener Audio-Faden) ===============
  // Misst, wann die Stimme lauter wird – unabhängig davon, ob die Seite gerade ruckelt. Zählt nur ein schneller Anstieg
  // (mehr als doppelt so laut innerhalb von 40 ms): ein Konsonant/neuer Anschlag ja, Lautstärke-Vibrato nein. Zeiten in AudioContext-Zeit,
  // also derselben Uhr wie die Metronom-Klicks. Vorher gefiltert: Klicks (hoch) und Rumpeln (tief) zählen nicht.
  const ONSET_JS = `class O extends AudioWorkletProcessor{constructor(){super();this.w=new Float32Array(Math.ceil(.01*sampleRate/32));this.wk=0;this.ws=0;
  this.h=new Float32Array(Math.ceil(.04*sampleRate/32));this.k=0;this.last=-1;this.rise=null}
  process(ins){const x=ins[0]&&ins[0][0];if(!x)return true;const H=32,n=x.length,h=this.h,w=this.w;
  for(let o=0;o<n;o+=H){let e=0;for(let i=o;i<o+H&&i<n;i++)e+=x[i]*x[i];
  this.ws+=e-w[this.wk%w.length];w[this.wk++%w.length]=e;const s=Math.sqrt(Math.max(0,this.ws)/(w.length*H));
  const t=currentTime+o/sampleRate;h[this.k++%h.length]=s;let f=1e9;for(let i=0;i<h.length;i++)if(h[i]<f)f=h[i];
  if(s<=Math.max(.002,f*1.5))this.rise=t-.005;
  if(this.rise!=null&&s>.004&&s>f*2.2&&t-this.last>.07){this.last=t;this.port.postMessage(this.rise);this.rise=null}}
  return true}}
  registerProcessor("onsets",O)`;
  let onsetNode = null, onsetMod = null, onsets = [];
  async function onsetStart(src) {
    try {
      if (!ctx.audioWorklet) return;
      if (!onsetMod) onsetMod = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([ONSET_JS], { type: "application/javascript" })));
      await onsetMod;
      const f = (type, hz) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = hz; return b; };
      const hp = f("highpass", 80), lp1 = f("lowpass", 1000), lp2 = f("lowpass", 1000);
      onsetNode = new AudioWorkletNode(ctx, "onsets", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      onsetNode.port.onmessage = e => { onsets.push(e.data); if (onsets.length > 64) onsets.shift(); if (calRun) calRun.on.push(e.data); };
      src.connect(hp); hp.connect(lp1); lp1.connect(lp2); lp2.connect(onsetNode); onsetNode.connect(ctx.destination);
    } catch { onsetNode = null; }
  }
  function onsetStop() { if (onsetNode) { try { onsetNode.port.onmessage = null; onsetNode.disconnect(); } catch {} onsetNode = null; } }
  // Bildschirm-Zeit → AudioContext-Zeit. currentTime springt in Blöcken: die kleinste Differenz ist die genaueste.
  let clk = null;
  function clkTick() { if (!ctx) return; const o = performance.now() / 1000 - ctx.currentTime; clk = clk == null || o - clk > .3 ? o : Math.min(o, clk + 2e-6); }
  const ctxAt = ms => { clkTick(); return ms / 1000 - clk; };
  // Einsatz eines erkannten Tons: der passende Lautstärke-Anstieg; ohne einen solchen (gebunden gesungen) die übliche Erkennungs-Verzögerung abziehen
  const lagEst = []; let lastOn = -1;
  const lagNow = () => lagEst.length >= 3 ? median(lagEst) : .045;
  function noteOnset(startMs) {
    const T = ctxAt(startMs), want = T - lagNow(); let best = null;
    for (const t of onsets) if (t > T - .25 && t < T + .015 && t > lastOn + .05 && (best == null || Math.abs(t - want) < Math.abs(best - want))) best = t;
    if (best == null) return want;
    lagEst.push(T - best); if (lagEst.length > 15) lagEst.shift(); lastOn = best; return best;
  }

  // =============== Audio ===============
  let ctx, analyser, stream, raf, data, running = false, wakeLock = null;
  let liveTake = [], liveKey = null;   // Töne dieses Durchgangs (mit genauer Tonhöhe) und die Tonart, auf die Verlass ist
  const hist = [], trace = [];
  let rawStable = { midi: null, since: 0 };
  let current = null;
  const levelBar = $("levelBar"), noteEl = $("note"), metaEl = $("meta"), needle = $("needle");

  let visualOnly = false, lastAuto = null;   // true während einer Memo-Aufnahme: nur anzeigen, nicht mitschreiben
  async function start(useStream, vis) {
    $("err").textContent = ""; visualOnly = !!vis;
    if (!useStream) Piano.setRec(true);
    try {
      stream = useStream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      Piano.setRec(false);
      $("err").textContent = "Kein Mikrofonzugriff. Bitte im Browser erlauben und erneut versuchen. (" + (e.name || e) + ")"; return;
    }
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    onsets = []; lastOn = -1; clkTick(); await onsetStart(src);
    analyser = ctx.createAnalyser();
    analyser.fftSize = ctx.sampleRate > 48000 ? 4096 : 2048;
    data = new Float32Array(analyser.fftSize);
    src.connect(analyser);
    running = true; liveSaving = true; seg = null; cand = []; liveTake = []; liveKey = fitKey(song());
    $("startBtn").textContent = vis === "cal" ? "■ Kalibrieren abbrechen" : vis ? "■ Memo stoppen" : "■ Stopp"; $("startBtn").classList.remove("primary"); $("startBtn").classList.toggle("recon", !!vis);
    dockState();
    metaEl.textContent = "Ich höre zu …";
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    loop();
  }
  function stop() {
    const metroTake = !!Metro.timer;
    endSeg(performance.now());
    running = false; liveSaving = false; cancelAnimationFrame(raf); saveNow();
    stream?.getTracks().forEach(t => t.stop()); onsetStop();
    if (!recState) Piano.setRec(false);
    try { wakeLock?.release(); } catch {}
    $("startBtn").textContent = "🎤 Start"; $("startBtn").classList.add("primary"); $("startBtn").classList.remove("recon");
    const wasLive = !visualOnly;
    showIdle("Pausiert"); levelBar.style.width = "0"; visualOnly = false;
    if (wasLive) takeRecheck(liveTake);   // mit der jetzt sicheren Tonart nochmals prüfen
    if (wasLive && settings.auto && !metroTake) setTimeout(() => autoTempo(false), 50);   // mit Metronom ist das Tempo schon klar
    if (calRun) calDone();
    dockState();
  }
  $("startBtn").onclick = () => { if (recState) { recState.rec.stop(); return; } if (calRun) { calRun.abort = true; stop(); return; } running ? stop() : start(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden && running) stop(); });

  function loop() {
    if (!running) return;
    analyser.getFloatTimeDomainData(data);
    const { f, rms } = detectPitch(data, ctx.sampleRate);
    const now = performance.now(); clkTick();
    levelBar.style.width = Math.max(0, Math.min(100, (20 * Math.log10(rms + 1e-9) + 60) / 60 * 100)) + "%";

    if (f > 0) {
      lastVoice = now;
      const mRaw = 69 + 12 * Math.log2(f / 440);
      hist.push(mRaw); if (hist.length > 5) hist.shift();
      const mMed = median(hist);
      // Tonwiederholung live: Lautstärke-Einbruch und wieder laut auf gleicher Tonhöhe → neuer Ton
      if (seg && Math.abs(mRaw - seg.center) < SEG_TOL) {
        seg.peak = Math.max(seg.peak || 0, rms);
        if (rms < seg.peak * .7 && now - seg.start > 50) seg.dip = true;
        else if (seg.dip && rms > seg.peak * .88) {
          // nur bei einem echten neuen Anschlag (Lautstärke-Sprung, sample-genau gemessen) – sonst machen Vibrato und
          // Lautstärke-Schwankungen eines gehaltenen Tons einen Doppelton
          const T = ctxAt(now);
          if (!onsetNode || onsets.some(t => t > T - .15 && t < T + .01 && t > seg.start / 1000 - clk + .05)) newSeg([mRaw], now, true);
          else { seg.dip = false; seg.peak = rms; }
        }
      }
      segFeed(mRaw, now);
      let mShow, held;
      if (settings.smooth && seg) { mShow = seg.center; held = now - seg.start; }
      else {
        mShow = mMed; const r = Math.round(mMed);
        if (rawStable.midi !== r) rawStable = { midi: r, since: now };
        held = now - rawStable.since;
      }
      const midi = Math.round(mShow);
      current = { midi, cents: Math.round((mShow - midi) * 100), f: midiToFreq(mShow) };
      trace.push({ t: now, m: mRaw, s: seg ? seg.center : null, id: seg ? seg.id : 0 });
      showNote(current, held > 250);
      // notieren, sobald ein Ton kurz stabil ist (100 ms; bei grossem Sprung 200 ms gegen Oktavfehler)
      if (settings.auto && !visualOnly && seg && !seg.added) {
        // gerundet – unsauber gesungen und tonartfremd → passender Nachbarton (siehe fitPitch)
        const mm = fitPitch(seg.center, liveKey, pitchStats(liveTake.map(x => x.c))), jump = lastAuto == null ? 0 : Math.abs(mm - lastAuto);
        if (now - seg.start > (jump > 12 ? 300 : jump > 9 ? 200 : 100)) {
          seg.added = true; seg.addedMidi = mm; lastAuto = mm; seg.ref = addNote(mm, true);
          liveTake.push(seg.take = { line: seg.ref.line, idx: seg.ref.idx, c: seg.center, m: mm }); liveKey = fitKey(song());
          // Einsatzzeit merken; läuft das Metronom, auch dessen Raster (eine «Eins»)
          const L = seg.ref.line; L.rh = L.rh || [];
          // Einsatz in Metronom-Zeit; mit Metronom die gemessene Verzögerung Klick → Ohr → Stimme → Mikrofon abziehen
          const a = Metro.timer ? Metro.t0 : null, t = noteOnset(seg.start) - (a != null ? latNow() : 0), prev = L.rh[seg.ref.idx - 1];
          // neuer Durchgang (Pause > 4 s, anderes Metronom): nicht mit altem Rhythmus mischen
          if (seg.ref.idx > 0 && (!prev || t - prev.t > 4 || t < prev.t || prev.a !== a)) L.rh = [];
          L.rh[seg.ref.idx] = seg.rh = { t, d: null, a, b: a != null ? song().bpm : null };
        }
      } else if (seg && seg.added && seg.ref) {
        // früh notierter Ton: korrigieren, solange er sich noch einpendelt
        const r = seg.ref, early = now - seg.start < 1500;
        if (early && seg.take) seg.take.c = seg.center;
        const mm = fitPitch(seg.center, liveKey, pitchStats(liveTake.map(x => x.c)));
        if (mm !== seg.addedMidi && r.line.notes[r.idx] === seg.addedMidi && early) { r.line.notes[r.idx] = mm; seg.addedMidi = mm; lastAuto = mm; if (seg.take) seg.take.m = mm; persist(); afterNotesChanged(r.si); }
      }
    } else {
      hist.length = 0;
      trace.push({ t: now, m: null });
      if (now - lastVoice > SILENCE_MS) { endSeg(lastVoice); seg = null; cand = []; current = null; showIdle(""); rawStable = { midi: null, since: 0 }; }
    }
    while (trace.length && now - trace[0].t > 6000) trace.shift();
    drawTrace(now);
    raf = requestAnimationFrame(loop);
  }

  function showNote({ midi, cents, f }, ok) {
    noteEl.className = "note" + (ok ? " ok" : "");
    noteEl.innerHTML = noteName(midi) + "<sub>" + octave(midi) + "</sub>";
    metaEl.textContent = f.toFixed(1) + " Hz · " + (cents > 0 ? "+" : "") + cents + " Cent";
    needle.style.left = (50 + Math.max(-50, Math.min(50, cents))) + "%"; needle.style.opacity = 1;
    needle.style.background = Math.abs(cents) <= 10 ? "var(--good)" : "var(--accent)";
    
  }
  function showIdle(msg) {
    noteEl.className = "note idle"; noteEl.textContent = "–";
    if (msg !== undefined) metaEl.textContent = msg || "Ich höre zu …";
    needle.style.opacity = 0;
  }

  // =============== Verlauf zeichnen ===============
  const cv = $("trace"), g = cv.getContext("2d");
  let viewCenter = 60;
  function drawTrace(now) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const vals = trace.filter(p => p.m != null).map(p => p.m);
    if (vals.length) { const tg = (Math.min(...vals) + Math.max(...vals)) / 2; viewCenter += (tg - viewCenter) * 0.08; }
    const range = h < 100 ? 9 : 14, L = 34, step = h / range, y = m => h / 2 - (m - viewCenter) / range * h, x = t => L + (w - L) * (1 - (now - t) / 6000);
    g.font = "10px sans-serif"; g.textBaseline = "middle";
    for (let m = Math.floor(viewCenter - range / 2); m <= Math.ceil(viewCenter + range / 2); m++) {
      const yy = y(m), pc = ((m % 12) + 12) % 12, black = [1,3,6,8,10].includes(pc);
      g.strokeStyle = pc === 0 ? "#3a4050" : black ? "#1b1e25" : "#252933"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, yy); g.lineTo(w, yy); g.stroke();
      if (!black && (step >= 9 || pc === 0 || pc === 7)) { g.fillStyle = "#5c6372"; g.fillText(noteName(m) + octave(m), 4, yy); }
    }
    // geglättete Töne als Balken
    if (settings.smooth) {
      g.strokeStyle = "rgba(62,207,142,.55)"; g.lineWidth = 7; g.lineCap = "round";
      let segStart = null, last = null;
      const flush = () => { if (segStart && last && last.t - segStart.t > 60) { const yy = y(last.s); g.beginPath(); g.moveTo(x(segStart.t), yy); g.lineTo(x(last.t), yy); g.stroke(); } };
      for (const p of trace) {
        if (p.s == null || (last && p.id !== last.id)) { flush(); segStart = p.s == null ? null : p; last = p.s == null ? null : p; continue; }
        if (!segStart) segStart = p; last = p;
      }
      flush(); g.lineCap = "butt";
    }
    // rohe Kurve
    g.strokeStyle = settings.smooth ? "rgba(240,180,41,.75)" : "#f0b429"; g.lineWidth = settings.smooth ? 1.5 : 2.5; g.lineJoin = "round"; g.beginPath();
    let pen = false;
    for (const p of trace) { if (p.m == null) { pen = false; continue; } if (!pen) { g.moveTo(x(p.t), y(p.m)); pen = true; } else g.lineTo(x(p.t), y(p.m)); }
    g.stroke();
  }

  // =============== Notieren ===============
