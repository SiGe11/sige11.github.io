// Balance harness — development tool, not part of the game.
//
// Nothing in the game loads this file. Paste it into the browser console (or
// fetch + eval it) while the game is open, then:
//
//   window.__suite(window.__DUMB,   60)  // constant pressure, holds wells
//   window.__suite(window.__STAGE,  40)  // stages near the fight, times Frenzy
//   window.__suite(window.__SMART,  40)  // stages in a far corner (bad play)
//
// Last measured: DUMB ~53%, STAGE ~60%, SMART ~25%. That ordering is the
// point — committing a massed swarm should beat trickling, and parking the
// army out of the fight should lose.
//
// It reports a win rate, run lengths, per-champion-class results, and any
// invariant violations (NaN state, runaway multipliers, entities out of the
// world, caps exceeded). Balance targets: roughly a 50% win rate for __DUMB
// and no violations. Sample at least 40 runs — run-to-run variance is high
// enough that n=10 readings swing by 30 points.

window.__step = (g, dt) => { g.update(dt); g.clicks.length = 0; g.rightClicks.length = 0; };

/** Invariants that must hold every frame. Returns a list of violations. */
window.__check = (g) => {
  const bad = [];
  const n = (v, label) => { if (!Number.isFinite(v)) bad.push(`${label}=${v}`); };
  n(g.aether, 'aether'); n(g.earned, 'earned'); n(g.time, 'time');
  n(g.hero.hp, 'heroHp'); n(g.hero.x, 'heroX'); n(g.hero.y, 'heroY'); n(g.hero.xp, 'heroXp');
  n(g.threat, 'threat');
  if (g.aether < -0.001) bad.push(`negative aether ${g.aether}`);
  if (g.units.length > 90) bad.push(`unit cap exceeded: ${g.units.length}`);
  const stats = g.heroStats();
  if (g.hero.hp > stats.maxHp + 1) bad.push(`hp>max ${Math.round(g.hero.hp)}>${stats.maxHp}`);
  if (stats.maxHp > 400000) bad.push(`hero maxHp runaway ${stats.maxHp}`);
  if (g.stats.damageDealt > 5e6) bad.push(`damage runaway ${g.stats.damageDealt}`);
  if (g.takenUpgrades.length > 40) bad.push(`upgrade runaway ${g.takenUpgrades.length}`);
  if (g.heroRelics.length > 12) bad.push(`relic runaway ${g.heroRelics.length}`);
  for (const u of g.units) {
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) { bad.push(`unit NaN pos ${u.type}`); break; }
    if (!Number.isFinite(u.hp)) { bad.push(`unit NaN hp ${u.type}`); break; }
    if (u.x < 0 || u.y < 0 || u.x > g.world.width || u.y > g.world.height) {
      bad.push(`unit out of world ${u.type} ${Math.round(u.x)},${Math.round(u.y)}`); break;
    }
    if (u.hp > u.maxHp + 1) { bad.push(`unit hp>max ${u.type}`); break; }
  }
  if (g.fx.particles.length > 1000) bad.push(`particles ${g.fx.particles.length}`);
  if (g.projectiles.length > 400) bad.push(`projectiles ${g.projectiles.length}`);
  if (g.rifts.length > 60) bad.push(`rifts ${g.rifts.length}`);
  if (g.relics.length > 20) bad.push(`relics ${g.relics.length}`);
  if (g.feed.length > 6) bad.push(`feed ${g.feed.length}`);
  return bad;
};

const affordableAt = (g, ids, p) => {
  for (const id of ids) if (g.unlocked.has(id) && !g.summonBlocker(id, p)) return id;
  return null;
};

/** Constant-pressure player: garrisons wells, feeds the fight, frenzies on cooldown. */
window.__DUMB = (g, i) => {
  if (i % 12) return;
  let done = false;
  for (const w of g.world.wells) {
    const guards = g.units.filter(u => u.job === w.id).length;
    if (guards >= (w.owner === 'swarm' ? 2 : 3)) continue;
    const p = { x: w.x + (Math.random()-0.5)*60, y: w.y + (Math.random()-0.5)*60 };
    const id = affordableAt(g, ['mauler','mite'], p);
    if (id) { g.trySummon(id, p); done = true; break; }
  }
  if (!done) {
    const a = Math.random()*Math.PI*2, r = g.minSpawnRange()+30;
    const p = { x: g.hero.x + Math.cos(a)*r, y: g.hero.y + Math.sin(a)*r };
    const id = affordableAt(g, ['titan','matriarch','shrieker','burrower','flinger','mauler','mite'], p);
    if (id) g.trySummon(id, p);
  }
  const near = g.units.filter(u => Math.hypot(u.x-g.hero.x, u.y-g.hero.y) < 300).length;
  if (g.frenzyCooldown <= 0 && near >= 10) g.tryFrenzy();
};

