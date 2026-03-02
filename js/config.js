// config.js — Templates, constants, tuning knobs
// Multiscale region-graph simulation

var CONFIG = {
  GRID_WIDTH: 80,
  GRID_HEIGHT: 80,
  TICK_MS: 200,
  SPEED_OPTIONS: [200, 100, 40, 0],

  // Region generation
  WATER_BLOBS: 5,
  WATER_BLOB_SIZE: 30,
  ROCK_CLUSTERS: 4,
  ROCK_CLUSTER_SIZE: 15,
  REGION_MIN_SIZE: 12,
  REGION_MAX_SIZE: 120,

  // Initial group spawns (number of groups, not individuals)
  INITIAL_GRASS: 0,    // auto: one per walkable region
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
  ENERGY_DRAIN: 0.15,
  PLANT_GROW_RATE: 0.8,
  PLANT_MAX_DENSITY: 5,    // max count per tile in region
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
};

var TILE_TYPES = {
  grass: { symbol: '·', color: '#4a7c3f', bg: '#2d4a1e' },
  water: { symbol: '~', color: '#3a6ea5', bg: '#1a3a5c' },
  dirt:  { symbol: ',', color: '#8b7355', bg: '#3d2e1a' },
  rock:  { symbol: '░', color: '#707070', bg: '#3a3a3a' },
};

var TEMPLATES = {
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
    category: 'item',
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
    category: 'item',
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
  // --- Herbivores ---
  rabbit: {
    category: 'herbivore',
    symbol: '◆',
    color: '#d4a574',
    renderPriority: 10,
    defaultCount: 10,
    strength: 1,
    traits: {
      vitals: { hunger: 20, energy: 80 },
      spatial: { speed: 3 },
      diet: { eats: ['plant', 'item'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'grazer', activePlan: null, activePlanStep: 0, lastAction: null },
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
      vitals: { hunger: 20, energy: 80 },
      spatial: { speed: 2 },
      diet: { eats: ['plant', 'item'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'grazer', activePlan: null, activePlanStep: 0, lastAction: null },
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
      vitals: { hunger: 20, energy: 80 },
      spatial: { speed: 1 },
      diet: { eats: ['plant', 'item', 'herbivore'], eatenBy: ['carnivore'] },
      agency: { activeRole: 'forager', activePlan: null, activePlanStep: 0, lastAction: null },
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
      vitals: { hunger: 20, energy: 80 },
      spatial: { speed: 1 },
      diet: { eats: ['plant', 'item', 'herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'forager', activePlan: null, activePlanStep: 0, lastAction: null },
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
      vitals: { hunger: 25, energy: 80 },
      spatial: { speed: 3 },
      diet: { eats: ['herbivore'], eatenBy: [] },
      agency: { activeRole: 'hunter', activePlan: null, activePlanStep: 0, lastAction: null },
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
      vitals: { hunger: 25, energy: 80 },
      spatial: { speed: 2 },
      diet: { eats: ['herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'hunter', activePlan: null, activePlanStep: 0, lastAction: null },
      group: { mergeThreshold: 15, maxSize: 25 },
    },
  },
};
