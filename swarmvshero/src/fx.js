// Particles, ground decals, floating combat text and one-shot visual flourishes.

import { clamp, rand, pick } from './math.js';

const MAX_PARTICLES = 900;
const MAX_DECALS = 160;

export class Fx {
  constructor() {
    this.particles = [];
    this.decals = [];
    this.texts = [];
    this.rings = [];
    this.slashes = [];
    this.beams = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';
  }

  clear() {
    this.particles.length = 0;
    this.decals.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.slashes.length = 0;
    this.beams.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.flash = Math.max(0, this.flash - dt * 3.4);

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vy += p.gravity * dt;
      if (p.spin) p.angle += p.spin * dt;
    }
    if (this.particles.length && this.particles.some((p) => p.life <= 0)) {
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    for (const t of this.texts) {
      t.life -= dt;
      t.y -= t.rise * dt;
      t.rise *= 0.94;
    }
    if (this.texts.length && this.texts.some((t) => t.life <= 0)) {
      this.texts = this.texts.filter((t) => t.life > 0);
    }

    for (const r of this.rings) r.life -= dt;
    if (this.rings.length && this.rings.some((r) => r.life <= 0)) {
      this.rings = this.rings.filter((r) => r.life > 0);
    }

    for (const s of this.slashes) s.life -= dt;
    if (this.slashes.length && this.slashes.some((s) => s.life <= 0)) {
      this.slashes = this.slashes.filter((s) => s.life > 0);
    }

    for (const b of this.beams) b.life -= dt;
    if (this.beams.length && this.beams.some((b) => b.life <= 0)) {
      this.beams = this.beams.filter((b) => b.life > 0);
    }

    for (const d of this.decals) d.life -= dt;
    if (this.decals.length && this.decals.some((d) => d.life <= 0)) {
      this.decals = this.decals.filter((d) => d.life > 0);
    }
  }

  addShake(amount) {
    this.shake = Math.min(1.6, Math.max(this.shake, amount));
  }

