// All tuning lives here. Gameplay code reads these; nothing here reads gameplay.

export const CONFIG = {
  worldWidth: 2600,
  worldHeight: 1800,
  arenaPadding: 40,

  cameraLerp: 5.5,
  cameraLookAhead: 90,
  zoomMin: 0.6,
  zoomMax: 1.45,
  zoomDefault: 0.95,

  // Economy
  startAether: 60,
  baseIncome: 8,
  incomePerWell: 3,
  aetherPerHeroDamage: 0.1,

  maxUnits: 90,

  // Summoning
  minSpawnDistanceFromHero: 200,
  riftOpenTime: 0.32,
  spawnInvulnTime: 0.8,

  // Rally beacon
  rallyAggroRadius: 190,

  // Frenzy
  frenzyDuration: 7,
  frenzyCooldown: 22,
  frenzySpeedMult: 1.45,
  frenzyDamageMult: 1.45,
  frenzyAbilityResist: 0.5, // while frenzied, hero abilities do half damage

  // Hero progression
  heroXpPerUnitKill: 0.85, // multiplier on unit.xpValue
  heroXpPerSecond: 1.8, // the champion trains on its own, so stalling never wins
  heroXpPerWellPurge: 55,
  ascensionTime: 70, // survive this long at final stage and the player loses
  heroWellHealFraction: 0.032, // of max HP per second, so wells matter at every tier
  heroRetreatHpFraction: 0.42,
  heroReclaimAtWells: 2,      // corrupted wells before it breaks off to purge one
  heroReclaimDuration: 26,    // gives up after this long
  heroReclaimCooldown: 14,

  // Threat ramp: slow global pressure so turtling is not free.
  threatRampPerMinute: 0.12,

  // Wells
  wellCount: 4,
  wellRadius: 74,
  wellCaptureTime: 4.4,
  wellUnitsToCapture: 2,

  // Battlefield drops. Killing a unit occasionally leaves something behind
  // that the champion can walk over, so trading bodies has a second cost.
  dropChance: 0.06,           // per unit death
  dropPermanentShare: 0.6,    // of those drops, this share are permanent relics
  maxRelicsPerRun: 9,         // hard cap on permanent relics
  maxDropsOnField: 5,
  dropLifetime: 13,

  // Modal panels swallow input this long after opening, so a held summon key
  // or an in-flight click cannot pick a card the player has not seen yet.
  panelInputDelay: 0.45,

  // Champion summons (Summoner class)
  allyAetherOnKill: 7,

  // Upgrades
  aetherPerUpgrade: 190,
  upgradeCostGrowth: 1.26, // each mutation costs 26% more Aether than the last
  maxUpgradesPerRun: 16,

  // Terrain
  terrainCount: 92,
};

export const PALETTE = {
  // Ground is a cool slate so warm hero gold and violet swarm both pop.
  groundDeep: '#1b2430',
  groundMid: '#26313d',
  groundHigh: '#31404d',
  groundAccent: '#3d5566',

  swarm: '#c25bff',
  swarmDeep: '#5a1e7a',
  swarmGlow: '#e79bff',

  hero: '#ffd98a',
  heroDeep: '#8a6320',
  heroGlow: '#fff4cf',

  danger: '#ff5470',
  good: '#6ef2a4',
  ui: '#e9e2ff',
  uiDim: '#9d95b8',
};

/**
 * Unit roster. Each entry is a distinct tactical role rather than a stat tier:
 * chaff, ranged poke, tank, support debuffer, elite.
 */
