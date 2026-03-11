// roles.js — Role definitions (data) + role engine (code)
// Role definitions are pure data (future target for .acf format parsing).
// Role engine matches conditions via sense model, dispatches to Effects engine.
// No imperative action code — all actions defined in ACTION_DEFS (rules.js).

// === ROLE DEFINITIONS (DATA) ===
// Each entry: { name, urgent?, when (conditions), action/plan }
// Conditions: [field, op, value] — evaluated by evalRuleConditions()
// Priority: first match wins. Urgent: whole group acts in unison.
// Future .acf:
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

// === ROLE ENGINE (CODE) ===

var Roles = {
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;

    if (agency.activePlan) {
      Planner.executeStep(node);
      return;
    }

    var sense = Sense.scan(node);

    if (node.count <= CONFIG.PLACEHOLDER_MAX) {
      this.evaluatePlaceholders(node, sense);
    } else {
      this.evaluateCompound(node, sense);
    }
  },

  _matchRules: function(roleDef, vitals, sense, count, node) {
    var matches = [];
    for (var i = 0; i < roleDef.length; i++) {
      var rule = roleDef[i];
      if (!rule.when || evalRuleConditions(rule.when, vitals, sense, count, node)) {
        matches.push(rule);
      }
    }
    return matches;
  },

  _execRule: function(rule, node, sense) {
    if (rule.action) {
      Effects.executeAction(rule.action, node, sense);
    } else if (rule.plan) {
      Planner.start(node, rule.plan);
    }
  },

  _findRule: function(roleDef, name) {
    for (var i = 0; i < roleDef.length; i++) {
      if (roleDef[i].name === name) return roleDef[i];
    }
    return null;
  },

  evaluateCompound: function(node, sense) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    var matches = this._matchRules(roleDef, node.traits.vitals, sense, node.count, node);
    if (matches.length === 0) return;

    if (this._isComplex(node, sense, matches)) {
      this.evaluatePlaceholders(node, sense);
      return;
    }

    var primary = matches[0];
    var secondary = matches.length > 1 ? matches[1] : null;

    if (primary.urgent) {
      this._execRule(primary, node, sense);
      agency.actionSpread = {};
      agency.actionSpread[primary.name] = node.count;
      return;
    }

    this._execRule(primary, node, sense);

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

  evaluatePlaceholders: function(node, sense) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    var v = node.traits.vitals;
    var actionTally = {};

    for (var p = 0; p < node.count; p++) {
      var jv = {
        hunger: clamp(v.hunger + (Math.random() - 0.5) * 12, 0, 100),
        energy: clamp(v.energy + (Math.random() - 0.5) * 10, 0, 100),
      };
      if (v.health !== undefined) jv.health = clamp(v.health + (Math.random() - 0.5) * 8, 0, 100);
      if (v.thirst !== undefined) jv.thirst = clamp(v.thirst + (Math.random() - 0.5) * 8, 0, 100);

      for (var i = 0; i < roleDef.length; i++) {
        var rule = roleDef[i];
        if (!rule.when || evalRuleConditions(rule.when, jv, sense, 1, node)) {
          actionTally[rule.name] = (actionTally[rule.name] || 0) + 1;
          break;
        }
      }
    }

    var majorAction = null;
    var majorCount = 0;
    var keys = Object.keys(actionTally);
    for (var i = 0; i < keys.length; i++) {
      if (actionTally[keys[i]] > majorCount) {
        majorCount = actionTally[keys[i]];
        majorAction = keys[i];
      }
    }

    if (keys.length <= 1 || node.count <= 1) {
      var rule = majorAction ? this._findRule(roleDef, majorAction) : null;
      if (rule) this._execRule(rule, node, sense);
      agency.actionSpread = actionTally;
      return;
    }

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

      var splitRule = this._findRule(roleDef, keys[k]);
      if (splitRule) this._execRule(splitRule, newNode, sense);
    }

    node.count = majorCount;
    computeSpread(node);
    var majorRule = majorAction ? this._findRule(roleDef, majorAction) : null;
    if (majorRule) this._execRule(majorRule, node, sense);
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
