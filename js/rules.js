// rules.js — Rule layers: declarative data + engine
// Rule definitions are pure data (future target for .acf format parsing).
// Rule engine interprets the data tables against vitals and sense model.
// Three layers execute in order: L1 Biology → L2 Reflex → L0 Base (post-action).

// === L0: BASE RULE DEFINITIONS — action consequence costs (DATA) ===
// Applied after each action via Rules.applyActionCost(node, actionType).
// Maps action type → array of vital effects.
// Future .acf:  BASE graze  COST energy -= 0.5

var BASE_RULE_DEFS = {
  graze:  [{ target: 'energy', op: 'sub', amount: 0.5 }],
  hunt:   [{ target: 'energy', op: 'sub', amount: 3 }],
  rest:   [{ target: 'energy', op: 'add', amount: 5, cap: 100 }],
  move:   [{ target: 'energy', op: 'sub', amount: 0.5 }],
  flee:   [{ target: 'energy', op: 'sub', amount: 1 }],
  seek:   [{ target: 'energy', op: 'sub', amount: 1 }],
};

// === L1: BIOLOGY RULE DEFINITIONS — passive world sim (DATA) ===
// Pure vitals → vitals. No perception needed. Runs every tick on animals.
// Future .acf:  RULE hungerDrain  APPLY hunger += 0.4

var BIO_RULE_DEFS = [
  // --- Vital drains (per-tick, unconditional) ---
  { name: 'hungerDrain',   target: 'hunger', op: 'add', amount: CONFIG.HUNGER_RATE },
  { name: 'thirstDrain',   target: 'thirst', op: 'add', amount: CONFIG.THIRST_RATE,
    requires: 'thirst' },
  { name: 'energyDrain',   target: 'energy', op: 'sub', amount: CONFIG.ENERGY_DRAIN },

  // --- Passive regen ---
  { name: 'energyRegen',   target: 'energy', op: 'add', amount: 0.1, cap: 100,
    when: [['hunger', '<', 70], ['energy', '<', 100]] },
  { name: 'healthRegen',   target: 'health', op: 'add', amount: CONFIG.HEAL_RATE, cap: 100,
    requires: 'health',
    when: [['hunger', '<', 50], ['thirst', '<', 50]] },

  // --- Damage from unmet needs ---
  { name: 'dehydration',   target: 'health', op: 'sub', amount: 2,
    requires: 'health',
    when: [['thirst', '>=', 80]] },

  // --- Death ---
  { name: 'starvation',    effect: 'kill', rate: CONFIG.STARVE_RATE, min: 1,
    when: [['hunger', '>=', 90]] },
  { name: 'exhaustion',    effect: 'kill', count: 1,
    set: { energy: 0 },
    when: [['energy', '<=', 0]] },
  { name: 'healthCollapse', effect: 'kill', rate: 0.1, min: 1,
    requires: 'health',
    set: { health: 20 },
    when: [['health', '<=', 0]] },
];

// === L2: REFLEX RULE DEFINITIONS — involuntary responses (DATA) ===
// Needs perception (sense model). Runs after biology.
// These are non-voluntary behaviors — the entity doesn't choose them.
// Future .acf:  REFLEX autoDrink  WHEN thirst > 40 AND sense.water.adjacent  APPLY thirst -= 15

var REFLEX_RULE_DEFS = [
  // Auto-drink: involuntary response to water proximity
  { name: 'autoDrink',     target: 'thirst', op: 'sub', amount: 15, floor: 0,
    requires: 'thirst',
    when: [['thirst', '>', 40], ['sense.water.adjacent', '==', true]] },

  // Reproduction: biological drive, not a choice
  { name: 'reproduce',     effect: 'birth', rate: CONFIG.BIRTH_RATE, min: 1,
    cost: { hunger: 12, energy: -5 },
    when: [['hunger', '<', 40], ['energy', '>', 30],
           ['health', '>', 50], ['thirst', '<', 50], ['count', '>=', 2]] },
];

// === RULE ENGINE (CODE) ===

