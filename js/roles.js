// roles.js — Role definitions (data) + action implementations (code) + role engine
// Role definitions are pure data (future target for .acf format parsing).
// Actions are named implementations referenced by role rules.
// Role engine matches conditions via sense model and dispatches to actions/plans.

// === ROLE DEFINITIONS (DATA) ===
// Each entry: { name, urgent?, when (conditions), action/plan }
// Conditions: [field, op, value] — evaluated by evalRuleConditions()
// Priority: first match wins. Urgent: whole group acts in unison.
// This data block maps directly to a future .acf role format:
//   ROLE grazer
//     RULE flee      URGENT  WHEN sense.threats.count > 0         PLAN flee
//     RULE graze             WHEN hunger > 35 AND sense.food.here != null  ACTION graze

var ROLE_DEFS = {
  grazer: [
    { name: 'flee',      urgent: true,
      when: [['sense.threats.count', '>', 0]],                          plan: 'flee' },
    { name: 'seekWater',
      when: [['thirst', '>', 60]],                                     plan: 'findWater' },
    { name: 'graze',
      when: [['hunger', '>', 35], ['sense.food.here', '!=', null]],    action: 'graze' },
    { name: 'seekFood',
      when: [['hunger', '>', 55]],                                     plan: 'findFood' },
    { name: 'rest',
      when: [['energy', '<', 20]],                                     action: 'rest' },
    { name: 'wander',                                                  action: 'wander' },
  ],
  hunter: [
    { name: 'flee',      urgent: true,
      when: [['sense.biggerThreats.count', '>', 0]],                   plan: 'flee' },
    { name: 'seekWater',
      when: [['thirst', '>', 60]],                                     plan: 'findWater' },
    { name: 'hunt',
      when: [['hunger', '>', 30], ['sense.prey.here', '!=', null]],    action: 'hunt' },
    { name: 'seekPrey',
      when: [['hunger', '>', 45]],                                     plan: 'huntPrey' },
    { name: 'rest',
      when: [['energy', '<', 20]],                                     action: 'rest' },
    { name: 'wander',                                                  action: 'wander' },
  ],
  forager: [
    { name: 'flee',      urgent: true,
      when: [['sense.biggerThreats.count', '>', 0]],                   plan: 'flee' },
    { name: 'seekWater',
      when: [['thirst', '>', 60]],                                     plan: 'findWater' },
    { name: 'hunt',
      when: [['hunger', '>', 50], ['sense.prey.here', '!=', null]],    action: 'hunt' },
    { name: 'graze',
      when: [['hunger', '>', 35], ['sense.food.here', '!=', null]],    action: 'graze' },
    { name: 'seekFood',
      when: [['hunger', '>', 50]],                                     plan: 'findFood' },
    { name: 'rest',
      when: [['energy', '<', 20]],                                     action: 'rest' },
    { name: 'wander',                                                  action: 'wander' },
  ],
};

// === ACTION IMPLEMENTATIONS (CODE) ===
// Named actions referenced by role rules. These are the code bridge
// between declarative rules and world mutation.
// Energy/vitals costs are in BASE_RULE_DEFS, applied via Rules.applyActionCost().
// Combat damage formula stays here for now (too formula-heavy for simple data rules).

