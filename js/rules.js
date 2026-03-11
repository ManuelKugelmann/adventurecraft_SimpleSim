// rules.js — Unified rule format + effects engine
// ALL simulation behavior is described as rules. The engine executes rules.
// One format: { name, when?, requires?, effects: [{type:...}] }
// One dispatcher: Effects.apply() handles every effect type.
// One condition system: [field, op, value] tuples evaluated by evalRuleConditions().
//
// Effect types (complete set):
//   vital   — change a vital:     { type:'vital', target, op:'add'|'sub'|'set', amount, cap?, floor? }
//   kill    — remove count:       { type:'kill', rate?, count?, min? }
//   birth   — add count:          { type:'birth', rate, min? }
//   consume — eat from source:    { type:'consume', source, vital, rate, perUnit }
//   combat  — hunt from source:   { type:'combat', source, vital, killRate, perKill, lossRate, damageBase }
//   move    — start movement:     { type:'move', toward, pickup?, antiCircle? }
//   grow    — plant growth:       { type:'grow', rate, maxPerTile }
//   spawn   — create item node:   { type:'spawn', chance, countRate, templateMap, defaultTemplate }
//
// Condition fields: vitals (hunger, thirst, energy, health), count, category, templateId, sense.*
// Operators: >, <, >=, <=, ==, !=, in
//
// Future .acf:
//   RULE hungerDrain  WHEN category IN [herbivore,carnivore,omnivore]  EFFECT vital hunger += 0.4
//   RULE plantGrowth  WHEN category == plant                          EFFECT grow RATE 0.8 MAX_PER_TILE 5
//   ACTION graze  EFFECT consume food VITAL hunger RATE 0.3 PER_UNIT 0.8  EFFECT vital energy -= 0.5

// === L1: BIOLOGY RULE DEFINITIONS — passive world sim (DATA) ===
// Runs every tick on all living nodes with vitals.
// All filtering via unified 'when' conditions — no special-case fields.

var ANIMAL_COND = ['category', 'in', ['herbivore', 'carnivore', 'omnivore']];

var BIO_RULE_DEFS = [
  // --- Animal vital drains ---
  { name: 'hungerDrain',
    when: [ANIMAL_COND],
    effects: [{ type: 'vital', target: 'hunger', op: 'add', amount: CONFIG.HUNGER_RATE }] },
  { name: 'thirstDrain', requires: 'thirst',
    when: [ANIMAL_COND],
    effects: [{ type: 'vital', target: 'thirst', op: 'add', amount: CONFIG.THIRST_RATE }] },
  { name: 'energyDrain',
    when: [ANIMAL_COND],
    effects: [{ type: 'vital', target: 'energy', op: 'sub', amount: CONFIG.ENERGY_DRAIN }] },

  // --- Animal passive regen ---
  { name: 'energyRegen',
    when: [ANIMAL_COND, ['hunger', '<', 70], ['energy', '<', 100]],
    effects: [{ type: 'vital', target: 'energy', op: 'add', amount: 0.1, cap: 100 }] },
  { name: 'healthRegen', requires: 'health',
    when: [ANIMAL_COND, ['hunger', '<', 50], ['thirst', '<', 50]],
    effects: [{ type: 'vital', target: 'health', op: 'add', amount: CONFIG.HEAL_RATE, cap: 100 }] },

  // --- Animal damage from unmet needs ---
  { name: 'dehydration', requires: 'health',
    when: [ANIMAL_COND, ['thirst', '>=', 80]],
    effects: [{ type: 'vital', target: 'health', op: 'sub', amount: 2 }] },

  // --- Animal death ---
  { name: 'starvation',
    when: [ANIMAL_COND, ['hunger', '>=', 90]],
    effects: [{ type: 'kill', rate: CONFIG.STARVE_RATE, min: 1 }] },
  { name: 'exhaustion',
    when: [ANIMAL_COND, ['energy', '<=', 0]],
    effects: [{ type: 'kill', count: 1 },
              { type: 'vital', target: 'energy', op: 'set', amount: 0 }] },
  { name: 'healthCollapse', requires: 'health',
    when: [ANIMAL_COND, ['health', '<=', 0]],
    effects: [{ type: 'kill', rate: 0.1, min: 1 },
              { type: 'vital', target: 'health', op: 'set', amount: 20 }] },

  // --- Plant growth ---
  { name: 'plantGrowth',
    when: [['category', '==', 'plant']],
    effects: [{ type: 'grow', rate: CONFIG.PLANT_GROW_RATE, maxPerTile: CONFIG.PLANT_MAX_DENSITY }] },
  { name: 'seedDrop',
    when: [['category', '==', 'plant'], ['count', '>', 10]],
    effects: [{ type: 'spawn', chance: CONFIG.SEED_DROP_RATE, countRate: 0.05,
                templateMap: { grass: 'grains' }, defaultTemplate: 'seeds' }] },
];

