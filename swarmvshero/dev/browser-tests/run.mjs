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
  await page.waitForTimeout(600);            // let the settling window pass
  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  r.checks.freshKeyPicksAfterDelay = await page.evaluate(
    () => window.__swarm.roster[5] === 'mender' && window.__swarm.phase === 'playing');

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
  const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`\n=== ${r.browser} ${r.version ?? ''}`);
  console.log(`  checks     : ${Object.keys(r.checks).length - failed.length}/${Object.keys(r.checks).length} pass` +
              (failed.length ? `  FAILED: ${failed.join(', ')}` : ''));
  console.log(`  sim        : ${r.simDetail ?? '-'}`);
  console.log(`  layout     : ${r.layoutProblems?.length ? r.layoutProblems.slice(0, 4).join(' | ') : 'clean at all 10 viewports'}`);
  console.log(`  compat page: ${r.compat?.verdict ?? '-'}`);
  if (r.compat?.fails?.length) console.log(`  compat FAIL: ${r.compat.fails.join(', ')}`);
  if (r.compat?.warns?.length) console.log(`  compat warn: ${r.compat.warns.join(', ')}`);
  if (r.errors.length) console.log(`  errors     : ${[...new Set(r.errors)].slice(0, 5).join(' | ')}`);
}