var ACTIONS = {
  graze: function(node, sense) {
    var food = sense.food.here;
    if (!food) return;

    var eaten = Math.min(food.count, node.count * CONFIG.FEED_RATE);
    eaten = Math.max(1, Math.round(eaten));
    food.count -= eaten;
    if (food.count <= 0) food.alive = false;

    node.traits.vitals.hunger -= eaten * CONFIG.FOOD_PER_PLANT / Math.max(1, node.count);
    node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);
    Rules.applyActionCost(node, 'graze');
    node.traits.agency.lastAction = 'graze';
  },

  hunt: function(node, sense) {
    var prey = sense.prey.here;
    if (!prey || prey.count <= 0) return;

    var myStrength = node.count * TEMPLATES[node.templateId].strength;
    var preyStrength = prey.count * TEMPLATES[prey.templateId].strength;
    var ratio = myStrength / Math.max(preyStrength, 1);

    var expectedKills = node.count * CONFIG.KILL_RATE * ratio;
    var variance = expectedKills * 0.2;
    var killed = Math.round(expectedKills + (Math.random() - 0.5) * variance);
    killed = Math.max(0, Math.min(killed, prey.count));

    prey.count -= killed;
    if (prey.count <= 0) prey.alive = false;

    node.traits.vitals.hunger -= killed * CONFIG.FOOD_PER_PREY / Math.max(1, node.count);
    node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);

    // Combat: predator losses + health damage (formula, not yet data-driven)
    var predatorLosses = Math.round(killed * 0.05 / Math.max(ratio, 0.1));
    node.count -= Math.min(predatorLosses, node.count - 1);
    if (node.traits.vitals.health !== undefined) {
      node.traits.vitals.health -= Math.max(1, Math.round(5 / Math.max(ratio, 0.1)));
      node.traits.vitals.health = Math.max(0, node.traits.vitals.health);
    }

    Rules.applyActionCost(node, 'hunt');
    node.traits.agency.lastAction = killed > 0 ? 'kill(' + killed + ')' : 'hunt-miss';
  },

  rest: function(node) {
    Rules.applyActionCost(node, 'rest');
    node.traits.agency.lastAction = 'rest';
  },

  wander: function(node, sense) {
    if (sense.stones.blocked) {
      Rules.applyActionCost(node, 'move');
      node.traits.agency.lastAction = 'blocked-stones';
      return;
    }
    if (sense.stones.slowed) {
      var slowChance = (sense.stones.density - CONFIG.STONE_SLOW_PER_TILE) /
                       (CONFIG.STONE_BLOCK_PER_TILE - CONFIG.STONE_SLOW_PER_TILE);
      if (Math.random() < slowChance) {
        Rules.applyActionCost(node, 'move');
        node.traits.agency.lastAction = 'slowed-stones';
        return;
      }
    }
    var neighbors = sense.neighbors;
    if (neighbors.length === 0) return;
    // Anti-circle: avoid returning to previous container
    var candidates = neighbors;
    if (node._lastContainer && neighbors.length > 1) {
      candidates = [];
      for (var i = 0; i < neighbors.length; i++) {
        if (neighbors[i] !== node._lastContainer) candidates.push(neighbors[i]);
      }
      if (candidates.length === 0) candidates = neighbors;
    }
    var target = candidates[Math.floor(Math.random() * candidates.length)];
    node._lastContainer = node.container;
    tryPickup(node);
    World.startMove(node, target);
    Rules.applyActionCost(node, 'move');
    node.traits.agency.lastAction = 'wander';
  },
};

// === ROLE ENGINE (CODE) ===

