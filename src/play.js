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
    if (c.txt != null) return; const t = ac().currentTime;
    QUAL[c.q].forEach(iv => playTone(48 + c.r + iv, .9, t, .18));
  }

  // =============== Start ===============