export const UNITS = {
  mite: {
    id: 'mite',
    name: 'Mite',
    role: 'Cheap chaff. Numbers over quality.',
    hotkey: '1',
    cost: 12,
    maxHp: 30,
    speed: 138,
    damage: 8,
    attackRange: 24,
    attackCooldown: 0.6,
    radius: 11,
    xpValue: 10,
    behavior: 'melee',
    unlockAt: 0,
    color: '#b750f0',
  },
  flinger: {
    id: 'flinger',
    name: 'Flinger',
    role: 'Ranged acid. Outranges the champion at every tier.',
    hotkey: '2',
    cost: 22,
    maxHp: 30,
    speed: 82,
    damage: 18,
    attackRange: 210,
    attackCooldown: 1.35,
    radius: 13,
    xpValue: 16,
    behavior: 'ranged',
    projectileSpeed: 330,
    kiteRange: 150, // backs off if the hero gets closer than this
    unlockAt: 22,
    color: '#8f5bff',
  },
  mauler: {
    id: 'mauler',
    name: 'Mauler',
    role: 'Armoured tank. Soaks area damage.',
    hotkey: '3',
    cost: 34,
    maxHp: 130,
    speed: 74,
    damage: 32,
    attackRange: 30,
    attackCooldown: 1.15,
    radius: 19,
    xpValue: 30,
    behavior: 'melee',
    aoeResist: 0.45, // takes 45% less from hero abilities
    unlockAt: 45,
    color: '#7a2f9c',
  },
  burrower: {
    id: 'burrower',
    name: 'Burrower',
    role: 'Burrows in untouchable, surfaces with a heavy ambush strike.',
    hotkey: '4',
    cost: 42,
    maxHp: 70,
    speed: 152,
    damage: 21,
    attackRange: 28,
    attackCooldown: 0.9,
    radius: 13,
    xpValue: 32,
    behavior: 'ambush',
    surfaceRange: 190, // burrows again beyond this, surfaces inside it
    ambushMultiplier: 2.5,
    unlockAt: 58,
    color: '#a13cc8',
  },
  shrieker: {
    id: 'shrieker',
    name: 'Shrieker',
    role: 'Support. Slows the hero and marks it for +damage.',
    hotkey: '5',
    cost: 30,
    maxHp: 42,
    speed: 108,
    damage: 4,
    attackRange: 175,
    attackCooldown: 1.6,
    radius: 14,
    xpValue: 22,
    behavior: 'support',
    auraRadius: 190,
    slowAmount: 0.14, // hero move speed reduction, stacks up to a cap
    markAmount: 0.09, // hero damage taken increase, stacks up to a cap
    hover: true,
    unlockAt: 70,
    color: '#5fd3ff',
  },
  matriarch: {
    id: 'matriarch',
    name: 'Matriarch',
    role: 'Hangs back and hatches free Mites for as long as she lives.',
    hotkey: '6',
    cost: 85,
    maxHp: 120,
    speed: 64,
    damage: 0,
    attackRange: 0,
    attackCooldown: 6.5, // doubles as the hatch interval
    radius: 18,
    xpValue: 46,
    behavior: 'brood',
    standoffRange: 340, // keeps this far from the champion
    broodUnit: 'mite',
    unlockAt: 88,
    color: '#8e2f6e',
  },
  mender: {
    id: 'mender',
    name: 'Mender',
    role: 'Never attacks. Knits the wounded swarm around it back together.',
    hotkey: '6',
    cost: 76,
    maxHp: 108,
    speed: 80,
    damage: 0,
    attackRange: 0,
    attackCooldown: 1, // doubles as the mend tick
    radius: 17,
    xpValue: 42,
    behavior: 'mender',
    standoffRange: 300, // hangs back like the Matriarch; she is the investment
    mendRadius: 155,
    mendPerSecond: 15,
    unlockAt: 88,
    color: '#3fb98a',
  },
  titan: {
    id: 'titan',
    name: 'Titan',
    role: 'Elite siege beast. Long cooldown.',
    hotkey: '7',
    cost: 110,
    maxHp: 520,
    speed: 84,
    damage: 60,
    attackRange: 40,
    attackCooldown: 1.0,
    radius: 32,
    xpValue: 80,
    behavior: 'melee',
    aoeResist: 0.35,
    summonCooldown: 34,
    unlockAt: 105,
    color: '#e0447a',
  },
  bombardier: {
    id: 'bombardier',
    name: 'Bombardier',
    role: 'Elite siege lobber. Outranges everything and splashes on impact.',
    hotkey: '7',
    cost: 102,
    maxHp: 175,
    speed: 64,
    damage: 52,
    attackRange: 410,
    attackCooldown: 2.6,
    radius: 22,
    xpValue: 66,
    behavior: 'artillery',
    projectileSpeed: 250,
    splashRadius: 90, // the only swarm attack that can clear the champion's wisps
    kiteRange: 250,
    summonCooldown: 26,
    unlockAt: 105,
    color: '#d2762f',
  },
};