var Rules = {
  // L1: Passive biology — no perception needed
  biology: function(node) {
    var tmpl = TEMPLATES[node.templateId];
    if (tmpl.category === 'seed' || tmpl.category === 'item') return;

    var v = node.traits.vitals;
    if (!v) return;

    if (tmpl.category === 'plant') {
      this._plantGrowth(node, v);
      return;
    }

    // Animals: run bio rule table (pure vitals, no sense)
    this._runRuleTable(BIO_RULE_DEFS, node, v, null);
    this._deathCheck(node);
    computeSpread(node);
  },

  // L2: Involuntary reflexes — needs perception
  reflex: function(node) {
    var tmpl = TEMPLATES[node.templateId];
    if (tmpl.category !== 'herbivore' && tmpl.category !== 'carnivore' && tmpl.category !== 'omnivore') return;

    var v = node.traits.vitals;
    if (!v || !node.alive) return;

    var sense = Sense.scan(node);
    this._runRuleTable(REFLEX_RULE_DEFS, node, v, sense);
    this._deathCheck(node);
    computeSpread(node);
  },

  // L0: Apply action consequence costs from BASE_RULE_DEFS
  applyActionCost: function(node, actionType) {
    var costs = BASE_RULE_DEFS[actionType];
    if (!costs) return;
    var v = node.traits.vitals;
    if (!v) return;
    for (var i = 0; i < costs.length; i++) {
      this._applyVitalChange(v, costs[i]);
    }
  },

  // --- Shared engine internals ---

  _runRuleTable: function(table, node, v, sense) {
    for (var i = 0; i < table.length; i++) {
      var rule = table[i];
      if (rule.requires && v[rule.requires] === undefined) continue;
      if (rule.when && !evalRuleConditions(rule.when, v, sense, node.count)) continue;

      if (rule.effect) {
        this._applyEffect(node, v, rule);
      } else {
        this._applyVitalChange(v, rule);
      }
    }
  },

  _deathCheck: function(node) {
    if (node.count <= 0) {
      dropContained(node);
      node.alive = false;
    }
  },

  _applyVitalChange: function(v, rule) {
    if (rule.op === 'add') v[rule.target] += rule.amount;
    else if (rule.op === 'sub') v[rule.target] -= rule.amount;
    if (rule.cap !== undefined && v[rule.target] > rule.cap) v[rule.target] = rule.cap;
    if (rule.floor !== undefined && v[rule.target] < rule.floor) v[rule.target] = rule.floor;
  },

  _applyEffect: function(node, v, rule) {
    if (rule.effect === 'kill') {
      var deaths = rule.count !== undefined
        ? rule.count
        : Math.max(rule.min || 1, Math.ceil(node.count * rule.rate));
      node.count -= deaths;
      if (rule.set) {
        var keys = Object.keys(rule.set);
        for (var i = 0; i < keys.length; i++) v[keys[i]] = rule.set[keys[i]];
      }
    } else if (rule.effect === 'birth') {
      var births = Math.max(rule.min || 1, Math.floor(node.count * rule.rate));
      node.count += births;
      if (rule.cost) {
        var keys = Object.keys(rule.cost);
        for (var i = 0; i < keys.length; i++) v[keys[i]] += rule.cost[keys[i]];
      }
    }
  },

  _plantGrowth: function(node, v) {
    var group = World.groups.get(node.container);
    if (group) {
      var maxCount = CONFIG.PLANT_MAX_DENSITY * group.tileCount;
      if (node.count < maxCount) {
        node.count += CONFIG.PLANT_GROW_RATE * group.fertility;
        node.count = Math.min(node.count, maxCount);
      }
    }
    if (node.count > 10 && Math.random() < CONFIG.SEED_DROP_RATE) {
      var itemType = node.templateId === 'grass' ? 'grains' : 'seeds';
      var dropCount = Math.max(1, Math.floor(node.count * 0.05));
      spawnItem(itemType, dropCount, node.container, node.center);
    }
    computeSpread(node);
  },
};

// Spawn an item node in a container
function spawnItem(templateId, count, containerId, center) {
  var node = createNode(templateId);
  node.count = count;
  node.container = containerId;
  node.parent = containerId;
  node.center.x = center.x;
  node.center.y = center.y;
  computeSpread(node);
  World.nodes.set(node.id, node);
  if (!World.byGroup.has(containerId)) World.byGroup.set(containerId, new Set());
  World.byGroup.get(containerId).add(node.id);
}
