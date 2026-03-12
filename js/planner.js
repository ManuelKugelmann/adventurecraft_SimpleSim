// planner.js — Multi-step plan definitions (data) + planner engine (code)
// Plans are just plans — not autonomous state machines. Each tick, Roles.evaluate
// re-checks drive priorities. If the plan's originating drive still has priority,
// the planner continues the next step. If a higher-priority drive fires or the
// plan's drive is no longer active, the plan is abandoned (preempted by drives).
// No explicit timeout needed — hunger, fatigue, threats naturally preempt stuck plans.
// Plan definitions are pure data: step sequences with typed instructions.
// Planner engine interprets step types generically via Effects engine.
// All effects (movement, costs) are declared inline as data.

// === PLAN DEFINITIONS (DATA) ===
// Each plan: { initTarget?, fallback?, predict?, risk?, steps: [...] }
// Step types:
//   startmove — initiate movement: { type:'startmove', destination, pickup, cost:[], label, noTarget? }
//   wait      — block until movement completes: { type:'wait' }
//   action    — execute named action: { type:'action', name, valid? }
// cost: array of effect data applied on successful move
// predict: { vital: delta } — estimated outcome per plan (for scoring)
// risk: 0-1 base danger level (modified by strength ratio at runtime)
// Future .acf:
//   plan findFood [survival, universal] {
//     params { target = SpatialRef }
//     method walk {
//       needs { self.knows(route_to($target, walking)) }
//       step: do Move.Direct { destination = $target }
//       action: do graze { valid: sense.food.here != null }
//     }
//   }

// Plan predicted effects: { vital: delta, ... } — estimated outcome per plan.
// Used by scorePlan() to evaluate plan desirability before committing.
// risk: 0-1 base danger level (modified by strength ratio at runtime).
var PLAN_DEFS = {
  flee: {
    predict: { energy: -2 },
    risk: 0,
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
    predict: { hunger: -15, energy: -1.5 },
    risk: 0,
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
    predict: { thirst: -15, energy: -1 },
    risk: 0,
    steps: [
      { type: 'startmove', destination: '$target', pickup: true, label: 'seek-water',
        cost: [{ type: 'vital', target: 'energy', op: 'sub', amount: 1 }] },
      { type: 'wait' },
    ],
  },
  huntPrey: {
    initTarget: 'preyNearby',
    fallback: 'wander',
    predict: { hunger: -25, energy: -4, health: -5 },
    risk: 0.4,
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
  // Score a plan based on predicted vital changes and risk.
  // Intelligence gates lookahead depth:
  //   int 1: no scoring (just run the plan)
  //   int 2: consider predicted effects on current vitals
  //   int 3+: also factor in risk using strength ratio
  scorePlan: function(planName, node, sense) {
    var def = PLAN_DEFS[planName];
    if (!def || !def.predict) return 0;

    var intel = node.traits.spatial ? node.traits.spatial.intelligence : 1;
    if (intel <= 1) return 0;

    var v = node.traits.vitals;
    if (!v) return 0;

    var score = 0;
    var predict = def.predict;
    var keys = Object.keys(predict);
    for (var i = 0; i < keys.length; i++) {
      var vital = keys[i];
      var delta = predict[vital];
      var current = v[vital];
      if (current === undefined) continue;

      if (delta < 0) {
        if (vital === 'energy' || vital === 'health') {
          score += delta * 0.5;  // costs penalize score
        } else {
          score += (-delta) * (current / 100);  // more urgent need → higher value
        }
      } else {
        score += delta * ((100 - current) / 100);
      }
    }

    // Risk assessment (intelligence 3+)
    if (intel >= 3 && def.risk > 0) {
      var myStrength = sense.self.strength * Math.max(1, node.count);
      var threatStrength = 0;
      if (planName === 'huntPrey' && sense.prey.here) {
        var preyTmpl = TEMPLATES[sense.prey.here.templateId];
        threatStrength = preyTmpl.strength * sense.prey.here.count;
      }
      var ratio = myStrength / Math.max(threatStrength, 1);
      score -= def.risk * (1 / Math.max(ratio, 0.1)) * 10;
    }

    return score;
  },

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

    agency.activePlan = { goal: planName, steps: def.steps, target: target, stepIdx: 0 };
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
        // Wait for movement to finish. Drive preemption is handled by
        // Roles.evaluate which re-checks priorities each tick before calling us.
        if (World.isMoving(node)) return;
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
