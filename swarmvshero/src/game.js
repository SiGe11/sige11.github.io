// Core simulation and render orchestration.
//
// The player is the swarm mind: you place summoning rifts, hold aether wells
// and time an alpha strike. The hero is a single evolving AI that grows
// stronger from every unit it kills, so feeding it chaff is how you lose.

import {
  CONFIG, PALETTE, UNITS, UNIT_ORDER, DEBUFF_CAPS,
  HERO_STAGES, HERO_ABILITIES, HERO_CLASSES, HERO_RELICS,
  SWARM_UPGRADES, baseModifiers, baseHeroMods,
} from './config.js';
import {
  clamp, lerp, rand, pick, chance, dist, dist2, angleTo,
  approachAngle, damp, smoothstep,
} from './math.js';
import { World } from './world.js';
import { Fx, randomIchor } from './fx.js';
import {
  drawGround, drawArenaBorder, drawWell, drawTerrain, drawTerrainShadow,
  drawUnit, drawHero, drawRift, drawTelegraph, drawRally, drawProjectile,
  drawRelic,
} from './art.js';
import { Hud } from './hud.js';

const TAU = Math.PI * 2;

export class Game {
  constructor(canvas, sfx) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('2D canvas context is required');
    this.sfx = sfx;
    this.fx = new Fx();
    this.hud = new Hud(this);

    this.width = 1280;
    this.height = 720;
    this.dpr = 1;

    this.camera = { x: 0, y: 0, zoom: CONFIG.zoomDefault };
    this.mouse = { x: 0, y: 0, world: { x: 0, y: 0 }, down: false };
    this.clicks = [];
    this.rightClicks = [];

    this.helpVisible = false;
    this.lastTime = performance.now();

    this.resize();
    this.newRun();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  // -------------------------------------------------------------- run setup

  newRun() {
    this.world = new World();
    this.groundPattern = this.ctx.createPattern(this.world.groundTile, 'repeat');
    this.fx.clear();

    this.phase = 'intro';
    this.time = 0;
    this.nextId = 1;

    this.units = [];
    this.projectiles = [];
    this.rifts = [];
    this.relics = [];
    this.telegraph = null;

    this.aether = CONFIG.startAether;
    this.earned = 0;
    this.nextUpgradeAt = CONFIG.aetherPerUpgrade;
    this.mods = baseModifiers();
    this.upgradeChoices = [];
    this.takenUpgrades = [];

    this.selected = 'swarmling';
    this.unlocked = new Set(['swarmling']);
    this.titanCooldown = 0;

    this.rally = null;
    this.frenzyTimer = 0;
    this.frenzyCooldown = 0;

    this.threat = 1;
    this.feed = [];
    this.stats = { spawned: 0, lost: 0, damageDealt: 0, wellsHeld: 0 };

    this.heroClass = pick(HERO_CLASSES);
    this.heroMods = baseHeroMods();
    this.applyHeroMods(this.heroClass.mods);
    this.heroRelics = [];

    const stats0 = this.heroStats(0);
    this.hero = {
      x: this.world.width * 0.5,
      y: this.world.height * 0.5,
      vx: 0, vy: 0,
      facing: 0,
      gait: 0,
      swing: 0,
      hitFlash: 0,
      speedFraction: 0,
      hp: stats0.maxHp,
      stage: 0,
      xp: 0,
      attackTimer: 0,
      abilityTimer: 6,
      poison: 0,
      wanderTarget: null,
      wanderTimer: 0,
      action: null,
      state: 'hunt',
    };

    this.ascension = 0;
    this.heroDamageAccum = 0;
    this.heroDamageTimer = 0;
    this.endReason = '';
    this.camera.x = this.hero.x;
    this.camera.y = this.hero.y;
    this.camera.zoom = CONFIG.zoomDefault;

    this.log(`Champion: ${this.heroClass.name} — ${this.heroClass.blurb}`, PALETTE.hero);
  }

  log(text, color = PALETTE.ui) {
    this.feed.unshift({ text, color, life: 7 });
    if (this.feed.length > 6) this.feed.length = 6;
  }

  // ------------------------------------------------------------------ input

