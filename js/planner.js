// planner.js — Reusable processes (multi-step action sequences)
// Roles reference these; they're not a separate "layer", just reusable recipes

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
      // Process complete
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
          { exec: function(n) { return fleeTick(n); } },
          { exec: function(n) { return fleeTick(n); } },
          { exec: function(n) { return fleeTick(n); } },
        ]
      };
    },
  },

  findFood: {
    init: function(node) {
      var target = findNearestVisible(node, function(other) {
        var otherTmpl = TEMPLATES[other.templateId];
        if (node.traits.diet.eats.indexOf(otherTmpl.category) < 0) return false;
        if (otherTmpl.category === 'plant') {
          return other.traits.growth && other.traits.growth.stage >= 1;
        }
        return false;
      });

      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }

      var steps = buildApproachSteps(node, target, 5);
      steps.push({
        valid: function(n) { return target.alive; },
        exec: function(n) {
          // Try eat when adjacent
          var dx = Math.abs(n.x - target.x);
          var dy = Math.abs(n.y - target.y);
          if (dx <= 1 && dy <= 1 && target.alive) {
            var foodVal = FOOD_VALUES[target.templateId] || 15;
            n.traits.vitals.hunger = Math.max(0, n.traits.vitals.hunger - foodVal);
            target.alive = false;
            n.traits.agency.lastAction = 'eat';
            return 'done';
          }
          return 'fail';
        }
      });
      return { steps: steps };
    },
  },

  huntPrey: {
    init: function(node) {
      var target = findNearestVisible(node, function(other) {
        if (other.id === node.id) return false;
        var otherTmpl = TEMPLATES[other.templateId];
        if (node.traits.diet.eats.indexOf(otherTmpl.category) < 0) return false;
        return otherTmpl.category !== 'plant' && other.traits.vitals;
      });

      if (!target) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }

      var steps = buildApproachSteps(node, target, 8);
      // Attack step (may take multiple ticks)
      steps.push({
        valid: function(n) { return target.alive; },
        exec: function(n) {
          var dx = Math.abs(n.x - target.x);
          var dy = Math.abs(n.y - target.y);
          if (dx <= 1 && dy <= 1) {
            var atk = (n.traits.combat ? n.traits.combat.attack : 2);
            var def = (target.traits.combat ? target.traits.combat.defense : 0);
            var dmg = Math.max(1, atk - def);
            target.traits.vitals.hp -= dmg;
            n.traits.vitals.energy -= 2;
            if (target.traits.vitals.hp <= 0) {
              target.alive = false;
              var foodVal = FOOD_VALUES[target.templateId] || 30;
              n.traits.vitals.hunger = Math.max(0, n.traits.vitals.hunger - foodVal);
              n.traits.agency.lastAction = 'kill+eat';
              return 'done';
            }
            n.traits.agency.lastAction = 'attack';
            return 'continue'; // keep attacking
          } else {
            // Chase
            moveToward(n, target.x, target.y);
            return 'continue';
          }
        }
      });
      return { steps: steps };
    },
  },

  findMate: {
    init: function(node) {
      var mate = findNearestVisible(node, function(other) {
        return other.id !== node.id &&
               other.templateId === node.templateId &&
               other.traits.vitals && other.traits.vitals.reproUrge > 30;
      });

      if (!mate) {
        return { steps: [{ exec: function(n) { wander(n); return 'done'; } }] };
      }

      var steps = buildApproachSteps(node, mate, 5);
      steps.push({
        valid: function(n) { return mate.alive; },
        exec: function(n) {
          var dx = Math.abs(n.x - mate.x);
          var dy = Math.abs(n.y - mate.y);
          if (dx <= 1 && dy <= 1) {
            reproduce(n, mate);
            return 'done';
          }
          return 'fail';
        }
      });
      return { steps: steps };
    },
  },
};

// --- Process helpers ---

