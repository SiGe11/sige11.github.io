// Procedural artwork. Every creature, prop and prop shadow is drawn from code —
// no image assets — with one consistent light direction (upper-left).

import { PALETTE } from './config.js';
import { clamp, lerp } from './math.js';

const TAU = Math.PI * 2;

/**
 * Cached radial-glow sprite. Creating a gradient per entity per frame is the
 * single most expensive thing this renderer could do, so bake one white glow
 * and tint it with globalAlpha + a composite pass instead.
 */
const glowCache = new Map();
function glowSprite(color) {
  let sprite = glowCache.get(color);
  if (sprite) return sprite;
  const size = 128;
  sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const c = sprite.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  glowCache.set(color, sprite);
  return sprite;
}

/** Draw a cached glow centred on (x, y) with the given world radius. */
export function drawGlow(ctx, x, y, radius, color, alpha) {
  const sprite = glowSprite(color);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Shared helper: soft elliptical contact shadow under an object. */
function contactShadow(ctx, x, y, rx, ry, alpha = 0.34) {
  ctx.fillStyle = `rgba(4,8,14,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amount, 0, 255);
  const g = clamp(((n >> 8) & 255) + amount, 0, 255);
  const b = clamp((n & 255) + amount, 0, 255);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// --------------------------------------------------------------------- ground

export function drawGround(ctx, world, pattern, view, time) {
  ctx.fillStyle = pattern;
  ctx.fillRect(view.x, view.y, view.w, view.h);

  // Large slow colour drifts stop the tiling from reading as a grid.
  const g = ctx.createRadialGradient(
    world.width * 0.32, world.height * 0.36, 60,
    world.width * 0.32, world.height * 0.36, world.width * 0.5,
  );
  g.addColorStop(0, 'rgba(84,120,150,0.12)');
  g.addColorStop(1, 'rgba(84,120,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(view.x, view.y, view.w, view.h);

  const g2 = ctx.createRadialGradient(
    world.width * 0.74, world.height * 0.7, 60,
    world.width * 0.74, world.height * 0.7, world.width * 0.44,
  );
  g2.addColorStop(0, 'rgba(126,70,150,0.12)');
  g2.addColorStop(1, 'rgba(126,70,150,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(view.x, view.y, view.w, view.h);

  // Ground scatter, culled to the view.
  ctx.save();
  for (const d of world.details) {
    if (d.x < view.x - 20 || d.x > view.x + view.w + 20) continue;
    if (d.y < view.y - 20 || d.y > view.y + view.h + 20) continue;
    if (d.kind === 'tuft') {
      const sway = Math.sin(time * 1.2 + d.seed) * 0.16;
      ctx.strokeStyle = 'rgba(118,158,138,0.5)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = -1; i <= 1; i += 1) {
        ctx.moveTo(d.x + i * 2.4, d.y);
        ctx.quadraticCurveTo(
          d.x + i * 3 + sway * 6, d.y - d.size * 0.6,
          d.x + i * 4 + sway * 10 + d.tilt * 6, d.y - d.size,
        );
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(150,168,186,0.34)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.size * 0.32, d.size * 0.22, d.tilt, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawArenaBorder(ctx, world, pad) {
  ctx.save();
  ctx.strokeStyle = 'rgba(180,210,255,0.14)';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 12]);
  ctx.strokeRect(pad, pad, world.width - pad * 2, world.height - pad * 2);
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------- wells

export function drawWell(ctx, well, time) {
  const corrupted = well.owner === 'swarm';
  const base = corrupted ? '#b45cff' : '#ffd489';
  const pulse = 0.5 + Math.sin(time * 1.6 + well.pulse) * 0.5;

  ctx.save();

  // Sunken basin.
  const basin = ctx.createRadialGradient(well.x, well.y, well.radius * 0.15, well.x, well.y, well.radius);
  basin.addColorStop(0, corrupted ? 'rgba(70,20,100,0.55)' : 'rgba(60,52,30,0.5)');
  basin.addColorStop(0.7, 'rgba(16,22,30,0.4)');
  basin.addColorStop(1, 'rgba(16,22,30,0)');
  ctx.fillStyle = basin;
  ctx.beginPath();
  ctx.arc(well.x, well.y, well.radius, 0, TAU);
  ctx.fill();

  // Rune ring.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = base;
  ctx.globalAlpha = 0.32 + pulse * 0.22;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(well.x, well.y, well.radius * 0.82, 0, TAU);
  ctx.stroke();

  ctx.globalAlpha = 0.2 + pulse * 0.14;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(well.x, well.y, well.radius * 0.55, 0, TAU);
  ctx.stroke();

  // Rune ticks rotating slowly.
  const spin = time * (corrupted ? -0.4 : 0.25);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i += 1) {
    const a = spin + (i / 8) * TAU;
    const r1 = well.radius * 0.64;
    const r2 = well.radius * 0.78;
    ctx.beginPath();
    ctx.moveTo(well.x + Math.cos(a) * r1, well.y + Math.sin(a) * r1);
    ctx.lineTo(well.x + Math.cos(a) * r2, well.y + Math.sin(a) * r2);
    ctx.stroke();
  }

  // Core light.
  const core = ctx.createRadialGradient(well.x, well.y, 0, well.x, well.y, well.radius * 0.42);
  core.addColorStop(0, corrupted ? 'rgba(226,164,255,0.75)' : 'rgba(255,232,176,0.72)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.5 + pulse * 0.35;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(well.x, well.y, well.radius * 0.42, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Capture progress arc.
  if (well.progress > 0.01 && well.progress < 0.99) {
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = well.contested ? PALETTE.swarmGlow : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(well.x, well.y, well.radius * 0.92, -Math.PI / 2, -Math.PI / 2 + well.progress * TAU);
    ctx.stroke();
  }

  ctx.restore();
}

// -------------------------------------------------------------------- terrain

export function drawTerrainShadow(ctx, t, time) {
  const sway = Math.sin(time * 0.6 * t.sway + t.seed) * 3;
  switch (t.kind) {
    case 'tree':
      contactShadow(ctx, t.x + 10 + sway, t.y + t.radius * 0.5, t.canopy * 0.95, t.canopy * 0.4, 0.32);
      break;
    case 'ruin':
      contactShadow(ctx, t.x + 12, t.y + t.radius * 0.45, t.radius * 1.15, t.radius * 0.48, 0.34);
      break;
    case 'crystal':
      contactShadow(ctx, t.x + 8, t.y + t.radius * 0.4, t.radius * 1.1, t.radius * 0.45, 0.26);
      break;
    default:
      contactShadow(ctx, t.x + 8, t.y + t.radius * 0.35, t.radius * 1.05, t.radius * 0.46, 0.34);
  }
}

export function drawTerrain(ctx, t, time) {
  switch (t.kind) {
    case 'tree': return drawTree(ctx, t, time);
    case 'rock': return drawRock(ctx, t);
    case 'ruin': return drawRuin(ctx, t);
    default: return drawCrystal(ctx, t, time);
  }
}

function drawTree(ctx, t, time) {
  const sway = Math.sin(time * 0.8 * t.sway + t.seed) * 4;
  const topY = t.y - t.height;

  // Trunk.
  ctx.fillStyle = '#3a2b22';
  ctx.beginPath();
  ctx.moveTo(t.x - t.radius * 0.32, t.y + 6);
  ctx.quadraticCurveTo(t.x - t.radius * 0.16, t.y - t.height * 0.5, t.x - t.radius * 0.14 + sway * 0.5, topY + 10);
  ctx.lineTo(t.x + t.radius * 0.14 + sway * 0.5, topY + 10);
  ctx.quadraticCurveTo(t.x + t.radius * 0.16, t.y - t.height * 0.5, t.x + t.radius * 0.32, t.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(122,96,72,0.5)';
  ctx.beginPath();
  ctx.moveTo(t.x - t.radius * 0.3, t.y + 6);
  ctx.quadraticCurveTo(t.x - t.radius * 0.14, t.y - t.height * 0.5, t.x - t.radius * 0.06 + sway * 0.5, topY + 10);
  ctx.lineTo(t.x - t.radius * 0.02 + sway * 0.5, topY + 10);
  ctx.quadraticCurveTo(t.x - t.radius * 0.06, t.y - t.height * 0.5, t.x - t.radius * 0.16, t.y + 6);
  ctx.closePath();
  ctx.fill();

  // Canopy: three overlapping lobes, lit from upper-left.
  const lobes = [
    { dx: -t.canopy * 0.42, dy: 4, r: t.canopy * 0.66 },
    { dx: t.canopy * 0.4, dy: 10, r: t.canopy * 0.6 },
    { dx: 0, dy: -t.canopy * 0.3, r: t.canopy * 0.78 },
  ];
  for (const lobe of lobes) {
    const cx = t.x + lobe.dx + sway;
    const cy = topY + lobe.dy;
    const g = ctx.createRadialGradient(cx - lobe.r * 0.4, cy - lobe.r * 0.45, lobe.r * 0.1, cx, cy, lobe.r);
    g.addColorStop(0, `hsl(${t.hue}, 34%, 46%)`);
    g.addColorStop(0.55, `hsl(${t.hue}, 32%, 30%)`);
    g.addColorStop(1, `hsl(${t.hue - 8}, 34%, 17%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, lobe.r, 0, TAU);
    ctx.fill();
  }

  // Leaf speckle catches the light.
  ctx.fillStyle = `hsla(${t.hue + 12}, 40%, 58%, 0.35)`;
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + t.seed;
    const r = t.canopy * (0.2 + (i % 3) * 0.18);
    ctx.beginPath();
    ctx.arc(
      t.x + sway + Math.cos(a) * r - t.canopy * 0.12,
      topY + Math.sin(a) * r * 0.8 - t.canopy * 0.2,
      2.6, 0, TAU,
    );
    ctx.fill();
  }
}

