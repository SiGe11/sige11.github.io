// All screen-space UI: panels, unit cards, minimap, overlays and the cursor
// placement ghost.

import {
  CONFIG, PALETTE, UNITS, UNIT_ORDER, UNIT_SLOTS, SLOT_UNLOCK_AT,
  HERO_STAGES, HERO_ABILITIES,
} from './config.js';
import { clamp, dist } from './math.js';
import { drawUnit } from './art.js';

const TAU = Math.PI * 2;

/** "An Arcanist", "A Templar". */
const article = (word) => (/^[aeiou]/i.test(word) ? 'An' : 'A');

const BEHAVIOUR_LABEL = {
  melee: 'melee',
  ranged: 'ranged',
  support: 'support',
  ambush: 'ambush',
  brood: 'breeder',
  mender: 'healer',
  artillery: 'siege',
};

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export const HELP_PAGES = [
  {
    title: 'Basics',
    body: [
      ['You are the swarm mind', [
        'A lone champion has entered the rift-lands. You cannot control it and you',
        'cannot outlast it — you have to kill it.',
        'You never control units directly. You choose what to summon, where it appears,',
        'and when the swarm commits. Everything else they do on their own.',
      ]],
      ['How a run ends', [
        'WIN — the champion dies.',
        'LOSE — the champion reaches its final tier and survives the ascension timer.',
        'Nothing else can end the run. Losing your whole swarm is a setback, not a loss.',
      ]],
      ['Controls', [
        'Left-click        summon the selected unit there (a rift opens first)',
        '1 - 7             select a unit; pressing it also summons at the cursor',
        '                  during a strain pick, 1 and 2 choose instead',
        'Right-click       place a rally beacon — the swarm gathers and waits',
        'Q                 clear the rally beacon',
        'Space             Frenzy: release the swarm, buffed and ability-resistant',
        'Mouse wheel       zoom    ·    Esc pause    ·    M mute    ·    H this guide',
      ]],
    ],
  },
  {
    title: 'The trade',
    body: [
      ['Every death feeds the champion', [
        'The champion evolves on experience, and almost all of it comes from killing',
        'your units. A constant trickle of Mites does not wear it down — it arms it.',
        'The tier bar under its health is, in effect, a record of your mistakes.',
      ]],
      ['Corpses leave things behind', [
        'About one death in twenty drops a pickup. Most are flasks — a loud boon for',
        'ten seconds or so — and the rare spinning relics are permanent, nine a run.',
        'The champion has to walk over one, so a drop is a piece of map to play',
        'around: fight elsewhere, or take the trade. They fade after 13 seconds.',
      ]],
      ['The beacon steers, it does not store', [
        'Right-click gathers the swarm at a point instead of charging. Use it to pull',
        'units out of a telegraph, to regroup survivors so they arrive together, or to',
        'pin one flank. Set it near the fight — a beacon across the map is a long walk,',
        'and an idle swarm is wasted damage while the champion trains for free.',
      ]],
      ['Frenzy is your commit button', [
        'Space clears the beacon, releases every garrison, and for a few seconds the',
        'swarm moves faster, hits harder, and takes half damage from abilities.',
        'That last part is the point: it is the one window where a packed swarm can',
        'stand inside a Shockwave and keep swinging. Spend it when you have bodies.',
      ]],
    ],
  },
  {
    title: 'Aether wells',
    body: [
      ['Map control', [
        'The four glowing circles are aether wells. They start neutral (gold).',
        'Summon a unit inside a well and it garrisons there instead of charging the',
        'champion. Two or more holding it corrupts it (purple) after a few seconds.',
      ]],
      ['What you gain', [
        `Each corrupted well pays +${CONFIG.incomePerWell} Aether per second, on top of your base income.`,
        'More importantly the champion heals on any well it still controls — a few',
        'percent of its health every second. Take them all and it cannot heal at all.',
      ]],
      ['What it costs', [
        'Garrisoned units are not attacking. Holding every well while also killing the',
        'champion is the central tension of the game.',
        'The champion will walk over to purge your wells, and gains experience for it.',
        'Frenzy releases every garrison — going all-in gives up the map.',
      ]],
    ],
  },
  {
    title: 'Your units',
    body: null, // rendered from the roster
  },
  {
    title: 'Strains',
    body: [
      ['The last two slots are a choice', [
        'Slots 1 to 5 are always the same. Slots 6 and 7 open as a pick between two',
        'units of the same weight, and the run stops so you can commit. What you',
        'pass on is gone for the rest of the run.',
      ]],
      ['Slot 6 — Matriarch or Mender', [
        'MATRIARCH replaces losses: she hatches free Mites forever, so a long grind',
        'costs you less Aether. Take her when you are trading bodies constantly.',
        'MENDER keeps what you already have: it heals every unit around it, which',
        'turns a packed swarm into something that survives a Shockwave. Take it when',
        'your units are expensive and you want them to live through the ability.',
      ]],
      ['Slot 7 — Titan or Bombardier', [
        'TITAN is a 520 HP brawler that walks in and holds the champion in place.',
        'It is the answer to a melee champion and to anything that has to be tanked.',
        'BOMBARDIER never enters the fight: it lobs shells over terrain from 410',
        'away and splashes on impact. It is the only thing in the roster that can',
        'clear a Summoner\u2019s wisps, and the only answer to a champion that kites.',
      ]],
    ],
  },
  {
    title: 'The champion',
    body: null, // rendered from the tier ladder
  },
];

export class Hud {
  constructor(game) {
    this.game = game;
    this.hoverCard = null;
    this.helpPage = 0;
  }

  // ------------------------------------------------------------- primitives