  addFlash(amount, color = '255,255,255') {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  particle(opts) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      x: opts.x,
      y: opts.y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      life: opts.life ?? 0.5,
      maxLife: opts.life ?? 0.5,
      size: opts.size ?? 3,
      color: opts.color ?? '#fff',
      drag: opts.drag ?? 0.92,
      gravity: opts.gravity ?? 0,
      glow: opts.glow ?? true,
      shape: opts.shape ?? 'dot',
      angle: opts.angle ?? 0,
      spin: opts.spin ?? 0,
    });
  }

  /** Small directional spark burst, used for every hit. */
  hit(x, y, color, count = 8, speed = 140) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      this.particle({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.18, 0.42),
        size: rand(1.4, 3.2),
        color,
        drag: 0.88,
      });
    }
  }

  /** Bigger omnidirectional burst for deaths and explosions. */
  burst(x, y, color, count, speed, opts = {}) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.25, speed);
      this.particle({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.85),
        size: rand(1.8, opts.size ?? 4.5),
        color,
        drag: 0.9,
        gravity: opts.gravity ?? 0,
        shape: opts.shape ?? 'dot',
        spin: rand(-8, 8),
      });
    }
  }

  /** Soft dust kicked up by fast movement. */
  dust(x, y, color = 'rgba(150,170,185,0.5)') {
    this.particle({
      x: x + rand(-4, 4),
      y: y + rand(-2, 4),
      vx: rand(-14, 14),
      vy: rand(-10, 4),
      life: rand(0.3, 0.6),
      size: rand(2.5, 5.5),
      color,
      drag: 0.9,
      glow: false,
      shape: 'smoke',
    });
  }

  /** Persistent stain on the ground where something died. */
  decal(x, y, color, radius, life = 22) {
    if (this.decals.length >= MAX_DECALS) this.decals.shift();
    this.decals.push({
      x, y, color,
      radius,
      life,
      maxLife: life,
      seed: rand(0, 100),
      blobs: Array.from({ length: 5 }, () => ({
        dx: rand(-radius * 0.6, radius * 0.6),
        dy: rand(-radius * 0.45, radius * 0.45),
        r: rand(radius * 0.35, radius * 0.75),
      })),
    });
  }

  text(x, y, value, color, opts = {}) {
    this.texts.push({
      x: x + rand(-6, 6),
      y,
      value: String(value),
      color,
      life: opts.life ?? 0.85,
      maxLife: opts.life ?? 0.85,
      rise: opts.rise ?? 46,
      size: opts.size ?? 15,
      weight: opts.weight ?? 700,
    });
  }

  ring(x, y, radius, color, opts = {}) {
    this.rings.push({
      x, y,
      radius,
      from: opts.from ?? radius * 0.2,
      color,
      life: opts.life ?? 0.5,
      maxLife: opts.life ?? 0.5,
      width: opts.width ?? 3,
      fill: opts.fill ?? false,
    });
  }

  slash(x, y, angle, radius, color, opts = {}) {
    this.slashes.push({
      x, y, angle, radius, color,
      arc: opts.arc ?? 1.5,
      life: opts.life ?? 0.22,
      maxLife: opts.life ?? 0.22,
      width: opts.width ?? 7,
    });
  }

  beam(x1, y1, x2, y2, color, opts = {}) {
    this.beams.push({
      x1, y1, x2, y2, color,
      life: opts.life ?? 0.14,
      maxLife: opts.life ?? 0.14,
      width: opts.width ?? 2.4,
    });
  }

  // ---------------------------------------------------------------- drawing

  /** Ground-level layer: decals sit under everything else. */
  drawDecals(ctx) {
    ctx.save();
    for (const d of this.decals) {
      const fade = clamp(d.life / d.maxLife, 0, 1);
      ctx.globalAlpha = fade * 0.5;
      ctx.fillStyle = d.color;
      for (const b of d.blobs) {
        ctx.beginPath();
        ctx.ellipse(d.x + b.dx, d.y + b.dy, b.r, b.r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Everything above the entities. */
  draw(ctx) {
    // Rings and shockwaves.
    ctx.save();
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const radius = r.from + (r.radius - r.from) * t;
      const alpha = (1 - t) * (1 - t);
      if (r.fill) {
        const g = ctx.createRadialGradient(r.x, r.y, radius * 0.4, r.x, r.y, radius);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, r.color);
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.5);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Melee slash arcs.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.slashes) {
      const t = 1 - s.life / s.maxLife;
      const alpha = 1 - t;
      const sweep = s.arc;
      const start = s.angle - sweep / 2 + sweep * t * 0.8;
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = s.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = s.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * (0.85 + t * 0.35), start, start + sweep * 0.7);
      ctx.stroke();
    }
    ctx.restore();

    // Tracer beams (ranged shots, hero bolts).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const alpha = b.life / b.maxLife;
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width * alpha;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    ctx.restore();

    // Particles: glowing ones use additive blending for a cheap bloom.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (!p.glow) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const size = p.size * (0.4 + a * 0.6);
      if (p.shape === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-size, -size * 0.35, size * 2, size * 0.7);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.save();
    for (const p of this.particles) {
      if (p.glow) continue;
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - a * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Combat text draws last so it is never hidden by effects. */
  drawTexts(ctx, zoom) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      const pop = t.life > t.maxLife - 0.08 ? 1.35 : 1;
      const size = (t.size / Math.max(0.6, zoom)) * pop;
      ctx.globalAlpha = a;
      ctx.font = `${t.weight} ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(6,8,14,0.85)';
      ctx.strokeText(t.value, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.value, t.x, t.y);
    }
    ctx.restore();
  }
}

export const ICHOR_COLORS = ['#7d1f9e', '#5d1580', '#8f2bb0'];
export const randomIchor = () => pick(ICHOR_COLORS);
