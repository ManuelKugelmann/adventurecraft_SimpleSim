// config.js — Templates, constants, tuning knobs

const CONFIG = {
  GRID_WIDTH: 80,
  GRID_HEIGHT: 80,
  TICK_MS: 200,           // default ms per tick (5 tps)
  SPEED_OPTIONS: [200, 100, 40, 0],  // ms per tick at 1x, 2x, 5x, max

  // Terrain generation
  WATER_BLOBS: 5,
  WATER_BLOB_SIZE: 30,
  ROCK_CLUSTERS: 4,
  ROCK_CLUSTER_SIZE: 15,

  // Initial populations
  INITIAL_GRASS: 400,
  INITIAL_BUSH: 100,
  INITIAL_TREE: 40,
  INITIAL_RABBIT: 25,
  INITIAL_DEER: 15,
  INITIAL_PIG: 10,
  INITIAL_BEAR: 4,
  INITIAL_FOX: 8,
  INITIAL_WOLF: 6,

  // Biology tuning
  HUNGER_RATE: 0.4,       // hunger increase per tick (animals)
  ENERGY_DRAIN: 0.2,      // energy decrease per tick (animals)
  REPRO_URGE_RATE: 0.15,  // reproduction urge increase per tick
  MAX_AGE_MULTIPLIER: 1,  // multiply species maxAge by this

  // Plant tuning
  PLANT_SPREAD_CHANCE: 0.008,
  PLANT_GROW_RATE: 0.02,
  MAX_PLANTS_PER_TILE: 1,

  // Group tuning
  GROUP_CELL_SIZE: 8,
  HERD_THRESHOLD: 3,      // min count for herd safety bonus
  PACK_THRESHOLD: 2,      // min count for pack hunt bonus
  DISPERSE_THRESHOLD: 6,  // large group dispersion kicks in
};

const TILE_TYPES = {
  grass: { symbol: '·', color: '#4a7c3f', bg: '#2d4a1e' },
  water: { symbol: '~', color: '#3a6ea5', bg: '#1a3a5c' },
  dirt:  { symbol: ',', color: '#8b7355', bg: '#3d2e1a' },
  rock:  { symbol: '░', color: '#707070', bg: '#3a3a3a' },
};

// Template definitions — each species is a template with default traits
const TEMPLATES = {
  grass: {
    category: 'plant',
    symbol: '♣',
    color: '#6dbf5c',
    renderPriority: 0,
    traits: {
      vitals: { hp: 3, maxHp: 3, maxAge: 300 },
      growth: { stage: 0, maxStage: 2, growRate: 0.02, spreadChance: 0.01, spreadCooldown: 0 },
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
    },
  },
  bush: {
    category: 'plant',
    symbol: '❀',
    color: '#3d8b37',
    renderPriority: 1,
    traits: {
      vitals: { hp: 5, maxHp: 5, maxAge: 500 },
      growth: { stage: 0, maxStage: 2, growRate: 0.015, spreadChance: 0.006, spreadCooldown: 0 },
      diet: { eats: [], eatenBy: ['herbivore', 'omnivore'] },
    },
  },
  tree: {
    category: 'plant',
    symbol: '♠',
    color: '#2d6b27',
    renderPriority: 2,
    traits: {
      vitals: { hp: 10, maxHp: 10, maxAge: 2000 },
      growth: { stage: 0, maxStage: 2, growRate: 0.005, spreadChance: 0.002, spreadCooldown: 0 },
      diet: { eats: [], eatenBy: ['herbivore'] },
    },
  },
  rabbit: {
    category: 'herbivore',
    symbol: '◆',
    color: '#d4a574',
    renderPriority: 10,
    traits: {
      vitals: { hp: 5, maxHp: 5, maxAge: 400, hunger: 20, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 3, perception: 4 },
      diet: { eats: ['plant'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'grazer', activePlan: null, activePlanStep: 0 },
    },
  },
  deer: {
    category: 'herbivore',
    symbol: '◇',
    color: '#c4935a',
    renderPriority: 11,
    traits: {
      vitals: { hp: 8, maxHp: 8, maxAge: 600, hunger: 20, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 2, perception: 5 },
      diet: { eats: ['plant'], eatenBy: ['carnivore', 'omnivore'] },
      agency: { activeRole: 'grazer', activePlan: null, activePlanStep: 0 },
    },
  },
  pig: {
    category: 'omnivore',
    symbol: '●',
    color: '#dba8b0',
    renderPriority: 20,
    traits: {
      vitals: { hp: 10, maxHp: 10, maxAge: 500, hunger: 20, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 1, perception: 3 },
      diet: { eats: ['plant', 'herbivore'], eatenBy: ['carnivore'] },
      agency: { activeRole: 'forager', activePlan: null, activePlanStep: 0 },
    },
  },
  bear: {
    category: 'omnivore',
    symbol: '■',
    color: '#8b4513',
    renderPriority: 21,
    traits: {
      vitals: { hp: 20, maxHp: 20, maxAge: 800, hunger: 20, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 1, perception: 5 },
      diet: { eats: ['plant', 'herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'forager', activePlan: null, activePlanStep: 0 },
      combat: { attack: 6, defense: 3 },
    },
  },
  fox: {
    category: 'carnivore',
    symbol: '▸',
    color: '#d4682b',
    renderPriority: 30,
    traits: {
      vitals: { hp: 7, maxHp: 7, maxAge: 500, hunger: 25, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 3, perception: 5 },
      diet: { eats: ['herbivore'], eatenBy: [] },
      agency: { activeRole: 'hunter', activePlan: null, activePlanStep: 0 },
      combat: { attack: 3, defense: 1 },
    },
  },
  wolf: {
    category: 'carnivore',
    symbol: '▲',
    color: '#a0a0a0',
    renderPriority: 31,
    traits: {
      vitals: { hp: 12, maxHp: 12, maxAge: 600, hunger: 25, energy: 80, reproUrge: 0, reproCooldown: 0 },
      spatial: { speed: 2, perception: 6 },
      diet: { eats: ['herbivore', 'omnivore'], eatenBy: [] },
      agency: { activeRole: 'hunter', activePlan: null, activePlanStep: 0 },
      combat: { attack: 5, defense: 2 },
    },
  },
};

// Food value: how much hunger a prey reduces when eaten
const FOOD_VALUES = {
  grass: 15,
  bush: 20,
  tree: 10,
  rabbit: 35,
  deer: 50,
  pig: 45,
};