function drawRock(ctx, t) {
  ctx.save();
  ctx.translate(t.x, t.y);

  // Body.
  ctx.beginPath();
  ctx.moveTo(t.shape[0].x, t.shape[0].y);
  for (let i = 1; i < t.shape.length; i += 1) ctx.lineTo(t.shape[i].x, t.shape[i].y);
  ctx.closePath();
  const g = ctx.createLinearGradient(-t.radius, -t.radius, t.radius * 0.6, t.radius);
  g.addColorStop(0, '#8b98a6');
  g.addColorStop(0.45, '#5c6875');
  g.addColorStop(1, '#333d49');
  ctx.fillStyle = g;
  ctx.fill();

  // Lit top facet.
  ctx.beginPath();
  ctx.moveTo(t.shape[0].x * 0.55, t.shape[0].y * 0.55 - t.height * 0.22);
  for (let i = 1; i < t.shape.length; i += 1) {
    ctx.lineTo(t.shape[i].x * 0.55, t.shape[i].y * 0.55 - t.height * 0.22);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(190,206,222,0.42)';
  ctx.fill();

  // Cracks.
  ctx.strokeStyle = 'rgba(22,28,36,0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-t.radius * 0.3, -t.radius * 0.1);
  ctx.lineTo(t.radius * 0.05, t.radius * 0.2);
  ctx.lineTo(t.radius * 0.4, t.radius * 0.05);
  ctx.stroke();

  ctx.restore();
}

function drawRuin(ctx, t) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.lean);

  const w = t.radius * 0.78;
  const h = t.height;

  // Column shaft.
  const g = ctx.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, '#cfc7b4');
  g.addColorStop(0.4, '#948c7c');
  g.addColorStop(1, '#575246');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w, 6);
  ctx.lineTo(-w * 0.82, -h);
  ctx.lineTo(w * 0.82, -h * (1 - t.broken * 0.35));
  ctx.lineTo(w, 6);
  ctx.closePath();
  ctx.fill();

  // Fluting.
  ctx.strokeStyle = 'rgba(50,48,42,0.35)';
  ctx.lineWidth = 1.2;
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.moveTo(w * 0.42 * i, 4);
    ctx.lineTo(w * 0.36 * i, -h * 0.9);
    ctx.stroke();
  }

  // Broken top edge.
  ctx.fillStyle = 'rgba(226,220,204,0.55)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.82, -h);
  ctx.lineTo(-w * 0.3, -h - 6);
  ctx.lineTo(w * 0.2, -h * (1 - t.broken * 0.3) - 4);
  ctx.lineTo(w * 0.82, -h * (1 - t.broken * 0.35));
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Rubble at the base.
  ctx.fillStyle = '#6a6558';
  for (let i = 0; i < 3; i += 1) {
    const a = t.seed + i * 2.1;
    ctx.beginPath();
    ctx.ellipse(
      t.x + Math.cos(a) * t.radius * 0.9,
      t.y + Math.sin(a) * t.radius * 0.32 + 4,
      t.radius * 0.24, t.radius * 0.15, a, 0, TAU,
    );
    ctx.fill();
  }
}

