// rules.js — Rule layers: declarative data + effect engine
// ALL simulation behavior is described as rule data. The engine executes rules.
// Layers: L0 Base (action costs) → L1 Bio (passive) → L2 Reflex (involuntary)
// Actions: ACTION_DEFS describe effects as data, Effects engine interprets them.

// === L0: BASE RULE DEFINITIONS — action consequence costs (DATA) ===
// Applied after each action via Rules.applyActionCost(node, actionType).
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
// Future .acf:  REFLEX autoDrink  WHEN thirst > 40 AND sense.water.adjacent  APPLY thirst -= 15

var REFLEX_RULE_DEFS = [
  { name: 'autoDrink',     target: 'thirst', op: 'sub', amount: 15, floor: 0,
    requires: 'thirst',
    when: [['thirst', '>', 40], ['sense.water.adjacent', '==', true]] },

  { name: 'reproduce',     effect: 'birth', rate: CONFIG.BIRTH_RATE, min: 1,
    cost: { hunger: 12, energy: -5 },
    when: [['hunger', '<', 40], ['energy', '>', 30],
           ['health', '>', 50], ['thirst', '<', 50], ['count', '>=', 2]] },
];

// === L3: ACTION DEFINITIONS — what actions do to the world (DATA) ===
// Each action: { effects: [...], cost: 'baseRuleName' }
// Effect types:
//   consume — eat from source:  { type:'consume', source:'food', rate:R, perUnit:P }
//   combat  — hunt prey:        { type:'combat', source:'prey', killRate:R, perKill:P, lossRate:L, damageBase:D }
//   move    — start movement:   { type:'move', toward:'random'|'away_threats'|groupId, pickup:bool, antiCircle:bool }
// Future .acf:  ACTION graze  CONSUME food RATE 0.3 PER_UNIT 0.8  COST graze

var ACTION_DEFS = {
  graze: {
    effects: [
      { type: 'consume', source: 'food', rate: CONFIG.FEED_RATE, perUnit: CONFIG.FOOD_PER_PLANT },
    ],
    cost: 'graze',
  },
  hunt: {
    effects: [
      { type: 'combat', source: 'prey', killRate: CONFIG.KILL_RATE, perKill: CONFIG.FOOD_PER_PREY,
        lossRate: 0.05, damageBase: 5 },
    ],
    cost: 'hunt',
  },
  rest: {
    effects: [],
    cost: 'rest',
  },
  wander: {
    effects: [
      { type: 'move', toward: 'random', pickup: true, antiCircle: true },
    ],
    cost: 'move',
  },
};

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

// === EFFECTS ENGINE (CODE) ===
// Generic interpreter for action effect definitions.
// Each effect type has a handler that mutates world state.