/**
 * Action-bar slots. The first five are fixed; the last two open as a choice
 * between two units of the same weight, picked once per run, so the late game
 * is not the same roster every time.
 */
export const UNIT_SLOTS = [
  ['mite'],
  ['flinger'],
  ['mauler'],
  ['burrower'],
  ['shrieker'],
  ['matriarch', 'mender'],
  ['titan', 'bombardier'],
];

/** Every unit id, in slot order. Used for lookups, not for the action bar. */
export const UNIT_ORDER = UNIT_SLOTS.flat();

/** When slot `i` becomes available. Paired units always share an unlock time. */
export const SLOT_UNLOCK_AT = UNIT_SLOTS.map((ids) => UNITS[ids[0]].unlockAt);

/** Caps on stacking debuffs so a wall of Shriekers cannot fully lock the hero. */
export const DEBUFF_CAPS = { slow: 0.45, mark: 0.35 };

/**
 * Hero evolution ladder. The hero climbs it by killing your units, so every
 * loss is literally ammunition for the enemy.
 */
export const HERO_STAGES = [
  {
    name: 'Scout',
    xpThreshold: 0,
    maxHp: 1190,
    moveSpeed: 108,
    damage: 26,
    attackRange: 34,
    attackCooldown: 0.75,
    radius: 22,
    ability: 'pulse',
  },
  {
    name: 'Sentinel',
    xpThreshold: 260,
    maxHp: 1915,
    moveSpeed: 122,
    damage: 38,
    attackRange: 40,
    attackCooldown: 0.68,
    radius: 25,
    ability: 'shockwave',
  },
  {
    name: 'Vanguard',
    xpThreshold: 640,
    maxHp: 2530,
    moveSpeed: 134,
    damage: 50,
    attackRange: 46,
    attackCooldown: 0.6,
    radius: 28,
    ability: 'dash',
  },
  {
    name: 'Warden',
    xpThreshold: 1160,
    maxHp: 2995,
    moveSpeed: 146,
    damage: 62,
    attackRange: 52,
    attackCooldown: 0.52,
    radius: 31,
    ability: 'bladestorm',
  },
  {
    name: 'Arbiter',
    xpThreshold: 1840,
    maxHp: 3830,
    moveSpeed: 156,
    damage: 76,
    attackRange: 58,
    attackCooldown: 0.46,
    radius: 35,
    ability: 'judgment',
  },
  {
    name: 'Ascendant',
    xpThreshold: 2700,
    maxHp: 4815,
    moveSpeed: 168,
    damage: 92,
    attackRange: 66,
    attackCooldown: 0.4,
    radius: 39,
    ability: 'nova',
  },
];

/** Ability tuning, keyed by the id referenced in HERO_STAGES. */
export const HERO_ABILITIES = {
  pulse: {
    name: 'Repulse',
    cooldown: 11,
    telegraph: 0.85,
    radius: 120,
    damage: 26,
  },
  shockwave: {
    name: 'Shockwave',
    cooldown: 7.5,
    telegraph: 0.75,
    radius: 165,
    damage: 43,
  },
  dash: {
    name: 'Dash Strike',
    cooldown: 8.5,
    telegraph: 0.6,
    range: 340,
    width: 60,
    damage: 58,
  },
  bladestorm: {
    name: 'Blade Storm',
    cooldown: 10,
    telegraph: 0.8,
    duration: 1.8,
    radius: 128,
    tickDamage: 21,
    tickRate: 0.28,
  },
  judgment: {
    name: 'Judgment',
    cooldown: 9,
    telegraph: 1.15,
    radius: 145,
    damage: 118,
  },
  nova: {
    name: 'Ascendant Nova',
    cooldown: 7,
    telegraph: 0.9,
    radius: 250,
    damage: 105,
  },
};