  resize() {
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.width = Math.max(640, window.innerWidth);
    this.height = Math.max(420, window.innerHeight);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.height / 2) / this.camera.zoom + this.camera.y,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }

  bindInput() {
    const canvas = this.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.world = this.screenToWorld(this.mouse.x, this.mouse.y);
    });

    canvas.addEventListener('mousedown', (e) => {
      this.sfx.unlock();
      const r = canvas.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.world = this.screenToWorld(p.x, p.y);
      if (e.button === 0) {
        this.mouse.down = true;
        this.clicks.push({ ...p });
      } else if (e.button === 2) {
        e.preventDefault();
        this.rightClicks.push({ ...p });
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY > 0 ? 0.9 : 1.1;
      this.camera.zoom = clamp(this.camera.zoom * step, CONFIG.zoomMin, CONFIG.zoomMax);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      const key = e.key.toLowerCase();

      if (key >= '1' && key <= '5') {
        const id = UNIT_ORDER[Number(key) - 1];
        if (id && this.unlocked.has(id)) {
          this.selected = id;
          if (this.phase === 'playing' && !this.helpVisible) this.trySummonAtCursor();
        }
        return;
      }

      switch (key) {
        case ' ':
          e.preventDefault();
          if (this.phase === 'playing') this.tryFrenzy();
          break;
        case 'q':
          if (this.rally) {
            this.rally = null;
            this.log('Rally beacon cleared', PALETTE.swarmGlow);
          }
          break;
        case 'h':
        case '?':
        case 'f1':
          this.helpVisible = !this.helpVisible;
          break;
        case 'm':
          this.sfx.setMuted(!this.sfx.muted);
          this.log(this.sfx.muted ? 'Sound off' : 'Sound on', PALETTE.uiDim);
          break;
        case 'escape':
          if (this.helpVisible) { this.helpVisible = false; break; }
          if (this.phase === 'playing') this.phase = 'paused';
          else if (this.phase === 'paused') this.phase = 'playing';
          break;
        case 'r':
        case 'enter':
          if (this.phase === 'victory' || this.phase === 'defeat') this.newRun();
          else if (this.phase === 'intro' && !this.helpVisible) this.phase = 'playing';
          break;
        default:
          break;
      }
    });
  }

  // ------------------------------------------------------------------- loop

  start() {
    const frame = (now) => {
      const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
      this.lastTime = now;
      this.update(dt);
      this.render();
      this.clicks.length = 0;
      this.rightClicks.length = 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    this.mouse.world = this.screenToWorld(this.mouse.x, this.mouse.y);
    this.fx.update(dt);

    for (const entry of this.feed) entry.life -= dt;
    if (this.feed.some((f) => f.life <= 0)) this.feed = this.feed.filter((f) => f.life > 0);

    if (this.phase === 'intro') {
      // No timeout: the run starts when the player says so.
      if (this.helpVisible) this.hud.handleHudClicks();
      else this.hud.handleIntroClicks();
      this.updateCamera(dt);
      return;
    }

    if (this.helpVisible && this.phase !== 'playing') {
      this.hud.handleHudClicks();
      this.updateCamera(dt);
      return;
    }

    if (this.phase === 'upgrade') {
      this.hud.handleUpgradeClicks();
      this.updateCamera(dt);
      return;
    }

    if (this.phase === 'victory' || this.phase === 'defeat') {
      this.hud.handleEndClicks();
      this.updateCamera(dt);
      return;
    }

    if (this.phase === 'paused' || this.helpVisible) {
      this.hud.handleHudClicks();
      this.updateCamera(dt);
      return;
    }

    // Clicks on HUD widgets are consumed before they can place a rift.
    this.hud.handleHudClicks();
    this.handleWorldClicks();

    this.time += dt;
    this.threat = 1 + (this.time / 60) * CONFIG.threatRampPerMinute;

    this.updateUnlocks();
    this.updateEconomy(dt);
    this.updateWells(dt);
    this.updateRifts(dt);
    this.updateUnits(dt);
    this.updateHero(dt);
    this.updateProjectiles(dt);
    this.updateRelics(dt);
    this.updateProgression(dt);
    this.updateCamera(dt);

    this.heroDamageTimer -= dt;
    if (this.heroDamageTimer <= 0) {
      if (this.heroDamageAccum >= 1) {
        this.fx.text(this.hero.x + rand(-12, 12), this.hero.y - this.heroStats().radius - 14,
          Math.round(this.heroDamageAccum), '#ff9db4', { size: 17 });
      }
      this.heroDamageAccum = 0;
      this.heroDamageTimer = 0.32;
    }

    this.frenzyTimer = Math.max(0, this.frenzyTimer - dt);
    this.frenzyCooldown = Math.max(0, this.frenzyCooldown - dt);
    this.titanCooldown = Math.max(0, this.titanCooldown - dt);
  }

  // -------------------------------------------------------------- economy

  updateUnlocks() {
    for (const id of UNIT_ORDER) {
      if (this.unlocked.has(id)) continue;
      if (this.time >= UNITS[id].unlockAt) {
        this.unlocked.add(id);
        this.log(`${UNITS[id].name} available — ${UNITS[id].role}`, PALETTE.good);
        this.sfx.play('upgrade');
      }
    }
  }

  heldWells() {
    return this.world.wells.filter((w) => w.owner === 'swarm').length;
  }

  incomePerSecond() {
    const wells = this.heldWells();
    return CONFIG.baseIncome
      + this.mods.incomeBonus
      + wells * (CONFIG.incomePerWell + this.mods.wellIncomeBonus);
  }

  updateEconomy(dt) {
    this.gain(this.incomePerSecond() * dt);
  }

  gain(amount) {
    this.aether += amount;
    this.earned += amount;
  }

  unitCost(id) {
    return Math.ceil(UNITS[id].cost * this.mods.costMult);
  }

  // --------------------------------------------------------------- summoning

  minSpawnRange() {
    return Math.max(90, CONFIG.minSpawnDistanceFromHero - this.mods.spawnRangeBonus);
  }

  /** Why a summon at `p` would fail, or null if it is legal. */
  summonBlocker(id, p) {
    if (!this.unlocked.has(id)) return 'Locked';
    if (this.units.length >= CONFIG.maxUnits) return 'Swarm at capacity';
    if (this.aether < this.unitCost(id)) return 'Not enough Aether';
    if (id === 'titan' && this.titanCooldown > 0) return `Titan ready in ${Math.ceil(this.titanCooldown)}s`;
    if (!this.world.inArena(p, UNITS[id].radius + 8)) return 'Outside the arena';
    if (dist(p, this.hero) < this.minSpawnRange()) return 'Too close to the champion';
    if (this.world.blocked(p, UNITS[id].radius + 4)) return 'Blocked by terrain';
    return null;
  }

  trySummonAtCursor() {
    this.trySummon(this.selected, this.mouse.world);
  }

  trySummon(id, p) {
    const blocker = this.summonBlocker(id, p);
    if (blocker) {
      this.fx.text(p.x, p.y - 12, blocker, PALETTE.danger, { life: 0.8, size: 13 });
      return false;
    }

    const def = UNITS[id];
    this.aether -= this.unitCost(id);
    if (id === 'titan') this.titanCooldown = def.summonCooldown;

    this.rifts.push({
      id: this.nextId++,
      x: p.x,
      y: p.y,
      radius: def.radius * 1.8,
      age: 0,
      duration: CONFIG.riftOpenTime * 2,
      seed: rand(0, 10),
      spawnAt: CONFIG.riftOpenTime,
      spawned: false,
      unitType: id,
    });

    this.fx.ring(p.x, p.y, def.radius * 4, 'rgba(200,110,255,0.8)', { life: 0.45 });
    this.fx.burst(p.x, p.y, PALETTE.swarmGlow, 14, 130);
    this.sfx.play(id === 'titan' ? 'summonTitan' : 'spawn');
    if (id === 'titan') {
      this.fx.addShake(0.7);
      this.log('A Titan tears through', '#ff8fb0');
    }
    return true;
  }

  updateRifts(dt) {
    for (const rift of this.rifts) {
      rift.age += dt;
      if (!rift.spawned && rift.age >= rift.spawnAt) {
        rift.spawned = true;
        this.spawnUnit(rift.unitType, rift.x, rift.y);
      }
      if (chance(dt * 14)) {
        const a = rand(0, TAU);
        this.fx.particle({
          x: rift.x + Math.cos(a) * rift.radius * 0.8,
          y: rift.y + Math.sin(a) * rift.radius * 0.35,
          vx: Math.cos(a) * 20,
          vy: -rand(20, 70),
          life: rand(0.3, 0.7),
          size: rand(1.5, 3.4),
          color: PALETTE.swarmGlow,
        });
      }
    }
    this.rifts = this.rifts.filter((r) => r.age < r.duration);
  }

  spawnUnit(id, x, y) {
    const def = UNITS[id];
    const hp = def.maxHp * this.mods.hpMult;
    const unit = {
      id: this.nextId++,
      type: id,
      x, y,
      vx: 0, vy: 0,
      facing: angleTo({ x, y }, this.hero),
      hp,
      maxHp: hp,
      attackTimer: rand(0, def.attackCooldown),
      seed: rand(0, 100),
      gait: rand(0, TAU),
      hitFlash: 0,
      invuln: CONFIG.spawnInvulnTime + this.mods.spawnInvulnBonus,
      spawnScale: 0,
      job: null,
    };
    this.world.resolveCollision(unit, def.radius);

    // Summoning inside a well commits that unit to holding it. This is the
    // only way to take map control, so placement is a real decision.
    const well = this.world.wellAt(unit, -8);
    if (well) unit.job = well.id;
    else unit.job = null;

    this.units.push(unit);
    this.stats.spawned += 1;
  }

  // ------------------------------------------------------------------- wells

  updateWells(dt) {
    let held = 0;
    for (const well of this.world.wells) {
      const heroInside = dist(this.hero, well) < well.radius;
      let swarmCount = 0;
      for (const u of this.units) {
        if (dist2(u, well) < well.radius * well.radius) swarmCount += 1;
      }
      well.contested = swarmCount > 0 && heroInside;

      if (heroInside) {
        // The hero purges corruption fast; nothing captures while it stands here.
        const purgeRate = swarmCount >= CONFIG.wellUnitsToCapture ? 0.35 : 0.85;
        well.progress = Math.max(0, well.progress - dt * purgeRate);
        if (well.owner === 'swarm' && well.progress <= 0) {
          well.owner = 'neutral';
          this.hero.xp += CONFIG.heroXpPerWellPurge;
          this.log('The champion purged a well', PALETTE.danger);
          this.sfx.play('lose_well');
          this.fx.ring(well.x, well.y, well.radius * 1.4, 'rgba(255,210,140,0.9)', { life: 0.7 });
        }
      } else if (swarmCount >= CONFIG.wellUnitsToCapture) {
        const speed = 1 + (swarmCount - CONFIG.wellUnitsToCapture) * 0.16;
        well.progress = Math.min(1, well.progress + (dt / CONFIG.wellCaptureTime) * speed);
        if (well.progress >= 1 && well.owner !== 'swarm') {
          well.owner = 'swarm';
          this.log('Well corrupted — Aether income up', PALETTE.good);
          this.sfx.play('capture');
          this.fx.ring(well.x, well.y, well.radius * 1.6, 'rgba(200,120,255,0.9)', { life: 0.8, fill: true });
          this.fx.burst(well.x, well.y, PALETTE.swarmGlow, 26, 150);
        }
      } else if (well.owner !== 'swarm') {
        well.progress = Math.max(0, well.progress - dt * 0.25);
      }

      if (well.owner === 'swarm') {
        held += 1;
        // Corruption motes rising from held wells.
        if (chance(dt * 6)) {
          const a = rand(0, TAU);
          const r = rand(0, well.radius * 0.8);
          this.fx.particle({
            x: well.x + Math.cos(a) * r,
            y: well.y + Math.sin(a) * r,
            vx: rand(-6, 6),
            vy: -rand(18, 44),
            life: rand(0.7, 1.4),
            size: rand(1.4, 3),
            color: PALETTE.swarmGlow,
            drag: 0.99,
          });
        }
        if (this.mods.wellHeal) {
          for (const u of this.units) {
            if (dist2(u, well) < well.radius * well.radius) {
              u.hp = Math.min(u.maxHp, u.hp + dt * 8);
            }
          }
        }
      }
    }
    this.stats.wellsHeld = held;
  }

  // ------------------------------------------------------------------- units

  /** Swarm Link: damage scales with how many allies are packed nearby. */
  linkBonus(unit) {
    if (this.mods.linkBonus <= 0) return 1;
    let n = 0;
    for (const other of this.units) {
      if (other === unit) continue;
      if (dist2(other, unit) < 90 * 90) {
        n += 1;
        if (n >= 6) break;
      }
    }
    return 1 + n * this.mods.linkBonus;
  }

  separation(unit, def) {
    let sx = 0;
    let sy = 0;
    const reach = def.radius * 2.4;
    const reach2 = reach * reach;
    for (const other of this.units) {
      if (other === unit) continue;
      const dx = unit.x - other.x;
      const dy = unit.y - other.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1e-4 && d2 < reach2) {
        const inv = 1 / Math.sqrt(d2);
        const push = (1 - Math.sqrt(d2) / reach) * 1.4;
        sx += dx * inv * push;
        sy += dy * inv * push;
      }
    }
    return { x: sx, y: sy };
  }

  /** Steering away from an active telegraph, if the player took Dispersal. */
  dodgeVector(unit) {
    if (!this.mods.dodgeTelegraphs || !this.telegraph) return null;
    const tel = this.telegraph;
    if (tel.shape === 'line') return null;
    const d = dist(unit, tel);
    if (d > tel.radius * 1.35 || d < 1e-3) return null;
    return { x: (unit.x - tel.x) / d, y: (unit.y - tel.y) / d };
  }

  updateUnits(dt) {
    const heroStats = this.heroStats();
    const frenzied = this.frenzyTimer > 0;
    const speedMult = this.mods.speedMult * (frenzied ? CONFIG.frenzySpeedMult : 1);
    const dmgMult = this.mods.damageMult * (frenzied ? CONFIG.frenzyDamageMult : 1);

    for (const unit of this.units) {
      const def = UNITS[unit.type];
      unit.attackTimer -= dt;
      unit.hitFlash = Math.max(0, unit.hitFlash - dt);
      unit.invuln = Math.max(0, unit.invuln - dt);
      unit.spawnScale = Math.min(1, unit.spawnScale + dt * 4);

      const toHero = dist(unit, this.hero);

      // Decide where this unit wants to be. Priority: defend a well it was
      // assigned to, then a rally beacon, then hunt the hero.
      let target = this.hero;
      let holding = false;
      const guarded = unit.job !== null ? this.world.wells[unit.job] : null;

      if (guarded && toHero > CONFIG.rallyAggroRadius) {
        target = guarded;
        holding = dist(unit, guarded) < guarded.radius * 0.6;
      } else if (this.rally && toHero > CONFIG.rallyAggroRadius) {
        target = this.rally;
        holding = dist(unit, this.rally) < 60;
      }

      const desired = { x: 0, y: 0 };
      const dodge = this.dodgeVector(unit);

      if (dodge) {
        desired.x += dodge.x * 2.2;
        desired.y += dodge.y * 2.2;
      } else if (def.behavior === 'ranged' && toHero < def.kiteRange && !holding) {
        // Spitters back away to keep their range advantage.
        desired.x += (unit.x - this.hero.x) / Math.max(1, toHero) * 1.4;
        desired.y += (unit.y - this.hero.y) / Math.max(1, toHero) * 1.4;
      } else if (def.behavior === 'support' && toHero < def.auraRadius * 0.65 && !holding) {
        desired.x += (unit.x - this.hero.x) / Math.max(1, toHero);
        desired.y += (unit.y - this.hero.y) / Math.max(1, toHero);
      } else if (!holding) {
        const d = Math.max(1, dist(unit, target));
        const stopAt = target === this.hero
          ? (def.behavior === 'melee' ? def.attackRange * 0.75 : def.attackRange * 0.85)
          : guarded && target === guarded ? guarded.radius * 0.55 : 34;
        if (d > stopAt) {
          desired.x += (target.x - unit.x) / d;
          desired.y += (target.y - unit.y) / d;
        }
      }

      const sep = this.separation(unit, def);
      desired.x += sep.x * 0.9;
      desired.y += sep.y * 0.9;

      const avoid = this.world.avoidance(unit, def.radius + 16);
      desired.x += avoid.x;
      desired.y += avoid.y;

      // A little wander keeps the crowd from marching in lockstep.
      desired.x += Math.cos(this.time * 1.7 + unit.seed) * 0.12;
      desired.y += Math.sin(this.time * 1.5 + unit.seed) * 0.12;

      const len = Math.hypot(desired.x, desired.y);
      const speed = def.speed * speedMult * (unit.invuln > 0 ? 1.35 : 1);
      if (len > 1e-3) {
        const nx = desired.x / len;
        const ny = desired.y / len;
        unit.vx = damp(unit.vx, nx * speed, 9, dt);
        unit.vy = damp(unit.vy, ny * speed, 9, dt);
      } else {
        unit.vx = damp(unit.vx, 0, 9, dt);
        unit.vy = damp(unit.vy, 0, 9, dt);
      }

      const stepX = unit.vx * dt;
      const stepY = unit.vy * dt;
      const next = { x: unit.x + stepX, y: unit.y + stepY };
      if (this.world.blocked(next, def.radius)) {
        // Slide along the obstacle instead of grinding into it.
        const slideA = { x: unit.x + stepY, y: unit.y - stepX };
        const slideB = { x: unit.x - stepY, y: unit.y + stepX };
        if (!this.world.blocked(slideA, def.radius)) { unit.x = slideA.x; unit.y = slideA.y; }
        else if (!this.world.blocked(slideB, def.radius)) { unit.x = slideB.x; unit.y = slideB.y; }
      } else {
        unit.x = next.x;
        unit.y = next.y;
      }

      this.world.clampToArena(unit, def.radius);
      this.world.resolveCollision(unit, def.radius);

      const moveSpeed = Math.hypot(unit.vx, unit.vy);
      unit.gait += dt * (4 + moveSpeed * 0.06);
      if (moveSpeed > 12) {
        unit.facing = approachAngle(unit.facing, Math.atan2(unit.vy, unit.vx), dt * 9);
      } else if (toHero < 320) {
        unit.facing = approachAngle(unit.facing, angleTo(unit, this.hero), dt * 6);
      }
      if (moveSpeed > 90 && chance(dt * 6) && !def.hover) {
        this.fx.dust(unit.x, unit.y + def.radius * 0.4);
      }

      // Attacking.
      if (def.behavior === 'support') {
        if (unit.attackTimer <= 0 && toHero < def.auraRadius) {
          unit.attackTimer = def.attackCooldown;
          this.fx.ring(unit.x, unit.y, def.auraRadius, 'rgba(120,225,255,0.5)', { life: 0.6, width: 2 });
          this.damageHero(def.damage * dmgMult * this.linkBonus(unit), unit, { silent: true });
        }
        continue;
      }

      if (toHero <= def.attackRange + heroStats.radius && unit.attackTimer <= 0) {
        unit.attackTimer = def.attackCooldown;
        const damage = def.damage * dmgMult * this.linkBonus(unit);

        if (def.behavior === 'melee') {
          this.damageHero(damage, unit);
          this.fx.slash(
            unit.x + Math.cos(unit.facing) * def.radius,
            unit.y + Math.sin(unit.facing) * def.radius,
            unit.facing, def.radius * 1.6, PALETTE.swarmGlow, { arc: 2.0, width: 5 },
          );
        } else if (!this.world.lineBlocked(unit, this.hero, 6)) {
          const a = angleTo(unit, this.hero);
          this.projectiles.push({
            id: this.nextId++,
            team: 'swarm',
            x: unit.x + Math.cos(a) * def.radius,
            y: unit.y + Math.sin(a) * def.radius,
            vx: Math.cos(a) * def.projectileSpeed,
            vy: Math.sin(a) * def.projectileSpeed,
            radius: 5,
            damage,
            life: 1.8,
            color: '#c6ff8a',
            trail: [],
          });
          this.sfx.play('spit');
        } else {
          unit.attackTimer = def.attackCooldown * 0.4;
        }
      }
    }

    // Hero body crushes anything it walks over.
    for (const unit of this.units) {
      if (unit.invuln > 0) continue;
      const def = UNITS[unit.type];
      if (dist(unit, this.hero) < heroStats.radius + def.radius * 0.6) {
        this.damageUnit(unit, 26 * dt * this.threat, { source: 'contact' });
      }
    }

    this.reapUnits();
  }

  reapUnits() {
    if (!this.units.some((u) => u.hp <= 0)) return;
    const survivors = [];
    for (const unit of this.units) {
      if (unit.hp > 0) { survivors.push(unit); continue; }
      this.killUnit(unit);
    }
    this.units = survivors;
  }

  killUnit(unit) {
    const def = UNITS[unit.type];
    this.stats.lost += 1;

    // Every death feeds the hero. This is the core difficulty loop.
    this.hero.xp += def.xpValue * CONFIG.heroXpPerUnitKill;

    this.fx.burst(unit.x, unit.y, '#a63fd6', 14 + def.radius, 120 + def.radius * 4, { gravity: 120 });
    this.fx.decal(unit.x, unit.y + def.radius * 0.3, randomIchor(), def.radius * 1.5);
    this.sfx.play('death');

    if (this.mods.deathBurst > 0 && dist(unit, this.hero) < 78) {
      this.damageHero(this.mods.deathBurst, unit, { silent: true });
      this.fx.ring(unit.x, unit.y, 78, 'rgba(190,90,255,0.8)', { life: 0.35, fill: true });
    }

    if (chance(0.07)) this.spawnRelic(unit.x, unit.y);
  }

  damageUnit(unit, amount, opts = {}) {
    if (unit.invuln > 0 || unit.hp <= 0) return;
    const def = UNITS[unit.type];
    let dmg = amount;
    if (opts.source === 'ability') {
      const resist = clamp((def.aoeResist ?? 0) + this.mods.aoeResist, 0, 0.85);
      dmg *= 1 - resist;
    }
    unit.hp -= dmg;
    unit.hitFlash = 0.14;
    if (!opts.silent) {
      // Only chunky hits get a number; chip damage would drown the screen.
      if (dmg >= unit.maxHp * 0.3) {
        this.fx.text(unit.x, unit.y - def.radius - 6, Math.round(dmg), '#ffd9a0', { size: 13 });
      }
      this.fx.hit(unit.x, unit.y, '#ffcf8a', 6, 110);
    }
  }

  // -------------------------------------------------------------------- hero

  applyHeroMods(mods) {
    for (const key of ['hpMult', 'damageMult', 'moveSpeedMult', 'attackCooldownMult', 'abilityCooldownMult', 'aoeRadiusMult']) {
      if (mods[key] !== undefined) this.heroMods[key] *= mods[key];
    }
    if (mods.attackRangeBonus !== undefined) this.heroMods.attackRangeBonus += mods.attackRangeBonus;
  }

  /** Aggregate slow/mark applied by Shriekers in range, capped. */
  heroDebuffs() {
    let shriekers = 0;
    const def = UNITS.shrieker;
    for (const u of this.units) {
      if (u.type !== 'shrieker') continue;
      if (dist2(u, this.hero) < def.auraRadius * def.auraRadius) shriekers += 1;
    }
    return {
      slow: Math.min(DEBUFF_CAPS.slow, shriekers * def.slowAmount),
      mark: Math.min(DEBUFF_CAPS.mark, shriekers * def.markAmount),
      shriekers,
    };
  }

  heroStats(stageOverride) {
    const stage = stageOverride ?? this.hero.stage;
    const base = HERO_STAGES[stage];
    const t = this.threat;
    return {
      name: base.name,
      radius: base.radius,
      ability: base.ability,
      maxHp: Math.round(base.maxHp * this.heroMods.hpMult * (1 + (t - 1) * 0.5)),
      moveSpeed: base.moveSpeed * this.heroMods.moveSpeedMult * (1 + (t - 1) * 0.25),
      damage: base.damage * this.heroMods.damageMult * (1 + (t - 1) * 0.4),
      attackRange: base.attackRange + this.heroMods.attackRangeBonus,
      attackCooldown: base.attackCooldown * this.heroMods.attackCooldownMult,
    };
  }

  nearestUnit(from, filter) {
    let best = null;
    let bestD = Infinity;
    for (const u of this.units) {
      if (filter && !filter(u)) continue;
      const d = dist2(from, u);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  updateHero(dt) {
    const hero = this.hero;
    const stats = this.heroStats();
    const debuffs = this.heroDebuffs();
    const ranged = this.heroClass.attackStyle === 'ranged';

    hero.attackTimer -= dt;
    hero.abilityTimer -= dt;
    hero.hitFlash = Math.max(0, hero.hitFlash - dt);
    hero.swing = Math.max(0, hero.swing - dt * 4);

    // Poison ticks regardless of what the hero is doing.
    if (hero.poison > 0) {
      const tick = hero.poison * 0.55 * dt;
      hero.hp -= tick;
      hero.poison = Math.max(0, hero.poison - dt * 0.9);
      if (chance(dt * 8)) {
        this.fx.particle({
          x: hero.x + rand(-10, 10),
          y: hero.y + rand(-10, 10),
          vx: rand(-8, 8), vy: -rand(10, 30),
          life: 0.6, size: 2.4, color: '#9dff7a',
        });
      }
      if (hero.hp <= 0) { this.onHeroDown(); return; }
    }

    // Active ability takes over movement while it runs.
    if (hero.action) {
      this.updateHeroAction(dt, stats);
      return;
    }

    const maxHp = stats.maxHp;
    const target = this.nearestUnit(hero, (u) => u.invuln <= 0) ?? this.nearestUnit(hero);
    const hurt = hero.hp < maxHp * CONFIG.heroRetreatHpFraction;

    // Pick a state.
    let refuge = null;
    if (hurt) {
      refuge = this.world.wells
        .filter((w) => w.owner !== 'swarm')
        .sort((a, b) => dist2(hero, a) - dist2(hero, b))[0] ?? null;
    }
    // If the swarm holds every well, the hero comes to break one instead.
    if (hurt && !refuge) {
      refuge = this.world.wells.sort((a, b) => dist2(hero, a) - dist2(hero, b))[0] ?? null;
    }
    hero.state = hurt && refuge ? 'retreat' : target ? 'hunt' : 'patrol';

    const move = { x: 0, y: 0 };
    let kiting = false;
    const range = stats.attackRange + (target ? UNITS[target.type].radius : 0);
    const toTarget = target ? dist(hero, target) : Infinity;

    if (hero.state === 'retreat' && refuge) {
      const d = Math.max(1, dist(hero, refuge));
      if (d > refuge.radius * 0.4) {
        move.x += (refuge.x - hero.x) / d * 1.5;
        move.y += (refuge.y - hero.y) / d * 1.5;
      }
      // Shove away from the swarm while running.
      if (target && toTarget < 180) {
        const d2 = Math.max(1, toTarget);
        move.x += (hero.x - target.x) / d2 * 1.1;
        move.y += (hero.y - target.y) / d2 * 1.1;
      }
    } else if (hero.state === 'hunt' && target) {
      if (ranged && this.heroClass.kites && toTarget < range * 0.45) {
        // Backpedalling is deliberately slower than advancing, so a committed
        // melee push can still close the gap.
        kiting = true;
        const d = Math.max(1, toTarget);
        move.x += (hero.x - target.x) / d * 1.3;
        move.y += (hero.y - target.y) / d * 1.3;
      } else if (toTarget > range * 0.85) {
        const d = Math.max(1, toTarget);
        move.x += (target.x - hero.x) / d * 1.3;
        move.y += (target.y - hero.y) / d * 1.3;
      } else {
        // Strafe around the target while in range.
        const a = angleTo(hero, target) + Math.PI / 2;
        move.x += Math.cos(a) * 0.5;
        move.y += Math.sin(a) * 0.5;
      }
    } else {
      hero.wanderTimer -= dt;
      if (!hero.wanderTarget || hero.wanderTimer <= 0 || dist(hero, hero.wanderTarget) < 60) {
        // Patrol toward wells the swarm has taken, so idling is never safe.
        const corrupted = this.world.wells.filter((w) => w.owner === 'swarm');
        const goal = corrupted.length ? pick(corrupted) : pick(this.world.wells);
        hero.wanderTarget = { x: goal.x + rand(-80, 80), y: goal.y + rand(-80, 80) };
        hero.wanderTimer = rand(4, 8);
      }
      const d = Math.max(1, dist(hero, hero.wanderTarget));
      move.x += (hero.wanderTarget.x - hero.x) / d;
      move.y += (hero.wanderTarget.y - hero.y) / d;
    }

    const avoid = this.world.avoidance(hero, stats.radius + 22);
    move.x += avoid.x * 1.3;
    move.y += avoid.y * 1.3;

    const speed = stats.moveSpeed * (1 - debuffs.slow) * (kiting ? 0.72 : 1);
    const len = Math.hypot(move.x, move.y);
    if (len > 1e-3) {
      hero.vx = damp(hero.vx, (move.x / len) * speed, 7, dt);
      hero.vy = damp(hero.vy, (move.y / len) * speed, 7, dt);
    } else {
      hero.vx = damp(hero.vx, 0, 7, dt);
      hero.vy = damp(hero.vy, 0, 7, dt);
    }

    this.moveHero(dt, stats);

    // Healing at a well it controls.
    const well = this.world.wellAt(hero, -10);
    const contested = well && this.units.some((u) => dist2(u, well) < well.radius * well.radius);
    if (well && well.owner !== 'swarm' && !contested && hero.hp < maxHp) {
      hero.hp = Math.min(maxHp, hero.hp + maxHp * CONFIG.heroWellHealFraction * dt);
      if (chance(dt * 10)) {
        this.fx.particle({
          x: hero.x + rand(-14, 14), y: hero.y + rand(-6, 14),
          vx: 0, vy: -rand(20, 50), life: 0.7, size: 2.6, color: '#ffe9a8',
        });
      }
    }

    // Basic attack.
    if (target && toTarget <= range && hero.attackTimer <= 0) {
      hero.attackTimer = stats.attackCooldown;
      hero.swing = 1;
      hero.facing = angleTo(hero, target);
      if (ranged) {
        if (!this.world.lineBlocked(hero, target, 6)) {
          const a = angleTo(hero, target);
          this.projectiles.push({
            id: this.nextId++,
            team: 'hero',
            x: hero.x + Math.cos(a) * stats.radius,
            y: hero.y + Math.sin(a) * stats.radius,
            vx: Math.cos(a) * (this.heroClass.projectileSpeed ?? 380),
            vy: Math.sin(a) * (this.heroClass.projectileSpeed ?? 380),
            radius: 6,
            damage: stats.damage,
            life: 1.6,
            color: '#ffe9a8',
            trail: [],
          });
        } else {
          hero.attackTimer = stats.attackCooldown * 0.35;
        }
      } else {
        // A sword sweep cleaves everything in front of the hero. Without this
        // a single champion simply drowns in bodies.
        const reach = range + stats.radius * 0.6;
        for (const u of this.units) {
          if (u.invuln > 0) continue;
          const d = dist(hero, u);
          if (d > reach + UNITS[u.type].radius) continue;
          const spread = Math.abs(Math.atan2(u.y - hero.y, u.x - hero.x) - hero.facing);
          const delta = Math.min(spread, TAU - spread);
          if (delta > 1.15) continue;
          this.damageUnit(u, stats.damage * (u === target ? 1 : 0.85), { source: 'hero' });
        }
        this.fx.slash(
          hero.x + Math.cos(hero.facing) * stats.radius * 0.8,
          hero.y + Math.sin(hero.facing) * stats.radius * 0.8,
          hero.facing, reach * 1.1, '#fff2c4', { arc: 2.4, width: 9 },
        );
        this.sfx.play('hit');
      }
    }

    // Abilities.
    if (stats.ability && hero.abilityTimer <= 0 && this.units.length > 0) {
      this.startHeroAbility(stats);
    }
  }

  moveHero(dt, stats) {
    const hero = this.hero;
    const next = { x: hero.x + hero.vx * dt, y: hero.y + hero.vy * dt };
    if (this.world.blocked(next, stats.radius)) {
      const slideA = { x: hero.x + hero.vy * dt, y: hero.y - hero.vx * dt };
      const slideB = { x: hero.x - hero.vy * dt, y: hero.y + hero.vx * dt };
      if (!this.world.blocked(slideA, stats.radius)) { hero.x = slideA.x; hero.y = slideA.y; }
      else if (!this.world.blocked(slideB, stats.radius)) { hero.x = slideB.x; hero.y = slideB.y; }
    } else {
      hero.x = next.x;
      hero.y = next.y;
    }
    this.world.clampToArena(hero, stats.radius);
    this.world.resolveCollision(hero, stats.radius);

    const speed = Math.hypot(hero.vx, hero.vy);
    hero.speedFraction = clamp(speed / Math.max(1, stats.moveSpeed), 0, 1);
    hero.gait += dt * (2 + hero.speedFraction * 9);
    if (speed > 10) hero.facing = approachAngle(hero.facing, Math.atan2(hero.vy, hero.vx), dt * 7);
    if (speed > stats.moveSpeed * 0.6 && chance(dt * 8)) {
      this.fx.dust(hero.x, hero.y + stats.radius * 0.5, 'rgba(210,200,170,0.45)');
    }
  }

  // -------------------------------------------------------------- abilities

  startHeroAbility(stats) {
    const spec = HERO_ABILITIES[stats.ability];
    if (!spec) return;
    const hero = this.hero;
    const radiusMult = this.heroMods.aoeRadiusMult;

    hero.abilityTimer = spec.cooldown * this.heroMods.abilityCooldownMult;
    this.sfx.play('telegraph');

    if (stats.ability === 'dash') {
      const target = this.nearestUnit(hero);
      const angle = target ? angleTo(hero, target) : hero.facing;
      hero.action = { kind: 'dash', phase: 'telegraph', t: 0, spec, angle };
      this.telegraph = {
        shape: 'line',
        x: hero.x, y: hero.y,
        angle,
        length: spec.range,
        width: spec.width,
        age: 0,
        duration: spec.telegraph,
      };
      return;
    }

    // Judgment aims at the densest cluster, punishing blobbed-up swarms.
    let cx = hero.x;
    let cy = hero.y;
    if (stats.ability === 'judgment') {
      const spot = this.densestCluster(spec.radius * radiusMult);
      if (spot) { cx = spot.x; cy = spot.y; }
    }

    const radius = spec.radius * radiusMult;
    hero.action = { kind: stats.ability, phase: 'telegraph', t: 0, spec, x: cx, y: cy, radius };
    this.telegraph = {
      shape: 'circle',
      x: cx, y: cy,
      radius,
      age: 0,
      duration: spec.telegraph,
    };
    this.log(`${this.heroStats().name} casts ${spec.name}`, PALETTE.danger);
  }

  densestCluster(radius) {
    if (!this.units.length) return null;
    let best = null;
    let bestCount = 0;
    const r2 = radius * radius;
    for (const u of this.units) {
      let count = 0;
      for (const other of this.units) {
        if (dist2(u, other) < r2) count += 1;
      }
      if (count > bestCount) { bestCount = count; best = u; }
    }
    return bestCount >= 2 ? { x: best.x, y: best.y } : null;
  }

  updateHeroAction(dt, stats) {
    const hero = this.hero;
    const action = hero.action;
    action.t += dt;
    if (this.telegraph) this.telegraph.age += dt;

    if (action.phase === 'telegraph') {
      // Hero plants itself while winding up — the window to pull units out.
      hero.vx = damp(hero.vx, 0, 10, dt);
      hero.vy = damp(hero.vy, 0, 10, dt);
      this.moveHero(dt, stats);
      if (action.t >= action.spec.telegraph) {
        action.phase = 'active';
        action.t = 0;
        this.telegraph = null;
        this.resolveAbility(action, stats);
      }
      return;
    }

    if (action.kind === 'dash') {
      const speed = action.spec.range / 0.32;
      hero.vx = Math.cos(action.angle) * speed;
      hero.vy = Math.sin(action.angle) * speed;
      this.moveHero(dt, stats);
      this.fx.particle({
        x: hero.x + rand(-8, 8), y: hero.y + rand(-8, 8),
        vx: -hero.vx * 0.08, vy: -hero.vy * 0.08,
        life: 0.3, size: 4, color: '#ffe8b0',
      });
      for (const u of this.units) {
        if (u.dashHit || u.invuln > 0) continue;
        if (dist(u, hero) < stats.radius + UNITS[u.type].radius + 6) {
          u.dashHit = true;
          this.damageUnit(u, action.spec.damage * this.threat, { source: 'ability' });
        }
      }
      if (action.t >= 0.32) {
        for (const u of this.units) u.dashHit = false;
        hero.action = null;
        hero.vx *= 0.2;
        hero.vy *= 0.2;
      }
      return;
    }

    if (action.kind === 'bladestorm') {
      hero.vx = damp(hero.vx, 0, 6, dt);
      hero.vy = damp(hero.vy, 0, 6, dt);
      this.moveHero(dt, stats);
      hero.facing += dt * 16;
      action.tick = (action.tick ?? 0) - dt;
      if (action.tick <= 0) {
        action.tick = action.spec.tickRate;
        const radius = action.spec.radius * this.heroMods.aoeRadiusMult;
        this.fx.ring(hero.x, hero.y, radius, 'rgba(255,230,170,0.7)', { life: 0.3, width: 4 });
        for (const u of this.units) {
          if (dist(u, hero) < radius) {
            this.damageUnit(u, action.spec.tickDamage * this.threat, { source: 'ability' });
          }
        }
        this.sfx.play('hit');
      }
      if (action.t >= action.spec.duration) hero.action = null;
      return;
    }

    hero.action = null;
  }

  resolveAbility(action, stats) {
    const spec = action.spec;
    const hero = this.hero;

    if (action.kind === 'dash') {
      this.fx.addShake(0.5);
      this.sfx.play('boom');
      return;
    }

    if (action.kind === 'bladestorm') {
      action.tick = 0;
      this.fx.addShake(0.4);
      return;
    }

    const radius = action.radius ?? spec.radius * this.heroMods.aoeRadiusMult;
    const cx = action.x ?? hero.x;
    const cy = action.y ?? hero.y;

    this.fx.ring(cx, cy, radius * 1.05, 'rgba(255,226,168,0.95)', { life: 0.5, width: 6, fill: true });
    this.fx.burst(cx, cy, '#ffe6b0', 40, 340);
    this.fx.addShake(action.kind === 'nova' ? 1.2 : 0.8);
    this.fx.addFlash(action.kind === 'nova' ? 0.4 : 0.22, '255,230,180');
    this.sfx.play('boom');

    for (const u of this.units) {
      const d = dist(u, { x: cx, y: cy });
      if (d < radius) {
        // Falloff rewards clipping the edge instead of standing in the middle.
        const falloff = lerp(1, 0.45, smoothstep(radius * 0.4, radius, d));
        this.damageUnit(u, spec.damage * falloff * this.threat, { source: 'ability' });
      }
    }
    hero.action = null;
  }

  // -------------------------------------------------------------- projectiles

  updateProjectiles(dt) {
    const heroStats = this.heroStats();
    for (const p of this.projectiles) {
      p.life -= dt;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 6) p.trail.shift();
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (!this.world.inArena(p, -8)) { p.life = 0; continue; }
      if (this.world.blocked(p, p.radius)) {
        this.fx.hit(p.x, p.y, 'rgba(190,180,170,0.9)', 6, 80);
        p.life = 0;
        continue;
      }

      if (p.team === 'swarm') {
        if (dist(p, this.hero) < p.radius + heroStats.radius) {
          this.damageHero(p.damage, p);
          p.life = 0;
        }
      } else {
        for (const u of this.units) {
          if (u.invuln > 0) continue;
          if (dist(p, u) < p.radius + UNITS[u.type].radius) {
            this.damageUnit(u, p.damage, { source: 'hero' });
            // Small splash: clustering under fire has a cost.
            for (const other of this.units) {
              if (other === u || other.invuln > 0) continue;
              if (dist(other, p) < 46) this.damageUnit(other, p.damage * 0.5, { source: 'hero' });
            }
            this.fx.hit(p.x, p.y, '#ffe9a8', 10, 150);
            this.fx.ring(p.x, p.y, 46, 'rgba(255,220,150,0.6)', { life: 0.25 });
            p.life = 0;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
    this.reapUnits();
  }

  // -------------------------------------------------------------------- relics

  spawnRelic(x, y) {
    const def = pick(HERO_RELICS);
    this.relics.push({
      id: this.nextId++,
      relic: def,
      x: x + rand(-12, 12),
      y: y + rand(-12, 12),
      color: def.color,
      life: 14,
      seed: rand(0, 10),
    });
  }

  updateRelics(dt) {
    const radius = this.heroStats().radius;
    for (const r of this.relics) {
      r.life -= dt;
      if (dist(r, this.hero) < radius + 16) {
        r.life = 0;
        this.applyHeroMods(r.relic.mods ?? {});
        this.heroRelics.push(r.relic);
        if (r.relic.heal) {
          this.hero.hp = Math.min(this.heroStats().maxHp, this.hero.hp + this.heroStats().maxHp * r.relic.heal);
        }
        this.log(`Champion claimed ${r.relic.name} (${r.relic.desc})`, r.relic.color);
        this.fx.text(this.hero.x, this.hero.y - 40, r.relic.name, r.relic.color, { size: 16 });
        this.fx.ring(this.hero.x, this.hero.y, 60, r.relic.color, { life: 0.6 });
        this.sfx.play('upgrade');
      }
    }
    this.relics = this.relics.filter((r) => r.life > 0);
  }

  // ---------------------------------------------------------------- damage

  damageHero(amount, from, opts = {}) {
    if (this.phase !== 'playing') return;
    const debuffs = this.heroDebuffs();
    const dmg = amount * (1 + debuffs.mark);

    this.hero.hp -= dmg;
    this.hero.hitFlash = 0.12;
    this.stats.damageDealt += dmg;

    if (this.mods.toxinStack > 0) {
      this.hero.poison = Math.min(60, this.hero.poison + this.mods.toxinStack);
    }

    this.gain(dmg * CONFIG.aetherPerHeroDamage * this.mods.damageAetherMult);

    if (!opts.silent) {
      // Dozens of units hit per second; show one running total instead of
      // burying the screen in single-digit numbers.
      this.heroDamageAccum += dmg;
      this.fx.hit(from.x, from.y, PALETTE.swarmGlow, 7, 130);
      this.sfx.play('heroHit');
    }
    if (dmg > 30) this.fx.addShake(0.28);

    if (this.hero.hp <= 0) this.onHeroDown();
  }

  onHeroDown() {
    if (this.phase !== 'playing') return;
    this.hero.hp = 0;
    this.phase = 'victory';
    this.endReason = `The ${this.heroStats().name} fell after ${Math.floor(this.time)}s.`;
    this.fx.burst(this.hero.x, this.hero.y, '#ffd9a0', 70, 420, { gravity: 200 });
    this.fx.ring(this.hero.x, this.hero.y, 320, 'rgba(255,220,160,0.9)', { life: 1.1, width: 8 });
    this.fx.addShake(1.4);
    this.fx.addFlash(0.6, '255,240,200');
    this.sfx.play('victory');
  }

  // ------------------------------------------------------------ progression

  updateProgression(dt) {
    // The champion trains even when unopposed, so refusing to fight only
    // hands it the win on the ascension timer.
    // Accelerating, so a stalled game always resolves rather than running forever.
    this.hero.xp += CONFIG.heroXpPerSecond * (1 + this.time / 120) * dt;

    // Hero evolution.
    const next = this.hero.stage + 1;
    if (next < HERO_STAGES.length && this.hero.xp >= HERO_STAGES[next].xpThreshold) {
      const before = this.heroStats();
      const ratio = clamp(this.hero.hp / before.maxHp, 0.15, 1);
      this.hero.stage = next;
      const after = this.heroStats();
      this.hero.hp = Math.round(after.maxHp * Math.min(1, ratio + 0.25));
      this.hero.abilityTimer = 2;
      this.log(`Champion evolved: ${after.name}`, PALETTE.hero);
      this.fx.text(this.hero.x, this.hero.y - 50, after.name.toUpperCase(), '#fff0b8', { size: 22, life: 1.6 });
      this.fx.ring(this.hero.x, this.hero.y, 260, 'rgba(255,236,180,0.9)', { life: 1, width: 6, fill: true });
      this.fx.burst(this.hero.x, this.hero.y, '#fff0b8', 50, 300);
      this.fx.addShake(1);
      this.fx.addFlash(0.35, '255,240,190');
      this.sfx.play('evolve');
    }

    // Ascension timer at the final stage.
    if (this.hero.stage >= HERO_STAGES.length - 1) {
      this.ascension += dt;
      if (this.ascension >= CONFIG.ascensionTime) {
        this.phase = 'defeat';
        this.endReason = 'The champion completed its ascension. The swarm is scattered.';
        this.fx.addFlash(0.7, '255,240,200');
        this.sfx.play('defeat');
        return;
      }
    }

    // Player upgrade offers. The threshold escalates with every mutation
    // taken: damage earns Aether, so a flat threshold would let damage buy
    // more damage and run away exponentially.
    if (this.earned >= this.nextUpgradeAt) {
      this.nextUpgradeAt = this.earned
        + CONFIG.aetherPerUpgrade * (1 + this.takenUpgrades.length * 0.22);
      this.upgradeChoices = this.rollUpgrades();
      if (this.upgradeChoices.length) {
        this.phase = 'upgrade';
        this.sfx.play('upgrade');
      }
    }
  }

  rollUpgrades() {
    const taken = new Set(this.takenUpgrades.map((u) => u.id));
    // Stackable numeric upgrades can repeat; unique ones cannot.
    const unique = new Set(['carapace', 'rift', 'wells', 'dispersal', 'frenzy']);
    const pool = SWARM_UPGRADES.filter((u) => !(unique.has(u.id) && taken.has(u.id)));
    const out = [];
    const copy = [...pool];
    while (out.length < 3 && copy.length) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  chooseUpgrade(upgrade) {
    if (!upgrade) { this.upgradeChoices = []; this.phase = 'playing'; return; }
    upgrade.apply(this.mods);
    this.takenUpgrades.push(upgrade);
    this.upgradeChoices = [];
    this.phase = 'playing';
    this.log(`Swarm evolved: ${upgrade.name}`, PALETTE.good);
    this.sfx.play('upgrade');
  }

  // ------------------------------------------------------------ player verbs

  tryFrenzy() {
    if (this.frenzyCooldown > 0) return;
    this.frenzyTimer = CONFIG.frenzyDuration + this.mods.frenzyDurationBonus;
    this.frenzyCooldown = CONFIG.frenzyCooldown * this.mods.frenzyCooldownMult;
    this.rally = null; // Frenzy releases the staged swarm...
    for (const u of this.units) u.job = null; // ...and every well garrison.
    this.sfx.play('frenzy');
    this.fx.addFlash(0.2, '200,120,255');
    for (const u of this.units) {
      this.fx.ring(u.x, u.y, UNITS[u.type].radius * 3, 'rgba(210,120,255,0.7)', { life: 0.4 });
    }
    this.log('FRENZY — the swarm is released', PALETTE.swarmGlow);
  }

  handleWorldClicks() {
    for (const click of this.clicks) {
      const w = this.screenToWorld(click.x, click.y);
      this.trySummon(this.selected, w);
    }
    for (const click of this.rightClicks) {
      const w = this.screenToWorld(click.x, click.y);
      if (!this.world.inArena(w, 10)) continue;
      this.rally = { x: w.x, y: w.y };
      this.fx.ring(w.x, w.y, 60, 'rgba(200,120,255,0.8)', { life: 0.5 });
      this.log('Rally beacon set — swarm will gather (Q to clear)', PALETTE.swarmGlow);
    }
  }

  // ------------------------------------------------------------------ camera

  updateCamera(dt) {
    // Follow the hero, but lean toward the swarm's centre of mass so the
    // player can see the formation they are actually commanding.
    let tx = this.hero.x + this.hero.vx * 0.35;
    let ty = this.hero.y + this.hero.vy * 0.35;

    if (this.units.length) {
      let sx = 0;
      let sy = 0;
      for (const u of this.units) { sx += u.x; sy += u.y; }
      const cx = sx / this.units.length;
      const cy = sy / this.units.length;
      tx = lerp(tx, cx, 0.22);
      ty = lerp(ty, cy, 0.22);
    }
    if (this.rally) {
      tx = lerp(tx, this.rally.x, 0.12);
      ty = lerp(ty, this.rally.y, 0.12);
    }

    const halfW = this.width / (2 * this.camera.zoom);
    const halfH = this.height / (2 * this.camera.zoom);
    tx = clamp(tx, Math.min(halfW, this.world.width / 2), Math.max(this.world.width - halfW, this.world.width / 2));
    ty = clamp(ty, Math.min(halfH, this.world.height / 2), Math.max(this.world.height - halfH, this.world.height / 2));

    this.camera.x = damp(this.camera.x, tx, CONFIG.cameraLerp, dt);
    this.camera.y = damp(this.camera.y, ty, CONFIG.cameraLerp, dt);
  }

  viewRect() {
    const halfW = this.width / (2 * this.camera.zoom);
    const halfH = this.height / (2 * this.camera.zoom);
    return {
      x: this.camera.x - halfW,
      y: this.camera.y - halfH,
      w: halfW * 2,
      h: halfH * 2,
    };
  }

  visible(x, y, pad = 80) {
    const v = this.viewRect();
    return x > v.x - pad && x < v.x + v.w + pad && y > v.y - pad && y < v.y + v.h + pad;
  }

  // ------------------------------------------------------------------ render

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1219';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    if (this.fx.shake > 0) {
      const s = this.fx.shake * 10;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.renderWorld(ctx);

    ctx.restore();
    ctx.restore();

    this.renderVignette(ctx);
    if (this.fx.flash > 0) {
      ctx.fillStyle = `rgba(${this.fx.flashColor},${clamp(this.fx.flash, 0, 1) * 0.55})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    this.hud.draw(ctx);
  }

  renderWorld(ctx) {
    const view = this.viewRect();
    const lod = this.camera.zoom < 0.68 ? 0 : 1;

    drawGround(ctx, this.world, this.groundPattern, view, this.time);
    drawArenaBorder(ctx, this.world, CONFIG.arenaPadding);

    for (const well of this.world.wells) {
      if (this.visible(well.x, well.y, well.radius + 40)) drawWell(ctx, well, this.time);
    }

    this.fx.drawDecals(ctx);

    if (this.rally) drawRally(ctx, this.rally, this.time);
    if (this.telegraph) drawTelegraph(ctx, this.telegraph, this.time);

    // Shadows for every prop first, so nothing casts onto a neighbour's body.
    const props = this.world.terrain.filter((t) => this.visible(t.x, t.y, t.radius + 110));
    for (const t of props) drawTerrainShadow(ctx, t, this.time);

    for (const rift of this.rifts) {
      if (this.visible(rift.x, rift.y, 80)) drawRift(ctx, rift, this.time);
    }
    for (const relic of this.relics) {
      if (this.visible(relic.x, relic.y, 40)) drawRelic(ctx, relic, this.time);
    }

    // Depth sort: everything that stands on the ground draws back-to-front.
    const actors = [];
    for (const u of this.units) {
      if (this.visible(u.x, u.y, 60)) actors.push({ y: u.y, kind: 'unit', ref: u });
    }
    for (const t of props) actors.push({ y: t.y, kind: 'prop', ref: t });
    actors.push({ y: this.hero.y, kind: 'hero', ref: this.hero });
    actors.sort((a, b) => a.y - b.y);

    const heroStats = this.heroStats();

    // Threat ring: keeps the champion findable under a pile of bodies and
    // shows exactly how far its attacks reach.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,196,120,0.32)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -this.time * 14;
    ctx.beginPath();
    ctx.arc(this.hero.x, this.hero.y, heroStats.attackRange + heroStats.radius, 0, TAU);
    ctx.stroke();
    ctx.restore();

    for (const actor of actors) {
      if (actor.kind === 'unit') {
        drawUnit(ctx, actor.ref, UNITS[actor.ref.type], this.time, lod);
      } else if (actor.kind === 'prop') {
        drawTerrain(ctx, actor.ref, this.time);
      } else {
        drawHero(ctx, this.hero, heroStats, this.heroClass, this.hero.stage, this.time);
      }
    }

    // Health bars on top of the crowd so they are never occluded.
    for (const u of this.units) {
      if (!this.visible(u.x, u.y, 60)) continue;
      if (u.hp >= u.maxHp - 0.01) continue;
      const def = UNITS[u.type];
      this.drawMiniBar(ctx, u.x, u.y - def.radius - 9, def.radius * 2.2, 3, u.hp / u.maxHp, '#6ef2a4');
    }
    this.drawMiniBar(
      ctx, this.hero.x, this.hero.y - heroStats.radius - 20, 84, 6,
      clamp(this.hero.hp / heroStats.maxHp, 0, 1), '#ff6b86',
    );

    for (const p of this.projectiles) {
      if (this.visible(p.x, p.y, 40)) drawProjectile(ctx, p, this.time);
    }

    this.fx.draw(ctx);
    this.fx.drawTexts(ctx, this.camera.zoom);
  }

  drawMiniBar(ctx, cx, y, w, h, fraction, color) {
    const x = cx - w / 2;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(fraction, 0, 1), h);
  }

  renderVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.width * 0.5, this.height * 0.5, Math.min(this.width, this.height) * 0.35,
      this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.75,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}
