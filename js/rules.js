// rules.js — Unified rule format + effects engine
// ALL simulation behavior is described as rules. The engine executes rules.
// One format: { name, when?, requires?, prob?, effects: [{type:...}] }
// One dispatcher: Effects.apply() handles every effect type.
// One condition system: [field, op, value] tuples evaluated by evalRuleConditions().
//
// Rule fields:
//   name     — rule identifier
//   when     — array of [field, op, value] condition tuples (all must pass)
//   requires — vital field that must exist on this node (skip rule if absent)
//   prob     — probabilistic trigger 0..1 (checked after conditions pass)
//
// Effect types (aligned with spec elementary operations):
//   vital   — change a vital:     { type:'vital', target, op:'add'|'sub'|'set', amount, cap?, floor? }
//   destroy — remove count:       { type:'destroy', rate?, count?, min? }
//   birth   — add count:          { type:'birth', rate, min? }
//   consume — eat from source:    { type:'consume', source, vital, rate, perUnit }
//   combat  — hunt from source:   { type:'combat', source, vital, killRate, perKill, lossRate, damageBase }
//   move    — start movement:     { type:'move', destination, pickup?, antiCircle? }
//   grow    — plant growth:       { type:'grow', rate, maxPerTile }
//   create  — create item node:   { type:'create', countRate, templateMap, defaultTemplate }
//
// Condition fields: vitals (hunger, thirst, energy, health), count, category, templateId, sense.*
// Operators: >, <, >=, <=, ==, !=, in
//
// Read/write separation: when Snapshot is active, conditions and sense reads use
// snapshot state; effects write to live nodes. Post-layer clamp handles over-decrement.
//
// Future .acf:
//   rule hungerDrain [biology, L1] {
//     drain: when entity.category in [herbivore,carnivore,omnivore],
//            rate = 0.4, effect: entity.hunger += rate * dt
//   }

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
    effects: [{ type: 'destroy', rate: CONFIG.STARVE_RATE, min: 1 }] },
  { name: 'exhaustion',
    when: [ANIMAL_COND, ['energy', '<=', 0]],
    effects: [{ type: 'destroy', count: 1 },
              { type: 'vital', target: 'energy', op: 'set', amount: 0 }] },
  { name: 'healthCollapse', requires: 'health',
    when: [ANIMAL_COND, ['health', '<=', 0]],
    effects: [{ type: 'destroy', rate: 0.1, min: 1 },
              { type: 'vital', target: 'health', op: 'set', amount: 20 }] },

  // --- Plant growth ---
  { name: 'plantGrowth',
    when: [['category', '==', 'plant']],
    effects: [{ type: 'grow', rate: CONFIG.PLANT_GROW_RATE, maxPerTile: CONFIG.PLANT_MAX_DENSITY }] },
  { name: 'seedDrop',
    when: [['category', '==', 'plant'], ['count', '>', 10]],
    prob: CONFIG.SEED_DROP_RATE,
    effects: [{ type: 'create', countRate: 0.05,
                templateMap: { grass: 'grains' }, defaultTemplate: 'seeds' }] },

  // --- Signal decay (virtual items: sounds, scents, tracks) ---
  // count = ticks remaining; destroy 1/tick → dies naturally at 0
  { name: 'signalDecay',
    when: [['category', '==', 'signal']],
    effects: [{ type: 'destroy', count: 1 }] },
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

  // Social alarm: emit danger signal when threats detected (involuntary for social animals)
  { name: 'alarm',
    when: [ANIMAL_COND,
           ['sense.self.social', '>', 0.3],
           ['sense.threats.count', '>', 0]],
    effects: [{ type: 'signal', kind: 'sound', decay: 4,
                tokens: [{ type: 'danger' }] }] },
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
      { type: 'move', destination: 'random', pickup: true, antiCircle: true },
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
    computeSpread(node);
  },

  // L2: Involuntary reflexes — needs perception
  reflex: function(node) {
    var v = node.traits.vitals;
    if (!v || !node.alive || !node.traits.agency) return;

    var sense = Sense.scan(node);
    this._runRuleTable(REFLEX_RULE_DEFS, node, v, sense);
    computeSpread(node);
  },

  // --- Shared engine internals ---

  // Evaluate rules: check requires, conditions (unified), prob, then apply effects
  _runRuleTable: function(table, node, v, sense) {
    for (var i = 0; i < table.length; i++) {
      var rule = table[i];
      if (rule.requires && v[rule.requires] === undefined) continue;
      if (rule.when && !evalRuleConditions(rule.when, v, sense, node.count, node)) continue;
      if (rule.prob !== undefined && Rng.random() >= rule.prob) continue;
      Effects.applyEffects(rule.effects, node, sense);
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
      case 'destroy': return this._destroy(effect, node);
      case 'birth':   return this._birth(effect, node);
      case 'consume': return this._consume(effect, node, sense);
      case 'combat':  return this._combat(effect, node, sense);
      case 'move':    return this._move(effect, node, sense);
      case 'grow':    return this._grow(effect, node);
      case 'create':  return this._create(effect, node);
      case 'signal':  return this._signal(effect, node);
      default:        return null;
    }
  },

  // --- Signal effect handler ---
  // Creates a virtual item node carrying knowledge tokens.
  // count = decay ticks (destroyed 1/tick by bio rule signalDecay).
  _signal: function(effect, node) {
    var sig = createNode('signal');
    sig.count = effect.decay || 3;
    sig.container = node.container;
    sig.parent = node.container;
    sig.center.x = node.center.x;
    sig.center.y = node.center.y;
    sig.traits.signal = {
      kind: effect.kind || 'sound',
      tokens: effect.tokens || [],
      emitter: node.id,
      emitterSpecies: node.templateId
    };
    World.nodes.set(sig.id, sig);
    if (!World.byGroup.has(node.container)) World.byGroup.set(node.container, new Set());
    World.byGroup.get(node.container).add(sig.id);
    return null;
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

  _destroy: function(effect, node) {
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
    // Read source count from snapshot (parallel execution: all consumers see same supply)
    var sourceCount = Snapshot.active() ? Snapshot.count(source.id) : source.count;
    var eaten = Math.min(sourceCount, node.count * effect.rate);
    eaten = Math.max(1, Math.round(eaten));
    // Write to live node (may go negative; post-layer clamp handles it)
    source.count -= eaten;
    node.traits.vitals[effect.vital] -= eaten * effect.perUnit / Math.max(1, node.count);
    node.traits.vitals[effect.vital] = Math.max(0, node.traits.vitals[effect.vital]);
    return null;
  },

  _combat: function(effect, node, sense) {
    var prey = sense[effect.source].here;
    if (!prey) return { label: 'hunt-miss' };
    // Read prey count from snapshot (parallel: all hunters see same prey count)
    var preyCount = Snapshot.active() ? Snapshot.count(prey.id) : prey.count;
    if (preyCount <= 0) return { label: 'hunt-miss' };

    var myStrength = node.count * TEMPLATES[node.templateId].strength;
    var preyStrength = preyCount * TEMPLATES[prey.templateId].strength;
    var ratio = myStrength / Math.max(preyStrength, 1);

    var expectedKills = node.count * effect.killRate * ratio;
    var variance = expectedKills * 0.2;
    var killed = Math.round(expectedKills + (Rng.random() - 0.5) * variance);
    killed = Math.max(0, Math.min(killed, preyCount));

    // Write to live node (may go negative; post-layer clamp handles it)
    prey.count -= killed;

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
      if (Rng.random() < slowChance) return { status: 'slowed', label: 'slowed-stones' };
    }

    if (effect.pickup) tryPickup(node);

    var target = this._resolveDestination(effect.destination, node, sense);
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

  _create: function(effect, node) {
    // prob filtering is at rule level (prob field on rule def)
    var template = (effect.templateMap && effect.templateMap[node.templateId]) || effect.defaultTemplate;
    var dropCount = Math.max(1, Math.floor(node.count * effect.countRate));
    createItem(template, dropCount, node.container, node.center);
    return null;
  },

  // --- Destination resolution ---

  _resolveDestination: function(destination, node, sense) {
    if (destination === 'random') {
      var candidates = sense.neighbors;
      if (candidates.length === 0) return null;
      if (node._lastContainer && candidates.length > 1) {
        var filtered = [];
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i] !== node._lastContainer) filtered.push(candidates[i]);
        }
        if (filtered.length > 0) candidates = filtered;
      }
      return candidates[Math.floor(Rng.random() * candidates.length)];
    }
    if (destination === 'away_threats') {
      return this._awayFromThreats(node, sense);
    }
    return destination;
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

// Create an item node in a container
function createItem(templateId, count, containerId, center) {
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
