import { chromium, firefox, webkit } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:8765';
const SHOTS = process.env.SHOTS || '/tmp/swarm-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900],
  [1680, 1050], [1920, 1080], [2560, 1440], [3440, 1440], [1024, 640],
];

const targets = [
  { name: 'chromium', launcher: chromium, opts: {} },
  { name: 'chrome',   launcher: chromium, opts: { channel: 'chrome' } },
  // Real Microsoft Edge. Skipped with a launch error when it is not installed;
  // it is Blink like Chrome, so Chrome's result stands in for it then.
  { name: 'edge',     launcher: chromium, opts: { channel: 'msedge' } },
  { name: 'firefox',  launcher: firefox,  opts: {} },
  { name: 'webkit',   launcher: webkit,   opts: {} },
];

const results = [];

for (const t of targets) {
  const r = { browser: t.name, version: null, errors: [], checks: {} };
  let browser;
  try {
    browser = await t.launcher.launch(t.opts);
  } catch (e) {
    r.errors.push(`launch: ${e.message.split('\n')[0]}`);
    results.push(r);
    continue;
  }
  r.version = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => r.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (q) => r.errors.push(`requestfailed: ${q.url()} ${q.failure()?.errorText}`));

  // ---- 1. the game boots
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  r.checks.boots = await page.evaluate(() => !!window.__swarm && window.__swarm.phase === 'intro');
  r.checks.canvasSized = await page.evaluate(() => {
    const c = document.querySelector('#game');
    return c.width > 0 && c.height > 0;
  });

  // ---- 2. the rAF loop actually advances
  await page.evaluate(() => { window.__swarm.phase = 'playing'; window.__t0 = window.__swarm.time; });
  await page.waitForTimeout(700);
  r.checks.loopRuns = await page.evaluate(() => window.__swarm.time > window.__t0);

  // ---- 3. real input: click starts, click summons
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.mouse.click(300, 620);           // dismiss intro (clear of the guide button)
  await page.waitForTimeout(150);
  r.checks.introDismissedByClick = await page.evaluate(() => window.__swarm.phase === 'playing');
  const summoned = await page.evaluate(async () => {
    const g = window.__swarm;
    const before = g.rifts.length + g.units.length;
    for (let i = 0; i < 400; i += 1) {
      const s = { x: 60 + Math.random() * (g.width - 120), y: 120 + Math.random() * (g.height - 300) };
      if (!g.summonBlocker(g.selected, g.screenToWorld(s.x, s.y))) { window.__spot = s; return true; }
    }
    return false;
  });
  if (summoned) {
    const spot = await page.evaluate(() => window.__spot);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(250);
  }
  r.checks.clickSummons = await page.evaluate(() => window.__swarm.rifts.length + window.__swarm.units.length > 0);

  // ---- 4. real keyboard: held digit must not pick a strain
  await page.evaluate(() => { const g = window.__swarm; g.newRun(); g.phase = 'playing'; });
  await page.keyboard.down('1');
  await page.keyboard.down('1');   // second down carries repeat:true
  await page.keyboard.down('1');
  await page.evaluate(() => window.__swarm.openUnitChoice(5));
  await page.keyboard.down('1');
  await page.keyboard.down('1');
  await page.waitForTimeout(120);
  r.checks.heldKeyDoesNotPick = await page.evaluate(
    () => window.__swarm.phase === 'choose' && window.__swarm.roster[5] === null);
  await page.keyboard.up('1');
  // Let the settling window pass. It is measured in game time, which runs
  // behind the wall clock whenever frames drop, so wait on it rather than on
  // a fixed delay — a busy machine made the fixed 600 ms flaky in WebKit.
  await page.waitForFunction(() => window.__swarm.panelAge >= 0.5, null, { timeout: 5000 });
  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  r.checks.freshKeyPicksAfterDelay = await page.evaluate(
    () => window.__swarm.roster[5] === 'mender' && window.__swarm.phase === 'playing');

  // ---- 4b. a held digit opens one rift, not one per auto-repeat
  const spot = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing'; g.aether = 999;
    window.__summons = 0;
    const orig = g.trySummon.bind(g);
    g.trySummon = (...a) => { const ok = orig(...a); if (ok) window.__summons += 1; return ok; };
    for (let i = 0; i < 400; i += 1) {
      const s = { x: 300 + Math.random() * (g.width - 600), y: 200 + Math.random() * (g.height - 400) };
      if (!g.hud.pointerOverUi(s) && !g.summonBlocker('mite', g.screenToWorld(s.x, s.y))) return s;
    }
    return null;
  });
  if (spot) {
    await page.mouse.move(spot.x, spot.y);
    await page.keyboard.down('1');
    await page.keyboard.down('1');           // repeat:true
    await page.keyboard.down('1');
    await page.keyboard.up('1');
    await page.waitForTimeout(100);
  }
  r.checks.heldDigitSummonsOnce = await page.evaluate(() => window.__summons === 1);

  // ---- 4c. clicks on panels and feed text never fall through into the world
  const panels = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing'; g.aether = 999;
    window.__attempts = 0;
    const orig = g.trySummon.bind(g);
    g.trySummon = (...a) => { window.__attempts += 1; return orig(...a); };
    const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    // newRun logs the champion's name, so the feed has a line to click on.
    return [g.hud.resourcePanelRect(), g.hud.heroPanelLayout().rect, ...g.hud.feedLineRects()].map(c);
  });
  for (const p of panels) await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  r.checks.panelClickDoesNotSummon = await page.evaluate(() => window.__attempts === 0);

  // ---- 4d. the Frenzy button works in play and does nothing while paused
  const frenzyAt = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'paused'; g.rally = { x: 500, y: 500 };
    const f = g.hud.frenzyRect();
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  });
  await page.mouse.click(frenzyAt.x, frenzyAt.y);
  await page.waitForTimeout(100);
  r.checks.frenzyNotWhilePaused = await page.evaluate(
    () => window.__swarm.frenzyTimer === 0 && window.__swarm.rally !== null);
  await page.evaluate(() => { window.__swarm.phase = 'playing'; });
  await page.mouse.click(frenzyAt.x, frenzyAt.y);
  await page.waitForTimeout(100);
  r.checks.frenzyButtonWorks = await page.evaluate(() => window.__swarm.frenzyTimer > 0);

  // ---- 4e. garrisons keep their well when the champion runs for one
  r.checks.wellsKeepOrder = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing';
    for (const w of g.world.wells) {
      w.owner = 'swarm'; w.progress = 1;
      g.spawnUnit('mite', w.x, w.y); g.spawnUnit('mite', w.x + 10, w.y);
    }
    g.hero.hp = g.heroStats().maxHp * 0.3;           // hurt: it looks for a refuge
    g.hero.x = g.world.wells[3].x + 200; g.hero.y = g.world.wells[3].y;
    for (let i = 0; i < 30; i += 1) g.update(1 / 60);
    return g.world.wells.every((w, i) => w.id === i)
      && g.units.every((u) => u.job === null || g.world.wells[u.job].id === u.job);
  });

  // ---- 4f. one seed replays the same run; another seed does not
  r.checks.seedReplaysRun = await page.evaluate(() => {
    const g = window.__swarm;
    const play = (seed) => {
      g.newRun(seed); g.phase = 'playing'; g.keepRecords = false;
      for (let i = 0; i < 60 * 90; i += 1) {
        if (g.phase === 'upgrade') g.chooseUpgrade(g.upgradeChoices[0]);
        if (g.phase === 'choose') g.chooseUnit(g.unitChoice.options[0]);
        if (g.phase !== 'playing') break;
        if (i % 20 === 0) {
          const a = i * 0.7;
          const p = { x: g.hero.x + Math.cos(a) * (g.minSpawnRange() + 40), y: g.hero.y + Math.sin(a) * (g.minSpawnRange() + 40) };
          g.trySummon(g.selected, p);
        }
        g.update(1 / 60);
        g.clicks.length = 0;
      }
      return JSON.stringify([g.heroClass.id, g.hero.x, g.hero.y, g.hero.hp, g.aether, g.units.length, g.stats.lost]);
    };
    const a = play(777);
    return a === play(777) && a !== play(778);
  });

  // ---- 4g. panning frees the camera, and a few seconds after the key is let
  // go it is back on the champion and following it — in real time, with the
  // page's own frame loop, both mid-fight and paused.
  for (const phase of ['playing', 'paused']) {
    await page.evaluate((ph) => {
      const g = window.__swarm; g.newRun(); g.phase = ph; window.__cx = g.camera.x;
    }, phase);
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
    const panned = await page.evaluate(
      () => window.__swarm.camera.free !== null && window.__swarm.camera.x > window.__cx + 40);
    const t0 = Date.now();
    const back = await page.waitForFunction(() => {
      const g = window.__swarm;
      if (g.camera.free) return false;
      const t = g.clampCameraTarget(g.followTarget());
      return Math.hypot(g.camera.x - t.x, g.camera.y - t.y) < 60;
    }, null, { timeout: 9000, polling: 50 }).then(() => true, () => false);
    const seconds = (Date.now() - t0) / 1000;
    // Not instantly (the player gets their look), not never.
    r.checks[`cameraPansAndReturns_${phase}`] = panned && back && seconds > 2;
    r[`cameraReturnSeconds_${phase}`] = seconds.toFixed(1);
  }

  // ---- 4h. minimap: left-click looks there, right-click rallies there
  const mini = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing';
    const m = g.hud.minimapRect();
    return { x: m.x + m.w * 0.25, y: m.y + m.h * 0.75 };
  });
  await page.mouse.click(mini.x, mini.y);
  await page.mouse.click(mini.x, mini.y, { button: 'right' });
  await page.waitForTimeout(100);
  r.checks.minimapLooksAndRallies = await page.evaluate(() => {
    const g = window.__swarm;
    const want = { x: g.world.width * 0.25, y: g.world.height * 0.75 };
    const near = (p) => p && Math.hypot(p.x - want.x, p.y - want.y) < 40;
    return g.camera.free !== null && near(g.rally);
  });

  // ---- 4i. keyboard edge cases: AZERTY digits, OS shortcuts, focus loss
  r.checks.azertyDigitSelects = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'intro'; g.unlocked.add('flinger');
    // AZERTY's unshifted "2" key reports key "é" and code "Digit2".
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'é', code: 'Digit2' }));
    return g.selected === 'flinger';
  });
  await page.evaluate(() => { window.__muted = window.__swarm.sfx.muted; });
  await page.keyboard.press('Control+m');
  r.checks.modifiedKeysIgnored = await page.evaluate(() => window.__swarm.sfx.muted === window.__muted);
  // ---- 4j. every sound, and the ambient bed, renders real audio in this
  // engine: offline, so no autoplay gate or speakers are involved.
  const audio = await page.evaluate(async () => {
    const { Sfx } = await import('/src/audio.js');
    const names = ['spawn', 'hit', 'heroHit', 'death', 'spit', 'telegraph', 'boom', 'summonTitan',
      'surface', 'rally', 'upgrade', 'heroEmpower', 'heroEvolve', 'heartbeat', 'frenzy', 'evolve',
      'capture', 'lose_well', 'victory', 'defeat'];
    const silent = [];
    for (const name of [...names, 'ambience']) {
      const off = new OfflineAudioContext(2, 44100 * (name === 'ambience' ? 4 : 1), 44100);
      Object.defineProperty(off, 'state', { get: () => 'running' });
      const s = new Sfx(); s.attach(off); s.unlocked = true;
      if (name === 'ambience') s.ambience(0.5, false); else s.play(name, { pan: 0.4 });
      const data = (await off.startRendering()).getChannelData(0);
      let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v));
      if (!(peak > 1e-4)) silent.push(name);
    }
    return silent;
  });
  r.checks.everySoundRenders = audio.length === 0;
  if (audio.length) r.errors.push(`silent sounds: ${audio.join(', ')}`);

  // ---- 4k. prefers-reduced-motion is honoured: no shake, calm effects
  await page.emulateMedia({ reducedMotion: 'reduce' });
  r.checks.reducedMotionHonoured = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing';
    g.fx.shake = 1.5; g.fx.flash = 1; g.frenzyTimer = 3; g.render();
    return g.calm() === true;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  r.checks.blurPauses = await page.evaluate(() => {
    const g = window.__swarm; g.newRun(); g.phase = 'playing';
    window.dispatchEvent(new Event('blur'));
    return g.phase === 'paused';
  });

  // ---- 5. simulate a full run headlessly in-page
  const sim = await page.evaluate(() => {
    const g = window.__swarm;
    try {
      g.newRun(); g.phase = 'playing';
      for (let i = 0; i < 60 * 300; i += 1) {
        if (g.phase === 'upgrade') { g.panelAge = 9; g.chooseUpgrade(g.upgradeChoices[0]); }
        if (g.phase === 'choose') { g.panelAge = 9; g.chooseUnit(g.unitChoice.options[i % 2]); }
        if (g.phase !== 'playing') break;
        if (i % 18 === 0) {
          const a = Math.random() * Math.PI * 2;
          const p = { x: g.hero.x + Math.cos(a) * (g.minSpawnRange() + 40), y: g.hero.y + Math.sin(a) * (g.minSpawnRange() + 40) };
          if (!g.summonBlocker(g.selected, p)) g.trySummon(g.selected, p);
        }
        g.update(1 / 60);
        g.clicks.length = 0;
      }
      return { ok: true, phase: g.phase, t: Math.round(g.time),
               finite: Number.isFinite(g.hero.hp) && Number.isFinite(g.aether) };
    } catch (e) { return { ok: false, err: `${e.name}: ${e.message}` }; }
  });
  r.checks.fullRunSimulates = sim.ok && sim.finite;
  r.simDetail = sim.ok ? `${sim.phase} at ${sim.t}s` : sim.err;

  // ---- 6. render + layout at every desktop viewport
  const layout = await page.evaluate((sizes) => {
    const g = window.__swarm;
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const bad = [];
    for (const [w, h] of sizes) {
      g.width = w; g.height = h; g.canvas.width = w; g.canvas.height = h; g.dpr = 1;
      try {
        g.render();
        g.helpVisible = true;
        for (let p = 0; p < 6; p += 1) { g.hud.helpPage = p; g.render(); }
        g.helpVisible = false;
        g.unitChoice = { slot: 6, options: ['titan', 'bombardier'] };
        const saved = g.phase; g.phase = 'choose'; g.panelAge = 1; g.render();
        g.phase = saved; g.unitChoice = null;
      } catch (e) { bad.push(`${w}x${h} render ${e.message}`); continue; }
      const bar = g.hud.actionBarLayout(), fz = g.hud.frenzyRect(), mini = g.hud.minimapRect();
      const res = g.hud.resourcePanelRect(), hero = g.hud.heroPanelRect(40), feed = g.hud.feedRect();
      if (bar.startX < 8) bad.push(`${w}x${h} action bar off-screen`);
      if (fz.x + fz.w > w - 8) bad.push(`${w}x${h} frenzy overflows`);
      if (mini.x < 8 || mini.y + mini.h > bar.y - 4) bad.push(`${w}x${h} minimap collides`);
      if (overlap(hero, res)) bad.push(`${w}x${h} panel over resources`);
      if (overlap(hero, { x: feed.x, y: feed.y, w: feed.w, h: 120 })) bad.push(`${w}x${h} panel over feed`);
    }
    return bad;
  }, VIEWPORTS);
  r.checks.layoutCleanEverywhere = layout.length === 0;
  r.layoutProblems = layout;

  // ---- 7. the compat page's own verdict
  await page.goto(`${BASE}/dev/compat-check.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  r.compat = await page.evaluate(() => {
    const v = document.getElementById('verdict')?.textContent ?? 'no verdict';
    const fails = [...document.querySelectorAll('td.f')].map(td => td.parentElement.children[0].textContent);
    const warns = [...document.querySelectorAll('td.w')].map(td => td.parentElement.children[0].textContent);
    return { verdict: v, fails, warns };
  });

  // ---- 8. one real screenshot of gameplay
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    const g = window.__swarm; g.phase = 'playing';
    for (let i = 0; i < 60 * 50; i += 1) {
      if (g.phase === 'upgrade') { g.panelAge = 9; g.chooseUpgrade(g.upgradeChoices[0]); }
      if (g.phase !== 'playing') break;
      if (i % 22 === 0) {
        const a = Math.random() * Math.PI * 2;
        const p = { x: g.hero.x + Math.cos(a) * (g.minSpawnRange() + 40), y: g.hero.y + Math.sin(a) * (g.minSpawnRange() + 40) };
        if (!g.summonBlocker(g.selected, p)) g.trySummon(g.selected, p);
      }
      g.update(1 / 60);
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${t.name}-game.png` });
  await page.evaluate(() => { window.__swarm.helpVisible = true; window.__swarm.hud.helpPage = 4; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${t.name}-guide.png` });

  await browser.close();
  results.push(r);
}

fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  if (!r.version) {
    console.log(`\n=== ${r.browser}\n  skipped    : ${r.errors[0] ?? 'did not launch'}`);
    continue;
  }
  const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`\n=== ${r.browser} ${r.version ?? ''}`);
  console.log(`  checks     : ${Object.keys(r.checks).length - failed.length}/${Object.keys(r.checks).length} pass` +
              (failed.length ? `  FAILED: ${failed.join(', ')}` : ''));
  console.log(`  sim        : ${r.simDetail ?? '-'}`);
  if (r.cameraReturnSeconds_playing) {
    console.log(`  camera     : back on the champion ${r.cameraReturnSeconds_playing}s after release (paused: ${r.cameraReturnSeconds_paused}s)`);
  }
  console.log(`  layout     : ${r.layoutProblems?.length ? r.layoutProblems.slice(0, 4).join(' | ') : 'clean at all 10 viewports'}`);
  console.log(`  compat page: ${r.compat?.verdict ?? '-'}`);
  if (r.compat?.fails?.length) console.log(`  compat FAIL: ${r.compat.fails.join(', ')}`);
  if (r.compat?.warns?.length) console.log(`  compat warn: ${r.compat.warns.join(', ')}`);
  if (r.errors.length) console.log(`  errors     : ${[...new Set(r.errors)].slice(0, 5).join(' | ')}`);
}
