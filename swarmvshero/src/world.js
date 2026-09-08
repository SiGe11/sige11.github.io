// Arena generation: ground texture, blocking terrain, aether wells, and the
// spatial grid used for terrain queries.

import { CONFIG } from './config.js';
import { clamp, rand, randInt, pick, dist, noise2, pointSegmentDist2 } from './math.js';

const CELL = 160;

/**
 * Bakes a seamless ground tile once. Filling the whole arena with a pattern is
 * far cheaper than drawing noise every frame, and it gives the floor real
 * texture instead of a flat gradient.
 */
export function buildGroundTile(size = 256) {
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const c = tile.getContext('2d');

  c.fillStyle = '#31404f';
  c.fillRect(0, 0, size, size);

  const img = c.getImageData(0, 0, size, size);
  const data = img.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Tile seamlessly by sampling noise on a torus.
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const nx = Math.cos(u) * 2.2 + 8;
      const ny = Math.sin(u) * 2.2 + 8;
      const nz = Math.cos(v) * 2.2 + 8;
      const nw = Math.sin(v) * 2.2 + 8;
      const n =
        noise2(nx * 1.4, nz * 1.4) * 0.42 +
        noise2(ny * 2.9, nw * 2.9) * 0.28 +
        noise2(nx * 5.8, nw * 5.8) * 0.18 +
        noise2(ny * 11.5, nz * 11.5) * 0.12;
      const shade = (n - 0.5) * 46;
      const i = (y * size + x) * 4;
      data[i] = clamp(49 + shade, 0, 255);
      data[i + 1] = clamp(63 + shade * 1.05, 0, 255);
      data[i + 2] = clamp(78 + shade * 1.12, 0, 255);
      data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);

  // Scatter faint pebbles and cracks on top of the noise.
  for (let i = 0; i < 70; i += 1) {
    const x = rand(0, size);
    const y = rand(0, size);
    const r = rand(1, 3.4);
    c.fillStyle = `rgba(${randInt(96, 128)},${randInt(112, 146)},${randInt(128, 164)},${rand(0.16, 0.36)})`;
    c.beginPath();
    c.ellipse(x, y, r, r * 0.7, rand(0, Math.PI), 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 12; i += 1) {
    c.strokeStyle = `rgba(24,32,42,${rand(0.18, 0.36)})`;
    c.lineWidth = rand(0.6, 1.6);
    c.beginPath();
    let x = rand(0, size);
    let y = rand(0, size);
    c.moveTo(x, y);
    for (let s = 0; s < 4; s += 1) {
      x += rand(-22, 22);
      y += rand(-22, 22);
      c.lineTo(x, y);
    }
    c.stroke();
  }

  return tile;
}

const TERRAIN_KINDS = ['tree', 'rock', 'ruin', 'crystal'];

function makeTerrain(x, y, kind) {
  const base = {
    kind,
    x,
    y,
    seed: rand(0, 1000),
    sway: rand(0.6, 1.4),
  };
  switch (kind) {
    case 'tree':
      return {
        ...base,
        radius: rand(16, 24),
        height: rand(52, 92),
        canopy: rand(30, 46),
        hue: randInt(96, 138),
        blocking: true,
      };
    case 'rock': {
      const radius = rand(20, 46);
      const points = randInt(6, 9);
      const shape = Array.from({ length: points }, (_, i) => {
        const a = (i / points) * Math.PI * 2;
        const r = radius * rand(0.72, 1.12);
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.82 };
      });
      return { ...base, radius, shape, height: radius * rand(0.5, 0.9), blocking: true };
    }
    case 'ruin':
      return {
        ...base,
        radius: rand(18, 30),
        height: rand(46, 96),
        lean: rand(-0.12, 0.12),
        broken: rand(0.2, 0.6),
        blocking: true,
      };
    default: {
      const radius = rand(14, 24);
      return {
        ...base,
        radius,
        shards: Array.from({ length: randInt(3, 5) }, () => ({
          angle: rand(-0.5, 0.5),
          height: rand(28, 62),
          width: rand(6, 12),
          dx: rand(-radius * 0.6, radius * 0.6),
        })),
        blocking: true,
      };
    }
  }
}

export class World {
  constructor() {
    this.width = CONFIG.worldWidth;
    this.height = CONFIG.worldHeight;
    this.groundTile = buildGroundTile(256);
    this.terrain = [];
    this.wells = [];
    this.details = [];
    this.grid = new Map();
    this.queryStamp = 0;
    this.queryResult = [];
    this.generate();
  }