  panel(ctx, x, y, w, h, opts = {}) {
    ctx.save();
    roundRect(ctx, x, y, w, h, opts.radius ?? 10);
    ctx.fillStyle = opts.fill ?? 'rgba(14,18,26,0.86)';
    ctx.fill();

    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.015)');
    g.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = opts.stroke ?? 'rgba(180,150,240,0.22)';
    ctx.lineWidth = opts.lineWidth ?? 1;
    ctx.stroke();
    ctx.restore();
  }

  bar(ctx, x, y, w, h, fraction, color, opts = {}) {
    ctx.save();
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = opts.track ?? 'rgba(0,0,0,0.5)';
    ctx.fill();

    const f = clamp(fraction, 0, 1);
    if (f > 0.002) {
      ctx.save();
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.clip();
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, opts.light ?? color);
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w * f, h);
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.stroke();
    ctx.restore();
  }

  font(opts = {}) {
    return `${opts.weight ?? 600} ${opts.size ?? 14}px "Segoe UI", system-ui, -apple-system, sans-serif`;
  }

  measure(ctx, str, opts = {}) {
    ctx.save();
    ctx.font = this.font(opts);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  /** Truncate to `maxWidth` with an ellipsis so labels never leave their panel. */
  fit(ctx, str, maxWidth, opts = {}) {
    if (maxWidth <= 0) return '';
    if (this.measure(ctx, str, opts) <= maxWidth) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(ctx, `${str.slice(0, mid)}…`, opts) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? `${str.slice(0, lo)}…` : '';
  }

  text(ctx, str, x, y, opts = {}) {
    const value = opts.maxWidth ? this.fit(ctx, str, opts.maxWidth, opts) : str;
    ctx.save();
    ctx.font = this.font(opts);
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = opts.baseline ?? 'alphabetic';
    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(value, x + 1, y + 1);
    }
    ctx.fillStyle = opts.color ?? PALETTE.ui;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  /** Greedy word wrap; returns the lines it produced. */
  wrap(ctx, str, maxWidth, opts = {}) {
    const words = String(str).split(' ');
    const lines = [''];
    for (const word of words) {
      const candidate = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
      if (this.measure(ctx, candidate, opts) > maxWidth && lines[lines.length - 1]) lines.push(word);
      else lines[lines.length - 1] = candidate;
    }
    return lines;
  }

  // ------------------------------------------------------------------ layout

  /**
   * Card strip scales down on narrow windows instead of running off-screen.
   * With seven units a fixed minimum width overflowed small viewports, so the
   * gap, the Frenzy button and the card content all shrink together, and
   * `compact` tells the card renderer to drop its secondary labels.
   */
  actionBarLayout() {
    const g = this.game;
    const count = UNIT_SLOTS.length;
    const tight = g.width < 940;
    const margin = tight ? 10 : 16;
    const gap = tight ? 5 : 8;
    const frenzyW = tight ? 72 : 92;
    const available = g.width - margin * 2 - frenzyW - gap;
    const cardW = clamp((available - (count - 1) * gap) / count, 52, 124);
    const cardH = tight ? 60 : 70;
    const totalW = count * cardW + (count - 1) * gap + gap + frenzyW;
    const startX = Math.max(margin, (g.width - totalW) / 2);
    const y = g.height - cardH - (tight ? 10 : 16);
    return { cardW, cardH, gap, frenzyW, startX, y, count, compact: cardW < 104 };
  }

  /**
   * One rect per slot. A paired slot whose strain has not been picked yet
   * carries a null id and renders as an undecided card.
   */
  unitCardRects() {
    const L = this.actionBarLayout();
    return UNIT_SLOTS.map((options, i) => ({
      id: this.game.roster[i],
      slot: i,
      options,
      unlockAt: SLOT_UNLOCK_AT[i],
      x: L.startX + i * (L.cardW + L.gap),
      y: L.y,
      w: L.cardW,
      h: L.cardH,
    }));
  }

  /** Two big cards for the strain pick, laid out like the mutation panel. */
  unitChoiceRects() {
    const g = this.game;
    const options = g.unitChoice ? g.unitChoice.options : [];
    const gap = 24;
    const cardW = clamp((g.width - 100 - (options.length - 1) * gap) / Math.max(1, options.length), 200, 280);
    // The cards have to clear the action bar on short windows, so their height
    // comes from the space actually available rather than a fixed 236.
    const top = Math.max(96, g.height / 2 - 118);
    const bottom = this.actionBarLayout().y - 14;
    const cardH = clamp(bottom - top, 176, 236);
    const totalW = options.length * cardW + (options.length - 1) * gap;
    const startX = (g.width - totalW) / 2;
    const y = Math.max(top, Math.min(g.height / 2 - cardH / 2 + 26, bottom - cardH));
    return options.map((id, i) => ({
      id,
      index: i,
      x: startX + i * (cardW + gap),
      y,
      w: cardW,
      h: cardH,
    }));
  }

  frenzyRect() {
    const L = this.actionBarLayout();
    return {
      x: L.startX + L.count * (L.cardW + L.gap),
      y: L.y,
      w: L.frenzyW,
      h: L.cardH,
    };
  }

  /** Top-left resource panel; narrows on small viewports. */
  resourcePanelRect() {
    const g = this.game;
    const compact = g.width < 940;
    return { x: 16, y: 16, w: compact ? 176 : 232, h: compact ? 96 : 88, compact };
  }

  feedRect() {
    const g = this.game;
    const w = clamp(g.width * 0.24, 132, 320);
    return { x: g.width - w - 16, y: 56, w };
  }

  /**
   * The champion panel sits between the resource readout and the event feed,
   * so its width has to be derived from theirs — a fixed 440 overlapped both
   * on narrow windows.
   */
  heroPanelRect(extraRows = 0) {
    const g = this.game;
    const res = this.resourcePanelRect();
    const feed = this.feedRect();
    const left = res.x + res.w + 14;
    const right = feed.x - 14;
    const w = clamp(Math.min(440, right - left), 230, 440);
    const x = clamp((g.width - w) / 2, left, Math.max(left, right - w));
    return { x, y: 14, w, h: 78 + extraRows };
  }

  helpButtonRect() {
    const g = this.game;
    return { x: g.width - 44, y: 16, w: 28, h: 28 };
  }

  minimapRect() {
    const g = this.game;
    const w = clamp(g.width * 0.15, 140, 200);
    const h = w * (g.world.height / g.world.width);
    return { x: g.width - w - 16, y: g.height - h - 96, w, h };
  }

  upgradeCardRects() {
    const g = this.game;
    const n = Math.max(1, g.upgradeChoices.length);
    const gap = 20;
    const cardW = clamp((g.width - 80 - (n - 1) * gap) / n, 190, 260);
    const cardH = 178;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = (g.width - totalW) / 2;
    const y = g.height / 2 - cardH / 2 + 20;
    return g.upgradeChoices.map((u, i) => ({
      upgrade: u,
      x: startX + i * (cardW + gap),
      y,
      w: cardW,
      h: cardH,
    }));
  }

  restartRect() {
    const g = this.game;
    return { x: g.width / 2 - 100, y: g.height / 2 + 78, w: 200, h: 46 };
  }

  helpPanelRect() {
    const g = this.game;
    const w = Math.min(860, g.width - 48);
    const h = Math.min(560, g.height - 48);
    return { x: (g.width - w) / 2, y: (g.height - h) / 2, w, h };
  }

  helpTabRects() {
    const panel = this.helpPanelRect();
    const tabW = (panel.w - 48) / HELP_PAGES.length;
    return HELP_PAGES.map((page, i) => ({
      page: i,
      title: page.title,
      x: panel.x + 24 + i * tabW,
      y: panel.y + 58,
      w: tabW - 6,
      h: 30,
    }));
  }

  /** True when a screen point sits on any interactive HUD widget. */
  pointerOverUi(p) {
    if (this.hit(this.frenzyRect(), p)) return true;
    if (this.hit(this.minimapRect(), p)) return true;
    if (this.hit(this.helpButtonRect(), p)) return true;
    return this.unitCardRects().some((rect) => this.hit(rect, p));
  }

  hit(rect, p) {
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  }

  // ------------------------------------------------------------------ clicks

  /** Consumes clicks that landed on UI so they cannot also place a rift. */
  handleHudClicks() {
    const g = this.game;
    if (!g.clicks.length) return;

    if (g.helpVisible) {
      for (const click of g.clicks) {
        for (const tab of this.helpTabRects()) {
          if (this.hit(tab, click)) this.helpPage = tab.page;
        }
        if (this.hit(this.helpButtonRect(), click)) g.helpVisible = false;
      }
      g.clicks = [];
      return;
    }

    const remaining = [];
    for (const click of g.clicks) {
      let consumed = false;

      if (this.hit(this.helpButtonRect(), click)) {
        g.helpVisible = true;
        consumed = true;
      }
      if (!consumed) {
        for (const rect of this.unitCardRects()) {
          if (this.hit(rect, click)) {
            if (rect.id && g.unlocked.has(rect.id)) g.selected = rect.id;
            consumed = true;
            break;
          }
        }
      }
      if (!consumed && this.hit(this.frenzyRect(), click)) {
        g.tryFrenzy();
        consumed = true;
      }
      if (!consumed && this.hit(this.minimapRect(), click)) consumed = true;
      if (!consumed) remaining.push(click);
    }
    g.clicks = remaining;
  }

  handleUpgradeClicks() {
    const g = this.game;
    for (const click of g.clicks) {
      for (const card of this.upgradeCardRects()) {
        if (this.hit(card, click)) {
          g.chooseUpgrade(card.upgrade);
          return;
        }
      }
    }
  }

  handleUnitChoiceClicks() {
    const g = this.game;
    for (const click of g.clicks) {
      for (const card of this.unitChoiceRects()) {
        if (this.hit(card, click)) {
          g.chooseUnit(card.id);
          g.clicks = [];
          return;
        }
      }
    }
    g.clicks = [];
  }

  handleEndClicks() {
    const g = this.game;
    for (const click of g.clicks) {
      if (this.hit(this.restartRect(), click)) {
        g.newRun();
        return;
      }
    }
  }

  handleIntroClicks() {
    const g = this.game;
    if (!g.clicks.length) return;
    for (const click of g.clicks) {
      if (this.hit(this.introHelpRect(), click)) {
        g.helpVisible = true;
        g.clicks = [];
        return;
      }
    }
    g.phase = 'playing';
    g.clicks = [];
  }

  introHelpRect() {
    const g = this.game;
    return { x: g.width / 2 - 100, y: g.height / 2 + 84, w: 200, h: 40 };
  }

  // ------------------------------------------------------------------- draw

  draw(ctx) {
    const g = this.game;

    if (g.phase === 'playing' && !g.helpVisible) this.drawPlacementGhost(ctx);

    this.drawResourcePanel(ctx);
    this.drawHeroPanel(ctx);
    this.drawFeed(ctx);
    this.drawUnitCards(ctx);
    this.drawFrenzy(ctx);
    this.drawMinimap(ctx);
    this.drawHelpButton(ctx);
    this.drawObjectives(ctx);

    if (g.phase === 'intro') this.drawIntro(ctx);
    if (g.phase === 'paused') this.drawCenter(ctx, 'Paused', 'Esc to resume · H for the guide');
    if (g.phase === 'upgrade') this.drawUpgrades(ctx);
    if (g.phase === 'choose') this.drawUnitChoice(ctx);
    if (g.phase === 'victory') this.drawEnd(ctx, 'Victory', g.endReason, PALETTE.good);
    if (g.phase === 'defeat') this.drawEnd(ctx, 'Defeat', g.endReason, PALETTE.danger);
    if (g.helpVisible) this.drawHelp(ctx);
  }

  /** Ghost circle under the cursor showing whether a summon would land. */
  drawPlacementGhost(ctx) {
    const g = this.game;
    const def = UNITS[g.selected];
    const p = g.mouse.world;
    const blocker = g.summonBlocker(g.selected, p);
    const screen = g.worldToScreen(p.x, p.y);
    const r = def.radius * g.camera.zoom;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = blocker ? 'rgba(255,90,110,0.9)' : 'rgba(150,255,190,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(10, r * 1.5), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = blocker ? 'rgba(255,90,110,0.45)' : 'rgba(150,255,190,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screen.x - 12, screen.y);
    ctx.lineTo(screen.x + 12, screen.y);
    ctx.moveTo(screen.x, screen.y - 12);
    ctx.lineTo(screen.x, screen.y + 12);
    ctx.stroke();
    ctx.restore();

    const label = blocker
      ?? (g.world.wellAt(p, -8)
        ? (g.world.wellAt(p, -8).owner === 'swarm' ? 'Garrisons this well' : 'Captures this well')
        : null);
    if (label) {
      this.text(ctx, label, screen.x, screen.y - r * 1.5 - 10, {
        align: 'center', size: 12, color: blocker ? '#ff9fb0' : '#a8ffce',
      });
    }

    // The exclusion zone around the hero, so the rule is visible not guessed.
    if (dist(p, g.hero) < g.minSpawnRange() * 1.6) {
      const heroScreen = g.worldToScreen(g.hero.x, g.hero.y);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = 'rgba(255,120,140,0.8)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(heroScreen.x, heroScreen.y, g.minSpawnRange() * g.camera.zoom, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawResourcePanel(ctx) {
    const g = this.game;
    const { x, y, w, h, compact } = this.resourcePanelRect();
    this.panel(ctx, x, y, w, h);

    // Aether gem icon.
    ctx.save();
    ctx.translate(x + 26, y + 30);
    ctx.rotate(g.time * 0.8);
    const grad = ctx.createLinearGradient(-9, -9, 9, 9);
    grad.addColorStop(0, '#e9a8ff');
    grad.addColorStop(1, '#8a3ad0');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const income = `+${g.incomePerSecond().toFixed(1)}/s`;
    const incomeSize = compact ? 11 : 12;
    const incomeW = this.measure(ctx, income, { size: incomeSize });
    this.text(ctx, Math.floor(g.aether).toString(), x + 46, y + (compact ? 34 : 37), {
      size: compact ? 22 : 25, weight: 700, color: '#f0dcff', maxWidth: w - 62 - incomeW - 8,
    });
    this.text(ctx, income, x + w - 12, y + (compact ? 32 : 35), {
      size: incomeSize, color: PALETTE.uiDim, align: 'right',
    });

    const wells = g.heldWells();
    const clock = `${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`;
    const rowSize = compact ? 11 : 12;
    this.text(ctx, `Wells ${wells}/${g.world.wells.length}`, x + 12, y + (compact ? 54 : 60), {
      size: rowSize, color: wells > 0 ? PALETTE.good : PALETTE.uiDim,
    });
    this.text(ctx, `Swarm ${g.units.length}/${CONFIG.maxUnits}`, x + 12, y + (compact ? 70 : 78), {
      size: rowSize, color: PALETTE.uiDim,
    });
    this.text(ctx, clock, x + w - 12, y + (compact ? 70 : 78), {
      size: rowSize, color: PALETTE.uiDim, align: 'right',
    });

    // Progress toward the next mutation offer.
    const taken = g.takenUpgrades.length;
    const maxed = taken >= CONFIG.maxUpgradesPerRun;
    const span = CONFIG.aetherPerUpgrade * CONFIG.upgradeCostGrowth ** taken;
    const frac = maxed ? 1 : clamp(1 - (g.nextUpgradeAt - g.earned) / Math.max(1, span), 0, 1);
    // Compact mode gives the mutation meter its own row; squeezing it beside
    // the clock made the two labels collide.
    const label = maxed ? 'Mutations maxed' : `Mutation ${taken + 1}/${CONFIG.maxUpgradesPerRun}`;
    if (compact) {
      const labelW = this.measure(ctx, label, { size: 10 });
      this.text(ctx, label, x + 12, y + 88, { size: 10, color: PALETTE.uiDim });
      const barX = x + 12 + labelW + 8;
      this.bar(ctx, barX, y + 82, Math.max(12, x + w - 12 - barX), 5, frac, '#7a45b8', { light: '#c07bf0' });
    } else {
      this.bar(ctx, x + 132, y + 70, w - 146, 5, frac, '#7a45b8', { light: '#c07bf0' });
      this.text(ctx, label, x + 132, y + 62, { size: 10, color: PALETTE.uiDim, maxWidth: w - 146 });
    }
  }

  drawHeroPanel(ctx) {
    const g = this.game;
    const stats = g.heroStats();
    const deb = g.heroDebuffs();
    const finalStage = g.hero.stage >= HERO_STAGES.length - 1;
    const statuses = [];
    if (deb.shriekers > 0) {
      statuses.push({ text: `Slowed ${Math.round(deb.slow * 100)}%`, color: '#7fdcff' });
      statuses.push({ text: `Marked +${Math.round(deb.mark * 100)}%`, color: '#7fdcff' });
    }
    if (g.hero.poison > 0) statuses.push({ text: `Poison ${g.hero.poison.toFixed(0)}`, color: '#9dff7a' });
    for (const boon of g.heroBoons) {
      statuses.push({ text: `${boon.def.name} ${Math.ceil(boon.timer)}s`, color: boon.def.color });
    }
    if (g.allies.length) {
      statuses.push({
        text: `${g.allies.length} wisp${g.allies.length === 1 ? '' : 's'}`,
        color: '#ffd489',
      });
    }
    if (g.hero.state === 'retreat') statuses.push({ text: 'Retreating to a well', color: '#ffc98a' });
    if (g.hero.state === 'reclaim') statuses.push({ text: 'Purging your wells', color: '#ff9a7a' });

    // Chips wrap onto a second row once boons stack up, so the panel has to
    // grow with them rather than clipping them at the border.
    const chipRows = statuses.length ? (statuses.length > 3 ? 2 : 1) : 0;
    const rect = this.heroPanelRect((finalStage ? 20 : 0) + chipRows * 20);
    const { x, y, w, h } = rect;
    this.panel(ctx, x, y, w, h, { stroke: 'rgba(255,210,140,0.28)' });

    const meta = `${g.heroClass.name} · tier ${g.hero.stage + 1}/${HERO_STAGES.length}`;
    const metaW = this.measure(ctx, meta, { size: 12 });
    this.text(ctx, stats.name, x + 14, y + 25, {
      size: 16, weight: 700, color: PALETTE.hero, maxWidth: w - 34 - metaW,
    });
    this.text(ctx, meta, x + w - 14, y + 24, { size: 12, color: PALETTE.uiDim, align: 'right' });

    const hpFrac = clamp(g.hero.hp / stats.maxHp, 0, 1);
    this.bar(ctx, x + 14, y + 33, w - 28, 14, hpFrac, '#e0405f', { light: '#ff7a92' });
    this.text(ctx, `${Math.max(0, Math.round(g.hero.hp))} / ${stats.maxHp}`,
      x + w / 2, y + 44, { size: 11, weight: 700, align: 'center', color: '#ffe6ec' });

    let cursorY = y + 54;
    if (!finalStage) {
      const next = HERO_STAGES[g.hero.stage + 1];
      const prev = HERO_STAGES[g.hero.stage].xpThreshold;
      const frac = clamp((g.hero.xp - prev) / (next.xpThreshold - prev), 0, 1);
      this.bar(ctx, x + 14, cursorY, w - 28, 6, frac, '#c79a3e', { light: '#ffd98a' });

      const ability = stats.ability ? HERO_ABILITIES[stats.ability] : null;
      const abilityLabel = ability
        ? (g.hero.abilityTimer > 0 ? `${ability.name} in ${Math.ceil(g.hero.abilityTimer)}s` : `${ability.name} READY`)
        : 'No ability';
      const abilityW = this.measure(ctx, abilityLabel, { size: 11 });
      this.text(ctx, `Evolves in ${Math.max(0, Math.ceil(next.xpThreshold - g.hero.xp))} XP`,
        x + 14, cursorY + 18, { size: 11, color: PALETTE.uiDim, maxWidth: w - 34 - abilityW });
      this.text(ctx, abilityLabel, x + w - 14, cursorY + 18, {
        size: 11, align: 'right', weight: g.hero.abilityTimer > 0 ? 600 : 800,
        color: g.hero.abilityTimer > 0 ? PALETTE.uiDim : '#ffb0a0',
      });
      cursorY += 26;
    } else {
      const frac = clamp(g.ascension / CONFIG.ascensionTime, 0, 1);
      this.bar(ctx, x + 14, cursorY, w - 28, 10, frac, '#ff3d5e', { light: '#ff8fa4' });
      const left = Math.max(0, CONFIG.ascensionTime - g.ascension);
      const pulse = 0.6 + Math.sin(g.time * 6) * 0.4;
      this.text(ctx, `ASCENSION IN ${left.toFixed(1)}s — KILL IT NOW`, x + w / 2, cursorY + 26, {
        size: 13, weight: 800, align: 'center',
        color: `rgba(255,${Math.round(120 + pulse * 90)},${Math.round(140 + pulse * 60)},1)`,
      });
      cursorY += 34;
    }

    // Status chips get their own row, so nothing can collide.
    if (statuses.length) {
      let chipX = x + 14;
      let chipY = cursorY;
      const lastRowY = cursorY + (chipRows - 1) * 20;
      for (const status of statuses) {
        const tw = this.measure(ctx, status.text, { size: 10.5, weight: 700 });
        if (chipX + tw + 14 > x + w - 14) {
          if (chipY >= lastRowY) break;
          chipY += 20;
          chipX = x + 14;
        }
        ctx.save();
        roundRect(ctx, chipX, chipY, tw + 12, 16, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.restore();
        this.text(ctx, status.text, chipX + 6, chipY + 12, {
          size: 10.5, weight: 700, color: status.color,
        });
        chipX += tw + 18;
      }
    }
  }

  drawFeed(ctx) {
    const g = this.game;
    if (!g.feed.length) return;
    const { x, y, w } = this.feedRect();
    ctx.save();
    for (let i = 0; i < g.feed.length; i += 1) {
      const entry = g.feed[i];
      ctx.globalAlpha = clamp(entry.life / 1.6, 0, 1);
      this.text(ctx, entry.text, x + w, y + 18 + i * 19, {
        size: 12, align: 'right', color: entry.color, maxWidth: w,
      });
    }
    ctx.restore();
  }

  drawUnitCards(ctx) {
    const g = this.game;
    const rects = this.unitCardRects();
    const { compact } = this.actionBarLayout();
    this.hoverCard = null;

    for (const rect of rects) {
      // A paired slot before the pick: show what is coming, not a unit.
      if (!rect.id) {
        this.drawUndecidedCard(ctx, rect, compact);
        continue;
      }

      const def = UNITS[rect.id];
      const unlocked = g.unlocked.has(rect.id);
      const cost = g.unitCost(rect.id);
      const affordable = g.aether >= cost;
      const selected = g.selected === rect.id;
      const cooldown = g.summonCooldown(rect.id);
      const onCooldown = cooldown > 0;
      const hovered = this.hit(rect, g.mouse);
      if (hovered) this.hoverCard = rect.id;

      this.panel(ctx, rect.x, rect.y, rect.w, rect.h, {
        fill: selected ? 'rgba(58,28,84,0.94)' : 'rgba(14,18,26,0.88)',
        stroke: selected ? 'rgba(226,160,255,0.8)' : hovered ? 'rgba(200,170,255,0.45)' : 'rgba(150,130,190,0.2)',
        lineWidth: selected ? 1.8 : 1,
      });

      ctx.save();
      if (!unlocked || (!affordable && !onCooldown)) ctx.globalAlpha = 0.42;

      // Name gets the full card width; the portrait sits on the row below.
      const nameSize = compact ? 10.5 : 12;
      this.text(ctx, def.name, rect.x + (compact ? 6 : 10), rect.y + (compact ? 16 : 19), {
        size: nameSize, weight: 700, maxWidth: rect.w - (compact ? 18 : 30),
      });

      const portraitX = rect.x + (compact ? 17 : 24);
      const portraitY = rect.y + (compact ? 40 : 46);
      ctx.save();
      ctx.translate(portraitX, portraitY);
      const scale = Math.min(compact ? 0.8 : 1.05, (compact ? 13 : 17) / def.radius);
      ctx.scale(scale, scale);
      drawUnit(ctx, {
        x: 0, y: 0, facing: -0.35, gait: g.time * 4 + def.cost,
        seed: def.cost, hitFlash: 0, attackTimer: 0,
      }, def, g.time, 1);
      ctx.restore();

      const textX = portraitX + (compact ? 15 : 22);
      const textW = rect.x + rect.w - 6 - textX;
      this.text(ctx, `${cost}`, textX, portraitY + (compact ? 4 : -1), {
        size: compact ? 13 : 15, weight: 700, color: affordable ? '#e2b6ff' : '#ff8fa0',
        maxWidth: textW,
      });
      if (!compact) {
        const costW = this.measure(ctx, `${cost}`, { size: 15, weight: 700 });
        this.text(ctx, 'Aether', textX + costW + 4, rect.y + 45, {
          size: 10, color: PALETTE.uiDim, maxWidth: textW - costW - 4,
        });
        this.text(ctx, BEHAVIOUR_LABEL[def.behavior] ?? def.behavior,
          textX, rect.y + 60, { size: 9.5, color: 'rgba(157,149,184,0.8)', maxWidth: textW });
      }
      ctx.restore();

      // Hotkey chip.
      this.text(ctx, def.hotkey, rect.x + rect.w - (compact ? 5 : 8), rect.y + (compact ? 16 : 19), {
        size: compact ? 10 : 11, weight: 700, align: 'right', color: PALETTE.uiDim,
      });

      if (!unlocked) {
        ctx.save();
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
        ctx.fillStyle = 'rgba(8,10,16,0.78)';
        ctx.fill();
        ctx.restore();
        this.text(ctx, `${Math.ceil(Math.max(0, rect.unlockAt - g.time))}s`,
          rect.x + rect.w / 2, rect.y + rect.h / 2 + 2, {
            size: compact ? 14 : 16, weight: 700, align: 'center', color: '#cbb9e8',
          });
        this.text(ctx, 'locked', rect.x + rect.w / 2, rect.y + rect.h / 2 + (compact ? 16 : 18), {
          size: compact ? 9 : 10, align: 'center', color: PALETTE.uiDim,
        });
      } else if (onCooldown) {
        ctx.save();
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
        ctx.clip();
        ctx.fillStyle = 'rgba(8,10,16,0.76)';
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h * (cooldown / def.summonCooldown));
        ctx.restore();
        this.text(ctx, `${Math.ceil(cooldown)}s`, rect.x + rect.w / 2, rect.y + rect.h / 2 + 5, {
          size: 16, weight: 700, align: 'center', color: '#ffd0dc',
        });
      }
    }

    if (this.hoverCard) this.drawUnitTooltip(ctx, this.hoverCard, rects);
  }

  /** Placeholder card for a slot whose strain has not been chosen yet. */
  drawUndecidedCard(ctx, rect, compact) {
    const g = this.game;
    const due = Math.max(0, rect.unlockAt - g.time);
    this.panel(ctx, rect.x, rect.y, rect.w, rect.h, {
      fill: 'rgba(14,18,26,0.88)',
      stroke: 'rgba(150,130,190,0.2)',
    });
    this.text(ctx, '?', rect.x + rect.w / 2, rect.y + (compact ? 28 : 32), {
      size: compact ? 20 : 24, weight: 800, align: 'center', color: '#8f7fb8',
    });
    const names = rect.options.map((id) => UNITS[id].name).join(' / ');
    this.text(ctx, names, rect.x + rect.w / 2, rect.y + (compact ? 43 : 48), {
      size: compact ? 8.5 : 9.5, align: 'center', color: PALETTE.uiDim, maxWidth: rect.w - 8,
    });
    this.text(ctx, due > 0 ? `choose in ${Math.ceil(due)}s` : 'choose now',
      rect.x + rect.w / 2, rect.y + (compact ? 54 : 62), {
        size: compact ? 8.5 : 9.5, align: 'center', color: '#cbb9e8', maxWidth: rect.w - 8,
      });
  }

  /**
   * The strain pick. Deliberately shaped like the mutation panel so the
   * "the run stops, you commit to something" beat reads the same way.
   */
  drawUnitChoice(ctx) {
    const g = this.game;
    this.dim(ctx, 0.8);
    this.text(ctx, 'A NEW STRAIN', g.width / 2, g.height / 2 - 168, {
      size: 32, weight: 800, align: 'center', color: '#e8ccff',
    });
    this.text(ctx, 'Choose one — the other is gone for the rest of the run',
      g.width / 2, g.height / 2 - 138, {
        size: 15, align: 'center', color: PALETTE.uiDim, maxWidth: g.width - 60,
      });

    const live = clamp(g.panelAge / CONFIG.panelInputDelay, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.25 + live * 0.75;
    for (const card of this.unitChoiceRects()) {
      const def = UNITS[card.id];
      const hovered = live >= 1 && this.hit(card, g.mouse);
      this.panel(ctx, card.x, card.y, card.w, card.h, {
        fill: hovered ? 'rgba(62,30,92,0.97)' : 'rgba(18,20,32,0.95)',
        stroke: hovered ? 'rgba(230,170,255,0.9)' : 'rgba(160,130,210,0.35)',
        lineWidth: hovered ? 2 : 1,
        radius: 12,
      });

      ctx.save();
      ctx.translate(card.x + card.w / 2, card.y + 62);
      const scale = Math.min(1.9, 34 / def.radius);
      ctx.scale(scale, scale);
      drawUnit(ctx, {
        x: 0, y: 0, facing: -0.35, gait: g.time * 4 + def.cost,
        seed: def.cost, hitFlash: 0, attackTimer: 0, broodTimer: 0, mendTimer: 0,
      }, def, g.time, 1);
      ctx.restore();

      this.text(ctx, def.name, card.x + card.w / 2, card.y + 118, {
        size: 19, weight: 700, align: 'center', color: '#f0dcff', maxWidth: card.w - 24,
      });
      this.text(ctx, `${def.cost} Aether · ${BEHAVIOUR_LABEL[def.behavior] ?? def.behavior}`,
        card.x + card.w / 2, card.y + 138, {
          size: 12, align: 'center', color: '#c2a8e8', maxWidth: card.w - 24,
        });
      this.wrap(ctx, def.role, card.w - 34, { size: 12.5 }).forEach((line, i) => {
        this.text(ctx, line, card.x + card.w / 2, card.y + 162 + i * 17, {
          size: 12.5, align: 'center', color: PALETTE.uiDim,
        });
      });
      this.text(ctx, `${def.maxHp} HP · ${def.damage > 0 ? `${def.damage} damage` : 'no attack'}`,
        card.x + card.w / 2, card.y + card.h - 34, {
          size: 11.5, align: 'center', color: PALETTE.ui, maxWidth: card.w - 24,
        });
      this.text(ctx, `press ${card.index + 1}`, card.x + card.w / 2, card.y + card.h - 14, {
        size: 10.5, align: 'center', color: PALETTE.uiDim,
      });
    }
    ctx.restore();
  }

  drawUnitTooltip(ctx, id, rects) {
    const g = this.game;
    const def = UNITS[id];
    const rect = rects.find((r) => r.id === id);
    const w = 268;
    const pad = 12;

    // Every entry wraps, so a long note never gets clipped.
    const lines = [];
    const add = (text, dim = true) => {
      for (const line of this.wrap(ctx, text, w - pad * 2, { size: 11.5 })) lines.push({ text: line, dim });
    };
    add(def.role);
    const dmg = def.damage > 0 ? `${Math.round(def.damage * g.mods.damageMult)} damage · ` : '';
    add(`${Math.round(def.maxHp * g.mods.hpMult)} HP · ${dmg}${Math.round(def.speed * g.mods.speedMult)} speed`, false);
    if (def.behavior === 'support') add(`Aura ${def.auraRadius}`);
    else if (def.attackRange > 0) add(`Range ${def.attackRange}`);
    if (def.aoeResist) add(`Takes ${Math.round(def.aoeResist * 100)}% less from champion abilities`);
    if (def.behavior === 'support') add('Slows the champion and marks it for extra damage');
    if (def.behavior === 'ranged') add('Backs away to keep its range advantage');
    if (def.behavior === 'ambush') {
      add(`Untouchable while burrowed; surfaces within ${def.surfaceRange} and its first hit deals ${def.ambushMultiplier}x damage`);
    }
    if (def.behavior === 'brood') {
      add(`Never attacks. Hatches a free Mite every ${def.attackCooldown}s and keeps ${def.standoffRange} away from the champion`);
    }
    if (def.behavior === 'mender') {
      add(`Never attacks. Heals every unit within ${def.mendRadius} for ${def.mendPerSecond}/s and keeps ${def.standoffRange} away from the champion`);
    }
    if (def.behavior === 'artillery') {
      add(`Lobs over terrain and splashes ${def.splashRadius} on impact — the only answer to summoned wisps`);
    }
    if (def.summonCooldown) add(`${def.summonCooldown}s summon cooldown`);
    add('Summon inside a well to garrison it');

    const h = 30 + lines.length * 16;
    const x = clamp(rect.x + rect.w / 2 - w / 2, 12, g.width - w - 12);
    const y = rect.y - h - 10;
    this.panel(ctx, x, y, w, h, { fill: 'rgba(10,12,20,0.97)' });
    this.text(ctx, def.name, x + pad, y + 20, { size: 13, weight: 700, color: '#e6cbff' });
    lines.forEach((line, i) => {
      this.text(ctx, line.text, x + pad, y + 38 + i * 16, {
        size: 11.5, color: line.dim ? PALETTE.uiDim : PALETTE.ui,
      });
    });
  }

  drawFrenzy(ctx) {
    const g = this.game;
    const rect = this.frenzyRect();
    const ready = g.frenzyCooldown <= 0;
    const active = g.frenzyTimer > 0;

    this.panel(ctx, rect.x, rect.y, rect.w, rect.h, {
      fill: active ? 'rgba(96,34,140,0.95)' : ready ? 'rgba(44,22,66,0.92)' : 'rgba(14,18,26,0.88)',
      stroke: active ? 'rgba(240,180,255,0.9)' : ready ? 'rgba(200,140,255,0.55)' : 'rgba(150,130,190,0.2)',
      lineWidth: active ? 2 : 1,
    });

    if (!ready) {
      ctx.save();
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
      ctx.clip();
      ctx.fillStyle = 'rgba(8,10,16,0.68)';
      ctx.fillRect(rect.x, rect.y, rect.w,
        rect.h * (g.frenzyCooldown / (CONFIG.frenzyCooldown * g.mods.frenzyCooldownMult)));
      ctx.restore();
    }

    const compact = rect.w < 84;
    this.text(ctx, 'FRENZY', rect.x + rect.w / 2, rect.y + (compact ? 25 : 28), {
      size: compact ? 11 : 13, weight: 800, align: 'center',
      color: active ? '#ffe9ff' : ready ? '#e0b6ff' : PALETTE.uiDim,
      maxWidth: rect.w - 8,
    });
    const sub = active ? `${g.frenzyTimer.toFixed(1)}s` : ready ? 'Space' : `${Math.ceil(g.frenzyCooldown)}s`;
    this.text(ctx, sub, rect.x + rect.w / 2, rect.y + (compact ? 42 : 48), {
      size: compact ? 10.5 : 12, align: 'center', color: active ? '#ffd9ff' : PALETTE.uiDim,
    });

    // Rally status sits just above the action bar.
    const staged = g.rally ? g.units.filter((u) => dist(u, g.rally) < 110).length : 0;
    const label = g.rally
      ? `Rally beacon · ${staged} staged · Space to release · Q to clear`
      : 'Right-click to set a rally beacon';
    this.text(ctx, label, g.width / 2, rect.y - 12, {
      size: 12, align: 'center', color: g.rally ? '#dcaeff' : PALETTE.uiDim,
      maxWidth: g.width - 40,
    });
  }

  drawHelpButton(ctx) {
    const g = this.game;
    const rect = this.helpButtonRect();
    const hovered = this.hit(rect, g.mouse);
    this.panel(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 14,
      fill: hovered ? 'rgba(58,28,84,0.95)' : 'rgba(14,18,26,0.88)',
      stroke: hovered ? 'rgba(226,160,255,0.8)' : 'rgba(150,130,190,0.35)',
    });
    this.text(ctx, '?', rect.x + rect.w / 2, rect.y + rect.h / 2 + 6, {
      size: 16, weight: 800, align: 'center', color: hovered ? '#f0dcff' : PALETTE.uiDim,
    });
  }

  drawMinimap(ctx) {
    const g = this.game;
    const rect = this.minimapRect();
    this.panel(ctx, rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8, { radius: 8 });

    const sx = rect.w / g.world.width;
    const sy = rect.h / g.world.height;
    const mx = (wx) => rect.x + wx * sx;
    const my = (wy) => rect.y + wy * sy;

    ctx.save();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 5);
    ctx.clip();
    ctx.fillStyle = '#1b2632';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = 'rgba(96,118,140,0.55)';
    for (const t of g.world.terrain) ctx.fillRect(mx(t.x) - 1, my(t.y) - 1, 2.4, 2.4);

    for (const well of g.world.wells) {
      ctx.beginPath();
      ctx.arc(mx(well.x), my(well.y), 4.5, 0, TAU);
      ctx.fillStyle = well.owner === 'swarm' ? '#c25bff' : '#ffd489';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = PALETTE.swarmGlow;
    for (const u of g.units) ctx.fillRect(mx(u.x) - 1, my(u.y) - 1, 2.2, 2.2);

    ctx.fillStyle = '#ffd489';
    for (const a of g.allies) ctx.fillRect(mx(a.x) - 1, my(a.y) - 1, 2.2, 2.2);

    for (const d of g.relics) {
      ctx.beginPath();
      ctx.arc(mx(d.x), my(d.y), 2, 0, TAU);
      ctx.fillStyle = d.color;
      ctx.fill();
    }

    if (g.rally) {
      ctx.strokeStyle = '#e0a8ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(mx(g.rally.x), my(g.rally.y), 5, 0, TAU);
      ctx.stroke();
    }

    const pulse = 0.5 + Math.sin(g.time * 4) * 0.5;
    ctx.beginPath();
    ctx.arc(mx(g.hero.x), my(g.hero.y), 3.5 + pulse * 2.5, 0, TAU);
    ctx.fillStyle = `rgba(255,220,150,${0.35 + pulse * 0.4})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx(g.hero.x), my(g.hero.y), 3, 0, TAU);
    ctx.fillStyle = '#fff0c4';
    ctx.fill();

    const view = g.viewRect();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(view.x), my(view.y), view.w * sx, view.h * sy);
    ctx.restore();
  }

  drawObjectives(ctx) {
    const g = this.game;
    if (g.phase !== 'playing' || g.helpVisible) return;

    // A rotating opening prompt that teaches the three verbs, then retires.
    const tips = [
      { until: 14, text: 'Left-click anywhere to open a rift and summon a Mite' },
      { until: 30, text: 'Summon inside a glowing well to capture it — more Aether, and the champion loses a place to heal' },
      { until: 48, text: 'Right-click to place a rally beacon: the swarm gathers there instead of trickling in' },
      { until: 66, text: 'Press Space to Frenzy — it releases the staged swarm and buffs it for a few seconds' },
      { until: 80, text: 'Press ? or H at any time for the full guide' },
    ];
    const tip = tips.find((t) => g.time < t.until);
    if (!tip) return;
    const prev = tips[tips.indexOf(tip) - 1];
    const start = prev ? prev.until : 1.5;
    const alpha = clamp((g.time - start) / 1.2, 0, 1) * clamp((tip.until - g.time) / 1.5, 0, 1);
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    const w = this.measure(ctx, tip.text, { size: 13 }) + 28;
    const x = g.width / 2 - w / 2;
    const y = this.frenzyRect().y - 62;
    this.panel(ctx, x, y, w, 30, { fill: 'rgba(12,14,22,0.9)', radius: 15 });
    this.text(ctx, tip.text, g.width / 2, y + 20, {
      size: 13, align: 'center', color: '#d8c8f4', maxWidth: w - 24,
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- overlays

  dim(ctx, alpha = 0.72) {
    ctx.fillStyle = `rgba(6,8,13,${alpha})`;
    ctx.fillRect(0, 0, this.game.width, this.game.height);
  }

  drawCenter(ctx, title, subtitle) {
    const g = this.game;
    this.dim(ctx);
    this.text(ctx, title, g.width / 2, g.height / 2 - 10, {
      size: 52, weight: 800, align: 'center', color: '#fff',
    });
    this.text(ctx, subtitle, g.width / 2, g.height / 2 + 26, {
      size: 17, align: 'center', color: PALETTE.uiDim, maxWidth: g.width - 80,
    });
  }

  drawIntro(ctx) {
    const g = this.game;
    this.dim(ctx, 0.68);
    const w = Math.min(680, g.width - 60);
    const h = 366;
    const x = (g.width - w) / 2;
    const y = g.height / 2 - h / 2;
    this.panel(ctx, x, y, w, h, { fill: 'rgba(10,12,20,0.95)', radius: 14 });

    this.text(ctx, 'SWARM vs HERO', g.width / 2, y + 56, {
      size: 38, weight: 800, align: 'center', color: '#e8ccff',
    });
    this.text(ctx, `${article(g.heroClass.name)} ${g.heroClass.name} has entered the rift-lands — ${g.heroClass.blurb}`,
      g.width / 2, y + 84, { size: 14, align: 'center', color: PALETTE.hero, maxWidth: w - 48 });

    const lines = [
      'You are the swarm mind. Open rifts, hold the aether wells,',
      'and break the champion before it finishes ascending.',
      '',
      'Every unit it kills makes it stronger. Feed it nothing.',
      '',
      'Left-click summons · Right-click rallies · Space unleashes',
    ];
    lines.forEach((line, i) => {
      if (!line) return;
      this.text(ctx, line, g.width / 2, y + 124 + i * 22, {
        size: 14, align: 'center', color: i >= 5 ? PALETTE.uiDim : PALETTE.ui, maxWidth: w - 48,
      });
    });

    const helpRect = this.introHelpRect();
    const hovered = this.hit(helpRect, g.mouse);
    this.panel(ctx, helpRect.x, helpRect.y, helpRect.w, helpRect.h, {
      fill: hovered ? 'rgba(62,30,92,0.96)' : 'rgba(28,20,44,0.94)',
      stroke: 'rgba(200,150,255,0.55)',
    });
    this.text(ctx, 'Read the guide  (H)', helpRect.x + helpRect.w / 2, helpRect.y + 25, {
      size: 14, weight: 700, align: 'center', color: '#e6cbff',
    });

    const pulse = 0.6 + Math.sin(g.time * 3) * 0.4;
    this.text(ctx, 'Click anywhere else to begin', g.width / 2, y + h - 24, {
      size: 14, weight: 700, align: 'center',
      color: `rgba(226,182,255,${0.45 + pulse * 0.55})`,
    });
  }

  drawUpgrades(ctx) {
    const g = this.game;
    this.dim(ctx, 0.8);
    this.text(ctx, 'THE SWARM EVOLVES', g.width / 2, g.height / 2 - 140, {
      size: 32, weight: 800, align: 'center', color: '#e8ccff',
    });
    this.text(ctx, 'Choose one mutation — it lasts the rest of the run', g.width / 2, g.height / 2 - 110, {
      size: 15, align: 'center', color: PALETTE.uiDim, maxWidth: g.width - 60,
    });

    // Cards fade in across the input-settling window, so "not clickable yet"
    // is visible rather than surprising.
    const live = clamp(g.panelAge / CONFIG.panelInputDelay, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.25 + live * 0.75;
    for (const card of this.upgradeCardRects()) {
      const hovered = live >= 1 && this.hit(card, g.mouse);
      this.panel(ctx, card.x, card.y, card.w, card.h, {
        fill: hovered ? 'rgba(62,30,92,0.97)' : 'rgba(18,20,32,0.95)',
        stroke: hovered ? 'rgba(230,170,255,0.9)' : 'rgba(160,130,210,0.35)',
        lineWidth: hovered ? 2 : 1,
        radius: 12,
      });

      ctx.save();
      ctx.translate(card.x + card.w / 2, card.y + 48);
      ctx.rotate(g.time * 0.5);
      ctx.strokeStyle = hovered ? '#e6b6ff' : '#8f6fc0';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.arc(0, 0, 12 + i * 6, i * 1.1, i * 1.1 + 4.2);
        ctx.stroke();
      }
      ctx.restore();

      this.text(ctx, card.upgrade.name, card.x + card.w / 2, card.y + 98, {
        size: 17, weight: 700, align: 'center', color: '#f0dcff', maxWidth: card.w - 24,
      });
      this.wrap(ctx, card.upgrade.desc, card.w - 34, { size: 13 }).forEach((line, i) => {
        this.text(ctx, line, card.x + card.w / 2, card.y + 124 + i * 18, {
          size: 13, align: 'center', color: PALETTE.uiDim,
        });
      });
    }
    ctx.restore();
  }

  drawEnd(ctx, title, subtitle, color) {
    const g = this.game;
    this.dim(ctx, 0.82);
    this.text(ctx, title, g.width / 2, g.height / 2 - 70, {
      size: 62, weight: 800, align: 'center', color,
    });
    this.text(ctx, subtitle, g.width / 2, g.height / 2 - 26, {
      size: 16, align: 'center', color: PALETTE.ui, maxWidth: g.width - 80,
    });

    const summary = [
      `Survived ${Math.floor(g.time / 60)}m ${String(Math.floor(g.time % 60)).padStart(2, '0')}s · ${g.takenUpgrades.length} mutations`,
      `${Math.round(g.stats.damageDealt)} damage dealt · ${g.stats.lost} units lost · ${g.stats.spawned} summoned`,
      `Champion: ${g.heroClass.name} ${g.heroStats().name} (tier ${g.hero.stage + 1}/${HERO_STAGES.length})`,
    ];
    summary.forEach((line, i) => {
      this.text(ctx, line, g.width / 2, g.height / 2 + 4 + i * 20, {
        size: 13, align: 'center', color: PALETTE.uiDim, maxWidth: g.width - 80,
      });
    });

    const rect = this.restartRect();
    const hovered = this.hit(rect, g.mouse);
    this.panel(ctx, rect.x, rect.y, rect.w, rect.h, {
      fill: hovered ? 'rgba(74,34,110,0.97)' : 'rgba(34,20,52,0.95)',
      stroke: 'rgba(226,170,255,0.6)',
      lineWidth: hovered ? 2 : 1,
    });
    this.text(ctx, 'Fight again', rect.x + rect.w / 2, rect.y + 22, {
      size: 16, weight: 700, align: 'center', color: '#f0dcff',
    });
    this.text(ctx, 'R or Enter', rect.x + rect.w / 2, rect.y + 38, {
      size: 11, align: 'center', color: PALETTE.uiDim,
    });
  }

  // ------------------------------------------------------------------- help

  drawHelp(ctx) {
    const g = this.game;
    this.dim(ctx, 0.9);
    const panel = this.helpPanelRect();
    this.panel(ctx, panel.x, panel.y, panel.w, panel.h, { fill: 'rgba(10,12,20,0.98)', radius: 14 });

    this.text(ctx, 'Field Guide', panel.x + 24, panel.y + 38, {
      size: 24, weight: 800, color: '#e8ccff',
    });
    this.text(ctx, 'H or Esc to close', panel.x + panel.w - 24, panel.y + 36, {
      size: 12, align: 'right', color: PALETTE.uiDim,
    });

    for (const tab of this.helpTabRects()) {
      const active = tab.page === this.helpPage;
      const hovered = this.hit(tab, g.mouse);
      this.panel(ctx, tab.x, tab.y, tab.w, tab.h, {
        radius: 7,
        fill: active ? 'rgba(66,32,98,0.98)' : hovered ? 'rgba(34,26,52,0.95)' : 'rgba(18,20,30,0.9)',
        stroke: active ? 'rgba(226,160,255,0.85)' : 'rgba(140,120,180,0.3)',
      });
      this.text(ctx, tab.title, tab.x + tab.w / 2, tab.y + 20, {
        size: 12.5, weight: active ? 800 : 600, align: 'center',
        color: active ? '#f0dcff' : PALETTE.uiDim, maxWidth: tab.w - 10,
      });
    }

    const bodyX = panel.x + 26;
    const bodyY = panel.y + 112;
    const bodyW = panel.w - 52;
    const page = HELP_PAGES[this.helpPage];

    // Hard clip: whatever a page renders, it cannot escape the panel.
    ctx.save();
    roundRect(ctx, panel.x + 8, bodyY - 20, panel.w - 16, panel.y + panel.h - bodyY + 8, 10);
    ctx.clip();
    if (page.title === 'Your units') this.drawHelpUnits(ctx, bodyX, bodyY, bodyW);
    else if (page.title === 'The champion') this.drawHelpChampion(ctx, bodyX, bodyY, bodyW);
    else this.drawHelpText(ctx, page, bodyX, bodyY, bodyW);
    ctx.restore();
  }

  /**
   * Prose pages shrink to fit rather than running off the bottom of the panel,
   * which is what used to happen on short windows and on the longer pages.
   */
  drawHelpText(ctx, page, x, y, w) {
    const panel = this.helpPanelRect();
    const available = panel.y + panel.h - 22 - y;
    let needed = 0;
    for (const [, lines] of page.body) needed += 22 + lines.length * 19 + 12;
    const k = clamp(available / Math.max(1, needed), 0.62, 1);

    let cursorY = y;
    for (const [heading, lines] of page.body) {
      this.text(ctx, heading, x, cursorY, { size: 14 * k, weight: 800, color: PALETTE.hero });
      cursorY += 22 * k;
      for (const line of lines) {
        this.text(ctx, line, x, cursorY, { size: 13 * k, color: PALETTE.ui, maxWidth: w });
        cursorY += 19 * k;
      }
      cursorY += 12 * k;
    }
  }

  drawHelpUnits(ctx, x, y, w) {
    const g = this.game;
    // The roster no longer fits one column on a short window, so it splits
    // into two the moment a single column would run past the panel edge.
    const panel = this.helpPanelRect();
    const available = panel.y + panel.h - 26 - y;
    const cols = UNIT_ORDER.length * 42 > available ? 2 : 1;
    const perCol = Math.ceil(UNIT_ORDER.length / cols);
    const row = clamp(available / perCol, 42, 62);
    const colGap = 18;
    const colW = (w - (cols - 1) * colGap) / cols;
    const dense = cols > 1 || row < 56;

    UNIT_ORDER.forEach((id, i) => {
      const def = UNITS[id];
      const colX = x + Math.floor(i / perCol) * (colW + colGap);
      const cursorY = y + (i % perCol) * row;

      ctx.save();
      ctx.translate(colX + 22, cursorY + 14);
      const scale = Math.min(1.1, 18 / def.radius);
      ctx.scale(scale, scale);
      drawUnit(ctx, {
        x: 0, y: 0, facing: -0.3, gait: g.time * 4 + def.cost,
        seed: def.cost, hitFlash: 0, attackTimer: 0, broodTimer: 0, mendTimer: 0,
      }, def, g.time, 1);
      ctx.restore();

      const tx = colX + 54;
      const metaText = dense
        ? `${def.cost}a · ${def.unlockAt}s`
        : `${def.cost} Aether · unlocks at ${def.unlockAt}s · key ${def.hotkey}`;
      const metaW = this.measure(ctx, metaText, { size: 11.5 });
      this.text(ctx, def.name, tx, cursorY + 10, {
        size: 13.5, weight: 700, color: '#e6cbff', maxWidth: colW - 62 - metaW,
      });
      this.text(ctx, metaText, colX + colW, cursorY + 10, {
        size: 11.5, align: 'right', color: PALETTE.uiDim,
      });
      this.text(ctx, def.role, tx, cursorY + 26, { size: 12, color: PALETTE.ui, maxWidth: colW - 60 });

      let detail;
      if (def.behavior === 'support') {
        detail = `${def.maxHp} HP · aura ${def.auraRadius} · slows and marks the champion`;
      } else if (def.behavior === 'brood') {
        detail = `${def.maxHp} HP · no attack · hatches a Mite every ${def.attackCooldown}s`;
      } else if (def.behavior === 'mender') {
        detail = `${def.maxHp} HP · no attack · heals ${def.mendPerSecond}/s within ${def.mendRadius}`;
      } else if (def.behavior === 'ambush') {
        detail = `${def.maxHp} HP · ${def.damage} damage · ${def.ambushMultiplier}x on the ambush hit · untargetable while burrowed`;
      } else {
        detail = `${def.maxHp} HP · ${def.damage} damage · range ${def.attackRange}${def.aoeResist ? ` · ${Math.round(def.aoeResist * 100)}% ability resist` : ''}`;
      }
      if (!dense) {
        this.text(ctx, detail, tx, cursorY + 42, { size: 11.5, color: PALETTE.uiDim, maxWidth: colW - 60 });
      }
    });

    if (dense) {
      this.text(ctx, 'Hover a unit card in game for its full stat line.',
        x, panel.y + panel.h - 30, { size: 11.5, color: PALETTE.uiDim });
    }
  }

  drawHelpChampion(ctx, x, y, w) {
    const g = this.game;
    this.text(ctx, 'It climbs this ladder on experience, and killing your units is where',
      x, y, { size: 13, color: PALETTE.ui, maxWidth: w });
    this.text(ctx, 'nearly all of it comes from. Each tier adds a new ability.',
      x, y + 19, { size: 13, color: PALETTE.ui, maxWidth: w });

    let cursorY = y + 50;
    HERO_STAGES.forEach((stage, i) => {
      const reached = g.hero.stage >= i;
      const current = g.hero.stage === i;
      const ability = stage.ability ? HERO_ABILITIES[stage.ability] : null;

      ctx.save();
      ctx.globalAlpha = reached ? 1 : 0.55;
      this.text(ctx, `${i + 1}. ${stage.name}`, x, cursorY, {
        size: 13.5, weight: current ? 800 : 700,
        color: current ? '#ffd98a' : reached ? PALETTE.ui : PALETTE.uiDim,
      });
      this.text(ctx, `${stage.maxHp} HP · ${stage.damage} damage`, x + 150, cursorY, {
        size: 12, color: PALETTE.uiDim,
      });
      this.text(ctx, ability ? `${ability.name}: ${this.abilityBlurb(stage.ability)}` : 'no ability',
        x + 300, cursorY, { size: 12, color: ability ? '#ffb0a0' : PALETTE.uiDim, maxWidth: w - 300 });
      ctx.restore();
      cursorY += 22;
    });

    cursorY += 14;
    this.text(ctx, 'Reading its telegraphs', x, cursorY, { size: 14, weight: 800, color: PALETTE.hero });
    cursorY += 22;
    for (const line of [
      'A red circle or lane on the ground means damage is about to land there.',
      'The bright inner ring filling up is the timer. Move the beacon and your',
      'swarm walks out of it. Maulers take far less; Flingers and Mites die.',
      'Judgment deliberately targets your densest cluster — never blob under it.',
    ]) {
      this.text(ctx, line, x, cursorY, { size: 13, color: PALETTE.ui, maxWidth: w });
      cursorY += 19;
    }

    cursorY += 14;
    this.text(ctx, 'Archetypes', x, cursorY, { size: 14, weight: 800, color: PALETTE.hero });
    cursorY += 22;
    for (const line of [
      'Templar tanks · Duelist swings fast · Arcanist casts wide · Huntress kites.',
      'Summoner calls wisps that fight beside it. Wisps burn out on their own, pay',
      'Aether when killed, and give no experience — but only a Bombardier can',
      'reach them without your swarm walking into the champion first.',
    ]) {
      this.text(ctx, line, x, cursorY, { size: 13, color: PALETTE.ui, maxWidth: w });
      cursorY += 19;
    }
  }

  abilityBlurb(id) {
    switch (id) {
      case 'pulse': return 'small burst around itself';
      case 'shockwave': return 'wide ring of damage';
      case 'dash': return 'charges through a lane';
      case 'bladestorm': return 'spins, damaging repeatedly';
      case 'judgment': return 'hits your densest cluster';
      case 'nova': return 'huge arena-wide blast';
      default: return '';
    }
  }
}
