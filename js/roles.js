// roles.js — Region-scale role actions
// All perception and actions operate on regions, not tiles

var Roles = {
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;

    // If executing a process, continue it
    if (agency.activePlan) {
      Planner.executeStep(node);
      return;
    }

    var roleDef = ROLE_DEFS[agency.activeRole];
    if (!roleDef) return;

    for (var i = 0; i < roleDef.length; i++) {
      if (roleDef[i].condition(node)) {
        roleDef[i].action(node);
        return;
      }
    }
  },
};

var ROLE_DEFS = {
  grazer: [
    { name: 'flee',
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
    { name: 'flee',
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
    { name: 'flee',
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

// --- Region-scale actions ---

function graze(node) {
  var food = foodInRegion(node);
  if (!food) return;

  // Compound: group feeds proportionally
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

  // Compound combat: one aggregate outcome
  var myStrength = node.count * TEMPLATES[node.templateId].strength;
  var preyStrength = prey.count * TEMPLATES[prey.templateId].strength;
  var ratio = myStrength / Math.max(preyStrength, 1);

  var expectedKills = node.count * CONFIG.KILL_RATE * ratio;
  var variance = expectedKills * 0.2;
  var killed = Math.round(expectedKills + (Math.random() - 0.5) * variance);
  killed = Math.max(0, Math.min(killed, prey.count));

  prey.count -= killed;
  if (prey.count <= 0) prey.alive = false;

  // Predator feeds
  node.traits.vitals.hunger -= killed * CONFIG.FOOD_PER_PREY / Math.max(1, node.count);
  node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger);

  // Counter-attack: predator losses
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
  var neighbors = World.walkableNeighbors(node.region);
  if (neighbors.length === 0) return;
  // Random walkable neighbor
  var target = neighbors[Math.floor(Math.random() * neighbors.length)];
  World.moveGroup(node, target);
  node.traits.vitals.energy -= 0.5;
  node.traits.agency.lastAction = 'wander';
}

// --- Region-scale perception ---

function foodInRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var groups = World.groupsInRegion(node.region);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.alive) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category === 'plant' && other.count > 0) {
      return other;
    }
  }
  return null;
}

function preyInRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var groups = World.groupsInRegion(node.region);
  for (var i = 0; i < groups.length; i++) {
    var other = groups[i];
    if (other.id === node.id || !other.alive) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category !== 'plant' && other.count > 0) {
      return other;
    }
  }
  return null;
}

function threatsInRegion(node) {
  var diet = node.traits.diet;
  if (!diet || !diet.eatenBy || diet.eatenBy.length === 0) return [];
  var groups = World.groupsInRegion(node.region);
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
  var groups = World.groupsInRegion(node.region);
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
