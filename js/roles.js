// roles.js — Role definitions with priority-sorted reactive rules
// Roles reference reusable processes (defined in planner.js) for multi-step behavior

var Roles = {
  // Evaluate the active role for a node: iterate rules by priority, first match fires
  evaluate: function(node) {
    var agency = node.traits.agency;
    if (!agency) return;

    // If currently executing a process, continue it
    if (agency.activePlan) {
      Planner.executeStep(node);
      return;
    }

    var roleName = agency.activeRole;
    var roleDef = ROLE_DEFS[roleName];
    if (!roleDef) return;

    for (var i = 0; i < roleDef.length; i++) {
      var rule = roleDef[i];
      if (rule.condition(node)) {
        rule.action(node);
        return;
      }
    }
  },
};

// Role definitions: arrays of {condition, action} sorted by priority (index 0 = highest)
var ROLE_DEFS = {
  grazer: [
    // Flee from predators
    { name: 'flee',
      condition: function(n) { return nearbyThreats(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    // Eat adjacent food when hungry
    { name: 'eat',
      condition: function(n) { return n.traits.vitals.hunger > 40 && adjacentFood(n); },
      action: function(n) { eatAdjacent(n); }
    },
    // Seek food when very hungry (multi-step process)
    { name: 'seekFood',
      condition: function(n) { return n.traits.vitals.hunger > 55; },
      action: function(n) { Planner.start(n, 'findFood'); }
    },
    // Reproduce when urge is high
    { name: 'reproduce',
      condition: function(n) { return n.traits.vitals.reproUrge > 60 && n.traits.vitals.hunger < 60; },
      action: function(n) { Planner.start(n, 'findMate'); }
    },
    // Rest when low energy
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    // Default: wander
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wander(n); }
    },
  ],

  hunter: [
    // Flee from bigger threats
    { name: 'flee',
      condition: function(n) { return nearbyBiggerThreats(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    // Eat adjacent kill
    { name: 'eat',
      condition: function(n) { return n.traits.vitals.hunger > 20 && adjacentPrey(n); },
      action: function(n) { attackAndEat(n); }
    },
    // Hunt when hungry (multi-step process)
    { name: 'hunt',
      condition: function(n) { return n.traits.vitals.hunger > 40; },
      action: function(n) { Planner.start(n, 'huntPrey'); }
    },
    // Reproduce
    { name: 'reproduce',
      condition: function(n) { return n.traits.vitals.reproUrge > 60 && n.traits.vitals.hunger < 50; },
      action: function(n) { Planner.start(n, 'findMate'); }
    },
    // Rest
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    // Wander
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wander(n); }
    },
  ],

  forager: [
    // Flee from bigger threats
    { name: 'flee',
      condition: function(n) { return nearbyBiggerThreats(n).length > 0; },
      action: function(n) { Planner.start(n, 'flee'); }
    },
    // Eat adjacent food (plant or small prey)
    { name: 'eat',
      condition: function(n) {
        return n.traits.vitals.hunger > 30 && (adjacentFood(n) || adjacentPrey(n));
      },
      action: function(n) {
        if (adjacentPrey(n) && n.traits.vitals.hunger > 50) {
          attackAndEat(n);
        } else if (adjacentFood(n)) {
          eatAdjacent(n);
        } else {
          attackAndEat(n);
        }
      }
    },
    // Seek food
    { name: 'seekFood',
      condition: function(n) { return n.traits.vitals.hunger > 50; },
      action: function(n) { Planner.start(n, 'findFood'); }
    },
    // Reproduce
    { name: 'reproduce',
      condition: function(n) { return n.traits.vitals.reproUrge > 60 && n.traits.vitals.hunger < 60; },
      action: function(n) { Planner.start(n, 'findMate'); }
    },
    // Rest
    { name: 'rest',
      condition: function(n) { return n.traits.vitals.energy < 20; },
      action: function(n) { rest(n); }
    },
    // Wander
    { name: 'wander',
      condition: function() { return true; },
      action: function(n) { wander(n); }
    },
  ],
};

// --- Immediate actions (single-tick) ---

function wander(node) {
  var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  shuffleArray(dirs);
  for (var i = 0; i < dirs.length; i++) {
    var nx = node.x + dirs[i][0];
    var ny = node.y + dirs[i][1];
    if (World.isWalkable(nx, ny)) {
      World.moveNode(node, nx, ny);
      node.traits.vitals.energy -= 0.5;
      node.traits.agency.lastAction = 'wander';
      return;
    }
  }
}

function rest(node) {
  node.traits.vitals.energy = Math.min(100, node.traits.vitals.energy + 5);
  node.traits.agency.lastAction = 'rest';
}

function adjacentFood(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var dirs = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];
  for (var d = 0; d < dirs.length; d++) {
    var ax = node.x + dirs[d][0], ay = node.y + dirs[d][1];
    var nearby = World.nodesAt(ax, ay);
    for (var i = 0; i < nearby.length; i++) {
      var other = nearby[i];
      if (other.id === node.id) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category === 'plant') {
        if (other.traits.growth && other.traits.growth.stage >= 1) {
          return other;
        }
      }
    }
  }
  return null;
}

