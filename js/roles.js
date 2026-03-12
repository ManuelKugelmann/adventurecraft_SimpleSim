// roles.js — Role definitions (data) + role engine (code)
// Role definitions are pure data (future target for .acf format parsing).
// Role engine matches conditions via sense model, dispatches to Effects engine.
// No imperative action code — all actions defined in ACTION_DEFS (rules.js).
//
// Hard rules (L1 bio, L2 reflex) always execute — dying, hunger, thirst happen regardless.
// Roles/plans are evaluated AFTER hard rules, choosing which voluntary action to take.
// Plans are just plans — the default mechanism roles use to satisfy drives.
// Each tick, all rules are re-evaluated by priority. If the winning rule's plan
// is already running, it continues. Otherwise the old plan is abandoned.
// Entities can't get stuck: biological drives (hunger, fatigue, etc.) naturally
// preempt any plan whose drive is no longer the top priority.

// === ROLE DEFINITIONS (DATA) ===
// Each entry: { name, priority, when (conditions), action/plan }
// Conditions: [field, op, value] — evaluated by evalRuleConditions()
// Priority: 0-95 integer. Higher = more involuntary. >= URGENT_PRIORITY = whole group acts.
// Matched rules sorted by priority desc; first match with highest priority wins.
//
// Universal animal role: one role for all species.
// Diet-driven sense model differentiates behavior automatically:
// - Herbivores never see prey (diet.eats has no animal categories) → hunt/seekPrey never match
// - Carnivores never see plant food (diet.eats has no plant/seed) → graze/seekFood never match
// - Omnivores see both → both branches available, hunger thresholds determine priority
// Threat detection: herbivores use threats (eatenBy), predators use biggerThreats (stronger hunters)
// Signal awareness: flee-alarm triggers on danger signals from allies (social communication)
var ROLE_DEFS = {
  animal: [
    // Urgent: flee from direct threats (things that eat me)
    { name: 'flee',       priority: 90,
      when: [['sense.threats.count', '>', 0]],                           plan: 'flee' },
    // Urgent: flee from bigger predators (things stronger than me that eat my category)
    { name: 'fleeStrong', priority: 88,
      when: [['sense.biggerThreats.count', '>', 0]],                    plan: 'flee' },
    // Social alarm: flee when allies signal danger nearby
    { name: 'fleeAlarm',  priority: 85,
      when: [['sense.self.social', '>', 0.3],
             ['sense.signals.danger', '>', 0]],                          plan: 'flee' },
    // Survival: seek water when thirsty
    { name: 'seekWater',  priority: 60,
      when: [['thirst', '>', 60]],                                       plan: 'findWater' },
    // Hunting: attack prey here (only matches if diet includes animal categories)
    { name: 'hunt',       priority: 45,
      when: [['hunger', '>', 30], ['sense.prey.here', '!=', null]],      action: 'hunt' },
    // Grazing: eat plants/seeds here (only matches if diet includes plant/seed)
    { name: 'graze',      priority: 40,
      when: [['hunger', '>', 35], ['sense.food.here', '!=', null]],      action: 'graze' },
    // Seek prey in nearby regions
    { name: 'seekPrey',   priority: 35,
      when: [['hunger', '>', 45], ['sense.preyNearby', '!=', null]],     plan: 'huntPrey' },
    // Seek plant food in nearby regions
    { name: 'seekFood',   priority: 33,
      when: [['hunger', '>', 50], ['sense.foodNearby', '!=', null]],     plan: 'findFood' },
    // Recovery
    { name: 'rest',       priority: 20,
      when: [['energy', '<', 20]],                                       action: 'rest' },
    // Default
    { name: 'wander',     priority: 0,                                   action: 'wander' },
  ],
};

// === ROLE ENGINE (CODE) ===