/** Hero archetypes reroll each run so no two runs open the same way. */
export const HERO_CLASSES = [
  {
    id: 'templar',
    name: 'Templar',
    blurb: 'Heavy plate, slow but brutal in melee.',
    mods: { hpMult: 1.2, damageMult: 1.1, moveSpeedMult: 0.92 },
    attackStyle: 'melee',
    weapon: 'sword',
  },
  {
    id: 'duelist',
    name: 'Duelist',
    blurb: 'Fast blade, relentless attack speed.',
    mods: { damageMult: 0.92, moveSpeedMult: 1.14, attackCooldownMult: 0.85 },
    attackStyle: 'melee',
    weapon: 'sword',
  },
  {
    id: 'arcanist',
    name: 'Arcanist',
    blurb: 'Ranged bolts and frequent, wider abilities.',
    mods: {
      hpMult: 0.98,
      abilityCooldownMult: 0.86,
      aoeRadiusMult: 1.16,
      attackRangeBonus: 120,
    },
    attackStyle: 'ranged',
    weapon: 'staff',
    projectileSpeed: 380,
  },
  {
    id: 'summoner',
    name: 'Summoner',
    blurb: 'Calls wisps to fight for it — break the summons or drown in them.',
    mods: {
      hpMult: 0.9,
      damageMult: 0.84,
      moveSpeedMult: 0.96,
      attackRangeBonus: 100,
    },
    attackStyle: 'ranged',
    weapon: 'scepter',
    projectileSpeed: 360,
    // Wisps arrive in pairs and expire, so the pressure comes in waves.
    summons: { interval: 13, count: 2, max: 4, firstAt: 14 },
  },
  {
    id: 'huntress',
    name: 'Huntress',
    blurb: 'Kites at range, punishing to chase.',
    mods: {
      hpMult: 0.88,
      moveSpeedMult: 1.1,
      attackCooldownMult: 0.82,
      attackRangeBonus: 130,
    },
    attackStyle: 'ranged',
    weapon: 'bow',
    projectileSpeed: 460,
    kites: true,
  },
];

/** Rewards the hero picks up from the battlefield. */
export const HERO_RELICS = [
  { id: 'edge', name: 'Whetstone', desc: '+9% damage', color: '#ffcf7a', mods: { damageMult: 1.09 } },
  { id: 'boots', name: 'Windstep', desc: '+8% speed', color: '#bfe9ff', mods: { moveSpeedMult: 1.08 } },
  { id: 'ward', name: 'Aegis Sigil', desc: '+12% max HP, heal 12%', color: '#ffe6a8', mods: { hpMult: 1.12 }, heal: 0.12 },
  { id: 'focus', name: 'Focus Lens', desc: '-10% ability cooldown', color: '#d7b6ff', mods: { abilityCooldownMult: 0.9 } },
];

/**
 * Short-lived pickups. These are the common drop: loud, dangerous for a few
 * seconds, and gone again. Nothing here touches max HP — a temporary hpMult
 * would strand the champion above its own cap when it expired.
 */
export const HERO_BOONS = [
  {
    id: 'ember', name: 'Emberdraught', desc: '+30% damage for 12s',
    color: '#ff9a5c', duration: 12, mods: { damageMult: 1.3 },
  },
  {
    id: 'quick', name: 'Quickroot', desc: '+26% move speed for 12s',
    color: '#8ff0d8', duration: 12, mods: { moveSpeedMult: 1.26 },
  },
  {
    id: 'cadence', name: 'Warsong Coil', desc: '+28% attack speed for 10s',
    color: '#ffe08a', duration: 10, mods: { attackCooldownMult: 0.78 },
  },
  {
    id: 'spark', name: 'Riftspark', desc: '-35% ability cooldown for 11s',
    color: '#c9a4ff', duration: 11, mods: { abilityCooldownMult: 0.65 },
  },
  {
    id: 'sun', name: 'Sunflask', desc: 'regenerates 16% HP over 8s',
    color: '#b8ffa8', duration: 8, regen: 0.16,
  },
];