function drawCrystal(ctx, t, time) {
  const glow = 0.55 + Math.sin(time * 1.4 + t.seed) * 0.45;
  ctx.save();
  ctx.translate(t.x, t.y);

  // Ambient light spill on the ground.
  ctx.globalCompositeOperation = 'lighter';
  const spill = ctx.createRadialGradient(0, 0, 0, 0, 0, t.radius * 3);
  spill.addColorStop(0, `rgba(120,190,255,${0.12 + glow * 0.1})`);
  spill.addColorStop(1, 'rgba(120,190,255,0)');
  ctx.fillStyle = spill;
  ctx.beginPath();
  ctx.arc(0, 0, t.radius * 3, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  for (const s of t.shards) {
    ctx.save();
    ctx.translate(s.dx, 0);
    ctx.rotate(s.angle);
    const g = ctx.createLinearGradient(-s.width, 0, s.width, -s.height);
    g.addColorStop(0, 'rgba(88,150,210,0.95)');
    g.addColorStop(0.5, 'rgba(150,220,255,0.95)');
    g.addColorStop(1, 'rgba(226,246,255,0.98)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-s.width, 4);
    ctx.lineTo(-s.width * 0.4, -s.height);
    ctx.lineTo(s.width * 0.4, -s.height * 0.86);
    ctx.lineTo(s.width, 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `rgba(255,255,255,${0.25 + glow * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(-s.width * 0.3, 2);
    ctx.lineTo(-s.width * 0.1, -s.height * 0.9);
    ctx.lineTo(s.width * 0.08, -s.height * 0.8);
    ctx.lineTo(s.width * 0.1, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ creatures

/**
 * Units are drawn in local space: +X is forward. Each type has a distinct
 * silhouette and a gait tied to how far it has actually walked, so the swarm
 * reads as a crowd of animals rather than a cloud of circles.
 */
export function drawUnit(ctx, u, def, time, lod) {
  const r = def.radius;
  const hover = def.hover ? Math.sin(time * 5 + u.seed) * 3 - 6 : 0;

  if (u.burrowed) {
    drawBurrowMound(ctx, u, def, time);
    return;
  }

  contactShadow(ctx, u.x + 3, u.y + r * 0.55, r * 0.95, r * 0.42, def.hover ? 0.2 : 0.32);
  drawGlow(ctx, u.x, u.y + hover, r * 2.6, def.color, 0.16);

  ctx.save();
  ctx.translate(u.x, u.y + hover);
  ctx.rotate(u.facing);

  const flash = u.hitFlash > 0 ? clamp(u.hitFlash / 0.14, 0, 1) : 0;

  // Slightly oversized dark body underneath, so the creature keeps a crisp
  // silhouette against the pale ground without stroking every sub-path.
  ctx.fillStyle = 'rgba(9,5,16,0.62)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 1.16, r * 0.98, 0, 0, TAU);
  ctx.fill();

  switch (def.id) {
    case 'mite': drawMite(ctx, u, def, time, lod); break;
    case 'flinger': drawFlinger(ctx, u, def, time, lod); break;
    case 'mauler': drawMauler(ctx, u, def, time, lod); break;
    case 'burrower': drawBurrower(ctx, u, def, time, lod); break;
    case 'shrieker': drawShrieker(ctx, u, def, time, lod); break;
    case 'matriarch': drawMatriarch(ctx, u, def, time, lod); break;
    case 'mender': drawMender(ctx, u, def, time, lod); break;
    case 'bombardier': drawBombardier(ctx, u, def, time, lod); break;
    default: drawTitan(ctx, u, def, time, lod); break;
  }

  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flash * 0.75;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

function legs(ctx, u, count, spread, length, thickness, color, speed = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  const phase = u.gait * speed;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const baseX = lerp(spread, -spread, t);
      const swing = Math.sin(phase + i * 1.9 + (side > 0 ? Math.PI : 0)) * 0.5;
      const lift = Math.max(0, Math.cos(phase + i * 1.9 + (side > 0 ? Math.PI : 0))) * 0.3;
      ctx.beginPath();
      ctx.moveTo(baseX, side * spread * 0.32);
      ctx.lineTo(baseX + swing * length * 0.5, side * (spread * 0.32 + length * 0.55) - lift * 3);
      ctx.lineTo(baseX + swing * length, side * (spread * 0.32 + length));
      ctx.stroke();
    }
  }
}

function drawMite(ctx, u, def, time, lod) {
  const r = def.radius;
  if (lod > 0) legs(ctx, u, 3, r * 0.7, r * 0.95, 1.6, '#43135e', 1);

  // Abdomen.
  const g = ctx.createLinearGradient(-r, -r * 0.6, r * 0.6, r * 0.6);
  g.addColorStop(0, '#2d0b42');
  g.addColorStop(0.5, def.color);
  g.addColorStop(1, '#4c1568');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 0.28, 0, r * 0.82, r * 0.62, 0, 0, TAU);
  ctx.fill();

  // Carapace highlight.
  ctx.fillStyle = 'rgba(255,220,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.42, -r * 0.24, r * 0.42, r * 0.2, -0.3, 0, TAU);
  ctx.fill();

  // Thorax + head.
  ctx.fillStyle = '#380f52';
  ctx.beginPath();
  ctx.ellipse(r * 0.42, 0, r * 0.44, r * 0.4, 0, 0, TAU);
  ctx.fill();

  // Mandibles.
  if (lod > 0) {
    ctx.strokeStyle = '#d38bff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 0.72, -r * 0.24);
    ctx.lineTo(r * 1.08, -r * 0.1);
    ctx.moveTo(r * 0.72, r * 0.24);
    ctx.lineTo(r * 1.08, r * 0.1);
    ctx.stroke();
  }

  // Eyes.
  ctx.fillStyle = PALETTE.swarmGlow;
  ctx.beginPath();
  ctx.arc(r * 0.5, -r * 0.2, r * 0.15, 0, TAU);
  ctx.arc(r * 0.5, r * 0.2, r * 0.15, 0, TAU);
  ctx.fill();
}

function drawFlinger(ctx, u, def, time, lod) {
  const r = def.radius;
  const charge = clamp(1 - u.attackTimer / def.attackCooldown, 0, 1);

  if (lod > 0) legs(ctx, u, 2, r * 0.6, r * 1.05, 1.8, '#3b1470', 0.8);

  // Bulbous acid sac that brightens as the attack recharges.
  const sacGlow = 0.3 + charge * 0.7;
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.3, r * 0.1, -r * 0.35, 0, r * 1.05);
  g.addColorStop(0, `rgba(190,255,150,${0.55 + sacGlow * 0.4})`);
  g.addColorStop(0.5, '#6f2ea8');
  g.addColorStop(1, '#37104f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, 0, r * 0.86, r * 0.7, 0, 0, TAU);
  ctx.fill();

  // Ribbed segments.
  if (lod > 0) {
    ctx.strokeStyle = 'rgba(20,6,30,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.ellipse(-r * 0.32 + i * r * 0.24, 0, r * 0.14, r * 0.6, 0, -1.1, 1.1);
      ctx.stroke();
    }
  }

  // Head and nozzle.
  ctx.fillStyle = '#4a1a72';
  ctx.beginPath();
  ctx.ellipse(r * 0.5, 0, r * 0.42, r * 0.36, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(190,255,150,${0.4 + charge * 0.6})`;
  ctx.beginPath();
  ctx.moveTo(r * 0.8, -r * 0.16);
  ctx.lineTo(r * 1.15, 0);
  ctx.lineTo(r * 0.8, r * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e7ffb6';
  ctx.beginPath();
  ctx.arc(r * 0.55, -r * 0.16, r * 0.11, 0, TAU);
  ctx.arc(r * 0.55, r * 0.16, r * 0.11, 0, TAU);
  ctx.fill();
}

function drawMauler(ctx, u, def, time, lod) {
  const r = def.radius;
  const bob = Math.sin(u.gait) * r * 0.06;

  if (lod > 0) legs(ctx, u, 2, r * 0.62, r * 0.9, 3.4, '#2b0d3d', 0.7);

  ctx.save();
  ctx.translate(0, bob);

  // Front claws.
  if (lod > 0) {
    ctx.fillStyle = '#5d1f7d';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(r * 0.55, side * r * 0.62);
      ctx.rotate(side * 0.4 + Math.sin(u.gait * 0.5) * 0.1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.75, -r * 0.22);
      ctx.lineTo(r * 0.95, r * 0.02);
      ctx.lineTo(r * 0.7, r * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Armoured shell.
  const g = ctx.createLinearGradient(-r, -r, r * 0.7, r);
  g.addColorStop(0, '#3a1152');
  g.addColorStop(0.45, def.color);
  g.addColorStop(1, '#280b3a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 0.16, 0, r * 0.95, r * 0.8, 0, 0, TAU);
  ctx.fill();

  // Plate segments.
  ctx.strokeStyle = 'rgba(232,180,255,0.3)';
  ctx.lineWidth = 1.6;
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.16 + i * r * 0.3, 0, r * 0.16, r * 0.72, 0, -1.2, 1.2);
    ctx.stroke();
  }

  // Back spikes.
  if (lod > 0) {
    ctx.fillStyle = '#c98bff';
    for (let i = 0; i < 3; i += 1) {
      const x = -r * 0.7 + i * r * 0.45;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.12, -r * 0.62);
      ctx.lineTo(x, -r * 1.05);
      ctx.lineTo(x + r * 0.12, -r * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.12, r * 0.62);
      ctx.lineTo(x, r * 1.05);
      ctx.lineTo(x + r * 0.12, r * 0.62);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Head.
  ctx.fillStyle = '#3d1258';
  ctx.beginPath();
  ctx.ellipse(r * 0.62, 0, r * 0.42, r * 0.44, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ff9de8';
  ctx.beginPath();
  ctx.arc(r * 0.72, -r * 0.2, r * 0.12, 0, TAU);
  ctx.arc(r * 0.72, r * 0.2, r * 0.12, 0, TAU);
  ctx.fill();

  ctx.restore();
}

function drawShrieker(ctx, u, def, time, lod) {
  const r = def.radius;
  const flap = Math.sin(time * 13 + u.seed) * 0.5 + 0.5;

  // Membrane wings.
  ctx.fillStyle = 'rgba(120,220,255,0.28)';
  ctx.strokeStyle = 'rgba(180,240,255,0.6)';
  ctx.lineWidth = 1.2;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, side);
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, 0);
    ctx.quadraticCurveTo(-r * 0.9, r * (0.6 + flap * 0.7), r * 0.2, r * (1.5 + flap * 0.5));
    ctx.quadraticCurveTo(r * 0.5, r * (0.7 + flap * 0.3), r * 0.1, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Body.
  const g = ctx.createLinearGradient(-r * 0.8, -r * 0.5, r * 0.6, r * 0.5);
  g.addColorStop(0, '#0d3a52');
  g.addColorStop(0.5, def.color);
  g.addColorStop(1, '#12506e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(r * 0.95, 0);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.62, -r * 0.85, -r * 0.2);
  ctx.quadraticCurveTo(-r * 0.9, 0, -r * 0.85, r * 0.2);
  ctx.quadraticCurveTo(r * 0.2, r * 0.62, r * 0.95, 0);
  ctx.closePath();
  ctx.fill();

  // Resonance chamber.
  ctx.fillStyle = `rgba(190,250,255,${0.4 + flap * 0.4})`;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.34, r * 0.26, 0, 0, TAU);
  ctx.fill();

  // Tendrils.
  if (lod > 0) {
    ctx.strokeStyle = 'rgba(150,230,255,0.55)';
    ctx.lineWidth = 1.3;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, i * r * 0.18);
      ctx.quadraticCurveTo(
        -r * 1.3, i * r * 0.3 + Math.sin(time * 6 + i + u.seed) * 3,
        -r * 1.7, i * r * 0.45 + Math.sin(time * 5 + i * 2 + u.seed) * 4,
      );
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#ecffff';
  ctx.beginPath();
  ctx.arc(r * 0.55, -r * 0.14, r * 0.1, 0, TAU);
  ctx.arc(r * 0.55, r * 0.14, r * 0.1, 0, TAU);
  ctx.fill();
}

function drawTitan(ctx, u, def, time, lod) {
  const r = def.radius;
  const bob = Math.sin(u.gait) * r * 0.05;
  const pulse = 0.5 + Math.sin(time * 3 + u.seed) * 0.5;

  if (lod > 0) legs(ctx, u, 3, r * 0.72, r * 0.85, 4.5, '#3a0f28', 0.6);

  ctx.save();
  ctx.translate(0, bob);

  // Massive claws.
  ctx.fillStyle = '#5c1130';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(r * 0.5, side * r * 0.7);
    ctx.rotate(side * 0.35 + Math.sin(u.gait * 0.5) * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * 0.9, -r * 0.3);
    ctx.lineTo(r * 1.15, 0);
    ctx.lineTo(r * 0.85, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Body with glowing cracks.
  const g = ctx.createLinearGradient(-r, -r, r * 0.6, r);
  g.addColorStop(0, '#43081f');
  g.addColorStop(0.45, def.color);
  g.addColorStop(1, '#2a0514');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(-r * 0.12, 0, r, r * 0.86, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,140,180,${0.5 + pulse * 0.5})`;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, -r * 0.2);
  ctx.lineTo(-r * 0.2, -r * 0.05);
  ctx.lineTo(-r * 0.35, r * 0.3);
  ctx.moveTo(-r * 0.2, -r * 0.05);
  ctx.lineTo(r * 0.3, -r * 0.32);
  ctx.stroke();

  // Crown of spikes.
  ctx.fillStyle = '#ff7fa8';
  for (let i = 0; i < 5; i += 1) {
    const a = -1.0 + (i / 4) * 2.0;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -3);
    ctx.lineTo(r * 1.22, 0);
    ctx.lineTo(r * 0.55, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Head with a burning core.
  ctx.fillStyle = '#4d0d24';
  ctx.beginPath();
  ctx.ellipse(r * 0.66, 0, r * 0.4, r * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,120,160,${0.55 + pulse * 0.45})`;
  ctx.beginPath();
  ctx.arc(r * 0.7, 0, r * 0.2, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.restore();
}

/** A travelling ridge of turned earth: the Burrower while it is underground. */
function drawBurrowMound(ctx, u, def, time) {
  const r = def.radius;
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.rotate(u.facing);

  ctx.fillStyle = 'rgba(24,20,16,0.5)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.2, r * 0.2, r * 1.5, r * 0.7, 0, 0, TAU);
  ctx.fill();

  const g = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.6);
  g.addColorStop(0, 'rgba(126,102,78,0.95)');
  g.addColorStop(1, 'rgba(58,44,32,0.95)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(r * 1.4, 0);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.85, -r * 1.3, -r * 0.3);
  ctx.quadraticCurveTo(-r * 1.5, 0, -r * 1.3, r * 0.3);
  ctx.quadraticCurveTo(r * 0.2, r * 0.85, r * 1.4, 0);
  ctx.closePath();
  ctx.fill();

  // Cracks along the ridge, and a hint of the thing inside.
  ctx.strokeStyle = 'rgba(180,110,240,0.45)';
  ctx.lineWidth = 1.4;
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.moveTo(r * 0.9, i * r * 0.22);
    ctx.lineTo(-r * 0.5, i * r * 0.42 + Math.sin(time * 6 + u.seed + i) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBurrower(ctx, u, def, time, lod) {
  const r = def.radius;

  // Digging claws lead the body.
  if (lod > 0) {
    ctx.fillStyle = '#5d1a78';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(r * 0.5, side * r * 0.45);
      ctx.rotate(side * (0.5 + Math.sin(u.gait * 1.4) * 0.18));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 1.15, -r * 0.18);
      ctx.lineTo(r * 1.3, r * 0.06);
      ctx.lineTo(r * 0.6, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    legs(ctx, u, 2, r * 0.6, r * 0.8, 2.2, '#39104d', 1.2);
  }

  // Segmented, chitinous body tapering to a tail.
  const g = ctx.createLinearGradient(-r, -r * 0.6, r * 0.5, r * 0.6);
  g.addColorStop(0, '#2a0a3c');
  g.addColorStop(0.5, def.color);
  g.addColorStop(1, '#48156b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(r * 0.9, 0);
  ctx.quadraticCurveTo(r * 0.1, -r * 0.8, -r * 0.6, -r * 0.32);
  ctx.quadraticCurveTo(-r * 1.5, -r * 0.1, -r * 1.6, 0);
  ctx.quadraticCurveTo(-r * 1.5, r * 0.1, -r * 0.6, r * 0.32);
  ctx.quadraticCurveTo(r * 0.1, r * 0.8, r * 0.9, 0);
  ctx.closePath();
  ctx.fill();

  if (lod > 0) {
    ctx.strokeStyle = 'rgba(20,6,30,0.55)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 3; i += 1) {
      const x = r * 0.35 - i * r * 0.4;
      ctx.beginPath();
      ctx.ellipse(x, 0, r * 0.1, r * (0.5 - i * 0.1), 0, -1.2, 1.2);
      ctx.stroke();
    }
  }

  // The ambush strike stays charged until it lands, so show it.
  if (u.ambushReady) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(236,150,255,${0.35 + Math.sin(time * 9 + u.seed) * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.5, r * 0.32, 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.fillStyle = '#f0a8ff';
  ctx.beginPath();
  ctx.arc(r * 0.55, -r * 0.17, r * 0.12, 0, TAU);
  ctx.arc(r * 0.55, r * 0.17, r * 0.12, 0, TAU);
  ctx.fill();
}

function drawMatriarch(ctx, u, def, time, lod) {
  const r = def.radius;
  // Ready-to-hatch swells the sac; it deflates the moment she lays.
  const ready = clamp(1 - (u.broodTimer ?? 0) / def.attackCooldown, 0, 1);
  const swell = 1 + ready * 0.12 + Math.sin(time * 2 + u.seed) * 0.02;

  if (lod > 0) legs(ctx, u, 3, r * 0.72, r * 0.7, 2.4, '#3a0f30', 0.5);

  // Egg sac.
  const sac = ctx.createRadialGradient(-r * 0.4, -r * 0.3, r * 0.1, -r * 0.3, 0, r * 1.1);
  sac.addColorStop(0, `rgba(255,190,240,${0.5 + ready * 0.4})`);
  sac.addColorStop(0.45, def.color);
  sac.addColorStop(1, '#320a28');
  ctx.fillStyle = sac;
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, 0, r * 0.95 * swell, r * 0.85 * swell, 0, 0, TAU);
  ctx.fill();

  // Eggs visible through the membrane.
  if (lod > 0) {
    ctx.fillStyle = `rgba(255,214,250,${0.25 + ready * 0.45})`;
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + u.seed;
      ctx.beginPath();
      ctx.arc(-r * 0.32 + Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.36, r * 0.13, 0, TAU);
      ctx.fill();
    }
  }

  // Head and mandibles.
  ctx.fillStyle = '#4a1038';
  ctx.beginPath();
  ctx.ellipse(r * 0.62, 0, r * 0.4, r * 0.36, 0, 0, TAU);
  ctx.fill();
  if (lod > 0) {
    ctx.strokeStyle = '#d47ab8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(r * 0.9, -r * 0.22);
    ctx.lineTo(r * 1.2, -r * 0.05);
    ctx.moveTo(r * 0.9, r * 0.22);
    ctx.lineTo(r * 1.2, r * 0.05);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffc4ec';
  ctx.beginPath();
  ctx.arc(r * 0.7, -r * 0.15, r * 0.1, 0, TAU);
  ctx.arc(r * 0.7, r * 0.15, r * 0.1, 0, TAU);
  ctx.fill();
}

function drawMender(ctx, u, def, time, lod) {
  const r = def.radius;
  // The dome brightens as the mend tick comes round, so its rhythm is visible.
  const charge = clamp(1 - (u.mendTimer ?? 0) / def.attackCooldown, 0, 1);
  const pulse = 0.35 + charge * 0.65;

  if (lod > 0) legs(ctx, u, 3, r * 0.66, r * 0.62, 2.2, '#123f31', 0.55);

  // Translucent healing dome.
  const dome = ctx.createRadialGradient(-r * 0.15, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
  dome.addColorStop(0, `rgba(200,255,226,${0.55 + pulse * 0.35})`);
  dome.addColorStop(0.5, def.color);
  dome.addColorStop(1, '#0d3a2c');
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, 0, r * 0.92, r * 0.82, 0, 0, TAU);
  ctx.fill();

  // Spore vents around the rim.
  if (lod > 0) {
    ctx.fillStyle = `rgba(150,255,205,${0.3 + pulse * 0.5})`;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU + u.seed + time * 0.4;
      ctx.beginPath();
      ctx.arc(-r * 0.1 + Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.52, r * 0.13, 0, TAU);
      ctx.fill();
    }
  }

  // Core.
  ctx.fillStyle = `rgba(226,255,238,${0.5 + pulse * 0.5})`;
  ctx.beginPath();
  ctx.arc(-r * 0.1, 0, r * 0.3 + charge * r * 0.08, 0, TAU);
  ctx.fill();

  // Blunt head; it has no mouthparts because it never bites anything.
  ctx.fillStyle = '#0f4436';
  ctx.beginPath();
  ctx.ellipse(r * 0.66, 0, r * 0.34, r * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#9dffcf';
  ctx.beginPath();
  ctx.arc(r * 0.76, -r * 0.13, r * 0.08, 0, TAU);
  ctx.arc(r * 0.76, r * 0.13, r * 0.08, 0, TAU);
  ctx.fill();
}

function drawBombardier(ctx, u, def, time, lod) {
  const r = def.radius;
  const load = clamp(1 - (u.attackTimer ?? 0) / def.attackCooldown, 0, 1);

  if (lod > 0) legs(ctx, u, 3, r * 0.74, r * 0.62, 3, '#4a2410', 0.5);

  // Heavy carapace.
  const shell = ctx.createLinearGradient(-r * 0.9, -r * 0.7, r * 0.7, r * 0.6);
  shell.addColorStop(0, '#54260d');
  shell.addColorStop(0.5, def.color);
  shell.addColorStop(1, '#3a1a08');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(-r * 0.12, 0, r * 0.98, r * 0.8, 0, 0, TAU);
  ctx.fill();

  // Mortar sac on the back, swelling as the shell is loaded.
  ctx.fillStyle = `rgba(255,170,90,${0.4 + load * 0.5})`;
  ctx.beginPath();
  ctx.ellipse(-r * 0.42, 0, r * 0.4 * (0.75 + load * 0.35), r * 0.34 * (0.75 + load * 0.35), 0, 0, TAU);
  ctx.fill();

  // Plated ridges.
  if (lod > 0) {
    ctx.strokeStyle = 'rgba(20,10,4,0.55)';
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.ellipse(-r * 0.12 + i * r * 0.28, 0, r * 0.1, r * 0.72, 0, 0, TAU);
      ctx.stroke();
    }
  }

  // Forward-facing launch tube.
  ctx.fillStyle = '#2c1406';
  ctx.beginPath();
  ctx.moveTo(r * 0.5, -r * 0.3);
  ctx.lineTo(r * 1.35, -r * 0.17);
  ctx.lineTo(r * 1.35, r * 0.17);
  ctx.lineTo(r * 0.5, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255,190,120,${0.35 + load * 0.6})`;
  ctx.beginPath();
  ctx.ellipse(r * 1.32, 0, r * 0.1, r * 0.16, 0, 0, TAU);
  ctx.fill();
}

// ----------------------------------------------------------------------- hero

/**
 * The hero is a humanoid with a real walk cycle, a trailing cloak and a
 * weapon that swings on attack. Higher evolution stages add armour trim,
 * a larger halo and orbiting blades so the threat level is readable at a glance.
 */
export function drawHero(ctx, hero, stats, cls, stage, time) {
  const r = stats.radius;
  const scale = r / 15;

  contactShadow(ctx, hero.x + 4, hero.y + r * 0.6, r * 0.9, r * 0.38, 0.42);

  // Halo of light on the ground; brighter with every evolution.
  drawGlow(ctx, hero.x, hero.y, r * (3.2 + stage * 0.4), 'rgba(255,214,140,1)', 0.16 + stage * 0.028);

  ctx.save();
  ctx.translate(hero.x, hero.y);

  // Cloak trails opposite to travel.
  const cloakAngle = hero.facing + Math.PI;
  const speedT = clamp(hero.speedFraction ?? 0, 0, 1);
  ctx.save();
  ctx.rotate(cloakAngle);
  const cloakLen = r * (1.1 + speedT * 0.9);
  const flutter = Math.sin(time * 8) * r * 0.16 * (0.4 + speedT);
  const cg = ctx.createLinearGradient(0, 0, cloakLen, 0);
  cg.addColorStop(0, 'rgba(190,60,80,0.92)');
  cg.addColorStop(1, 'rgba(110,26,44,0.32)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.5);
  ctx.quadraticCurveTo(cloakLen * 0.6, -r * 0.7 + flutter, cloakLen, -r * 0.25 + flutter);
  ctx.lineTo(cloakLen, r * 0.25 + flutter);
  ctx.quadraticCurveTo(cloakLen * 0.6, r * 0.7 + flutter, 0, r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.rotate(hero.facing);

  const walk = hero.gait ?? 0;
  const stride = Math.sin(walk) * scale * 4 * (0.3 + speedT);

  // Legs.
  ctx.strokeStyle = '#4a4335';
  ctx.lineWidth = 4.2 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-scale * 1, -scale * 3);
  ctx.lineTo(stride, -scale * 6.5);
  ctx.moveTo(-scale * 1, scale * 3);
  ctx.lineTo(-stride, scale * 6.5);
  ctx.stroke();

  // Dark underlay for silhouette separation.
  ctx.fillStyle = 'rgba(26,14,6,0.6)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, 0, r * 0.86, r * 0.9, 0, 0, TAU);
  ctx.fill();

  // Torso plate.
  const body = ctx.createLinearGradient(-r * 0.6, -r * 0.6, r * 0.5, r * 0.6);
  body.addColorStop(0, shade('#f4e6c0', 10));
  body.addColorStop(0.5, '#d8c48c');
  body.addColorStop(1, '#8d7743');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.62, r * 0.72, 0, 0, TAU);
  ctx.fill();

  // Shoulder pauldrons grow with stage.
  ctx.fillStyle = '#b99a55';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, side * r * 0.66, r * (0.3 + stage * 0.02), r * (0.24 + stage * 0.018), 0, 0, TAU);
    ctx.fill();
  }

  // Chest sigil.
  ctx.fillStyle = 'rgba(255,250,224,0.85)';
  ctx.beginPath();
  ctx.moveTo(r * 0.18, 0);
  ctx.lineTo(-r * 0.06, -r * 0.24);
  ctx.lineTo(-r * 0.06, r * 0.24);
  ctx.closePath();
  ctx.fill();

  // Head with helm.
  ctx.fillStyle = '#e9dcb4';
  ctx.beginPath();
  ctx.arc(r * 0.42, 0, r * 0.34, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#a98d47';
  ctx.beginPath();
  ctx.arc(r * 0.42, 0, r * 0.34, -2.5, -0.6);
  ctx.arc(r * 0.42, 0, r * 0.34, 0.6, 2.5);
  ctx.fill();
  // Visor glow.
  ctx.fillStyle = '#ff9a6a';
  ctx.fillRect(r * 0.58, -r * 0.14, r * 0.12, r * 0.28);

  // Weapon arm: swings through the attack animation.
  const swing = clamp(hero.swing ?? 0, 0, 1);
  const swingAngle = -0.9 + swing * 1.9;
  ctx.save();
  ctx.translate(r * 0.2, r * 0.55);
  ctx.rotate(swingAngle);
  drawWeapon(ctx, cls.weapon, r, stage, time);
  ctx.restore();

  ctx.restore();

  // Halo and orbiting blades sit above the body, in world space.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255,240,196,${0.3 + stage * 0.07})`;
  ctx.lineWidth = 1.6 + stage * 0.3;
  ctx.beginPath();
  ctx.ellipse(hero.x, hero.y - r * 0.95, r * 0.5, r * 0.15, 0, 0, TAU);
  ctx.stroke();

  if (stage >= 3) {
    const blades = stage - 1;
    for (let i = 0; i < blades; i += 1) {
      const a = time * 1.4 + (i / blades) * TAU;
      const bx = hero.x + Math.cos(a) * r * 2.1;
      const by = hero.y + Math.sin(a) * r * 2.1 * 0.55;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = 'rgba(255,238,190,0.85)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.42);
      ctx.lineTo(r * 0.1, 0);
      ctx.lineTo(0, r * 0.42);
      ctx.lineTo(-r * 0.1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();

  if (hero.hitFlash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(hero.hitFlash / 0.12, 0, 1) * 0.6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hero.x, hero.y, r * 1.1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawWeapon(ctx, weapon, r, stage, time) {
  if (weapon === 'scepter') {
    // Short rod with a caged sigil; the ring spins when wisps are due.
    ctx.strokeStyle = '#4a3a5c';
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, 0);
    ctx.lineTo(r * 1.15, -r * 0.14);
    ctx.stroke();

    ctx.save();
    ctx.translate(r * 1.22, -r * 0.16);
    ctx.rotate(time * 1.6);
    ctx.strokeStyle = 'rgba(255,226,168,0.9)';
    ctx.lineWidth = r * 0.07;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.2 + i * 0.11), i * 1.4, i * 1.4 + 4.4);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,236,190,${0.55 + Math.sin(time * 5) * 0.25})`;
    ctx.beginPath();
    ctx.arc(r * 1.22, -r * 0.16, r * 0.16, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  if (weapon === 'staff') {
    ctx.strokeStyle = '#6b5432';
    ctx.lineWidth = r * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, 0);
    ctx.lineTo(r * 1.5, -r * 0.2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const glow = 0.6 + Math.sin(time * 4) * 0.4;
    ctx.fillStyle = `rgba(190,220,255,${0.6 + glow * 0.4})`;
    ctx.beginPath();
    ctx.arc(r * 1.55, -r * 0.22, r * 0.24, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  if (weapon === 'bow') {
    ctx.strokeStyle = '#8a6a3c';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(r * 0.7, 0, r * 0.7, -1.3, 1.3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(r * 0.7 + Math.cos(-1.3) * r * 0.7, Math.sin(-1.3) * r * 0.7);
    ctx.lineTo(r * 0.7 + Math.cos(1.3) * r * 0.7, Math.sin(1.3) * r * 0.7);
    ctx.stroke();
    return;
  }
  // Sword: blade, crossguard, grip.
  const len = r * (1.5 + stage * 0.08);
  const bladeGrad = ctx.createLinearGradient(0, 0, len, 0);
  bladeGrad.addColorStop(0, '#cfd6e2');
  bladeGrad.addColorStop(0.6, '#f4f7ff');
  bladeGrad.addColorStop(1, '#ffffff');
  ctx.fillStyle = bladeGrad;
  ctx.beginPath();
  ctx.moveTo(r * 0.2, -r * 0.11);
  ctx.lineTo(len, -r * 0.05);
  ctx.lineTo(len + r * 0.2, 0);
  ctx.lineTo(len, r * 0.05);
  ctx.lineTo(r * 0.2, r * 0.11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c8a24e';
  ctx.fillRect(r * 0.1, -r * 0.3, r * 0.12, r * 0.6);
  ctx.fillStyle = '#5c4a2c';
  ctx.fillRect(-r * 0.25, -r * 0.08, r * 0.36, r * 0.16);
}

// ----------------------------------------------------------------------- misc

/** Spawn rift: a tear in the ground that creatures climb out of. */
export function drawRift(ctx, rift, time) {
  const t = clamp(rift.age / rift.duration, 0, 1);
  const open = Math.sin(t * Math.PI); // grows then closes
  const w = rift.radius * (0.6 + open * 1.5);
  const h = rift.radius * (0.24 + open * 0.5);

  ctx.save();
  ctx.translate(rift.x, rift.y);

  ctx.fillStyle = 'rgba(6,2,12,0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
  g.addColorStop(0, `rgba(226,155,255,${0.55 * open})`);
  g.addColorStop(0.6, `rgba(150,60,220,${0.28 * open})`);
  g.addColorStop(1, 'rgba(120,40,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 1.5, h * 2.4, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = `rgba(236,176,255,${0.8 * open})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, TAU);
  ctx.stroke();

  // Arcs of energy licking out of the tear.
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i += 1) {
    const a = time * 3 + (i / 4) * TAU + rift.seed;
    ctx.globalAlpha = 0.5 * open;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * w * 0.6, Math.sin(a) * h * 0.6);
    ctx.quadraticCurveTo(
      Math.cos(a) * w * 1.1, Math.sin(a) * h * 1.1 - rift.radius * 0.7,
      Math.cos(a + 0.6) * w * 0.7, Math.sin(a + 0.6) * h * 0.7 - rift.radius * 0.3,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Danger zone shown before a hero ability lands. */
export function drawTelegraph(ctx, tel, time) {
  const t = clamp(tel.age / tel.duration, 0, 1);
  ctx.save();

  if (tel.shape === 'line') {
    ctx.translate(tel.x, tel.y);
    ctx.rotate(tel.angle);
    ctx.fillStyle = `rgba(255,90,110,${0.1 + t * 0.2})`;
    ctx.fillRect(0, -tel.width / 2, tel.length, tel.width);
    ctx.strokeStyle = `rgba(255,150,160,${0.5 + t * 0.5})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, -tel.width / 2, tel.length, tel.width);
    ctx.fillStyle = `rgba(255,120,140,${0.28 + t * 0.4})`;
    ctx.fillRect(0, -tel.width / 2, tel.length * t, tel.width);
  } else {
    const g = ctx.createRadialGradient(tel.x, tel.y, tel.radius * 0.2, tel.x, tel.y, tel.radius);
    g.addColorStop(0, `rgba(255,80,100,${0.06 + t * 0.14})`);
    g.addColorStop(1, `rgba(255,80,100,${0.16 + t * 0.28})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(tel.x, tel.y, tel.radius, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,160,170,${0.55 + t * 0.45})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(tel.x, tel.y, tel.radius, 0, TAU);
    ctx.stroke();

    // Filling inner ring shows exactly when it detonates.
    ctx.strokeStyle = 'rgba(255,225,170,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(tel.x, tel.y, tel.radius * t, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Marker showing where units are told to gather. */
export function drawRally(ctx, rally, time) {
  const pulse = 0.5 + Math.sin(time * 3) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(200,120,255,${0.5 + pulse * 0.4})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(rally.x, rally.y, 26 + pulse * 6, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rally.x, rally.y, 12, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = `rgba(236,190,255,${0.7 + pulse * 0.3})`;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + time * 0.8;
    ctx.beginPath();
    ctx.moveTo(rally.x + Math.cos(a) * 32, rally.y + Math.sin(a) * 32);
    ctx.lineTo(rally.x + Math.cos(a) * 44, rally.y + Math.sin(a) * 44);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawProjectile(ctx, p, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Motion trail.
  if (p.trail && p.trail.length > 1) {
    ctx.strokeStyle = p.color;
    ctx.lineCap = 'round';
    for (let i = 1; i < p.trail.length; i += 1) {
      const a = i / p.trail.length;
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = p.radius * 1.6 * a;
      ctx.beginPath();
      ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
      ctx.lineTo(p.trail[i].x, p.trail[i].y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3.2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.32, p.color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * 3.2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A summoned wisp: a hovering mote of the champion's own light, with a slow
 * halo so it never reads as one of the player's units.
 */
export function drawAlly(ctx, a, def, time) {
  const r = def.radius;
  const hover = Math.sin(time * 3.4 + a.seed) * 3 - 5;
  const fade = clamp(a.life / 3, 0, 1); // blinks out as it burns down
  const scale = clamp(a.spawnScale ?? 1, 0.1, 1);

  contactShadow(ctx, a.x + 2, a.y + r * 0.7, r * 0.7, r * 0.3, 0.22 * fade);
  drawGlow(ctx, a.x, a.y + hover, r * 3.4, 'rgba(255,214,140,1)', 0.22 * fade);

  ctx.save();
  ctx.translate(a.x, a.y + hover);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.35 + fade * 0.65;

  // Orbiting motes.
  ctx.fillStyle = 'rgba(255,238,196,0.85)';
  for (let i = 0; i < 3; i += 1) {
    const ang = time * 2.2 + a.seed + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * r * 1.3, Math.sin(ang) * r * 0.62, r * 0.16, 0, TAU);
    ctx.fill();
  }

  // Body: a teardrop pointing where it is looking.
  ctx.rotate(a.facing);
  const body = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  body.addColorStop(0, '#fff6de');
  body.addColorStop(0.55, def.color);
  body.addColorStop(1, 'rgba(180,120,40,0.15)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(r * 1.05, 0);
  ctx.quadraticCurveTo(0, -r * 0.82, -r * 0.75, 0);
  ctx.quadraticCurveTo(0, r * 0.82, r * 1.05, 0);
  ctx.closePath();
  ctx.fill();

  if (a.hitFlash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(a.hitFlash / 0.14, 0, 1) * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawRelic(ctx, relic, time) {
  const bob = Math.sin(time * 3 + relic.seed) * 3;
  const y = relic.y + bob;
  const fading = relic.life < 3 ? 0.35 + Math.abs(Math.sin(time * 7)) * 0.65 : 1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(relic.x, y, 0, relic.x, y, 26);
  g.addColorStop(0, relic.color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.7 * fading;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(relic.x, y, 26, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(relic.x, y);
  ctx.globalAlpha = fading;

  if (relic.kind === 'boon') {
    // A flask, so the temporary drop never reads as a permanent relic.
    ctx.rotate(Math.sin(time * 2 + relic.seed) * 0.25);
    ctx.fillStyle = 'rgba(20,16,28,0.85)';
    ctx.beginPath();
    ctx.moveTo(-3.5, -9);
    ctx.lineTo(3.5, -9);
    ctx.lineTo(3.5, -4);
    ctx.quadraticCurveTo(8, 1, 5, 8);
    ctx.lineTo(-5, 8);
    ctx.quadraticCurveTo(-8, 1, -3.5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = relic.color;
    ctx.beginPath();
    ctx.moveTo(-4.6, 1);
    ctx.quadraticCurveTo(0, 3, 4.6, 1);
    ctx.lineTo(4.2, 6.6);
    ctx.lineTo(-4.2, 6.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = relic.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-3.5, -9);
    ctx.lineTo(3.5, -9);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.rotate(time * 1.2 + relic.seed);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, 0);
  ctx.lineTo(0, 9);
  ctx.lineTo(-7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = relic.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}