  cellKey(cx, cy) {
    // Integer key: cheaper than a template string on a path this hot.
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  addToGrid(obj) {
    const minX = Math.floor((obj.x - obj.radius) / CELL);
    const maxX = Math.floor((obj.x + obj.radius) / CELL);
    const minY = Math.floor((obj.y - obj.radius) / CELL);
    const maxY = Math.floor((obj.y + obj.radius) / CELL);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const key = this.cellKey(cx, cy);
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = [];
          this.grid.set(key, bucket);
        }
        bucket.push(obj);
      }
    }
  }

  /**
   * Terrain overlapping a circle. Objects span several cells, so a stamp
   * counter de-duplicates without the O(n^2) `includes` scan this used to do,
   * and the result array is reused — this runs for every unit, several times
   * per frame. Callers must finish with the array before querying again.
   */
  nearbyTerrain(point, reach) {
    this.queryStamp += 1;
    const found = this.queryResult;
    found.length = 0;
    const minX = Math.floor((point.x - reach) / CELL);
    const maxX = Math.floor((point.x + reach) / CELL);
    const minY = Math.floor((point.y - reach) / CELL);
    const maxY = Math.floor((point.y + reach) / CELL);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const bucket = this.grid.get(this.cellKey(cx, cy));
        if (!bucket) continue;
        for (const obj of bucket) {
          if (obj.stamp === this.queryStamp) continue;
          obj.stamp = this.queryStamp;
          found.push(obj);
        }
      }
    }
    return found;
  }

  generate() {
    this.terrain = [];
    this.wells = [];
    this.details = [];
    this.grid.clear();

    const pad = CONFIG.arenaPadding + 60;

    // Wells are placed first: they claim open ground and shape the map.
    const anchors = [
      { x: this.width * 0.22, y: this.height * 0.24 },
      { x: this.width * 0.78, y: this.height * 0.24 },
      { x: this.width * 0.22, y: this.height * 0.76 },
      { x: this.width * 0.78, y: this.height * 0.76 },
      { x: this.width * 0.5, y: this.height * 0.5 },
    ];
    for (let i = 0; i < CONFIG.wellCount; i += 1) {
      const a = anchors[i % anchors.length];
      this.wells.push({
        id: i,
        x: a.x + rand(-90, 90),
        y: a.y + rand(-70, 70),
        radius: CONFIG.wellRadius,
        owner: 'neutral', // 'neutral' | 'swarm'
        progress: 0,
        pulse: rand(0, Math.PI * 2),
        contested: false,
      });
    }

    // Terrain, rejecting anything that would sit on a well or the hero spawn.
    const heroSpawn = { x: this.width * 0.5, y: this.height * 0.5 };
    let attempts = 0;
    while (this.terrain.length < CONFIG.terrainCount && attempts < 3000) {
      attempts += 1;
      const kind = pick(TERRAIN_KINDS);
      const x = rand(pad, this.width - pad);
      const y = rand(pad, this.height - pad);
      const candidate = makeTerrain(x, y, kind);

      if (dist(candidate, heroSpawn) < 220) continue;
      if (this.wells.some((w) => dist(candidate, w) < w.radius + candidate.radius + 40)) continue;
      if (this.terrain.some((t) => dist(candidate, t) < t.radius + candidate.radius + 26)) continue;

      this.terrain.push(candidate);
      this.addToGrid(candidate);
    }

    // Non-blocking scatter: grass tufts and pebbles that sell the ground scale.
    for (let i = 0; i < 760; i += 1) {
      const x = rand(CONFIG.arenaPadding, this.width - CONFIG.arenaPadding);
      const y = rand(CONFIG.arenaPadding, this.height - CONFIG.arenaPadding);
      this.details.push({
        x,
        y,
        kind: Math.random() < 0.62 ? 'tuft' : 'pebble',
        size: rand(4, 11),
        seed: rand(0, 100),
        tilt: rand(-0.4, 0.4),
      });
    }
  }

  inArena(p, margin = 0) {
    const pad = CONFIG.arenaPadding + margin;
    return p.x > pad && p.x < this.width - pad && p.y > pad && p.y < this.height - pad;
  }

  clampToArena(p, margin = 0) {
    const pad = CONFIG.arenaPadding + margin;
    p.x = clamp(p.x, pad, this.width - pad);
    p.y = clamp(p.y, pad, this.height - pad);
    return p;
  }

  blocked(p, radius) {
    for (const t of this.nearbyTerrain(p, radius + 60)) {
      if (!t.blocking) continue;
      if (dist(p, t) < t.radius + radius) return true;
    }
    return false;
  }

  /** Push a point out of any terrain it has ended up inside. */
  resolveCollision(p, radius) {
    for (const t of this.nearbyTerrain(p, radius + 60)) {
      if (!t.blocking) continue;
      const d = dist(p, t);
      const min = t.radius + radius;
      if (d < min && d > 1e-4) {
        const push = (min - d) / d;
        p.x += (p.x - t.x) * push;
        p.y += (p.y - t.y) * push;
      }
    }
    return p;
  }

  /** Steering force that keeps walkers from hugging obstacles. */
  avoidance(p, reach) {
    let ax = 0;
    let ay = 0;
    for (const t of this.nearbyTerrain(p, reach + 40)) {
      if (!t.blocking) continue;
      const d = dist(p, t);
      const influence = t.radius + reach;
      if (d < influence && d > 1e-4) {
        const strength = (influence - d) / influence;
        ax += ((p.x - t.x) / d) * strength * 1.6;
        ay += ((p.y - t.y) / d) * strength * 1.6;
      }
    }
    return { x: ax, y: ay };
  }

  /** True if terrain sits between two points — blocks ranged attacks. */
  lineBlocked(a, b, pad = 0) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const reach = dist(a, b) / 2 + 60;
    for (const t of this.nearbyTerrain(mid, reach)) {
      if (!t.blocking) continue;
      const r = t.radius + pad;
      if (pointSegmentDist2(t, a, b) < r * r) return true;
    }
    return false;
  }

  wellAt(p, slack = 0) {
    return this.wells.find((w) => dist(p, w) < w.radius + slack);
  }
}