// === L2: REFLEX RULE DEFINITIONS — involuntary responses (DATA) ===
// Needs perception (sense model). Runs after biology.

var REFLEX_RULE_DEFS = [
  { name: 'autoDrink', requires: 'thirst',
    when: [ANIMAL_COND,
           ['thirst', '>', 40], ['sense.water.adjacent', '==', true]],
    effects: [{ type: 'vital', target: 'thirst', op: 'sub', amount: 15, floor: 0 }] },

  { name: 'reproduce',
    when: [ANIMAL_COND,
           ['hunger', '<', 40], ['energy', '>', 30],
           ['health', '>', 50], ['thirst', '<', 50], ['count', '>=', 2]],
    effects: [{ type: 'birth', rate: CONFIG.BIRTH_RATE, min: 1 },
              { type: 'vital', target: 'hunger', op: 'add', amount: 12 },
              { type: 'vital', target: 'energy', op: 'sub', amount: 5 }] },
];

// === L3: ACTION DEFINITIONS — complete effect descriptions (DATA) ===
// Each action: { effects: [...] } — ALL consequences listed explicitly.

var ACTION_DEFS = {
  graze: {
    effects: [
      { type: 'consume', source: 'food', vital: 'hunger', rate: CONFIG.FEED_RATE, perUnit: CONFIG.FOOD_PER_PLANT },
      { type: 'vital', target: 'energy', op: 'sub', amount: 0.5 },
    ],
  },
  hunt: {
    effects: [
      { type: 'combat', source: 'prey', vital: 'hunger', killRate: CONFIG.KILL_RATE, perKill: CONFIG.FOOD_PER_PREY,
        lossRate: 0.05, damageBase: 5 },
      { type: 'vital', target: 'energy', op: 'sub', amount: 3 },
    ],
  },
  rest: {
    effects: [
      { type: 'vital', target: 'energy', op: 'add', amount: 5, cap: 100 },
    ],
  },
  wander: {
    effects: [
      { type: 'move', toward: 'random', pickup: true, antiCircle: true },
      { type: 'vital', target: 'energy', op: 'sub', amount: 0.5 },
    ],
  },
};

// === RULE ENGINE (CODE) ===

var Rules = {
  // L1: Passive biology — all nodes with vitals
  biology: function(node) {
    var v = node.traits.vitals;
    if (!v) return;

    this._runRuleTable(BIO_RULE_DEFS, node, v, null);
    this._deathCheck(node);
    computeSpread(node);
  },

  // L2: Involuntary reflexes — needs perception
  reflex: function(node) {
    var v = node.traits.vitals;
    if (!v || !node.alive || !node.traits.agency) return;

    var sense = Sense.scan(node);
    this._runRuleTable(REFLEX_RULE_DEFS, node, v, sense);
    this._deathCheck(node);
    computeSpread(node);
  },

  // --- Shared engine internals ---

  // Evaluate rules: check requires, conditions (unified), then apply effects
  _runRuleTable: function(table, node, v, sense) {
    for (var i = 0; i < table.length; i++) {
      var rule = table[i];
      if (rule.requires && v[rule.requires] === undefined) continue;
      if (rule.when && !evalRuleConditions(rule.when, v, sense, node.count, node)) continue;
      Effects.applyEffects(rule.effects, node, sense);
    }
  },

  _deathCheck: function(node) {
    if (node.count <= 0) {
      dropContained(node);
      node.alive = false;
    }
  },
};

// === EFFECTS ENGINE (CODE) ===
// Generic interpreter for ALL effect types.
// One dispatcher, one format, used by bio rules, reflex rules, actions, and plans alike.

