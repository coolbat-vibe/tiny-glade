// ============================================================================
// audio.js — Procedural Cozy ASMR & Generative Acoustic Harp/Nature Soundscape
// ============================================================================

const AUDIO = (() => {
  let ctx = null;
  let masterGain = null;
  let sfxGain = null;
  let bgmGain = null;
  let noiseBuf = null;
  let windNode = null;
  let windFilter = null;
  let enabled = true;
  let started = false;
  let nextNoteTime = 0;
  let nextBirdTime = 0;
  let lastTileTick = 0;
  let lastStepTick = 0;

  // F-major / D-minor cozy pastoral pentatonic frequencies
  const COZY_NOTES = [
    261.63, 293.66, 349.23, 392.00, 440.00,
    523.25, 587.33, 698.46, 783.99, 880.00, 1046.50
  ];

  function ensureContext() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.72;
      masterGain.connect(ctx.destination);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.85;
      sfxGain.connect(masterGain);

      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0.28;
      bgmGain.connect(masterGain);

      // Shared white/pink noise buffer for organic ASMR textures
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }

      setupWindBed();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    started = true;
    return true;
  }

  function setupWindBed() {
    if (!ctx || windNode) return;
    windNode = ctx.createBufferSource();
    windNode.buffer = noiseBuf;
    windNode.loop = true;

    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.14;

    windNode.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(bgmGain);
    windNode.start();
  }

  // Tactile clay roof tile clink
  function playTileClatter(pitchScale = 1.0) {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    if (now - lastTileTick < 0.042) return;
    lastTileTick = now;

    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const t = now + i * (0.025 + Math.random() * 0.02);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const base = (920 + Math.random() * 520) * pitchScale;
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.58, t + 0.055);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
      osc.connect(g);
      g.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.07);
    }
  }

  // Cozy stone thud + ceramic pop when placing/settling buildings & walls
  function playStonePlace(scale = 1.0) {
    if (!ensureContext()) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165 * scale, now);
    osc.frequency.exponentialRampToValueAtTime(58 * scale, now + 0.14);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.17);

    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 680 * scale;
    f.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    n.connect(f);
    f.connect(ng);
    ng.connect(sfxGain);
    n.start(now, Math.random() * 1.2, 0.1);

    playTileClatter(0.95 + Math.random() * 0.2);
  }

  // Elastic spring pop for morphs / paint / duplicate
  function playSpringPop(pitch = 1.0) {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(620 * pitch, now + 0.085);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.11);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // Emergent arch/door/bridge creation sparkle!
  function playArchChime() {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 1046.50];
    chord.forEach((freq, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
      osc.connect(g);
      g.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.58);
    });
  }

  // Warm harp arpeggio when expanding or generating a new world
  function playMapExpandFanfare() {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const notes = [349.23, 440.00, 523.25, 698.46, 880.00, 1046.50];
    notes.forEach((freq, i) => {
      playHarpPluck(now + i * 0.065, freq, 0.095);
    });
  }

  // Villager stroll mode footsteps (grass / cobble stone / wooden bridge)
  function playFootstep(surface = 'grass') {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    if (now - lastStepTick < 0.24) return;
    lastStepTick = now;

    if (surface === 'wood') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(195 + Math.random() * 35, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.07);
      g.gain.setValueAtTime(0.11, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(g);
      g.connect(sfxGain);
      osc.start(now);
      osc.stop(now + 0.085);
      return;
    }

    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = surface === 'stone' ? (820 + Math.random() * 180) : (1450 + Math.random() * 250);
    f.Q.value = surface === 'stone' ? 2.2 : 1.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(surface === 'stone' ? 0.09 : 0.075, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    n.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    n.start(now, Math.random() * 1.2, 0.1);
  }

  // Foliage / grass / path soft brush rustle
  function playBrushRustle(kind = 'foliage') {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    if (now - lastTileTick < 0.075) return;
    lastTileTick = now;

    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = kind === 'water' ? 1150 : kind === 'dirt' ? 520 : 1650;
    f.Q.value = kind === 'water' ? 2.4 : 1.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    n.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    n.start(now, Math.random() * 1.4, 0.14);

    if (kind === 'water') {
      const drop = ctx.createOscillator();
      const dg = ctx.createGain();
      drop.type = 'sine';
      const base = 520 + Math.random() * 340;
      drop.frequency.setValueAtTime(base, now);
      drop.frequency.exponentialRampToValueAtTime(base * 1.75, now + 0.08);
      dg.gain.setValueAtTime(0.06, now);
      dg.gain.exponentialRampToValueAtTime(0.0008, now + 0.09);
      drop.connect(dg);
      dg.connect(sfxGain);
      drop.start(now);
      drop.stop(now + 0.095);
    }
  }

  // Adorable sheep "baa~" when petted!
  function playSheepBaa() {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(310 + Math.random() * 45, now);
    osc.frequency.linearRampToValueAtTime(275, now + 0.34);

    vib.type = 'sine';
    vib.frequency.value = 13.5;
    vibGain.gain.value = 14;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);

    f.type = 'bandpass';
    f.frequency.value = 780;
    f.Q.value = 2.1;

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.13, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    vib.start(now);
    osc.stop(now + 0.4);
    vib.stop(now + 0.4);

    const chime = ctx.createOscillator();
    const cg = ctx.createGain();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(880, now + 0.06);
    chime.frequency.setValueAtTime(1174.66, now + 0.14);
    cg.gain.setValueAtTime(0.06, now + 0.06);
    cg.gain.exponentialRampToValueAtTime(0.0008, now + 0.42);
    chime.connect(cg);
    cg.connect(sfxGain);
    chime.start(now + 0.06);
    chime.stop(now + 0.44);
  }

  // Pond duck soft quack
  function playDuckQuack() {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.13;
      const osc = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(290, t + 0.09);
      f.type = 'bandpass';
      f.frequency.value = 1150;
      f.Q.value = 2.6;
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(f);
      f.connect(g);
      g.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.11);
    }
  }

  // Soft poof demolish sound
  function playDemolish() {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.15);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.17);
    playBrushRustle('dirt');
  }

  function playUiClick(bright = false) {
    if (!ensureContext()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(bright ? 740 : 540, now);
    osc.frequency.exponentialRampToValueAtTime(bright ? 980 : 420, now + 0.045);
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.05);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  // Generative ambient harp/kalimba + songbirds ticked from main loop
  function update(timeSec, isNight) {
    if (!enabled || !started || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (windFilter) {
      windFilter.frequency.value = 340 + Math.sin(timeSec * 0.27) * 120;
    }

    if (now >= nextNoteTime) {
      nextNoteTime = now + 1.15 + Math.random() * 2.4;
      const freq = COZY_NOTES[Math.floor(Math.random() * COZY_NOTES.length)];
      playHarpPluck(now, freq, 0.09);
      if (Math.random() < 0.42) {
        const fifth = freq * 1.498;
        playHarpPluck(now + 0.22 + Math.random() * 0.15, fifth, 0.06);
      }
    }

    if (!isNight && now >= nextBirdTime) {
      nextBirdTime = now + 4.5 + Math.random() * 7.5;
      playBirdChirp(now);
    }
  }

  function playHarpPluck(t, freq, amp) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc2.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq * 2, t);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.18, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    g.gain.setValueAtTime(0.0005, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 2.4);

    osc2.connect(g2);
    g2.connect(g);
    osc.connect(g);
    g.connect(bgmGain);

    osc.start(t);
    osc2.start(t);
    osc.stop(t + 2.5);
    osc2.stop(t + 2.5);
  }

  function playBirdChirp(t) {
    const chirps = 2 + Math.floor(Math.random() * 2);
    const base = 2100 + Math.random() * 900;
    for (let i = 0; i < chirps; i++) {
      const st = t + i * 0.11;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, st);
      osc.frequency.exponentialRampToValueAtTime(base * 1.32, st + 0.045);
      osc.frequency.exponentialRampToValueAtTime(base * 0.92, st + 0.085);
      g.gain.setValueAtTime(0.0005, st);
      g.gain.linearRampToValueAtTime(0.032, st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0004, st + 0.09);
      osc.connect(g);
      g.connect(bgmGain);
      osc.start(st);
      osc.stop(st + 0.095);
    }
  }

  function setEnabled(flag) {
    enabled = !!flag;
    if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(enabled ? 0.72 : 0.0, ctx.currentTime, 0.06);
    }
    if (enabled) ensureContext();
    return enabled;
  }

  return {
    ensureContext,
    playTileClatter,
    playStonePlace,
    playSpringPop,
    playArchChime,
    playMapExpandFanfare,
    playFootstep,
    playBrushRustle,
    playSheepBaa,
    playDuckQuack,
    playDemolish,
    playUiClick,
    update,
    setEnabled,
    isEnabled: () => enabled
  };
})();
