// rules.js — Biology rules: declarative data + engine
// Rule definitions are pure data (future target for .acf format parsing).
// Rule engine interprets the data tables against vitals and sense model.

// === BIOLOGY RULE DEFINITIONS (DATA) ===
// Each rule: { name, target/effect, op, amount, when, requires }
// Conditions: [field, op, value] — evaluated by evalRuleConditions()
// This data block maps directly to a future .acf rule format:
//   RULE hungerDrain   APPLY hunger += 0.4
//   RULE autoDrink     REQUIRES thirst  WHEN thirst > 40 AND sense.water.adjacent == true  APPLY thirst -= 15 MIN 0

var BIO_RULE_DEFS = [
  // --- Vital drains (per-tick, unconditional for animals) ---
  { name: 'hungerDrain',   target: 'hunger', op: 'add', amount: CONFIG.HUNGER_RATE },
  { name: 'thirstDrain',   target: 'thirst', op: 'add', amount: CONFIG.THIRST_RATE,
    requires: 'thirst' },
  { name: 'energyDrain',   target: 'energy', op: 'sub', amount: CONFIG.ENERGY_DRAIN },

  // --- Conditional regen ---
  { name: 'energyRegen',   target: 'energy', op: 'add', amount: 0.1, cap: 100,
    when: [['hunger', '<', 70], ['energy', '<', 100]] },

  // --- Water / thirst ---
  { name: 'autoDrink',     target: 'thirst', op: 'sub', amount: 15, floor: 0,
    requires: 'thirst',
    when: [['thirst', '>', 40], ['sense.water.adjacent', '==', true]] },
  { name: 'dehydration',   target: 'health', op: 'sub', amount: 2,
    requires: 'health',
    when: [['thirst', '>=', 80]] },

  // --- Health ---
  { name: 'healthRegen',   target: 'health', op: 'add', amount: CONFIG.HEAL_RATE, cap: 100,
    requires: 'health',
    when: [['hunger', '<', 50], ['thirst', '<', 50]] },
  { name: 'healthCollapse', effect: 'kill', rate: 0.1, min: 1,
    requires: 'health',
    set: { health: 20 },
    when: [['health', '<=', 0]] },

  // --- Starvation / exhaustion ---
  { name: 'starvation',    effect: 'kill', rate: CONFIG.STARVE_RATE, min: 1,
    when: [['hunger', '>=', 90]] },
  { name: 'exhaustion',    effect: 'kill', count: 1,
    set: { energy: 0 },
    when: [['energy', '<=', 0]] },

  // --- Reproduction ---
  { name: 'reproduce',     effect: 'birth', rate: CONFIG.BIRTH_RATE, min: 1,
    cost: { hunger: 12, energy: -5 },
    when: [['hunger', '<', 40], ['energy', '>', 30],
           ['health', '>', 50], ['thirst', '<', 50], ['count', '>=', 2]] },
];

// === BIOLOGY RULE ENGINE (CODE) ===

var Rules = {
  biology: function(node) {
    var tmpl = TEMPLATES[node.templateId];
    if (tmpl.category === 'seed' || tmpl.category === 'item') return;

    var v = node.traits.vitals;
    if (!v) return;

    // Plants: separate growth logic (not data-driven yet)
    if (tmpl.category === 'plant') {
      this._plantGrowth(node, v);
      return;
    }

    // Animals: scan sense model, run rule table
    var sense = Sense.scan(node);
    for (var i = 0; i < BIO_RULE_DEFS.length; i++) {
      var rule = BIO_RULE_DEFS[i];
      if (rule.requires && v[rule.requires] === undefined) continue;
      if (rule.when && !evalRuleConditions(rule.when, v, sense, node.count)) continue;

      if (rule.effect) {
        this._applyEffect(node, v, rule);
      } else {
        this._applyVitalChange(v, rule);
      }
    }

    // Death: drop contained items
    if (node.count <= 0) {
      dropContained(node);
      node.alive = false;
    }
    computeSpread(node);
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