/** The Summoner's wisps. Not a hero, not a unit — its own small actor. */
export const ALLY = {
  name: 'Wisp',
  maxHp: 92,
  speed: 128,
  damage: 9,
  attackRange: 100,
  attackCooldown: 1.15,
  radius: 12,
  projectileSpeed: 330,
  lifetime: 24, // wisps burn out, so the board cannot silently fill with them
  color: '#ffd98a',
};

/**
 * Player upgrades. These are written to interact: Swarm Link rewards massing,
 * Carapace/Dispersal reward spreading, so the pool pulls in two directions.
 */
export const SWARM_UPGRADES = [
  {
    id: 'fangs',
    name: 'Razor Fangs',
    desc: '+22% unit damage',
    apply: (m) => { m.damageMult *= 1.22; },
  },
  {
    id: 'chitin',
    name: 'Thick Chitin',
    desc: '+28% unit health',
    apply: (m) => { m.hpMult *= 1.28; },
  },
  {
    id: 'brood',
    name: 'Efficient Brood',
    desc: '-16% summon cost',
    apply: (m) => { m.costMult *= 0.84; },
  },
  {
    id: 'nodes',
    name: 'Arc Nodes',
    desc: '+2.5 Aether per second',
    apply: (m) => { m.incomeBonus += 2.5; },
  },
  {
    id: 'venom',
    name: 'Venom Wind',
    desc: '+18% swarm move speed',
    apply: (m) => { m.speedMult *= 1.18; },
  },
  {
    id: 'volatile',
    name: 'Volatile Death',
    desc: 'Dying units burst for 22 damage nearby',
    apply: (m) => { m.deathBurst += 22; },
  },
  {
    id: 'carapace',
    name: 'Ablative Carapace',
    desc: '-35% damage from hero abilities',
    apply: (m) => { m.aoeResist = 1 - (1 - m.aoeResist) * 0.65; },
  },
  {
    id: 'link',
    name: 'Swarm Link',
    desc: '+7% damage per nearby ally (max +42%)',
    apply: (m) => { m.linkBonus += 0.07; },
  },
  {
    id: 'toxin',
    name: 'Creeping Toxin',
    desc: 'Hits stack poison on the hero',
    apply: (m) => { m.toxinStack += 1.4; },
  },
  {
    id: 'rift',
    name: 'Rift Mastery',
    desc: 'Summon 60px closer, +0.35s spawn immunity',
    apply: (m) => { m.spawnRangeBonus += 60; m.spawnInvulnBonus += 0.35; },
  },
  {
    id: 'bloodrite',
    name: 'Blood Rite',
    desc: '+80% Aether from damaging the hero',
    apply: (m) => { m.damageAetherMult *= 1.8; },
  },
  {
    id: 'frenzy',
    name: 'Frenzy Engine',
    desc: 'Frenzy: -25% cooldown, +2s duration',
    apply: (m) => { m.frenzyCooldownMult *= 0.75; m.frenzyDurationBonus += 2; },
  },
  {
    id: 'wells',
    name: 'Deep Roots',
    desc: 'Corrupted wells give +2 Aether/s and heal your units',
    apply: (m) => { m.wellIncomeBonus += 2; m.wellHeal = true; },
  },
  {
    id: 'dispersal',
    name: 'Dispersal Instinct',
    desc: 'Units scatter from ability telegraphs',
    apply: (m) => { m.dodgeTelegraphs = true; },
  },
];

/** Starting values for the player's accumulated modifiers. */
export const baseModifiers = () => ({
  damageMult: 1,
  hpMult: 1,
  speedMult: 1,
  costMult: 1,
  incomeBonus: 0,
  deathBurst: 0,
  aoeResist: 0,
  linkBonus: 0,
  toxinStack: 0,
  spawnRangeBonus: 0,
  spawnInvulnBonus: 0,
  damageAetherMult: 1,
  frenzyCooldownMult: 1,
  frenzyDurationBonus: 0,
  wellIncomeBonus: 0,
  wellHeal: false,
  dodgeTelegraphs: false,
});

export const baseHeroMods = () => ({
  hpMult: 1,
  damageMult: 1,
  moveSpeedMult: 1,
  attackCooldownMult: 1,
  abilityCooldownMult: 1,
  aoeRadiusMult: 1,
  attackRangeBonus: 0,
});
