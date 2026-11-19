  // =============== Wiedergabe ===============
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); return ctx; };
  function playTone(midi, dur, when, vol = .35) {
    const c = ac(), t0 = when ?? c.currentTime;
    const o = c.createOscillator(), o2 = c.createOscillator(), gn = c.createGain(), g2 = c.createGain();
    o.type = "triangle"; o2.type = "sine"; o.frequency.value = midiToFreq(midi); o2.frequency.value = midiToFreq(midi) * 2; g2.gain.value = .15;
    o.connect(gn); o2.connect(g2).connect(gn); gn.connect(c.destination);
    gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol, t0 + .015); gn.gain.exponentialRampToValueAtTime(.001, t0 + dur);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + .05); o2.stop(t0 + dur + .05);
    voices.push(o, o2);
  }
  // Ein Knopf startet die Wiedergabe, derselbe Knopf (■) stoppt sie
  let voices = [], playBtn = null, playTimer = null;
  function stopAll() {
    voices.forEach(o => { try { o.stop(); } catch {} }); voices = [];
    clearTimeout(playTimer);
    if (playBtn) { playBtn.textContent = "▶"; playBtn.classList.remove("primary"); playBtn = null; }
  }
  function playMelody(notes, btn) {
    if (btn && playBtn === btn) { stopAll(); return; }
    stopAll();
    if (!notes.length) return; const c = ac(); const t0 = c.currentTime + .05; let t = t0;
    notes.forEach(m => { playTone(m, .45, t); t += .42; });
    if (btn) { playBtn = btn; btn.textContent = "■"; btn.classList.add("primary"); playTimer = setTimeout(() => { if (playBtn === btn) { btn.textContent = "▶"; btn.classList.remove("primary"); playBtn = null; voices = []; } }, (t - t0) * 1000 + 200); }
  }
  function playChord(c) {
    if (c.txt != null) return; const t = ac().currentTime;
    QUAL[c.q].forEach(iv => playTone(48 + c.r + iv, .9, t, .18));
  }

  // =============== Start ===============