var Effects = {
  // Execute a named action: apply all its effects in order
  executeAction: function(name, node, sense) {
    var def = ACTION_DEFS[name];
    if (!def) return;
    var label = name;
    for (var i = 0; i < def.effects.length; i++) {
      var result = this.apply(def.effects[i], node, sense);
      if (result && result.label) label = result.label;
    }
    node.traits.agency.lastAction = label;
  },

  // Apply an array of effects
  applyEffects: function(effects, node, sense) {
    for (var i = 0; i < effects.length; i++) {
      this.apply(effects[i], node, sense);
    }
  },

  // Dispatch an effect to its handler
  apply: function(effect, node, sense) {
    switch (effect.type) {
      case 'vital':   return this._vital(effect, node);
      case 'kill':    return this._kill(effect, node);
      case 'birth':   return this._birth(effect, node);
      case 'consume': return this._consume(effect, node, sense);
      case 'combat':  return this._combat(effect, node, sense);
      case 'move':    return this._move(effect, node, sense);
      case 'grow':    return this._grow(effect, node);
      case 'spawn':   return this._spawn(effect, node);
      default:        return null;
    }
  },

  // --- Effect type handlers ---

  _vital: function(effect, node) {
    var v = node.traits.vitals;
    if (effect.op === 'add') v[effect.target] += effect.amount;
    else if (effect.op === 'sub') v[effect.target] -= effect.amount;
    else if (effect.op === 'set') v[effect.target] = effect.amount;
    if (effect.cap !== undefined && v[effect.target] > effect.cap) v[effect.target] = effect.cap;
    if (effect.floor !== undefined && v[effect.target] < effect.floor) v[effect.target] = effect.floor;
    return null;
  },

  _kill: function(effect, node) {
    var deaths = effect.count !== undefined
      ? effect.count
      : Math.max(effect.min || 1, Math.ceil(node.count * effect.rate));
    node.count -= deaths;
    return null;
  },

  _birth: function(effect, node) {
    var births = Math.max(effect.min || 1, Math.floor(node.count * effect.rate));
    node.count += births;
    return null;
  },

  _consume: function(effect, node, sense) {
    var source = sense[effect.source].here;
    if (!source) return null;
    var eaten = Math.min(source.count, node.count * effect.rate);
    eaten = Math.max(1, Math.round(eaten));
    source.count -= eaten;
    if (source.count <= 0) source.alive = false;
    node.traits.vitals[effect.vital] -= eaten * effect.perUnit / Math.max(1, node.count);
    node.traits.vitals[effect.vital] = Math.max(0, node.traits.vitals[effect.vital]);
    return null;
  },

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

    node.traits.vitals[effect.vital] -= killed * effect.perKill / Math.max(1, node.count);
    node.traits.vitals[effect.vital] = Math.max(0, node.traits.vitals[effect.vital]);

    var predatorLosses = Math.round(killed * effect.lossRate / Math.max(ratio, 0.1));
    node.count -= Math.min(predatorLosses, node.count - 1);
    if (node.traits.vitals.health !== undefined) {
      node.traits.vitals.health -= Math.max(1, Math.round(effect.damageBase / Math.max(ratio, 0.1)));
      node.traits.vitals.health = Math.max(0, node.traits.vitals.health);
    }

    return { label: killed > 0 ? 'kill(' + killed + ')' : 'hunt-miss' };
  },

  _move: function(effect, node, sense) {
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

  _grow: function(effect, node) {
    var group = World.groups.get(node.container);
    if (!group) return null;
    var maxCount = effect.maxPerTile * group.tileCount;
    if (node.count < maxCount) {
      node.count += effect.rate * group.fertility;
      node.count = Math.min(node.count, maxCount);
    }
    return null;
  },

  _spawn: function(effect, node) {
    if (Math.random() >= effect.chance) return null;
    var template = (effect.templateMap && effect.templateMap[node.templateId]) || effect.defaultTemplate;
    var dropCount = Math.max(1, Math.floor(node.count * effect.countRate));
    spawnItem(template, dropCount, node.container, node.center);
    return null;
  },

  // --- Target resolution ---

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
    return toward;
  },

  _awayFromThreats: function(node, sense) {
    var threats = sense.threats.here;
    if (threats.length === 0) threats = sense.biggerThreats.here;
    if (threats.length === 0) return null;

    var neighbors = sense.neighbors;
    if (neighbors.length === 0) return null;

    var tGroup = World.groups.get(threats[0].container);
    if (!tGroup) return neighbors[0];

    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < neighbors.length; i++) {
      var nGroup = World.groups.get(neighbors[i]);
      if (!nGroup) continue;
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
