// roles.js — Per-entity roles, compound execution for groups
// Roles are defined per entity. Groups execute them statistically:
//   Large groups  → compound: primary action for whole group, record spread
//   Small groups  → placeholder sim: jittered individuals evaluated independently

var Roles = {
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;

    // Continue active process
    if (agency.activePlan) {
      Planner.executeStep(node);
      return;
    }

    if (node.count <= CONFIG.PLACEHOLDER_MAX) {
      this.evaluatePlaceholders(node);
    } else {
      this.evaluateCompound(node);
    }
  },

  // --- Large groups: compound statistical execution ---
  // One evaluation, primary action applied to whole group via compound math.
  // Falls back to placeholder sim when situation is too complex for statistics.
  evaluateCompound: function(node) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    // Collect all matching conditions
    var matches = [];
    for (var i = 0; i < roleDef.length; i++) {
      if (roleDef[i].condition(node)) {
        matches.push(roleDef[i]);
      }
    }
    if (matches.length === 0) return;

    // Complexity check: fall back to placeholder sim when too many
    // competing actions make compound statistics unreliable
    if (this.isComplex(node, matches)) {
      this.evaluatePlaceholders(node);
      return;
    }

    var primary = matches[0];
    var secondary = matches.length > 1 ? matches[1] : null;

    // Urgent (flee): whole group acts together
    if (primary.urgent) {
      primary.action(node);
      agency.actionSpread = {};
      agency.actionSpread[primary.name] = node.count;
      return;
    }

    // Execute primary on whole group (compound math scales with count)
    primary.action(node);

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

  // Detect when compound statistics would be unreliable:
  // - 3+ competing actions (spread too thin for one aggregate)
  // - Mixed threat + opportunity (flee some, hunt others)
  // - Multiple distinct prey/food targets in region
  isComplex: function(node, matches) {
    // 3+ distinct actions matched → too many competing priorities
    if (matches.length >= 3) {
      var hasUrgent = false;
      var hasNonUrgent = 0;
      for (var i = 0; i < matches.length; i++) {
        if (matches[i].urgent) hasUrgent = true;
        else hasNonUrgent++;
      }
      // Urgent + 2 non-urgent alternatives = complex decision
      if (hasUrgent && hasNonUrgent >= 2) return true;
    }

    // Multiple distinct prey types in same region → compound combat formula unreliable
    var diet = node.traits.diet;
    if (diet) {
      var groups = World.groupsInRegion(node.container);
      var preyTypes = 0;
      for (var i = 0; i < groups.length; i++) {
        var other = groups[i];
        if (other.id === node.id || !other.alive) continue;
        var cat = TEMPLATES[other.templateId].category;
        if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'item') {
          preyTypes++;
        }
      }
      if (preyTypes >= 2) return true;
    }

    return false;
  },

  // --- Small groups: simulate placeholder individuals ---
  // Each placeholder gets jittered vitals and evaluates roles independently.
  // Majority action executes on the group. Distribution recorded.
  evaluatePlaceholders: function(node) {
    var agency = node.traits.agency;
    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    var v = node.traits.vitals;
    var actionTally = {};  // name → count

    for (var p = 0; p < node.count; p++) {
      // Virtual individual with jittered vitals
      var virtual = {
        id: node.id,
        templateId: node.templateId,
        count: 1,
        container: node.container,
        alive: true,
        traits: {
          vitals: {
            hunger: clamp(v.hunger + (Math.random() - 0.5) * 12, 0, 100),
            energy: clamp(v.energy + (Math.random() - 0.5) * 10, 0, 100),
          },
          diet: node.traits.diet,
          agency: agency,
          spatial: node.traits.spatial,
        }
      };

      // Evaluate: first matching condition wins for this placeholder
      for (var i = 0; i < roleDef.length; i++) {
        if (roleDef[i].condition(virtual)) {
          actionTally[roleDef[i].name] = (actionTally[roleDef[i].name] || 0) + 1;
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

    // Execute majority action on the whole group
    if (majorAction) {
      for (var i = 0; i < roleDef.length; i++) {
        if (roleDef[i].name === majorAction) {
          roleDef[i].action(node);
          break;
        }
      }
    }

    agency.actionSpread = actionTally;
  },
};

function clamp(val, lo, hi) { return val < lo ? lo : val > hi ? hi : val; }

// --- Role definitions (per entity) ---
// Each entry: { name, condition(entity), action(entity), urgent? }
// Priority: first match wins. Urgent = whole group acts in unison.

var ROLE_DEFS = {
  grazer: [
    { name: 'flee', urgent: true,
      condition: function(n) { return threatsInRegion(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    { name: 'graze',
      condition: function(n) { return n.traits.vitals.hunger > 35 && foodInRegion(n); },
      action: function(n) { graze(n); }
    },
    { name: 'seekFood',
      condition: function(n) { return n.traits.vitals.hunger > 55; },
      action: function(n) { Planner.start(n, 'findFood'); }
    },
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wanderRegion(n); }
    },
  ],

  hunter: [
    { name: 'flee', urgent: true,
      condition: function(n) { return biggerThreatsInRegion(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    { name: 'hunt',
      condition: function(n) { return n.traits.vitals.hunger > 30 && preyInRegion(n); },
      action: function(n) { hunt(n); }
    },
    { name: 'seekPrey',
      condition: function(n) { return n.traits.vitals.hunger > 45; },
      action: function(n) { Planner.start(n, 'huntPrey'); }
    },
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wanderRegion(n); }
    },
  ],

  forager: [
    { name: 'flee', urgent: true,
      condition: function(n) { return biggerThreatsInRegion(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    { name: 'hunt',
      condition: function(n) { return n.traits.vitals.hunger > 50 && preyInRegion(n); },
      action: function(n) { hunt(n); }
    },
    { name: 'graze',
      condition: function(n) { return n.traits.vitals.hunger > 35 && foodInRegion(n); },
      action: function(n) { graze(n); }
    },
    { name: 'seekFood',
      condition: function(n) { return n.traits.vitals.hunger > 50; },
      action: function(n) { Planner.start(n, 'findFood'); }
    },
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wanderRegion(n); }
    },
  ],
};

// --- Region-scale actions (compound math scales with count) ---

function graze(node) {
  var food = foodInRegion(node);
  if (!food) return;

  var eaten = Math.min(food.count, node.count * CONFIG.FEED_RATE);
  eaten = Math.max(1, Math.round(eaten));
  food.count -= eaten;
  if (food.count <= 0) food.alive = false;

  node.traits.vitals.hunger -= eaten * CONFIG.FOOD_PER_PLANT / Math.max(1, node.count);
  node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);
  node.traits.vitals.energy -= 0.5;
  node.traits.agency.lastAction = 'graze';
}

function hunt(node) {
  var prey = preyInRegion(node);
  if (!prey) return;

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

  var predatorLosses = Math.round(killed * 0.05 / Math.max(ratio, 0.1));
  node.count -= Math.min(predatorLosses, node.count - 1);

  node.traits.vitals.energy -= 3;
  node.traits.agency.lastAction = killed > 0 ? 'kill(' + killed + ')' : 'hunt-miss';
}

function rest(node) {
  node.traits.vitals.energy = Math.min(100, node.traits.vitals.energy + 5);
  node.traits.agency.lastAction = 'rest';
}

function wanderRegion(node) {
  var neighbors = World.walkableNeighbors(node.container);
  if (neighbors.length === 0) return;
  var target = neighbors[Math.floor(Math.random() * neighbors.length)];
  World.moveGroup(node, target);
  node.traits.vitals.energy -= 0.5;
  node.traits.agency.lastAction = 'wander';
}

// --- Region-scale perception ---

function foodInRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var groups = World.groupsInRegion(node.container);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.alive) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    var cat = otherTmpl.category;
    if (diet.eats.indexOf(cat) >= 0 && (cat === 'plant' || cat === 'item') && other.count > 0) {
      return other;
    }
  }
  return null;
}

function preyInRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var groups = World.groupsInRegion(node.container);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.alive) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    var cat = otherTmpl.category;
    if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'item' && other.count > 0) {
      return other;
    }
  }
  return null;
}

function threatsInRegion(node) {
  var diet = node.traits.diet;
  if (!diet || !diet.eatenBy || diet.eatenBy.length === 0) return [];
  var groups = World.groupsInRegion(node.container);
  var threats = [];
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.traits.agency) continue;
    if (diet.eatenBy.indexOf(TEMPLATES[other.templateId].category) >= 0) {
      threats.push(other);
    }
  }
  return threats;
}

function biggerThreatsInRegion(node) {
  var myCategory = TEMPLATES[node.templateId].category;
  var myStrength = TEMPLATES[node.templateId].strength;
  var groups = World.groupsInRegion(node.container);
  var threats = [];
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.traits.agency) continue;
    var otherDiet = other.traits.diet;
    if (otherDiet && otherDiet.eats.indexOf(myCategory) >= 0 &&
        TEMPLATES[other.templateId].strength > myStrength) {
      threats.push(other);
    }
  }
  return threats;
}