/** Stages a reserve behind a beacon, then commits on Frenzy. */
window.__SMART = (g, i) => {
  if (!g.rally || i % 240 === 0) {
    const ang = Math.atan2(g.hero.y - g.world.height/2, g.hero.x - g.world.width/2) + Math.PI;
    const p = { x: g.world.width/2 + Math.cos(ang)*560, y: g.world.height/2 + Math.sin(ang)*380 };
    g.world.clampToArena(p, 60);
    if (!g.world.blocked(p, 30)) g.rally = p;
  }
  if (i % 8) return;
  let done = false;
  for (const w of g.world.wells) {
    const guards = g.units.filter(u => u.job === w.id).length;
    if (guards >= (w.owner === 'swarm' ? 2 : 3)) continue;
    if (Math.hypot(g.hero.x-w.x, g.hero.y-w.y) < 300) continue;
    const p = { x: w.x + (Math.random()-0.5)*70, y: w.y + (Math.random()-0.5)*70 };
    const id = affordableAt(g, ['matriarch','mauler','mite'], p);
    if (id) { g.trySummon(id, p); done = true; break; }
  }
  if (!done) {
    const free = g.units.filter(u => u.job === null).length;
    const base = (free < 24 && g.frenzyCooldown > 4 && g.rally) ? g.rally : g.hero;
    const a = Math.random()*Math.PI*2;
    const r = base === g.hero ? g.minSpawnRange()+25 : 120;
    const p = { x: base.x + Math.cos(a)*r, y: base.y + Math.sin(a)*r };
    const id = affordableAt(g, ['titan','matriarch','shrieker','burrower','flinger','mauler','mite'], p);
    if (id) g.trySummon(id, p);
  }
  const staged = g.rally ? g.units.filter(u => Math.hypot(u.x-g.rally.x, u.y-g.rally.y) < 170).length : 0;
  if (g.frenzyCooldown <= 0 && staged >= 14 && !g.hero.action) g.tryFrenzy();
};

/**
 * Stages just outside the champion's aggro radius and releases on Frenzy.
 * This is the intended line of play, and should out-perform __DUMB.
 */
window.__STAGE = (g, i) => {
  if (i % 30 === 0) {
    const a = Math.random() * Math.PI * 2;
    const p = { x: g.hero.x + Math.cos(a) * 380, y: g.hero.y + Math.sin(a) * 380 };
    g.world.clampToArena(p, 60);
    if (!g.world.blocked(p, 30)) g.rally = p;
  }
  if (i % 8) return;
  let done = false;
  for (const w of g.world.wells) {
    const guards = g.units.filter(u => u.job === w.id).length;
    if (guards >= (w.owner === 'swarm' ? 2 : 3)) continue;
    if (Math.hypot(g.hero.x - w.x, g.hero.y - w.y) < 280) continue;
    const p = { x: w.x + (Math.random()-0.5)*70, y: w.y + (Math.random()-0.5)*70 };
    const id = affordableAt(g, ['matriarch','mauler','mite'], p);
    if (id) { g.trySummon(id, p); done = true; break; }
  }
  if (!done) {
    const base = (g.frenzyCooldown > 3 && g.rally) ? g.rally : g.hero;
    const a = Math.random() * Math.PI * 2;
    const r = base === g.hero ? g.minSpawnRange() + 25 : 110;
    const p = { x: base.x + Math.cos(a)*r, y: base.y + Math.sin(a)*r };
    const id = affordableAt(g, ['titan','matriarch','shrieker','burrower','flinger','mauler','mite'], p);
    if (id) g.trySummon(id, p);
  }
  const staged = g.rally ? g.units.filter(u => Math.hypot(u.x-g.rally.x, u.y-g.rally.y) < 200).length : 0;
  if (g.frenzyCooldown <= 0 && (staged >= 12 || g.units.length >= 30) && !g.hero.action) g.tryFrenzy();
};

window.__play = (bot, opts = {}) => {
  const g = window.__swarm;
  g.newRun(); g.phase = 'playing';
  const dt = 1/60; const errors = []; const violations = new Set();
  const maxFrames = (opts.maxSeconds ?? 900) * 60;
  for (let i = 0; i < maxFrames; i++) {
    try {
      if (g.phase === 'upgrade') g.chooseUpgrade(g.upgradeChoices[Math.floor(Math.random()*g.upgradeChoices.length)]);
      if (g.phase !== 'playing') break;
      bot(g, i);
      window.__step(g, dt);
      if (i % 30 === 0) for (const v of window.__check(g)) violations.add(v);
    } catch (e) { errors.push(`${i}: ${e.message} | ${(e.stack||'').split('\n')[1]}`); if (errors.length > 2) break; }
  }
  try { g.render(); } catch (e) { errors.push('render: ' + e.message); }
  return { cls: g.heroClass.id, res: g.phase, t: Math.round(g.time), tier: g.hero.stage+1,
    lost: g.stats.lost, dmg: Math.round(g.stats.damageDealt), ups: g.takenUpgrades.length,
    wells: g.heldWells(), relics: g.heroRelics.length,
    errors, violations: [...violations] };
};

window.__suite = (bot, n, opts) => {
  const out = []; const byClass = {};
  for (let i = 0; i < n; i++) {
    const r = window.__play(bot, opts);
    out.push(r);
    byClass[r.cls] = byClass[r.cls] ?? { w: 0, n: 0 };
    byClass[r.cls].n += 1;
    if (r.res === 'victory') byClass[r.cls].w += 1;
  }
  const wins = out.filter(o => o.res === 'victory').length;
  const times = out.map(o => o.t).sort((a,b) => a-b);
  return {
    winRate: `${Math.round(wins/n*100)}% (${wins}/${n})`,
    medianSeconds: times[Math.floor(n/2)],
    range: `${times[0]}-${times[n-1]}s`,
    byClass: Object.fromEntries(Object.entries(byClass).map(([k,v]) => [k, `${v.w}/${v.n}`])),
    unfinished: out.filter(o => o.res === 'playing').length,
    errors: [...new Set(out.flatMap(o => o.errors))].slice(0, 5),
    violations: [...new Set(out.flatMap(o => o.violations))].slice(0, 8),
  };
};
'harness loaded'
