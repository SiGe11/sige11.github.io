// Procedural sound. No asset files: everything is synthesised on demand.

const COOLDOWNS = {
  spawn: 45,
  hit: 55,
  heroHit: 40,
  death: 80,
  spit: 70,
  telegraph: 120,
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this.muted = false;
    this.lastPlay = {};
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    // A gentle low-pass keeps the square/saw voices from sounding harsh.
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 5200;
    this.filter.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  unlock() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.unlocked = true;
    ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  play(name, opts = {}) {
    if (!this.unlocked || this.muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;

    const now = performance.now();
    const cd = COOLDOWNS[name] ?? 0;
    if (now - (this.lastPlay[name] ?? -1e9) < cd) return;
    this.lastPlay[name] = now;

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = opts.gain ?? 1;
    bus.connect(this.filter);

    switch (name) {
      case 'spawn':
        this.tone(bus, t, 90, 210, 0.14, 'triangle', 0.05);
        this.noise(bus, t, 0.1, 0.02, 900);
        break;
      case 'hit':
        this.tone(bus, t, 380, 240, 0.05, 'square', 0.028);
        this.noise(bus, t, 0.04, 0.02, 3200);
        break;
      case 'heroHit':
        this.tone(bus, t, 210, 130, 0.07, 'sawtooth', 0.04);
        this.noise(bus, t, 0.05, 0.025, 1800);
        break;
      case 'death':
        this.tone(bus, t, 150, 60, 0.16, 'sawtooth', 0.05);
        this.noise(bus, t, 0.12, 0.02, 1400);
        break;
      case 'spit':
        this.tone(bus, t, 620, 260, 0.09, 'sine', 0.03);
        break;
      case 'telegraph':
        this.tone(bus, t, 180, 320, 0.28, 'sine', 0.045);
        this.tone(bus, t + 0.05, 260, 420, 0.24, 'triangle', 0.025);
        break;
      case 'boom':
        this.tone(bus, t, 130, 40, 0.36, 'sine', 0.11);
        this.noise(bus, t, 0.28, 0.06, 1100);
        break;
      case 'summonTitan':
        this.tone(bus, t, 70, 150, 0.42, 'sawtooth', 0.08);
        this.tone(bus, t + 0.1, 150, 96, 0.34, 'triangle', 0.05);
        this.noise(bus, t, 0.3, 0.04, 700);
        break;
      case 'upgrade':
        this.tone(bus, t, 340, 520, 0.1, 'triangle', 0.06);
        this.tone(bus, t + 0.06, 520, 780, 0.14, 'sine', 0.045);
        break;
      case 'frenzy':
        this.tone(bus, t, 200, 620, 0.3, 'sawtooth', 0.06);
        this.tone(bus, t + 0.08, 300, 900, 0.25, 'square', 0.02);
        break;
      case 'evolve':
        this.tone(bus, t, 280, 420, 0.24, 'triangle', 0.06);
        this.tone(bus, t + 0.12, 420, 640, 0.3, 'sine', 0.05);
        this.tone(bus, t + 0.24, 640, 880, 0.34, 'sine', 0.04);
        break;
      case 'capture':
        this.tone(bus, t, 420, 640, 0.16, 'sine', 0.05);
        this.tone(bus, t + 0.08, 640, 820, 0.18, 'triangle', 0.035);
        break;
      case 'lose_well':
        this.tone(bus, t, 420, 200, 0.24, 'triangle', 0.05);
        break;
      case 'victory':
        [330, 440, 550, 660].forEach((f, i) =>
          this.tone(bus, t + i * 0.11, f, f * 1.32, 0.34, 'triangle', 0.055),
        );
        break;
      case 'defeat':
        this.tone(bus, t, 260, 90, 0.7, 'sawtooth', 0.07);
        this.tone(bus, t + 0.18, 180, 60, 0.8, 'triangle', 0.05);
        this.noise(bus, t, 0.5, 0.03, 800);
        break;
      default:
        break;
    }

    setTimeout(() => bus.disconnect(), 1600);
  }

  tone(bus, start, freqFrom, freqTo, dur, type, peak) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), start + dur);
    gain.gain.setValueAtTime(1e-4, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  noise(bus, start, dur, peak, cutoff) {
    if (!this.ctx) return;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff ?? 2000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    src.start(start);
    src.stop(start + dur + 0.02);
  }
}
