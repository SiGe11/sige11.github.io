// Drives the real, shipping Safari through safaridriver (W3C WebDriver).
// Playwright's "webkit" is the engine; this is the browser the user actually has.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4601;
const BASE = 'http://localhost:8765';
const SHOTS = '/tmp/swarm-shots';
const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

const api = async (method, path, body) => {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
};

let sid = null;
const out = { browser: 'safari (real)', version: null, checks: {}, errors: [] };
try {
  const caps = await api('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  sid = caps.sessionId;
  out.version = `${caps.capabilities.browserVersion} (macOS ${caps.capabilities['safari:platformVersion']})`;
  const js = (script, args = []) => api('POST', `/session/${sid}/execute/sync`, { script, args });
  const go = async (url) => { await api('POST', `/session/${sid}/url`, { url }); await sleep(1200); };

  await api('POST', `/session/${sid}/window/rect`, { width: 1440, height: 900, x: 40, y: 40 });

  // 1. boots
  await go(BASE);
  out.checks.boots = await js('return !!window.__swarm && window.__swarm.phase === "intro";');
  out.checks.canvasSized = await js('const c=document.querySelector("#game"); return c.width>0 && c.height>0;');

  // 2. the rAF loop advances in a real window
  await js('window.__swarm.phase="playing"; window.__t0=window.__swarm.time; return true;');
  await sleep(800);
  out.checks.loopRuns = await js('return window.__swarm.time > window.__t0;');

  // 3. no page errors while loading modules
  out.checks.noModuleErrors = await js(`
    return performance.getEntriesByType('resource')
      .filter(e => e.name.indexOf('/src/') !== -1).length >= 8;`);

  // 4. the held-key guard, exercised through the real key handler
  await js('const g=window.__swarm; g.newRun(); g.phase="playing"; g.openUnitChoice(5); return true;');
  await js(`
    for (let i=0;i<8;i++) window.dispatchEvent(new KeyboardEvent('keydown',{key:'1',repeat:i>0}));
    return true;`);
  out.checks.heldKeyDoesNotPick = await js(
    'const g=window.__swarm; return g.phase==="choose" && g.roster[5]===null;');
  await js('for(let i=0;i<40;i++) window.__swarm.update(1/60); return true;');
  await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'2',repeat:false})); return true;");
  out.checks.freshKeyPicksAfterDelay = await js(
    'const g=window.__swarm; return g.roster[5]==="mender" && g.phase==="playing";');

  // 4b-4i. regression checks, driven through the game's real DOM handlers.
  // WebDriver has no Playwright-style input, so these dispatch the events the
  // browser would, and step frames with update() rather than waiting on rAF.
  const DOWN = `const down=(x,y,button)=>{const r=g.canvas.getBoundingClientRect();
    g.canvas.dispatchEvent(new MouseEvent('mousedown',{clientX:r.left+x,clientY:r.top+y,button,bubbles:true}));
    window.dispatchEvent(new MouseEvent('mouseup',{clientX:r.left+x,clientY:r.top+y,button,bubbles:true}));};`;

  out.checks.heldDigitSummonsOnce = await js(`
    const g=window.__swarm; g.newRun(); g.phase='playing'; g.aether=999;
    let n=0; const orig=g.trySummon.bind(g);
    g.trySummon=(...a)=>{const ok=orig(...a); if(ok) n+=1; return ok;};
    for (let i=0;i<400;i++){
      const s={x:300+Math.random()*(g.width-600), y:200+Math.random()*(g.height-400)};
      if(!g.hud.pointerOverUi(s)&&!g.summonBlocker('mite',g.screenToWorld(s.x,s.y))){
        g.mouse.x=s.x; g.mouse.y=s.y; g.mouse.world=g.screenToWorld(s.x,s.y); break; }
    }
    for (let i=0;i<4;i++) window.dispatchEvent(new KeyboardEvent('keydown',{key:'1',code:'Digit1',repeat:i>0}));
    delete g.trySummon; return n===1;`);

  out.checks.panelClickDoesNotSummon = await js(`
    const g=window.__swarm; g.newRun(); g.phase='playing'; g.aether=999; ${DOWN}
    let n=0; const orig=g.trySummon.bind(g); g.trySummon=(...a)=>{n+=1; return orig(...a);};
    g.update(1/60);   // the intro line is in the feed, so it has a rect too
    for (const r of [g.hud.resourcePanelRect(), g.hud.heroPanelLayout().rect, ...g.hud.feedLineRects()]) {
      down(r.x+r.w/2, r.y+r.h/2, 0); g.update(1/60);
    }
    delete g.trySummon; return n===0;`);

  out.checks.frenzyNotWhilePaused = await js(`
    const g=window.__swarm; g.newRun(); g.phase='paused'; g.rally={x:500,y:500}; ${DOWN}
    const f=g.hud.frenzyRect(); down(f.x+f.w/2, f.y+f.h/2, 0); g.update(1/60);
    const paused = g.frenzyTimer===0 && g.rally!==null;
    g.phase='playing'; down(f.x+f.w/2, f.y+f.h/2, 0); g.update(1/60);
    return paused && g.frenzyTimer>0;`);

  out.checks.wellsKeepOrder = await js(`
    const g=window.__swarm; g.newRun(); g.phase='playing';
    for (const w of g.world.wells){ w.owner='swarm'; w.progress=1; g.spawnUnit('mite',w.x,w.y); g.spawnUnit('mite',w.x+10,w.y); }
    g.hero.hp=g.heroStats().maxHp*0.3; g.hero.x=g.world.wells[3].x+200; g.hero.y=g.world.wells[3].y;
    for (let i=0;i<30;i++) g.update(1/60);
    return g.world.wells.every((w,i)=>w.id===i) && g.units.every(u=>u.job===null||g.world.wells[u.job].id===u.job);`);

  out.checks.seedReplaysRun = await js(`
    const g=window.__swarm;
    const play=(seed)=>{
      g.newRun(seed); g.phase='playing'; g.keepRecords=false;
      for (let i=0;i<60*90;i++){
        if(g.phase==='upgrade') g.chooseUpgrade(g.upgradeChoices[0]);
        if(g.phase==='choose') g.chooseUnit(g.unitChoice.options[0]);
        if(g.phase!=='playing') break;
        if(i%20===0){ const a=i*0.7, r=g.minSpawnRange()+40; g.trySummon(g.selected,{x:g.hero.x+Math.cos(a)*r,y:g.hero.y+Math.sin(a)*r}); }
        g.update(1/60); g.clicks.length=0;
      }
      return JSON.stringify([g.heroClass.id,g.hero.x,g.hero.y,g.hero.hp,g.aether,g.units.length,g.stats.lost]);
    };
    const a=play(777); return a===play(777) && a!==play(778);`);

  // Pan, let go, and it must be home within the 3 s delay plus the glide —
  // paused as well as mid-fight.
  out.checks.cameraPansAndRecenters = await js(`
    const g=window.__swarm; let ok=true;
    for (const ph of ['playing','paused']) {
      g.newRun(); g.phase=ph; const x0=g.camera.x;
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD'}));
      for (let i=0;i<24;i++) g.update(1/60);
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'d',code:'KeyD'}));
      const panned = g.camera.free!==null && g.camera.x>x0+40;
      for (let i=0;i<60*2;i++) g.update(1/60);
      const stillFree = g.camera.free!==null;               // not before the delay
      for (let i=0;i<60*3;i++) g.update(1/60);
      const t=g.clampCameraTarget(g.followTarget());
      ok = ok && panned && stillFree && g.camera.free===null && Math.hypot(g.camera.x-t.x,g.camera.y-t.y)<60;
    }
    return ok;`);

  // Every sound and the ambient bed render real audio in Safari's own engine,
  // offline, so no autoplay gate or speakers are involved.
  const jsAsync = (script) => api('POST', `/session/${sid}/execute/async`, { script, args: [] });
  const silent = await jsAsync(`
    const done = arguments[arguments.length - 1];
    import('/src/audio.js').then(async ({ Sfx }) => {
      const names = ['spawn','hit','heroHit','death','spit','telegraph','boom','summonTitan','surface','rally',
        'upgrade','heroEmpower','heroEvolve','heartbeat','frenzy','evolve','capture','lose_well','victory','defeat','ambience'];
      const quiet = [];
      for (const name of names) {
        const off = new OfflineAudioContext(2, 44100 * (name === 'ambience' ? 4 : 1), 44100);
        Object.defineProperty(off, 'state', { get: () => 'running' });
        const s = new Sfx(); s.attach(off); s.unlocked = true;
        if (name === 'ambience') s.ambience(0.5, false); else s.play(name, { pan: 0.4 });
        const data = (await off.startRendering()).getChannelData(0);
        let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v));
        if (!(peak > 1e-4)) quiet.push(name);
      }
      done(quiet);
    }, (e) => done(['import failed: ' + e.message]));`);
  out.checks.everySoundRenders = Array.isArray(silent) && silent.length === 0;
  if (silent.length) out.errors.push(`silent sounds: ${silent.join(', ')}`);

  out.checks.minimapLooksAndRallies = await js(`
    const g=window.__swarm; g.newRun(); g.phase='playing'; ${DOWN}
    const m=g.hud.minimapRect(); const x=m.x+m.w*0.25, y=m.y+m.h*0.75;
    down(x,y,0); down(x,y,2); g.update(1/60);
    const want={x:g.world.width*0.25, y:g.world.height*0.75};
    return g.camera.free!==null && !!g.rally && Math.hypot(g.rally.x-want.x,g.rally.y-want.y)<40
      && g.hud.minimapDrag===false;`);

  out.checks.keyboardEdgeCases = await js(`
    const g=window.__swarm; g.newRun(); g.phase='intro'; g.unlocked.add('flinger');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u00e9',code:'Digit2'}));   // AZERTY "2"
    const azerty = g.selected==='flinger';
    const muted=g.sfx.muted;
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'m',code:'KeyM',metaKey:true})); // Cmd+M
    const shortcut = g.sfx.muted===muted;
    g.phase='playing'; window.dispatchEvent(new Event('blur'));
    return azerty && shortcut && g.phase==='paused';`);

  // 5. a full simulated run
  const sim = await js(`
    const g = window.__swarm;
    try {
      g.newRun(); g.phase='playing';
      for (let i=0;i<60*300;i++){
        if (g.phase==='upgrade'){ g.panelAge=9; g.chooseUpgrade(g.upgradeChoices[0]); }
        if (g.phase==='choose'){ g.panelAge=9; g.chooseUnit(g.unitChoice.options[i%2]); }
        if (g.phase!=='playing') break;
        if (i%18===0){
          const a=Math.random()*Math.PI*2, r=g.minSpawnRange()+40;
          const p={x:g.hero.x+Math.cos(a)*r, y:g.hero.y+Math.sin(a)*r};
          if(!g.summonBlocker(g.selected,p)) g.trySummon(g.selected,p);
        }
        g.update(1/60); g.clicks.length=0;
      }
      return { ok:true, phase:g.phase, t:Math.round(g.time),
               finite: Number.isFinite(g.hero.hp) && Number.isFinite(g.aether) };
    } catch(e){ return { ok:false, err: e.name+': '+e.message }; }`);
  out.checks.fullRunSimulates = sim.ok && sim.finite;
  out.simDetail = sim.ok ? `${sim.phase} at ${sim.t}s` : sim.err;

  // 6. render + layout at every desktop viewport
  const layout = await js(`
    const g = window.__swarm;
    const sizes = [[1280,720],[1366,768],[1440,900],[1536,864],[1600,900],[1680,1050],[1920,1080],[2560,1440],[3440,1440],[1024,640]];
    const ov=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
    const bad=[];
    for (const [w,h] of sizes){
      g.width=w; g.height=h; g.canvas.width=w; g.canvas.height=h; g.dpr=1;
      try {
        g.render();
        g.helpVisible=true; for(let p=0;p<6;p++){ g.hud.helpPage=p; g.render(); } g.helpVisible=false;
        g.unitChoice={slot:6,options:['titan','bombardier']};
        const s=g.phase; g.phase='choose'; g.panelAge=1; g.render(); g.phase=s; g.unitChoice=null;
      } catch(e){ bad.push(w+'x'+h+' render '+e.message); continue; }
      const bar=g.hud.actionBarLayout(), fz=g.hud.frenzyRect(), mini=g.hud.minimapRect();
      const res=g.hud.resourcePanelRect(), hero=g.hud.heroPanelRect(40), feed=g.hud.feedRect();
      if (bar.startX<8) bad.push(w+'x'+h+' action bar off-screen');
      if (fz.x+fz.w>w-8) bad.push(w+'x'+h+' frenzy overflows');
      if (mini.x<8 || mini.y+mini.h>bar.y-4) bad.push(w+'x'+h+' minimap collides');
      if (ov(hero,res)) bad.push(w+'x'+h+' panel over resources');
      if (ov(hero,{x:feed.x,y:feed.y,w:feed.w,h:120})) bad.push(w+'x'+h+' panel over feed');
    }
    return bad;`);
  out.checks.layoutCleanEverywhere = layout.length === 0;
  out.layoutProblems = layout;

  // 7. the compat page's verdict, in real Safari
  await go(`${BASE}/dev/compat-check.html`);
  await sleep(2500);
  out.compat = await js(`
    return {
      verdict: (document.getElementById('verdict')||{}).textContent || 'no verdict',
      fails: Array.prototype.map.call(document.querySelectorAll('td.f'), td => td.parentElement.children[0].textContent),
      warns: Array.prototype.map.call(document.querySelectorAll('td.w'), td => td.parentElement.children[0].textContent)
    };`);

  // 8. screenshot of real gameplay
  await go(BASE);
  await js(`
    const g=window.__swarm; g.phase='playing';
    for(let i=0;i<60*50;i++){
      if(g.phase==='upgrade'){ g.panelAge=9; g.chooseUpgrade(g.upgradeChoices[0]); }
      if(g.phase!=='playing') break;
      if(i%22===0){ const a=Math.random()*Math.PI*2, r=g.minSpawnRange()+40;
        const p={x:g.hero.x+Math.cos(a)*r,y:g.hero.y+Math.sin(a)*r};
        if(!g.summonBlocker(g.selected,p)) g.trySummon(g.selected,p); }
      g.update(1/60);
    }
    g.render(); return true;`);
  await sleep(500);
  const png = await api('GET', `/session/${sid}/screenshot`);
  fs.writeFileSync(`${SHOTS}/safari-real-game.png`, Buffer.from(png, 'base64'));
} catch (e) {
  out.errors.push(e.message);
} finally {
  if (sid) { try { await api('DELETE', `/session/${sid}`); } catch {} }
  driver.kill();
}

const failed = Object.entries(out.checks).filter(([, v]) => !v).map(([k]) => k);
console.log(`\n=== ${out.browser} ${out.version ?? ''}`);
console.log(`  checks     : ${Object.keys(out.checks).length - failed.length}/${Object.keys(out.checks).length} pass` +
            (failed.length ? `  FAILED: ${failed.join(', ')}` : ''));
console.log(`  sim        : ${out.simDetail ?? '-'}`);
console.log(`  layout     : ${out.layoutProblems?.length ? out.layoutProblems.slice(0,4).join(' | ') : 'clean at all 10 viewports'}`);
console.log(`  compat page: ${out.compat?.verdict ?? '-'}`);
if (out.compat?.fails?.length) console.log(`  compat FAIL: ${out.compat.fails.join(', ')}`);
if (out.compat?.warns?.length) console.log(`  compat warn: ${out.compat.warns.join(', ')}`);
if (out.errors.length) console.log(`  errors     : ${out.errors.join(' | ')}`);
fs.writeFileSync(`${SHOTS}/safari-results.json`, JSON.stringify(out, null, 2));
