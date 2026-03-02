// planner.js — Reusable processes (multi-step action sequences)
// Region-scale: movement between regions, no tile pathfinding

var Planner = {
  // Start a process for a node
  start: function(node, processName) {
    var agency = node.traits.agency;
    var process = PROCESSES[processName];
    if (!process) return;

    var plan = process.init(node);
    if (plan && plan.steps && plan.steps.length > 0) {
      agency.activePlan = { goal: processName, steps: plan.steps };
      agency.activePlanStep = 0;
      // Execute first step immediately
      this.executeStep(node);
    }
  },

  // Execute current step of active process
  executeStep: function(node) {
    var agency = node.traits.agency;
    var plan = agency.activePlan;
    if (!plan) return;

    var stepIdx = agency.activePlanStep;
    if (stepIdx >= plan.steps.length) {
      agency.activePlan = null;
      agency.activePlanStep = 0;
      return;
    }

    var step = plan.steps[stepIdx];

    // Validate precondition (if the world changed, abort)
    if (step.valid && !step.valid(node)) {
      agency.activePlan = null;
      agency.activePlanStep = 0;
      return;
    }

    var result = step.exec(node);

    if (result === 'done' || result === true) {
      agency.activePlanStep++;
      if (agency.activePlanStep >= plan.steps.length) {
        agency.activePlan = null;
        agency.activePlanStep = 0;
      }
    } else if (result === 'fail') {
      agency.activePlan = null;
      agency.activePlanStep = 0;
    }
    // result === 'continue' means stay on this step next tick
  },
};

// --- Reusable process definitions (region-scale) ---

var PROCESSES = {
  flee: {
    init: function(node) {
      return {
        steps: [
          { exec: function(n) { return fleeRegion(n); } },
          { exec: function(n) { return fleeRegion(n); } },
        ]
      };
    },
  },

  findFood: {
    init: function(node) {
      // Scan neighbor regions for plant food
      var target = findFoodRegion(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wanderRegion(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            World.moveGroup(n, target);
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-food';
            return 'done';
          }},
          { valid: function(n) { return foodInRegion(n) !== null; },
            exec: function(n) { graze(n); return 'done'; }
          },
        ]
      };
    },
  },

  huntPrey: {
    init: function(node) {
      // Scan neighbor regions for prey
      var target = findPreyRegion(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wanderRegion(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            World.moveGroup(n, target);
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-prey';
            return 'done';
          }},
          { valid: function(n) { return preyInRegion(n) !== null; },
            exec: function(n) { hunt(n); return 'done'; }
          },
        ]
      };
    },
  },
};

// --- Region-scale process helpers ---

function fleeRegion(node) {
  var threats = threatsInRegion(node);
  if (threats.length === 0) threats = biggerThreatsInRegion(node);
  if (threats.length === 0) return 'done';

  // Pick a walkable neighbor region away from threats
  var neighbors = World.walkableNeighbors(node.container);
  if (neighbors.length === 0) return 'fail';

  // Score each neighbor: prefer regions farther from threats
  var threatRegion = threats[0].container; // primary threat location
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < neighbors.length; i++) {
    var nRegion = World.regions.get(neighbors[i]);
    if (!nRegion) continue;
    var tRegion = World.regions.get(threatRegion);
    if (!tRegion) { best = neighbors[i]; break; }
    // Distance from threat (Manhattan between region centers)
    var dist = Math.abs(nRegion.center.x - tRegion.center.x) +
               Math.abs(nRegion.center.y - tRegion.center.y);
    if (dist > bestScore) {
      bestScore = dist;
      best = neighbors[i];
    }
  }

  if (best !== null) {
    World.moveGroup(node, best);
    node.traits.vitals.energy -= 1;
    node.traits.agency.lastAction = 'flee';
  }
  return 'done';
}

// Find a neighbor region containing plant food
function findFoodRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var neighbors = World.walkableNeighbors(node.container);
  for (var i = 0; i < neighbors.length; i++) {
    var groups = World.groupsInRegion(neighbors[i]);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category === 'plant') {
        return neighbors[i];
      }
    }
  }
  return null;
}

// Find a neighbor region containing prey
function findPreyRegion(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var neighbors = World.walkableNeighbors(node.container);
  for (var i = 0; i < neighbors.length; i++) {
    var groups = World.groupsInRegion(neighbors[i]);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      if (diet.eats.indexOf(otherTmpl.category) >= 0 && otherTmpl.category !== 'plant') {
        return neighbors[i];
      }
    }
  }
  return null;
}
