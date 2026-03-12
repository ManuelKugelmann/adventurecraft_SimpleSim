// planner.js — Multi-step plan definitions (data) + planner engine (code)
// Plan definitions are pure data: step sequences with typed instructions.
// Planner engine interprets step types generically via Effects engine.
// All effects (movement, costs) are declared inline as data.

// === PLAN DEFINITIONS (DATA) ===
// Each plan: { initTarget?, fallback?, steps: [...] }
// Step types:
//   startmove — initiate movement: { type:'startmove', destination, pickup, cost:[], label, noTarget? }
//   wait      — block until movement completes: { type:'wait' }
//   action    — execute named action: { type:'action', name, valid? }
// cost: array of effect data applied on successful move
// Future .acf:
//   plan findFood [survival, universal] {
//     params { target = SpatialRef }
//     method walk {
//       needs { self.knows(route_to($target, walking)) }
//       step: do Move.Direct { destination = $target }
//       action: do graze { valid: sense.food.here != null }
//     }
//   }

var PLAN_DEFS = {
  flee: {
    steps: [
      { type: 'startmove', destination: 'away_threats', pickup: true, label: 'flee',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }],
        noTarget: 'done' },
      { type: 'wait' },
      { type: 'startmove', destination: 'away_threats', pickup: true, label: 'flee',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }],
        noTarget: 'done' },
      { type: 'wait' },
    ],
  },
  findFood: {
    initTarget: 'foodNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', destination: '$target', pickup: true, label: 'seek-food',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }] },
      { type: 'wait' },
      { type: 'action', name: 'graze', valid: [['sense.food.here', '!=', null]] },
    ],
  },
  findWater: {
    initTarget: 'waterNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', destination: '$target', pickup: true, label: 'seek-water',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }] },
      { type: 'wait' },
    ],
  },
  huntPrey: {
    initTarget: 'preyNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', destination: '$target', pickup: true, label: 'seek-prey',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }] },
      { type: 'wait' },
      { type: 'action', name: 'hunt', valid: [['sense.prey.here', '!=', null]] },
    ],
  },
};

// === PLANNER ENGINE (CODE) ===

var Planner = {
  start: function(node, planName) {
    var agency = node.traits.agency;
    var def = PLAN_DEFS[planName];
    if (!def) return;

    // Resolve init target from sense model
    var target = null;
    if (def.initTarget) {
      var sense = Sense.scan(node);
      target = sense[def.initTarget];
      if (!target) {
        if (def.fallback) Effects.executeAction(def.fallback, node, sense);
        return;
      }
    }

    agency.activePlan = { goal: planName, steps: def.steps, target: target, stepIdx: 0, waitTicks: 0 };
    this.executeStep(node);
  },

  executeStep: function(node) {
    var agency = node.traits.agency;
    var plan = agency.activePlan;
    if (!plan) return;

    if (plan.stepIdx >= plan.steps.length) {
      agency.activePlan = null;
      return;
    }

    var step = plan.steps[plan.stepIdx];
    var sense = Sense.scan(node);

    switch (step.type) {

      case 'startmove':
        var dest = step.destination === '$target' ? plan.target : step.destination;
        if (dest === 'away_threats') {
          dest = Effects._awayFromThreats(node, sense);
          if (!dest) {
            if (step.noTarget === 'done') { agency.activePlan = null; }
            else { this._advance(plan, agency); }
            return;
          }
        }
        if (!dest) { agency.activePlan = null; return; }

        var result = Effects._move({ destination: dest, pickup: step.pickup }, node, sense);
        if (result.status === 'ok') {
          if (step.cost) Effects.applyEffects(step.cost, node, sense);
          node.traits.agency.lastAction = step.label;
          this._advance(plan, agency);
        } else {
          if (result.status === 'blocked' || result.status === 'slowed') {
            if (step.cost) Effects.applyEffects(step.cost, node, sense);
            node.traits.agency.lastAction = result.label;
          }
          agency.activePlan = null;
        }
        break;

      case 'wait':
        if (World.isMoving(node)) {
          plan.waitTicks++;
          // Hard cap: abandon plan after 999 ticks of waiting
          if (plan.waitTicks >= 999) {
            agency.activePlan = null;
            agency.lastAction = plan.goal + '-timeout';
          }
          // Drive interruption: re-scan and check if a higher-priority drive
          // now demands action (e.g., new threat appeared while moving)
          if (plan.waitTicks > 0 && plan.waitTicks % 3 === 0) {
            var roleDef = ROLE_DEFS[agency.activeRole];
            if (roleDef) {
              var waitSense = Sense.scan(node);
              var planRule = null;
              for (var ri = 0; ri < roleDef.length; ri++) {
                if (roleDef[ri].plan === plan.goal || roleDef[ri].action === plan.goal) {
                  planRule = roleDef[ri]; break;
                }
              }
              var planPriority = planRule ? (planRule.priority || 0) : 0;
              for (var ri = 0; ri < roleDef.length; ri++) {
                var r = roleDef[ri];
                if ((r.priority || 0) <= planPriority) continue;
                if (!r.when || evalRuleConditions(r.when, node.traits.vitals, waitSense, node.count, node)) {
                  agency.activePlan = null;
                  agency.lastAction = plan.goal + '-interrupted';
                  return;
                }
              }
            }
          }
          return;
        }
        plan.waitTicks = 0;
        this._advance(plan, agency);
        if (agency.activePlan) this.executeStep(node);
        break;

      case 'action':
        if (step.valid && !evalRuleConditions(step.valid, node.traits.vitals, sense, node.count, node)) {
          agency.activePlan = null;
          return;
        }
        Effects.executeAction(step.name, node, sense);
        this._advance(plan, agency);
        break;
    }
  },

  _advance: function(plan, agency) {
    plan.stepIdx++;
    if (plan.stepIdx >= plan.steps.length) {
      agency.activePlan = null;
    }
  },
};