var Roles = {
  // Evaluate drives each tick. Plans are not autonomous — they continue only
  // if the originating drive still has highest priority (with commitment bonus).
  // Commitment bonus: active plans get a decaying priority boost to prevent
  // oscillation between close-priority drives. Bonus starts at
  // PLAN_COMMITMENT_BONUS and decays by PLAN_COMMITMENT_DECAY per tick.
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;
    if (World.isMoving(node)) return;

    var sense = Sense.scan(node);
    var roleDef = ROLE_DEFS[agency.activeRole];

    // Re-evaluate drives even if plan is active (with commitment bonus)
    if (agency.activePlan && roleDef) {
      // Decay commitment bonus each tick
      if (agency.commitmentBonus > 0) {
        agency.commitmentBonus = Math.max(0, agency.commitmentBonus - CONFIG.PLAN_COMMITMENT_DECAY);
      }
      var topRule = this._topMatchWithCommitment(roleDef, node.traits.vitals, sense, node.count, node, agency);
      if (topRule && topRule.plan === agency.activePlan.goal) {
        Planner.executeStep(node);
        return;
      }
      // Drive changed — abandon plan, reset commitment
      agency.activePlan = null;
      agency.commitmentBonus = 0;
    }


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
    // Sort by priority descending (highest = most involuntary, evaluated first)
    matches.sort(function(a, b) {
      return (b.priority || 0) - (a.priority || 0);
    });
    return matches;
  },

  // Fast single-best-rule lookup for plan continuation check
  _topMatch: function(roleDef, vitals, sense, count, node) {
    var best = null;
    var bestPri = -1;
    for (var i = 0; i < roleDef.length; i++) {
      var rule = roleDef[i];
      var pri = rule.priority || 0;
      if (pri <= bestPri) continue;
      if (!rule.when || evalRuleConditions(rule.when, vitals, sense, count, node)) {
        best = rule;
        bestPri = pri;
      }
    }
    return best;
  },

  // Like _topMatch but adds commitment bonus to the active plan's rule priority.
  // Also adds probabilistic noise to all rule priorities (PLAN_SCORE_NOISE).
  _topMatchWithCommitment: function(roleDef, vitals, sense, count, node, agency) {
    var activePlanGoal = agency.activePlan ? agency.activePlan.goal : null;
    var bonus = agency.commitmentBonus || 0;
    var noise = CONFIG.PLAN_SCORE_NOISE;
    var best = null;
    var bestPri = -Infinity;
    for (var i = 0; i < roleDef.length; i++) {
      var rule = roleDef[i];
      if (rule.when && !evalRuleConditions(rule.when, vitals, sense, count, node)) continue;
      var pri = rule.priority || 0;
      // Commitment bonus: boost the rule whose plan matches the active plan
      if (rule.plan === activePlanGoal) pri += bonus;
      // Probabilistic noise: prevents deterministic oscillation
      pri += (Rng.random() - 0.5) * noise;
      if (pri > bestPri) {
        best = rule;
        bestPri = pri;
      }
    }
    return best;
  },

  _execRule: function(rule, node, sense) {
    if (rule.action) {
      Effects.executeAction(rule.action, node, sense);
    } else if (rule.plan) {
      Planner.start(node, rule.plan);
      // Set commitment bonus when a new plan is selected
      node.traits.agency.commitmentBonus = CONFIG.PLAN_COMMITMENT_BONUS;
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

    if ((primary.priority || 0) >= CONFIG.URGENT_PRIORITY) {
      this._execRule(primary, node, sense);
      agency.actionSpread = {};
      agency.actionSpread[primary.name] = node.count;
      return;
    }

    // Plan scoring: when two close-priority rules both have plans,
    // use intelligence-gated scoring with probabilistic noise.
    if (secondary && primary.plan && secondary.plan &&
        (primary.priority || 0) - (secondary.priority || 0) <= 15) {
      var noise = CONFIG.PLAN_SCORE_NOISE;
      var scoreA = Planner.scorePlan(primary.plan, node, sense) + (Rng.random() - 0.5) * noise;
      var scoreB = Planner.scorePlan(secondary.plan, node, sense) + (Rng.random() - 0.5) * noise;
      if (scoreB > scoreA) {
        var tmp = primary;
        primary = secondary;
        secondary = tmp;
      }
    }

    this._execRule(primary, node, sense);

    agency.actionSpread = {};
    if (secondary) {
      var pFrac = 0.75 + Rng.random() * 0.1;
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
        if ((matches[i].priority || 0) >= CONFIG.URGENT_PRIORITY) hasUrgent = true;
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

    // Sort rules by priority desc
    var sortedRules = roleDef.slice().sort(function(a, b) {
      return (b.priority || 0) - (a.priority || 0);
    });

    for (var p = 0; p < node.count; p++) {
      var jv = {
        hunger: clamp(v.hunger + (Rng.random() - 0.5) * 12, 0, 100),
        energy: clamp(v.energy + (Rng.random() - 0.5) * 10, 0, 100),
      };
      if (v.health !== undefined) jv.health = clamp(v.health + (Rng.random() - 0.5) * 8, 0, 100);
      if (v.thirst !== undefined) jv.thirst = clamp(v.thirst + (Rng.random() - 0.5) * 8, 0, 100);

      for (var i = 0; i < sortedRules.length; i++) {
        var rule = sortedRules[i];
        if (!rule.when || evalRuleConditions(rule.when, jv, sense, 1, null)) {
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

    // Split minority actions into separate nodes (bounded by role rule count, max ~6).
    // New nodes are NOT in the actors array, so they won't be double-evaluated this tick.
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
        newNode.traits.vitals.hunger = clamp(sv.hunger + (Rng.random() - 0.5) * 3, 0, 100);
        newNode.traits.vitals.energy = clamp(sv.energy + (Rng.random() - 0.5) * 3, 0, 100);
        if (sv.health !== undefined) newNode.traits.vitals.health = clamp(sv.health + (Rng.random() - 0.5) * 3, 0, 100);
        if (sv.thirst !== undefined) newNode.traits.vitals.thirst = clamp(sv.thirst + (Rng.random() - 0.5) * 3, 0, 100);
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
  var cap = remainingCapacity(node);
  if (cap.weight <= 0 && cap.bulk <= 0) return; // already at capacity

  var groups = World.groupsInContainer(node.container);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (!other.alive || other.count <= 0 || other.containedBy) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    var cat = otherTmpl.category;
    var chance = 0;
    if (cat === 'seed') chance = CONFIG.CARRY_SEED_CHANCE;
    else if (cat === 'item') chance = CONFIG.CARRY_STONE_CHANCE;
    if (chance > 0 && Rng.random() < chance) {
      var amount = Math.max(1, Math.floor(other.count * CONFIG.CARRY_FRACTION));
      // Clamp amount to remaining capacity (weight and bulk)
      var perW = otherTmpl.weight || 0;
      var perB = otherTmpl.bulk || 0;
      if (perW > 0) amount = Math.min(amount, Math.floor(cap.weight / perW));
      if (perB > 0) amount = Math.min(amount, Math.floor(cap.bulk / perB));
      if (amount <= 0) continue; // can't fit any

      if (amount >= other.count) {
        containItem(node, other);
        cap.weight -= perW * other.count;
        cap.bulk -= perB * other.count;
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
        cap.weight -= perW * amount;
        cap.bulk -= perB * amount;
      }
      if (cap.weight <= 0 && cap.bulk <= 0) return; // full
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
