// planner.js — Multi-step processes (plans)
// Processes use the sense model for perception — no omniscient search.
// Each process init scans sense to find a 1-hop target, then generates steps.
// Plans abort ('fail') if movement fails or preconditions are invalidated.

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

// === PROCESS DEFINITIONS ===
// Each process: init(node) → { steps: [{ exec, valid? }] }
// Steps use sense model for perception. Targets are 1-hop neighbors
// from the sense model at init time.

var PROCESSES = {
  flee: {
    init: function(node) {
      return {
        steps: [
          { exec: function(n) { return fleeStep(n); } },
          { exec: function(n) { return fleeStep(n); } },
        ]
      };
    },
  },

  findFood: {
    init: function(node) {
      var sense = Sense.scan(node);
      var target = sense.foodNearby;
      if (!target) {
        return { steps: [{ exec: function(n) { ACTIONS.wander(n, Sense.scan(n)); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            Rules.applyActionCost(n, 'seek');
            n.traits.agency.lastAction = 'seek-food';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            return 'done';
          }},
          { valid: function(n) {
            var s = Sense.scan(n);
            return s.food.here !== null;
          },
            exec: function(n) { ACTIONS.graze(n, Sense.scan(n)); return 'done'; }
          },
        ]
      };
    },
  },

  findWater: {
    init: function(node) {
      var sense = Sense.scan(node);
      var target = sense.waterNearby;
      if (!target) {
        return { steps: [{ exec: function(n) { ACTIONS.wander(n, Sense.scan(n)); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            Rules.applyActionCost(n, 'seek');
            n.traits.agency.lastAction = 'seek-water';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            // Arrived near water — thirst handled by biology auto-drink rule
            return 'done';
          }},
        ]
      };
    },
  },

  huntPrey: {
    init: function(node) {
      var sense = Sense.scan(node);
      var target = sense.preyNearby;
      if (!target) {
        return { steps: [{ exec: function(n) { ACTIONS.wander(n, Sense.scan(n)); return 'done'; } }] };
      }
      return {
        steps: [
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            if (stoneMoveBlocked(n)) return 'fail';
            tryPickup(n);
            if (!World.startMove(n, target)) return 'fail';
            Rules.applyActionCost(n, 'seek');
            n.traits.agency.lastAction = 'seek-prey';
            return 'continue';
          }},
          { exec: function(n) {
            if (World.isMoving(n)) return 'continue';
            return 'done';
          }},
          { valid: function(n) {
            var s = Sense.scan(n);
            return s.prey.here !== null;
          },
            exec: function(n) { ACTIONS.hunt(n, Sense.scan(n)); return 'done'; }
          },
        ]
      };
    },
  },
};

// --- Process helpers ---

function fleeStep(node) {
  if (World.isMoving(node)) return 'continue';
  var sense = Sense.scan(node);
  var threats = sense.threats.here;
  if (threats.length === 0) threats = sense.biggerThreats.here;
  if (threats.length === 0) return 'done';

  var neighbors = sense.neighbors;
  if (neighbors.length === 0) return 'fail';

  // Pick a walkable neighbor away from threats
  var threatGroup = threats[0].container;
  var best = null;
  var bestScore = -Infinity;
  for (var i = 0; i < neighbors.length; i++) {
    var nGroup = World.groups.get(neighbors[i]);
    if (!nGroup) continue;
    var tGroup = World.groups.get(threatGroup);
    if (!tGroup) { best = neighbors[i]; break; }
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
    Rules.applyActionCost(node, 'flee');
    node.traits.agency.lastAction = 'flee';
    return 'continue';
  }
  return 'done';
}
