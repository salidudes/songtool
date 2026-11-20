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
  function newSeg(vals, start) { endSeg(start); segCount++; seg = { vals, start, center: trimmedMean(vals), added: false, id: segCount }; cand = []; }
  let inTol = 0;
  function segFeed(m, now) {
    if (!seg) { newSeg([m], now); return; }
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

  // =============== Audio ===============
  let ctx, analyser, stream, raf, data, running = false, wakeLock = null;
  const hist = [], trace = [];
  let rawStable = { midi: null, since: 0 };
  let current = null;
  const levelBar = $("levelBar"), noteEl = $("note"), metaEl = $("meta"), needle = $("needle");

  let visualOnly = false, lastAuto = null;   // true während einer Memo-Aufnahme: nur anzeigen, nicht mitschreiben
  async function start(useStream, vis) {
    $("err").textContent = ""; visualOnly = !!vis;
    try {
      stream = useStream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      $("err").textContent = "Kein Mikrofonzugriff. Bitte im Browser erlauben und erneut versuchen. (" + (e.name || e) + ")"; return;
    }
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = ctx.sampleRate > 48000 ? 4096 : 2048;
    data = new Float32Array(analyser.fftSize);
    src.connect(analyser);
    running = true; seg = null; cand = [];
    $("startBtn").textContent = vis ? "■ Memo stoppen" : "■ Stopp"; $("startBtn").classList.remove("primary"); $("startBtn").classList.toggle("recon", !!vis);
    dockState();
    metaEl.textContent = "Ich höre zu …";
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    loop();
  }
  function stop() {
    endSeg(performance.now());
    running = false; cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    try { wakeLock?.release(); } catch {}
    $("startBtn").textContent = "🎤 Start"; $("startBtn").classList.add("primary"); $("startBtn").classList.remove("recon");
    showIdle("Pausiert"); levelBar.style.width = "0"; visualOnly = false;
    dockState();
  }
  $("startBtn").onclick = () => { if (recState) { recState.rec.stop(); return; } running ? stop() : start(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden && running) stop(); });

  function loop() {
    if (!running) return;
    analyser.getFloatTimeDomainData(data);
    const { f, rms } = detectPitch(data, ctx.sampleRate);
    const now = performance.now();
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
        else if (seg.dip && rms > seg.peak * .88) newSeg([mRaw], now);
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
        const mm = Math.round(seg.center), jump = lastAuto == null ? 0 : Math.abs(mm - lastAuto);
        if (now - seg.start > (jump > 12 ? 300 : jump > 9 ? 200 : 100)) {
          seg.added = true; seg.addedMidi = mm; lastAuto = mm; seg.ref = addNote(mm, true);
          // Einsatzzeit merken; läuft das Metronom, auch dessen Raster (eine «Eins»)
          const L = seg.ref.line; L.rh = L.rh || [];
          L.rh[seg.ref.idx] = seg.rh = { t: seg.start / 1000, d: null, a: Metro.timer ? Metro.anchor : null };
        }
      } else if (seg && seg.added && seg.ref) {
        // früh notierter Ton: korrigieren, solange er sich noch einpendelt
        const mm = Math.round(seg.center), r = seg.ref;
        if (mm !== seg.addedMidi && r.line.notes[r.idx] === seg.addedMidi && now - seg.start < 1500) { r.line.notes[r.idx] = mm; seg.addedMidi = mm; lastAuto = mm; persist(); afterNotesChanged(r.si); }
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
