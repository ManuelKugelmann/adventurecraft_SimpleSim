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
      // Scan neighbor groups for plant food
      var target = findFoodNearby(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-food';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            return 'done';
          }},
          { valid: function(n) { return foodInContainer(n) !== null; },
            exec: function(n) { graze(n); return 'done'; }
          },
        ]
      };
    },
  },

  findWater: {
    init: function(node) {
      // BFS for a group adjacent to water
      var target = bfsFind(node.container, 4, function(groupId) {
        var g = World.groups.get(groupId);
        if (!g) return false;
        for (var i = 0; i < g.neighbors.length; i++) {
          var ng = World.groups.get(g.neighbors[i]);
          if (ng && ng.type === 'water') return true;
        }
        return false;
      });
      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-water';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            // Arrived near water — thirst handled by biology auto-drink
            return 'done';
          }},
        ]
      };
    },
  },

  huntPrey: {
    init: function(node) {
      // Scan neighbor groups for prey
      var target = findPreyNearby(node);
      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            n.traits.vitals.energy -= 1;
            n.traits.agency.lastAction = 'seek-prey';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
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
  if (World.isMoving(node)) return 'continue';
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
    if (!World.startMove(node, best)) return 'fail';
    node.traits.vitals.energy -= 1;
    node.traits.agency.lastAction = 'flee';
    return 'continue'; // wait for movement to complete
  }
  return 'done';
}

// BFS on link graph: find first group within maxHops matching a predicate.
// Returns the first-hop neighbor ID on the path (what to pass to startMove),
// or null if nothing found. predicate(groupId) returns true if target found there.
function bfsFind(startContainer, maxHops, predicate) {
  var visited = {};
  visited[startContainer] = true;
  // queue entries: { groupId, firstHop } — firstHop is the immediate neighbor on the path
  var queue = [];
  var neighbors = World.walkableNeighbors(startContainer);
  for (var i = 0; i < neighbors.length; i++) {
    visited[neighbors[i]] = true;
    queue.push({ groupId: neighbors[i], firstHop: neighbors[i], depth: 1 });
  }
  var qi = 0;
  while (qi < queue.length) {
    var cur = queue[qi++];
    if (predicate(cur.groupId)) return cur.firstHop;
    if (cur.depth >= maxHops) continue;
    var next = World.walkableNeighbors(cur.groupId);
    for (var j = 0; j < next.length; j++) {
      if (!visited[next[j]]) {
        visited[next[j]] = true;
        queue.push({ groupId: next[j], firstHop: cur.firstHop, depth: cur.depth + 1 });
      }
    }
  }
  return null;
}

// Find a nearby group containing plant food (up to 3 hops via BFS)
function findFoodNearby(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  return bfsFind(node.container, 3, function(groupId) {
    var groups = World.groupsInContainer(groupId);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var cat = TEMPLATES[other.templateId].category;
      if (diet.eats.indexOf(cat) >= 0 && (cat === 'plant' || cat === 'seed')) {
        return true;
      }
    }
    return false;
  });
}

// Find a nearby group containing prey (up to 3 hops via BFS)
function findPreyNearby(node) {
  var diet = node.traits.diet;
  if (!diet) return null;
  return bfsFind(node.container, 3, function(groupId) {
    var groups = World.groupsInContainer(groupId);
    for (var j = 0; j < groups.length; j++) {
      var other = groups[j];
      if (!other.alive || other.count <= 0) continue;
      var cat = TEMPLATES[other.templateId].category;
      if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'seed' && cat !== 'item') {
        return true;
      }
    }
    return false;
  });
}
