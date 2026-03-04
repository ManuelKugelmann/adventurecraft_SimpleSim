// planner.js — Reusable processes (multi-step action sequences)
// Multi-step action sequences, movement between container groups

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

// --- Reusable process definitions ---

var PROCESSES = {
  flee: {
    init: function(node) {
      return {
        steps: [
          { exec: function(n) { return fleeContainer(n); } },
          { exec: function(n) { return fleeContainer(n); } },
        ]
      };
    },
  },

  findFood: {
    init: function(node) {
      // Scan neighbor regions for plant food
      var target = findFoodNearby(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            World.moveGroup(n, target);
            dropContained(n);
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-food';
            return 'done';
          }},
          { valid: function(n) { return foodInContainer(n) !== null; },
            exec: function(n) { graze(n); return 'done'; }
          },
        ]
      };
    },
  },

  huntPrey: {
    init: function(node) {
      // Scan neighbor regions for prey
      var target = findPreyNearby(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            World.moveGroup(n, target);
            dropContained(n);
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-prey';
            return 'done';
          }},
          { valid: function(n) { return preyInContainer(n) !== null; },
            exec: function(n) { hunt(n); return 'done'; }
          },
        ]
      };
    },
  },
};

// --- Process helpers ---

function fleeContainer(node) {
  var threats = threatsInContainer(node);
  if (threats.length === 0) threats = biggerThreatsInContainer(node);
  if (threats.length === 0) return 'done';

  // Pick a walkable neighbor away from threats
  var neighbors = World.walkableNeighbors(node.container);
  if (neighbors.length === 0) return 'fail';

  // Score each neighbor: prefer groups farther from threats
  var threatGroup = threats[0].container;
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < neighbors.length; i++) {
    var nGroup = World.groups.get(neighbors[i]);
    if (!nGroup) continue;
    var tGroup = World.groups.get(threatGroup);
    if (!tGroup) { best = neighbors[i]; break; }
    // Distance from threat (Manhattan between group centers)
    var dist = Math.abs(nGroup.center.x - tGroup.center.x) +
               Math.abs(nGroup.center.y - tGroup.center.y);
    if (dist > bestScore) {
      bestScore = dist;
      best = neighbors[i];
    }
  }

  if (best !== null) {
    if (stoneMoveBlocked(node)) return 'done';
    tryPickup(node);
    World.moveGroup(node, best);
    dropContained(node);
    node.traits.vitals.energy -= 1;
    node.traits.agency.lastAction = 'flee';
  }
  return 'done';
}

// Find a neighbor group containing plant food
function findFoodNearby(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var neighbors = World.walkableNeighbors(node.container);
  for (var i = 0; i < neighbors.length; i++) {
    var groups = World.groupsInContainer(neighbors[i]);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      var cat = otherTmpl.category;
      if (diet.eats.indexOf(cat) >= 0 && (cat === 'plant' || cat === 'seed')) {
        return neighbors[i];
      }
    }
  }
  return null;
}

// Find a neighbor group containing prey
function findPreyNearby(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  var neighbors = World.walkableNeighbors(node.container);
  for (var i = 0; i < neighbors.length; i++) {
    var groups = World.groupsInContainer(neighbors[i]);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      var cat = otherTmpl.category;
      if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'seed' && cat !== 'item') {
        return neighbors[i];
      }
    }
  }
  return null;
}