var Roles = {
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;

    // Continue active plan
    if (agency.activePlan) {
      Planner.executeStep(node);
      return;
    }

    // Scan world model once per evaluation
    var sense = Sense.scan(node);

    if (node.count <= CONFIG.PLACEHOLDER_MAX) {
      this.evaluatePlaceholders(node, sense);
    } else {
      this.evaluateCompound(node, sense);
    }
  },

  // Match role rules against vitals and sense model
  _matchRules: function(roleDef, vitals, sense, count) {
    var matches = [];
    for (var i = 0; i < roleDef.length; i++) {
      var rule = roleDef[i];
      if (!rule.when || evalRuleConditions(rule.when, vitals, sense, count)) {
        matches.push(rule);
      }
    }
    return matches;
  },

  // Execute a matched role rule
  _execRule: function(rule, node, sense) {
    if (rule.action) {
      ACTIONS[rule.action](node, sense);
    } else if (rule.plan) {
      Planner.start(node, rule.plan);
    }
  },

  // --- Large groups: compound statistical execution ---
  evaluateCompound: function(node, sense) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    var matches = this._matchRules(roleDef, node.traits.vitals, sense, node.count);
    if (matches.length === 0) return;

    // Complexity check: fall back to placeholder sim
    if (this._isComplex(node, sense, matches)) {
      this.evaluatePlaceholders(node, sense);
      return;
    }

    var primary = matches[0];
    var secondary = matches.length > 1 ? matches[1] : null;

    // Urgent: whole group acts in unison
    if (primary.urgent) {
      this._execRule(primary, node, sense);
      agency.actionSpread = {};
      agency.actionSpread[primary.name] = node.count;
      return;
    }

    // Execute primary on whole group
    this._execRule(primary, node, sense);

    // Record statistical spread estimate
    agency.actionSpread = {};
    if (secondary) {
      var pFrac = 0.75 + Math.random() * 0.1;
      agency.actionSpread[primary.name] = Math.round(node.count * pFrac);
      agency.actionSpread[secondary.name] = node.count - agency.actionSpread[primary.name];
    } else {
      agency.actionSpread[primary.name] = node.count;
    }
  },

  _isComplex: function(node, sense, matches) {
    if (matches.length >= 3) {
      var hasUrgent = false;
      var hasNonUrgent = 0;
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].urgent) hasUrgent = true;
        else hasNonUrgent++;
      }
      if (hasUrgent && hasNonUrgent >= 2) return true;
    }
    // Multiple prey types → compound combat formula unreliable
    if (sense.prey.count > 0) {
      var diet = node.traits.diet;
      if (diet) {
        var entities = World.groupsInContainer(node.container);
        var preyTypes = 0;
        for (var i = 0; i < entities.length; i++) {
          var other = entities[i];
          if (other.id === node.id || !other.alive) continue;
          var cat = TEMPLATES[other.templateId].category;
          if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'seed' && cat !== 'item') {
            preyTypes++;
          }
        }
        if (preyTypes >= 2) return true;
      }
    }
    return false;
  },

  // --- Small groups: simulate placeholder individuals ---
  evaluatePlaceholders: function(node, sense) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    var v = node.traits.vitals;
    var actionTally = {};

    for (var p = 0; p < node.count; p++) {
      // Virtual individual with jittered vitals
      var jv = {
        hunger: clamp(v.hunger + (Math.random() - 0.5) * 12, 0, 100),
        energy: clamp(v.energy + (Math.random() - 0.5) * 10, 0, 100),
      };
      if (v.health !== undefined) jv.health = clamp(v.health + (Math.random() - 0.5) * 8, 0, 100);
      if (v.thirst !== undefined) jv.thirst = clamp(v.thirst + (Math.random() - 0.5) * 8, 0, 100);

      // Evaluate: first matching condition wins for this placeholder
      for (var i = 0; i < roleDef.length; i++) {
        var rule = roleDef[i];
        if (!rule.when || evalRuleConditions(rule.when, jv, sense, 1)) {
          actionTally[rule.name] = (actionTally[rule.name] || 0) + 1;
          break;
        }
      }
    }

    // Find majority action
    var majorAction = null;
    var majorCount = 0;
    var keys = Object.keys(actionTally);
    for (var i = 0; i < keys.length; i++) {
      if (actionTally[keys[i]] > majorCount) {
        majorCount = actionTally[keys[i]];
        majorAction = keys[i];
      }
    }

    // Single action or group of 1: execute on whole group
    if (keys.length <= 1 || node.count <= 1) {
      if (majorAction) {
        for (var i = 0; i < roleDef.length; i++) {
          if (roleDef[i].name === majorAction) {
            this._execRule(roleDef[i], node, sense);
            break;
          }
        }
      }
      agency.actionSpread = actionTally;
      return;
    }

    // Multiple actions: split off minority factions into new groups
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] === majorAction) continue;
      var splitCount = actionTally[keys[k]];
      if (splitCount <= 0) continue;

      var newNode = createNode(node.templateId);
      newNode.count = splitCount;
      newNode.container = node.container;
      newNode.parent = node.container;
      newNode.center.x = node.center.x;
      newNode.center.y = node.center.y;
      if (node.traits.vitals) {
        var sv = node.traits.vitals;
        newNode.traits.vitals.hunger = clamp(sv.hunger + (Math.random() - 0.5) * 3, 0, 100);
        newNode.traits.vitals.energy = clamp(sv.energy + (Math.random() - 0.5) * 3, 0, 100);
        if (sv.health !== undefined) newNode.traits.vitals.health = clamp(sv.health + (Math.random() - 0.5) * 3, 0, 100);
        if (sv.thirst !== undefined) newNode.traits.vitals.thirst = clamp(sv.thirst + (Math.random() - 0.5) * 3, 0, 100);
      }
      computeSpread(newNode);
      World.nodes.set(newNode.id, newNode);
      if (!World.byGroup.has(node.container)) World.byGroup.set(node.container, new Set());
      World.byGroup.get(node.container).add(newNode.id);

      // Execute the minority action on the split group
      for (var j = 0; j < roleDef.length; j++) {
        if (roleDef[j].name === keys[k]) {
          this._execRule(roleDef[j], newNode, sense);
          break;
        }
      }
    }

    // Reduce original to majority count, execute majority action
    node.count = majorCount;
    computeSpread(node);
    if (majorAction) {
      for (var i = 0; i < roleDef.length; i++) {
        if (roleDef[i].name === majorAction) {
          this._execRule(roleDef[i], node, sense);
          break;
        }
      }
    }
    agency.actionSpread = actionTally;
  },
};

