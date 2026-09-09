// Renders one deterministic scene in every engine and samples a pixel grid,
// so "it looks right" is a measurement rather than an impression.
import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:8765';

const SCENE = `(() => {
  const g = window.__swarm;
  // Deterministic scene: fixed RNG, fixed world, fixed actors.
  let seed = 12345;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  g.newRun();
  g.phase = 'playing';
  g.width = 1280; g.height = 720;
  g.canvas.width = 1280; g.canvas.height = 720; g.dpr = 1;
  g.fx.clear(); g.fx.shake = 0; g.fx.flash = 0;
  g.units = []; g.allies = []; g.projectiles = []; g.relics = []; g.rifts = [];
  g.hero.x = g.world.width / 2; g.hero.y = g.world.height / 2;
  g.hero.hp = g.heroStats().maxHp * 0.62;
  g.hero.facing = 0.6; g.hero.stage = 2; g.refreshHeroCache();
  const ids = ['mite','flinger','mauler','burrower','shrieker','matriarch','mender','titan','bombardier'];
  ids.forEach((id, i) => {
    const a = (i / ids.length) * Math.PI * 2;
    g.spawnUnit(id, g.hero.x + Math.cos(a) * 190, g.hero.y + Math.sin(a) * 190);
    const u = g.units[g.units.length - 1];
    if (u) { u.spawnScale = 1; u.invuln = 0; u.hp = u.maxHp * 0.7; u.facing = a; u.gait = i; u.seed = i * 7; u.burrowed = false; }
  });
  g.spawnDrop(g.hero.x - 120, g.hero.y + 90);
  g.spawnDrop(g.hero.x + 120, g.hero.y + 90);
  g.relics.forEach((d, i) => { d.kind = i === 0 ? 'boon' : 'relic'; d.seed = i; d.life = 10; });
  g.allies.push({ id: 9001, x: g.hero.x + 70, y: g.hero.y - 90, vx: 0, vy: 0, facing: 0.3,
                  hp: 90, maxHp: 92, attackTimer: 0, seed: 4, gait: 1, hitFlash: 0, spawnScale: 1, life: 20 });
  g.camera.x = g.hero.x; g.camera.y = g.hero.y; g.camera.zoom = 1;
  g.time = 40;
  g.render();
  // Sample a coarse grid plus a few hand-picked spots.
  const ctx = g.canvas.getContext('2d');
  const pts = [];
  for (let y = 20; y < 720; y += 40) for (let x = 20; x < 1280; x += 40) pts.push([x, y]);
  const out = [];
  for (const [x, y] of pts) {
    const d = ctx.getImageData(x, y, 1, 1).data;
    out.push(d[0], d[1], d[2]);
  }
  return out;
})()`;

const engines = [
  ['chromium', chromium, {}],
  ['chrome', chromium, { channel: 'chrome' }],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
];

const samples = {};
for (const [name, launcher, opts] of engines) {
  const b = await launcher.launch(opts);
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  samples[name] = await page.evaluate(SCENE);
  await b.close();
}
fs.writeFileSync('/tmp/swarm-shots/pixels.json', JSON.stringify(samples));

const names = Object.keys(samples);
const ref = 'chromium';
console.log(`sampled ${samples[ref].length / 3} points per engine, reference = ${ref}\n`);
for (const n of names) {
  if (n === ref) continue;
  const a = samples[ref], c = samples[n];
  let max = 0, sum = 0, big = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - c[i]);
    max = Math.max(max, d); sum += d;
    if (d > 24) big += 1;
  }
  const mean = (sum / a.length).toFixed(2);
  const pct = ((big / a.length) * 100).toFixed(2);
  const verdict = max <= 24 ? 'identical within AA tolerance'
    : big / a.length < 0.01 ? 'a few AA-level edge pixels differ'
    : 'MATERIAL DIFFERENCE';
  console.log(`${n.padEnd(9)} max channel delta ${String(max).padStart(3)}  mean ${mean.padStart(5)}  channels off by >24: ${pct}%  -> ${verdict}`);
}