function fleeTick(node) {
  var threats = nearbyThreats(node);
  if (threats.length === 0) threats = nearbyBiggerThreats(node);
  if (threats.length === 0) return 'done';

  // Average threat position
  var tx = 0, ty = 0;
  for (var i = 0; i < threats.length; i++) {
    tx += threats[i].x;
    ty += threats[i].y;
  }
  tx /= threats.length;
  ty /= threats.length;

  // Move away from threats
  var dx = node.x - tx;
  var dy = node.y - ty;
  var speed = node.traits.spatial ? node.traits.spatial.speed : 1;

  for (var s = 0; s < speed; s++) {
    var nx = node.x, ny = node.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      nx += dx > 0 ? 1 : -1;
    } else {
      ny += dy > 0 ? 1 : -1;
    }
    if (World.isWalkable(nx, ny)) {
      World.moveNode(node, nx, ny);
      dx = node.x - tx;
      dy = node.y - ty;
    } else {
      // Try perpendicular
      var altx = node.x, alty = node.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        alty += (Math.random() < 0.5 ? 1 : -1);
      } else {
        altx += (Math.random() < 0.5 ? 1 : -1);
      }
      if (World.isWalkable(altx, alty)) {
        World.moveNode(node, altx, alty);
      }
      break;
    }
  }

  node.traits.vitals.energy -= 1;
  node.traits.agency.lastAction = 'flee';
  return 'done';
}

function moveToward(node, tx, ty) {
  var dx = tx - node.x;
  var dy = ty - node.y;
  if (dx === 0 && dy === 0) return true;

  var speed = node.traits.spatial ? node.traits.spatial.speed : 1;
  var moved = false;

  for (var s = 0; s < speed; s++) {
    var nx = node.x, ny = node.y;
    // Greedy: move along axis with larger distance
    if (Math.abs(dx) >= Math.abs(dy)) {
      nx += dx > 0 ? 1 : -1;
    } else {
      ny += dy > 0 ? 1 : -1;
    }
    if (World.isWalkable(nx, ny)) {
      World.moveNode(node, nx, ny);
      dx = tx - node.x;
      dy = ty - node.y;
      moved = true;
    } else {
      // Try other axis
      nx = node.x;
      ny = node.y;
      if (Math.abs(dx) < Math.abs(dy)) {
        nx += dx > 0 ? 1 : (dx < 0 ? -1 : 0);
      } else {
        ny += dy > 0 ? 1 : (dy < 0 ? -1 : 0);
      }
      if (nx !== node.x || ny !== node.y) {
        if (World.isWalkable(nx, ny)) {
          World.moveNode(node, nx, ny);
          dx = tx - node.x;
          dy = ty - node.y;
          moved = true;
        }
      }
      break;
    }
    if (node.x === tx && node.y === ty) break;
  }

  if (moved) {
    node.traits.vitals.energy -= 0.5;
    node.traits.agency.lastAction = 'move';
  }
  return node.x === tx && node.y === ty;
}

function buildApproachSteps(node, target, maxSteps) {
  var steps = [];
  for (var i = 0; i < maxSteps; i++) {
    (function(t) {
      steps.push({
        valid: function(n) { return t.alive; },
        exec: function(n) {
          var dx = Math.abs(n.x - t.x);
          var dy = Math.abs(n.y - t.y);
          if (dx <= 1 && dy <= 1) return 'done';
          moveToward(n, t.x, t.y);
          // Check if adjacent now
          dx = Math.abs(n.x - t.x);
          dy = Math.abs(n.y - t.y);
          if (dx <= 1 && dy <= 1) return 'done';
          return 'done'; // move once per step, advance
        }
      });
    })(target);
  }
  return steps;
}

function findNearestVisible(node, predicate) {
  var perception = node.traits.spatial ? node.traits.spatial.perception : 3;
  var candidates = World.nodesInRadius(node.x, node.y, perception);
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c.alive || c.id === node.id) continue;
    if (predicate(c)) {
      var dist = Math.abs(c.x - node.x) + Math.abs(c.y - node.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
  }
  return best;
}

function reproduce(a, b) {
  // Spawn offspring at midpoint
  var mx = Math.round((a.x + b.x) / 2);
  var my = Math.round((a.y + b.y) / 2);
  if (!World.isWalkable(mx, my)) {
    mx = a.x;
    my = a.y;
  }
  var child = World.spawnNode(a.templateId, mx, my);

  // Reset parents
  a.traits.vitals.reproUrge = 0;
  a.traits.vitals.reproCooldown = 80 + Math.floor(Math.random() * 40);
  a.traits.vitals.energy -= 15;
  b.traits.vitals.reproUrge = 0;
  b.traits.vitals.reproCooldown = 80 + Math.floor(Math.random() * 40);
  b.traits.vitals.energy -= 15;

  a.traits.agency.lastAction = 'reproduce';
}
