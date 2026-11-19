/* Procedural WebAudio SFX — unlocked on first user gesture (required on iOS). */
(function (global) {
  "use strict";

  const AudioFX = {
    ctx: null,
    master: null,
    muted: false,
    unlocked: false,
    _bowOsc: null,
    _bowGain: null,
  };

  function ctx() {
    if (AudioFX.ctx) return AudioFX.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    AudioFX.ctx = new AC();
    AudioFX.master = AudioFX.ctx.createGain();
    AudioFX.master.gain.value = 0.22;
    AudioFX.master.connect(AudioFX.ctx.destination);
    return AudioFX.ctx;
  }

  AudioFX.unlock = function () {
    const c = ctx();
    if (!c) return;
    if (c.state === "suspended") c.resume();
    // silent tick to fully unlock on iOS
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch (e) {}
    AudioFX.unlocked = true;
  };

  AudioFX.setMuted = function (m) {
    AudioFX.muted = !!m;
    if (AudioFX.master) AudioFX.master.gain.value = AudioFX.muted ? 0 : 0.22;
  };

  function envGain(t, a, d, v) {
    const c = ctx();
    if (!c || !AudioFX.master) return null;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(AudioFX.master);
    return g;
  }

  function tone(type, freq, dur, vol, slide) {
    const c = ctx();
    if (!c || AudioFX.muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    const g = envGain(t, 0.012, dur, vol);
    if (!g) return;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq) {
    const c = ctx();
    if (!c || AudioFX.muted) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq || 900;
    const t = c.currentTime;
    const g = envGain(t, 0.008, dur, vol);
    if (!g) return;
    src.connect(f);
    f.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  AudioFX.ui = function () { tone("square", 660, 0.07, 0.18, 880); };
  AudioFX.shoot = function () { tone("square", 420, 0.07, 0.2, 160); noise(0.05, 0.12, 1800); };
  AudioFX.slash = function () { noise(0.12, 0.22, 2400); tone("sawtooth", 280, 0.1, 0.12, 90); };
  AudioFX.pickup = function () { tone("sine", 520, 0.08, 0.2, 880); setTimeout(() => tone("sine", 880, 0.1, 0.16, 1320), 60); };
  AudioFX.hurt = function () { tone("sawtooth", 180, 0.16, 0.22, 70); noise(0.1, 0.16, 400); };
  AudioFX.die = function () { tone("sawtooth", 140, 0.28, 0.2, 50); noise(0.25, 0.2, 500); };
  AudioFX.boss = function () { tone("sawtooth", 80, 0.5, 0.28, 40); noise(0.4, 0.22, 300); };
  AudioFX.explode = function () { noise(0.28, 0.3, 600); tone("triangle", 90, 0.25, 0.18, 40); };
  AudioFX.wave = function () { tone("triangle", 300, 0.2, 0.16, 600); };
  AudioFX.power = function () { tone("sine", 400, 0.15, 0.2, 900); tone("triangle", 600, 0.2, 0.12, 200); };
  AudioFX.hit = function () { noise(0.06, 0.16, 1200); tone("square", 200, 0.05, 0.1, 80); };
  AudioFX.arrowFly = function (charge) {
    tone("triangle", 500 + charge * 400, 0.12, 0.14, 280);
    noise(0.08, 0.1 + charge * 0.08, 2000);
  };
  AudioFX.arrowStick = function () { tone("sine", 180, 0.08, 0.1, 90); noise(0.05, 0.1, 800); };

  AudioFX.bowDrawStart = function () {
    const c = ctx();
    if (!c || AudioFX.muted) return;
    AudioFX.bowDrawStop();
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(90, t);
    o.frequency.linearRampToValueAtTime(220, t + 1.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.08);
    o.connect(g);
    g.connect(AudioFX.master);
    o.start(t);
    AudioFX._bowOsc = o;
    AudioFX._bowGain = g;
  };

  AudioFX.bowDrawStop = function () {
    if (!AudioFX._bowOsc) return;
    try {
      const c = ctx();
      const t = c ? c.currentTime : 0;
      if (AudioFX._bowGain) {
        AudioFX._bowGain.gain.cancelScheduledValues(t);
        AudioFX._bowGain.gain.setValueAtTime(Math.max(0.0001, AudioFX._bowGain.gain.value), t);
        AudioFX._bowGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      }
      AudioFX._bowOsc.stop(t + 0.08);
    } catch (e) {}
    AudioFX._bowOsc = null;
    AudioFX._bowGain = null;
  };

  global.AudioFX = AudioFX;
})(window);
