// scenarios.js — Toggleable test scenarios for simulation experiments
//
// Each scenario defines CONFIG overrides and optional population overrides.
// Applied via Scenarios.apply(name) before World.init()/populate().
// Scenarios.reset() restores defaults.

var Scenarios = {
  _defaults: null,  // snapshot of original CONFIG values

  // Capture original CONFIG so we can restore it
  captureDefaults: function() {
    if (this._defaults) return;
    this._defaults = {};
    var keys = Object.keys(CONFIG);
    for (var i = 0; i < keys.length; i++) {
      this._defaults[keys[i]] = CONFIG[keys[i]];
    }
  },

  // Restore CONFIG to original values
  reset: function() {
    if (!this._defaults) return;
    var keys = Object.keys(this._defaults);
    for (var i = 0; i < keys.length; i++) {
      CONFIG[keys[i]] = this._defaults[keys[i]];
    }
  },

  // Apply a named scenario (overrides CONFIG)
  apply: function(name) {
    this.reset();
    var scenario = SCENARIO_DEFS[name];
    if (!scenario || !scenario.config) return;
    var keys = Object.keys(scenario.config);
    for (var i = 0; i < keys.length; i++) {
      CONFIG[keys[i]] = scenario.config[keys[i]];
    }
  },

  // List scenario names
  list: function() {
    return Object.keys(SCENARIO_DEFS);
  },
};

var SCENARIO_DEFS = {
  'default': {
    label: 'Default',
    desc: 'Standard configuration — all species, default tuning.',
    config: {},
  },

  'herbivore-only': {
    label: 'Herbivore Only',
    desc: 'No predators. Tests plant-herbivore balance and population growth.',
    config: {
      INITIAL_FOX: 0,
      INITIAL_WOLF: 0,
      INITIAL_BEAR: 0,
      INITIAL_PIG: 0,
      INITIAL_RABBIT: 8,
      INITIAL_DEER: 6,
    },
  },

  'predator-prey': {
    label: 'Predator-Prey',
    desc: 'Classic Lotka-Volterra: rabbits vs foxes only.',
    config: {
      INITIAL_RABBIT: 12,
      INITIAL_DEER: 0,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 4,
      INITIAL_WOLF: 0,
    },
  },

  'carnivore-stress': {
    label: 'Carnivore Stress',
    desc: 'Many predators, few prey. Tests population collapse speed.',
    config: {
      INITIAL_RABBIT: 3,
      INITIAL_DEER: 2,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 3,
      INITIAL_FOX: 6,
      INITIAL_WOLF: 5,
    },
  },

  'plant-only': {
    label: 'Plant Growth',
    desc: 'No animals. Watch plant spread and seed production.',
    config: {
      INITIAL_RABBIT: 0,
      INITIAL_DEER: 0,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 0,
      INITIAL_WOLF: 0,
    },
  },

  'social-alarm': {
    label: 'Social Alarm',
    desc: 'Gregarious deer herds + wolves. Tests alarm signals and flee behavior.',
    config: {
      INITIAL_RABBIT: 0,
      INITIAL_DEER: 10,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 0,
      INITIAL_WOLF: 4,
    },
  },

  'single-lifecycle': {
    label: 'Single Lifecycle',
    desc: 'One small rabbit group on a small seed of randomness. Track full lifecycle.',
    config: {
      INITIAL_RABBIT: 1,
      INITIAL_DEER: 0,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 0,
      INITIAL_WOLF: 0,
    },
  },

  'overcrowded': {
    label: 'Overcrowded',
    desc: 'Dense population. Tests merge/split, food competition, starvation.',
    config: {
      INITIAL_RABBIT: 20,
      INITIAL_DEER: 15,
      INITIAL_PIG: 10,
      INITIAL_BEAR: 5,
      INITIAL_FOX: 10,
      INITIAL_WOLF: 8,
    },
  },

  'sparse': {
    label: 'Sparse',
    desc: 'Minimal population. Tests survival and reproduction from near-extinction.',
    config: {
      INITIAL_RABBIT: 1,
      INITIAL_DEER: 1,
      INITIAL_PIG: 1,
      INITIAL_BEAR: 1,
      INITIAL_FOX: 1,
      INITIAL_WOLF: 1,
    },
  },

  'balanced': {
    label: 'Balanced Ecosystem',
    desc: 'Tuned 3:1 prey-predator ratio. Should sustain 500+ ticks.',
    config: {
      INITIAL_RABBIT: 10,
      INITIAL_DEER: 8,
      INITIAL_PIG: 4,
      INITIAL_BEAR: 1,
      INITIAL_FOX: 3,
      INITIAL_WOLF: 2,
    },
  },

  'omnivore-test': {
    label: 'Omnivore Test',
    desc: 'Pigs and bears only. Tests omnivore diet switching between plants and prey.',
    config: {
      INITIAL_RABBIT: 6,
      INITIAL_DEER: 0,
      INITIAL_PIG: 6,
      INITIAL_BEAR: 3,
      INITIAL_FOX: 0,
      INITIAL_WOLF: 0,
    },
  },

  'fast-metabolism': {
    label: 'Fast Metabolism',
    desc: 'Doubled hunger/thirst rates. Tests urgency of feeding behavior.',
    config: {
      HUNGER_RATE: 0.8,
      THIRST_RATE: 0.5,
      ENERGY_DRAIN: 0.3,
      INITIAL_RABBIT: 6,
      INITIAL_DEER: 4,
      INITIAL_FOX: 2,
      INITIAL_WOLF: 1,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
    },
  },

  'slow-world': {
    label: 'Slow World',
    desc: 'Halved drain rates, slow reproduction. Longer cycles, stable ecosystems.',
    config: {
      HUNGER_RATE: 0.2,
      THIRST_RATE: 0.12,
      ENERGY_DRAIN: 0.08,
      BIRTH_RATE: 0.02,
      STARVE_RATE: 0.04,
      PLANT_GROW_RATE: 0.4,
      INITIAL_RABBIT: 6,
      INITIAL_DEER: 4,
      INITIAL_FOX: 2,
      INITIAL_WOLF: 1,
      INITIAL_PIG: 2,
      INITIAL_BEAR: 1,
    },
  },

  'mega-herds': {
    label: 'Mega Herds',
    desc: 'Large max group size, many herbivores. Tests compound statistics at scale.',
    config: {
      MAX_GROUP_SIZE: 100,
      INITIAL_RABBIT: 15,
      INITIAL_DEER: 12,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 3,
      INITIAL_WOLF: 2,
    },
  },

  'stone-world': {
    label: 'Stone World',
    desc: 'Many stones blocking movement. Tests pathfinding and transport system.',
    config: {
      INITIAL_STONE: 20,
      INITIAL_RABBIT: 6,
      INITIAL_DEER: 4,
      INITIAL_PIG: 0,
      INITIAL_BEAR: 0,
      INITIAL_FOX: 2,
      INITIAL_WOLF: 1,
    },
  },
};
