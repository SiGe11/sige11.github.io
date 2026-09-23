// Procedural sound. No asset files: everything is synthesised on demand.
//
// Voices run bus -> (panner) -> low-pass -> master. The ambient bed joins at
// the master, so the mute switch silences everything.
//
// There is deliberately no compressor on the output. Measured offline, the
// loudest realistic frame — every cooldown-limited voice at once plus a shell
// — peaks near -19 dBFS. Only uncapped shells could stack toward clipping, so
// 'boom' has a cooldown like everything else. A DynamicsCompressorNode was
// tried: its knee and make-up gain reshaped every voice, loud or not.

const COOLDOWNS = {
  spawn: 45,
  hit: 55,
  heroHit: 40,
  death: 80,
  spit: 70,
  telegraph: 120,
  surface: 90,
  rally: 80,
  boom: 60,
};

/**
 * How far each voice may wander in pitch, in semitones either way. The same
 * sound at one fixed pitch forty times a second reads as a machine gun; a
 * little spread reads as a crowd. Stings and UI sounds stay exact.
 */
const SPREAD = {
  hit: 1.2,
  heroHit: 0.8,
  death: 1.8,
  spit: 1.5,
  spawn: 1.0,
  boom: 0.7,
  surface: 1.2,
};

/**
 * Ambient bed level. Measured offline, not guessed: this puts it near -56 dB
 * RMS calm and -49 dB at full tension, well under the -33..-36 dB peaks of
 * the everyday voices, so it fills silence without covering the fight.
 */
