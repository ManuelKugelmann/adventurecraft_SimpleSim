// planner.js — Multi-step process definitions (data) + planner engine (code)
// Process definitions are pure data: step sequences with typed instructions.
// Planner engine interprets step types generically via Effects engine.
// No imperative step functions — all behavior described as step data.

// === PROCESS DEFINITIONS (DATA) ===
// Each process: { initTarget?, fallback?, steps: [...] }
// Step types:
//   startmove — initiate movement: { type:'startmove', toward, pickup, cost, label, noTarget? }
//   wait      — block until movement completes: { type:'wait' }
//   action    — execute named action: { type:'action', name, valid? }
// Future .acf:
//   PROCESS findFood
//     INIT TARGET foodNearby FALLBACK wander
//     STEP MOVE $target PICKUP COST seek LABEL seek-food
//     STEP WAIT
//     STEP ACTION graze VALID sense.food.here != null

var PROCESS_DEFS = {
  flee: {
    steps: [
      { type: 'startmove', toward: 'away_threats', pickup: true, cost: 'flee', label: 'flee',
        noTarget: 'done' },
      { type: 'wait' },
      { type: 'startmove', toward: 'away_threats', pickup: true, cost: 'flee', label: 'flee',
        noTarget: 'done' },
      { type: 'wait' },
    ],
  },
  findFood: {
    initTarget: 'foodNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', toward: '$target', pickup: true, cost: 'seek', label: 'seek-food' },
      { type: 'wait' },
      { type: 'action', name: 'graze', valid: [['sense.food.here', '!=', null]] },
    ],
  },
  findWater: {
    initTarget: 'waterNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', toward: '$target', pickup: true, cost: 'seek', label: 'seek-water' },
      { type: 'wait' },
    ],
  },
  huntPrey: {
    initTarget: 'preyNearby',
    fallback: 'wander',
    steps: [
      { type: 'startmove', toward: '$target', pickup: true, cost: 'seek', label: 'seek-prey' },
      { type: 'wait' },
      { type: 'action', name: 'hunt', valid: [['sense.prey.here', '!=', null]] },
    ],
  },
};

// === PLANNER ENGINE (CODE) ===

var Planner = {
  start: function(node, processName) {
    var agency = node.traits.agency;
    var def = PROCESS_DEFS[processName];
    if (!def) return;

    // Resolve init target from sense model
    var target = null;
    if (def.initTarget) {
      var sense = Sense.scan(node);
      target = sense[def.initTarget];
      if (!target) {
        // No target found — execute fallback action
        if (def.fallback) Effects.executeAction(def.fallback, node, sense);
        return;
      }
    }

    agency.activePlan = { goal: processName, steps: def.steps, target: target, stepIdx: 0 };
    agency.activePlanStep = 0;
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
        // Resolve target
        var toward = step.toward === '$target' ? plan.target : step.toward;
        if (toward === 'away_threats') {
          toward = Effects._awayFromThreats(node, sense);
          if (!toward) {
            // No threats to flee from — step complete or plan done
            if (step.noTarget === 'done') { agency.activePlan = null; }
            else { this._advance(plan, agency); }
            return;
          }
        }
        if (!toward) { agency.activePlan = null; return; }

        // Execute movement via effects engine
        var result = Effects._move({ toward: toward, pickup: step.pickup }, node, sense);
        if (result.status === 'ok') {
          Rules.applyActionCost(node, step.cost);
          node.traits.agency.lastAction = step.label || step.cost;
          this._advance(plan, agency);
        } else {
          // blocked/slowed/fail — apply cost and abort plan
          if (result.status === 'blocked' || result.status === 'slowed') {
            Rules.applyActionCost(node, step.cost);
            node.traits.agency.lastAction = result.label;
          }
          agency.activePlan = null;
        }
        break;

      case 'wait':
        if (World.isMoving(node)) return; // still in transit
        this._advance(plan, agency);
        // Try next step immediately (e.g., action after arrival)
        if (agency.activePlan) this.executeStep(node);
        break;

      case 'action':
        // Validate precondition against sense model
        if (step.valid && !evalRuleConditions(step.valid, node.traits.vitals, sense, node.count)) {
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
