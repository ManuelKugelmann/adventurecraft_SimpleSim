// config.js — Templates, constants, tuning knobs
// Multiscale hierarchy simulation

// Seeded PRNG (mulberry32) — deterministic simulation with CONFIG.RNG_SEED
var Rng = {
  _state: 12345,
  seed: function(s) { this._state = s | 0 || 1; },
  random: function() {
    var t = this._state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
};

var CONFIG = {
  GRID_WIDTH: 80,
  GRID_HEIGHT: 80,
  TICK_MS: 200,
  SPEED_OPTIONS: [200, 100, 40, 0],

  // Terrain generation
  WATER_BLOBS: 5,
  WATER_BLOB_SIZE: 30,
  ROCK_CLUSTERS: 4,
  ROCK_CLUSTER_SIZE: 15,

  // Hierarchy generation (recursive tile grouping)
  HIERARCHY_L1_MIN: 16,         // min tiles per level-1 group
  HIERARCHY_L1_MAX: 25,         // max tiles per level-1 group
  HIERARCHY_BRANCH_MIN: 3,      // min children per higher-level group
  HIERARCHY_BRANCH_MAX: 5,      // max children per higher-level group

  // Initial group spawns (number of groups, not individuals)
  INITIAL_GRASS: 0,    // auto: one per walkable L1 group
  INITIAL_BUSH: 0,     // auto: ~half of walkable regions
  INITIAL_TREE: 0,     // auto: ~quarter of walkable regions
  INITIAL_RABBIT: 4,
  INITIAL_DEER: 3,
  INITIAL_PIG: 3,
  INITIAL_BEAR: 2,
  INITIAL_FOX: 3,
  INITIAL_WOLF: 2,

  // Biology (scale-agnostic: same rate for count=1 or count=50)
  HUNGER_RATE: 0.4,
  THIRST_RATE: 0.25,
  ENERGY_DRAIN: 0.15,
  HEAL_RATE: 0.3,          // health regen per tick when well-fed and hydrated
  PLANT_GROW_RATE: 0.8,
  PLANT_MAX_DENSITY: 5,    // max count per tile in group
  SEED_DROP_RATE: 0.02,    // chance per tick that a plant drops seeds/grains

  // Group interactions — compound statistics
  FEED_RATE: 0.3,          // fraction of group that feeds per tick
  KILL_RATE: 0.15,         // base kills per predator per tick
  BIRTH_RATE: 0.04,        // fraction of group that reproduces per tick
  STARVE_RATE: 0.08,       // fraction that dies per tick when starving
  MAX_GROUP_SIZE: 40,
  MERGE_THRESHOLD: 15,     // max hunger difference for merge
  PLACEHOLDER_MAX: 5,      // simulate individuals below this count

  // Food value per kill/eat (hunger reduction per unit eaten)
  FOOD_PER_PLANT: 0.8,     // per plant count eaten → hunger reduction per group member
  FOOD_PER_PREY: 3.0,      // per prey killed → hunger reduction per predator

  // Spread: how many tiles a group occupies visually = ceil(count / SPREAD_DENSITY)
  SPREAD_DENSITY: 4,       // members per tile of spread

  // Transport: items carried between regions during movement
  CARRY_SEED_CHANCE: 0.3,    // probability of picking up seeds when moving
  CARRY_STONE_CHANCE: 0.15,  // probability of picking up stones when moving
  CARRY_FRACTION: 0.1,       // fraction of item count carried per trip

  // Stones: movement penalty when dense in a group
  STONE_SLOW_PER_TILE: 3,    // stones per tile before slowdown begins
  STONE_BLOCK_PER_TILE: 8,   // stones per tile = impassable

  // Initial stone groups
  INITIAL_STONE: 3,

  // Role priority threshold: rules at or above this act as urgent (whole group in unison)
  URGENT_PRIORITY: 80,

  // Seeded PRNG
  RNG_SEED: 42,
};

var TILE_TYPES = {
  grass: { symbol: '·', color: '#4a7c3f', bg: '#2d4a1e' },
  water: { symbol: '~', color: '#3a6ea5', bg: '#1a3a5c' },
  dirt:  { symbol: ',', color: '#8b7355', bg: '#3d2e1a' },
  rock:  { symbol: '░', color: '#707070', bg: '#3a3a3a' },
};

var TEMPLATES = {
  // --- Terrain (tile nodes, structural — parented to regions) ---
  tile_grass: { category: 'terrain', symbol: '·', color: '#4a7c3f', renderPriority: -1, defaultCount: 1, strength: 0, traits: {} },
  tile_water: { category: 'terrain', symbol: '~', color: '#3a6ea5', renderPriority: -1, defaultCount: 1, strength: 0, traits: {} },
  tile_dirt:  { category: 'terrain', symbol: ',', color: '#8b7355', renderPriority: -1, defaultCount: 1, strength: 0, traits: {} },
  tile_rock:  { category: 'terrain', symbol: '░', color: '#707070', renderPriority: -1, defaultCount: 1, strength: 0, traits: {} },
  // --- Structural containers (grouping hierarchy, all levels) ---
  tilegroup: { category: 'tilegroup', symbol: 'G', color: '#888', renderPriority: -2, defaultCount: 1, strength: 0, traits: {} },
  // --- Virtual items (signals: sounds, scents, tracks) ---
  signal: { category: 'signal', symbol: '!', color: '#666', renderPriority: -1, defaultCount: 1, strength: 0, traits: {} },
  // --- Plants (group trait for merge/split) ---
  grass: {
    category: 'plant',
    symbol: '♣',
    color: '#6dbf5c',
    renderPriority: 0,
    defaultCount: 20,
    strength: 0,
    traits: {
      vitals: { hunger: 0, energy: 100 },
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
      group: { mergeThreshold: 15, maxSize: 200 },
    },
  },
  bush: {
    category: 'plant',
    symbol: '❀',
    color: '#3d8b37',
    renderPriority: 1,
    defaultCount: 12,
    strength: 0,
    traits: {
      vitals: { hunger: 0, energy: 100 },
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
      group: { mergeThreshold: 15, maxSize: 100 },
    },
  },
  tree: {
    category: 'plant',
    symbol: '♠',
    color: '#2d6b27',
    renderPriority: 2,
    defaultCount: 5,
    strength: 0,
    traits: {
      vitals: { hunger: 0, energy: 100 },
      diet: { eats: [], eatenBy: ['herbivore'] },
      group: { mergeThreshold: 15, maxSize: 50 },
    },
  },
  // --- Items (bulk nodes, no agency, no vitals) ---
  grains: {
    category: 'seed',
    symbol: '∴',
    color: '#c8b040',
    renderPriority: 3,
    defaultCount: 10,
    strength: 0,
    traits: {
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
      group: { mergeThreshold: 999, maxSize: 200 },
    },
  },
  seeds: {
    category: 'seed',
    symbol: '·',
    color: '#a09050',
    renderPriority: 3,
    defaultCount: 8,
    strength: 0,
    traits: {
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
      group: { mergeThreshold: 999, maxSize: 200 },
    },
  },
  // --- Stones (bulk nodes, no agency, no vitals, not edible) ---
  stone: {
    category: 'item',
    symbol: '□',
    color: '#808080',
    renderPriority: 3,
    defaultCount: 15,
    strength: 0,
    traits: {
      diet: { eats: [], eatenBy: [] },
      group: { mergeThreshold: 999, maxSize: 500 },
    },
  },
  // --- Signals (virtual items: sounds, scents, tracks — decay over time) ---
  // count = ticks remaining (destroyed 1/tick by bio rules, dies at 0)
  // signal trait set dynamically on creation with kind, tokens, emitter info
  signal: {
    category: 'signal',
    symbol: '!',
    color: '#666',
    renderPriority: -1,
    defaultCount: 1,
    strength: 0,
    traits: {},
  },
  // --- Herbivores ---
  rabbit: {
    category: 'herbivore',
    symbol: '◆',
    color: '#d4a574',
    renderPriority: 10,
    defaultCount: 10,
    strength: 1,
    traits: {
      vitals: { hunger: 20, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 3, intelligence: 1 },
      social: { gregarious: 0.6 },
      diet: { eats: ['plant', 'seed'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 40 },
    },
  },
  deer: {
    category: 'herbivore',
    symbol: '◇',
    color: '#c4935a',
    renderPriority: 11,
    defaultCount: 8,
    strength: 2,
    traits: {
      vitals: { hunger: 20, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 2, intelligence: 2 },
      social: { gregarious: 0.7 },
      diet: { eats: ['plant', 'seed'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 40 },
    },
  },
  // --- Omnivores ---
  pig: {
    category: 'omnivore',
    symbol: '●',
    color: '#dba8b0',
    renderPriority: 20,
    defaultCount: 6,
    strength: 2,
    traits: {
      vitals: { hunger: 20, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 1, intelligence: 2 },
      social: { gregarious: 0.5 },
      diet: { eats: ['plant', 'seed', 'herbivore'], eatenBy: ['carnivore'] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 40 },
    },
  },
  bear: {
    category: 'omnivore',
    symbol: '■',
    color: '#8b4513',
    renderPriority: 21,
    defaultCount: 3,
    strength: 6,
    traits: {
      vitals: { hunger: 20, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 1, intelligence: 2 },
      social: { gregarious: 0.2 },
      diet: { eats: ['plant', 'seed', 'herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 20 },
    },
  },
  // --- Carnivores ---
  fox: {
    category: 'carnivore',
    symbol: '▸',
    color: '#d4682b',
    renderPriority: 30,
    defaultCount: 5,
    strength: 3,
    traits: {
      vitals: { hunger: 25, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 3, intelligence: 2 },
      social: { gregarious: 0.3 },
      diet: { eats: ['herbivore'], eatenBy: [] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 30 },
    },
  },
  wolf: {
    category: 'carnivore',
    symbol: '▲',
    color: '#a0a0a0',
    renderPriority: 31,
    defaultCount: 4,
    strength: 5,
    traits: {
      vitals: { hunger: 25, energy: 80, health: 100, thirst: 10 },
      spatial: { speed: 2, intelligence: 3 },
      social: { gregarious: 0.8 },
      diet: { eats: ['herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'animal', activePlan: null, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 25 },
    },
  },
};