const AMBIENCE_LEVEL = 0.024;

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this.muted = false;
    this.lastPlay = {};
    this.amb = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    this.attach(new Ctor());
    return this.ctx;
  }

  /** Builds the output chain on `ctx`. Split out so a test can hand in an OfflineAudioContext. */
  attach(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;

    // A gentle low-pass keeps the square/saw voices from sounding harsh.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 5200;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);

    this.canPan = typeof ctx.createStereoPanner === 'function';

    // One second of white noise, shared by every noisy voice and the wind,
    // instead of a fresh buffer per hit.
    const frames = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  }

  unlock() {
    const ctx = this.ensure();
    if (!ctx) return;
    this.unlocked = true;
    ctx.resume().catch(() => {});
  }

  /** Called when the page is hidden, so the ambient bed does not hum on in a background tab. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.unlocked && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /**
   * `opts.pan` (-1 left .. 1 right) and `opts.gain` place a sound in the
   * world; Game.sfxAt derives both from where on screen it happened.
   */
  play(name, opts = {}) {
    if (!this.unlocked || this.muted) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const level = opts.gain ?? 1;
    // Too far off-screen to hear: skip it rather than spend the cooldown,
    // or a distant death would swallow a close one.
    if (level < 0.05) return;

    const now = performance.now();
    const cd = COOLDOWNS[name] ?? 0;
    if (now - (this.lastPlay[name] ?? -1e9) < cd) return;
    this.lastPlay[name] = now;

    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = level;
    let tail = bus;
    if (this.canPan && opts.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      bus.connect(panner);
      tail = panner;
    }
    tail.connect(this.filter);

    const spread = SPREAD[name] ?? 0;
    const k = 2 ** (((Math.random() * 2 - 1) * spread) / 12);
    const p = (hz) => hz * k;

    switch (name) {
      case 'spawn':
        this.tone(bus, t, p(90), p(210), 0.14, 'triangle', 0.05);
        this.noise(bus, t, 0.1, 0.02, 900, k);
        break;
      case 'hit':
        this.tone(bus, t, p(380), p(240), 0.05, 'square', 0.028);
        this.noise(bus, t, 0.04, 0.02, 3200, k);
        break;
      case 'heroHit':
        this.tone(bus, t, p(210), p(130), 0.07, 'sawtooth', 0.04);
        this.noise(bus, t, 0.05, 0.025, 1800, k);
        break;
      case 'death':
        this.tone(bus, t, p(150), p(60), 0.16, 'sawtooth', 0.05);
        this.noise(bus, t, 0.12, 0.02, 1400, k);
        break;
      case 'spit':
        this.tone(bus, t, p(620), p(260), 0.09, 'sine', 0.03);
        break;
      case 'telegraph':
        this.tone(bus, t, 180, 320, 0.28, 'sine', 0.045);
        this.tone(bus, t + 0.05, 260, 420, 0.24, 'triangle', 0.025);
        break;
      case 'boom':
        this.tone(bus, t, p(130), p(40), 0.36, 'sine', 0.11);
        this.noise(bus, t, 0.28, 0.06, 1100, k);
        break;
      case 'summonTitan':
        this.tone(bus, t, 70, 150, 0.42, 'sawtooth', 0.08);
        this.tone(bus, t + 0.1, 150, 96, 0.34, 'triangle', 0.05);
        this.noise(bus, t, 0.3, 0.04, 700);
        break;
      case 'surface':
        // A Burrower breaking ground: a dull thump under a spray of dirt.
        this.tone(bus, t, p(120), p(48), 0.2, 'sine', 0.07);
        this.noise(bus, t, 0.18, 0.035, 700, k);
        break;
      case 'rally':
        this.tone(bus, t, 520, 700, 0.07, 'sine', 0.03);
        this.tone(bus, t + 0.06, 700, 940, 0.09, 'sine', 0.025);
        break;
      case 'upgrade':
        this.tone(bus, t, 340, 520, 0.1, 'triangle', 0.06);
        this.tone(bus, t + 0.06, 520, 780, 0.14, 'sine', 0.045);
        break;
      case 'heroEmpower':
        // The champion grabbing a relic or a flask is bad news, so it must
        // not share the bright chime of the player's own upgrades.
        this.tone(bus, t, 110, 165, 0.34, 'sawtooth', 0.045);
        this.tone(bus, t + 0.05, 330, 247, 0.3, 'triangle', 0.035);
        this.noise(bus, t, 0.22, 0.02, 2400);
        break;
      case 'heroEvolve':
        // Heavy and falling, where the swarm's own evolve sting rises.
        this.tone(bus, t, 98, 65, 0.7, 'sawtooth', 0.07);
        this.tone(bus, t + 0.08, 196, 147, 0.6, 'triangle', 0.05);
        this.tone(bus, t + 0.16, 294, 220, 0.5, 'sine', 0.03);
        this.noise(bus, t, 0.5, 0.03, 900);
        break;
      case 'heartbeat':
        // Lub-dub under the Ascension timer; Game speeds it up as time runs out.
        this.tone(bus, t, 72, 42, 0.13, 'sine', 0.12);
        this.tone(bus, t + 0.17, 66, 40, 0.12, 'sine', 0.08);
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

    setTimeout(() => tail.disconnect(), 1600);
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

  /** A slice of the shared noise buffer; `rate` shifts its colour with the voice's pitch. */
  noise(bus, start, dur, peak, cutoff, rate = 1) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = rate;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff ?? 2000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    // A random offset, so back-to-back hits do not replay the same grain.
    src.start(start, Math.random() * 0.4);
    src.stop(start + dur + 0.02);
  }

  /**
   * The bed under everything: wind, and a low drone that swells and opens up
   * with `tension` (0 a fresh run .. 1 the champion is about to ascend).
   * Called every frame; it only schedules a change when the value moves.
   */
  ambience(tension, paused) {
    if (!this.unlocked || !this.ctx || this.ctx.state !== 'running') return;
    if (!this.amb) this.startAmbience();
    const step = Math.round(Math.max(0, Math.min(1, tension)) * 20);
    const key = step + (paused ? 100 : 0);
    if (key === this.amb.key) return;
    this.amb.key = key;
    const t = this.ctx.currentTime;
    const tn = step / 20;
    // Paused, the bed drops back so the pause screen reads as a breath.
    const level = AMBIENCE_LEVEL * (0.8 + tn * 0.4) * (paused ? 0.4 : 1);
    this.amb.out.gain.setTargetAtTime(level, t, 0.9);
    this.amb.droneFilter.frequency.setTargetAtTime(150 + tn * 480, t, 1.4);
    this.amb.droneGain.gain.setTargetAtTime(0.35 + tn * 0.25, t, 1.4);
  }

  startAmbience() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    // Wind: looping noise through a band-pass whose centre drifts slowly.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 380;
    band.Q.value = 0.8;
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.06;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 200;
    drift.connect(driftDepth);
    driftDepth.connect(band.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.55;
    wind.connect(band);
    band.connect(windGain);
    windGain.connect(out);

    // Drone: a low fifth, the upper voice detuned a hair so the two beat
    // slowly against each other instead of sitting still.
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 150;
    droneFilter.Q.value = 0.6;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.35;
    droneFilter.connect(droneGain);
    droneGain.connect(out);
    const voices = [[55, 'sine', 0.5], [82.6, 'triangle', 0.32], [110.4, 'sine', 0.18]];
    const oscs = voices.map(([hz, type, g]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      const vg = ctx.createGain();
      vg.gain.value = g;
      osc.connect(vg);
      vg.connect(droneFilter);
      return osc;
    });

    const t = ctx.currentTime;
    wind.start(t);
    drift.start(t);
    for (const osc of oscs) osc.start(t);
    this.amb = { out, droneFilter, droneGain, key: -1 };
  }
}