function adjacentPrey(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var dirs = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];
  for (var d = 0; d < dirs.length; d++) {
    var ax = node.x + dirs[d][0], ay = node.y + dirs[d][1];
    var nearby = World.nodesAt(ax, ay);
    for (var i = 0; i < nearby.length; i++) {
      var other = nearby[i];
      if (other.id === node.id) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category !== 'plant') {
        return other;
      }
    }
  }
  return null;
}

function eatAdjacent(node) {
  var food = adjacentFood(node);
  if (!food) return;
  var foodVal = FOOD_VALUES[food.templateId] || 15;
  node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger - foodVal);
  food.alive = false;
  node.traits.agency.lastAction = 'eat';
}

function attackAndEat(node) {
  var prey = adjacentPrey(node);
  if (!prey) return;
  var atk = (node.traits.combat ? node.traits.combat.attack : 2);
  var def = (prey.traits.combat ? prey.traits.combat.defense : 0);
  var dmg = Math.max(1, atk - def);
  prey.traits.vitals.hp -= dmg;
  node.traits.vitals.energy -= 3;
  if (prey.traits.vitals.hp <= 0) {
    prey.alive = false;
    var foodVal = FOOD_VALUES[prey.templateId] || 30;
    node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger - foodVal);
    node.traits.agency.lastAction = 'kill+eat';
  } else {
    node.traits.agency.lastAction = 'attack';
  }
}

// --- Perception helpers ---

function nearbyThreats(node) {
  var perception = node.traits.spatial ? node.traits.spatial.perception : 3;
  var diet = node.traits.diet;
  if (!diet || !diet.eatenBy || diet.eatenBy.length === 0) return [];

  var nearby = World.nodesInRadius(node.x, node.y, perception);
  var threats = [];
  for (var i = 0; i < nearby.length; i++) {
    var other = nearby[i];
    if (other.id === node.id || !other.traits.agency) continue;
    var otherTmpl = TEMPLATES[other.templateId];
    if (diet.eatenBy.indexOf(otherTmpl.category) >= 0) {
      threats.push(other);
    }
  }
  return threats;
}

function nearbyBiggerThreats(node) {
  var perception = node.traits.spatial ? node.traits.spatial.perception : 3;
  var myHp = node.traits.vitals.maxHp;
  var nearby = World.nodesInRadius(node.x, node.y, perception);
  var threats = [];
  for (var i = 0; i < nearby.length; i++) {
    var other = nearby[i];
    if (other.id === node.id || !other.traits.agency) continue;
    var otherDiet = other.traits.diet;
    var myTmpl = TEMPLATES[node.templateId];
    if (otherDiet && otherDiet.eats.indexOf(myTmpl.category) >= 0 && other.traits.vitals.maxHp > myHp) {
      threats.push(other);
    }
  }
  return threats;
}