var Effects = {
  // Execute a named action: apply all its effects, then base cost
  executeAction: function(name, node, sense) {
    var def = ACTION_DEFS[name];
    if (!def) return;
    var label = name;
    for (var i = 0; i < def.effects.length; i++) {
      var result = this.apply(def.effects[i], node, sense);
      if (result && result.label) label = result.label;
    }
    if (def.cost) Rules.applyActionCost(node, def.cost);
    node.traits.agency.lastAction = label;
  },

  // Dispatch an effect to its handler
  apply: function(effect, node, sense) {
    switch (effect.type) {
      case 'consume': return this._consume(effect, node, sense);
      case 'combat':  return this._combat(effect, node, sense);
      case 'move':    return this._move(effect, node, sense);
      default:        return null;
    }
  },

  // --- Effect type handlers ---

  // consume: eat plants/seeds from source in current container
  _consume: function(effect, node, sense) {
    var source = sense[effect.source].here;
    if (!source) return null;
    var eaten = Math.min(source.count, node.count * effect.rate);
    eaten = Math.max(1, Math.round(eaten));
    source.count -= eaten;
    if (source.count <= 0) source.alive = false;
    node.traits.vitals.hunger -= eaten * effect.perUnit / Math.max(1, node.count);
    node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);
    return null;
  },

  // combat: hunt prey in current container (strength-ratio formula)
  _combat: function(effect, node, sense) {
    var prey = sense[effect.source].here;
    if (!prey || prey.count <= 0) return { label: 'hunt-miss' };

    var myStrength = node.count * TEMPLATES[node.templateId].strength;
    var preyStrength = prey.count * TEMPLATES[prey.templateId].strength;
    var ratio = myStrength / Math.max(preyStrength, 1);

    var expectedKills = node.count * effect.killRate * ratio;
    var variance = expectedKills * 0.2;
    var killed = Math.round(expectedKills + (Math.random() - 0.5) * variance);
    killed = Math.max(0, Math.min(killed, prey.count));

    prey.count -= killed;
    if (prey.count <= 0) prey.alive = false;

    node.traits.vitals.hunger -= killed * effect.perKill / Math.max(1, node.count);
    node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);

    // Combat losses + health damage (parameterized from effect data)
    var predatorLosses = Math.round(killed * effect.lossRate / Math.max(ratio, 0.1));
    node.count -= Math.min(predatorLosses, node.count - 1);
    if (node.traits.vitals.health !== undefined) {
      node.traits.vitals.health -= Math.max(1, Math.round(effect.damageBase / Math.max(ratio, 0.1)));
      node.traits.vitals.health = Math.max(0, node.traits.vitals.health);
    }

    return { label: killed > 0 ? 'kill(' + killed + ')' : 'hunt-miss' };
  },

  // move: resolve target, check stone blocking, start graph movement
  _move: function(effect, node, sense) {
    // Stone blocking (from sense model)
    if (sense.stones.blocked) return { status: 'blocked', label: 'blocked-stones' };
    if (sense.stones.slowed) {
      var slowChance = (sense.stones.density - CONFIG.STONE_SLOW_PER_TILE) /
                       (CONFIG.STONE_BLOCK_PER_TILE - CONFIG.STONE_SLOW_PER_TILE);
      if (Math.random() < slowChance) return { status: 'slowed', label: 'slowed-stones' };
    }

    if (effect.pickup) tryPickup(node);

    var target = this._resolveTarget(effect.toward, node, sense);
    if (!target) return { status: 'no_target' };

    if (effect.antiCircle) node._lastContainer = node.container;
    if (!World.startMove(node, target)) return { status: 'fail' };
    return { status: 'ok' };
  },

  // Resolve a 'toward' value to a concrete group ID
  _resolveTarget: function(toward, node, sense) {
    if (toward === 'random') {
      var candidates = sense.neighbors;
      if (candidates.length === 0) return null;
      if (node._lastContainer && candidates.length > 1) {
        var filtered = [];
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i] !== node._lastContainer) filtered.push(candidates[i]);
        }
        if (filtered.length > 0) candidates = filtered;
      }
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (toward === 'away_threats') {
      return this._awayFromThreats(node, sense);
    }
    // Direct group ID (from plan target)
    return toward;
  },

  // Pick neighbor farthest from threats
  _awayFromThreats: function(node, sense) {
    var threats = sense.threats.here;
    if (threats.length === 0) threats = sense.biggerThreats.here;
    if (threats.length === 0) return null;

    var neighbors = sense.neighbors;
    if (neighbors.length === 0) return null;

    var threatGroup = threats[0].container;
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < neighbors.length; i++) {
      var nGroup = World.groups.get(neighbors[i]);
      if (!nGroup) continue;
      var tGroup = World.groups.get(threatGroup);
      if (!tGroup) { best = neighbors[i]; break; }
      var dist = Math.abs(nGroup.center.x - tGroup.center.x) +
                 Math.abs(nGroup.center.y - tGroup.center.y);
      if (dist > bestScore) {
        bestScore = dist;
        best = neighbors[i];
      }
    }
    return best;
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