function clamp(val, lo, hi) { return val < lo ? lo : val > hi ? hi : val; }

// === TRANSPORT HELPERS ===

function tryPickup(node) {
  var groups = World.groupsInContainer(node.container);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (!other.alive || other.count <= 0 || other.containedBy) continue;
    var cat = TEMPLATES[other.templateId].category;
    var chance = 0;
    if (cat === 'seed') chance = CONFIG.CARRY_SEED_CHANCE;
    else if (cat === 'item') chance = CONFIG.CARRY_STONE_CHANCE;
    if (chance > 0 && Math.random() < chance) {
      var amount = Math.max(1, Math.floor(other.count * CONFIG.CARRY_FRACTION));
      if (amount >= other.count) {
        containItem(node, other);
      } else {
        other.count -= amount;
        var carried = createNode(other.templateId);
        carried.count = amount;
        carried.container = node.container;
        carried.center.x = node.center.x;
        carried.center.y = node.center.y;
        computeSpread(carried);
        World.nodes.set(carried.id, carried);
        containItem(node, carried);
      }
    }
  }
}

function containItem(carrier, item) {
  var oldSet = World.byGroup.get(item.container);
  if (oldSet) oldSet.delete(item.id);
  item.containedBy = carrier.id;
  carrier.contains.push(item.id);
}

function dropContained(node) {
  if (node.contains.length === 0) return;
  for (var i = 0; i < node.contains.length; i++) {
    var item = World.nodes.get(node.contains[i]);
    if (!item || !item.alive) continue;
    item.containedBy = null;
    item.container = node.container;
    item.center.x = node.center.x;
    item.center.y = node.center.y;
    if (!World.byGroup.has(node.container)) World.byGroup.set(node.container, new Set());
    World.byGroup.get(node.container).add(item.id);
  }
  node.contains = [];
}

// Stone movement check (used by planner steps that don't have a sense model)
function stoneMoveBlocked(node) {
  var group = World.groups.get(node.container);
  if (!group) return false;
  var density = stonesInContainer(node.container) / group.tileCount;
  if (density >= CONFIG.STONE_BLOCK_PER_TILE) {
    node.traits.vitals.energy -= 0.5;
    node.traits.agency.lastAction = 'blocked-stones';
    return true;
  }
  if (density >= CONFIG.STONE_SLOW_PER_TILE) {
    var slowChance = (density - CONFIG.STONE_SLOW_PER_TILE) /
                     (CONFIG.STONE_BLOCK_PER_TILE - CONFIG.STONE_SLOW_PER_TILE);
    if (Math.random() < slowChance) {
      node.traits.vitals.energy -= 0.5;
      node.traits.agency.lastAction = 'slowed-stones';
      return true;
    }
  }
  return false;
}

function stonesInContainer(regionId) {
  var groups = World.groupsInContainer(regionId);
  var total = 0;
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].alive && TEMPLATES[groups[i].templateId].category === 'item') {
      total += groups[i].count;
    }
  }
  return total;
}
