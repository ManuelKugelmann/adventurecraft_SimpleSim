// sense.js — Perception module: builds range-limited world model per entity
// All behavior (roles, plans, bio rules) queries this model, not raw World state.
// Perception range: current container + immediate walkable neighbors (1 hop).
// Future: perception range per species, fog-of-war, memory decay.

var Sense = {
  // Build a filtered world model for an entity
  scan: function(node) {
    var diet = node.traits.diet;
    var container = node.container;
    var group = World.groups.get(container);

    var tmpl = TEMPLATES[node.templateId];
    var model = {
      food:          { here: null, count: 0 },    // edible plants/seeds in my container
      prey:          { here: null, count: 0 },    // huntable animals in my container
      threats:       { here: [], count: 0 },      // things that eat me (current container)
      biggerThreats: { here: [], count: 0 },      // stronger predators (current container)
      water:         { adjacent: false },          // water tile neighbor of my container
      neighbors:     World.walkableNeighbors(container),
      stones:        { density: 0, blocked: false, slowed: false },
      signals:       { danger: 0, food: 0, follow: 0 },  // nearby signal token counts
      allies:        { here: 0, nearby: 0 },              // same-species counts
      self:          {                                     // entity's own stats for conditions
        social: node.traits.social ? node.traits.social.gregarious : 0,
        intelligence: node.traits.spatial ? node.traits.spatial.intelligence : 1,
        strength: tmpl.strength,
        load: carriedLoad(node),                           // { weight, bulk, maxWeight, maxBulk }
      },
      foodNearby:    null,   // first neighbor containerId with food (1 hop)
      preyNearby:    null,   // first neighbor containerId with prey (1 hop)
      waterNearby:   null,   // first neighbor containerId adjacent to water (1 hop)
    };

    if (!group) return model;

    // Scan current container entities
    this._scanEntities(node, container, diet, model, true);

    // Scan neighbor containers (1-hop perception range)
    for (var i = 0; i < model.neighbors.length; i++) {
      this._scanEntities(node, model.neighbors[i], diet, model, false);
    }

    // Water adjacency: check all structural neighbors (including non-walkable)
    if (group.neighbors) {
      for (var i = 0; i < group.neighbors.length; i++) {
        var ng = World.groups.get(group.neighbors[i]);
        if (ng && ng.type === 'water') {
          model.water.adjacent = true;
          break;
        }
      }
    }

    // Water nearby: check walkable neighbors' structural neighbors for water
    if (!model.waterNearby) {
      for (var i = 0; i < model.neighbors.length; i++) {
        var nGroup = World.groups.get(model.neighbors[i]);
        if (!nGroup || !nGroup.neighbors) continue;
        for (var j = 0; j < nGroup.neighbors.length; j++) {
          var ng2 = World.groups.get(nGroup.neighbors[j]);
          if (ng2 && ng2.type === 'water') {
            model.waterNearby = model.neighbors[i];
            break;
          }
        }
        if (model.waterNearby) break;
      }
    }

    // Stone density in current container
    var stoneCount = 0;
    var entities = World.groupsInContainer(container);
    var snap = Snapshot.active();
    for (var i = 0; i < entities.length; i++) {
      var eAlive = snap ? Snapshot.alive(entities[i].id) : entities[i].alive;
      var eCount = snap ? Snapshot.count(entities[i].id) : entities[i].count;
      if (eAlive && TEMPLATES[entities[i].templateId].category === 'item') {
        stoneCount += eCount;
      }
    }
    model.stones.density = stoneCount / group.tileCount;
    model.stones.blocked = model.stones.density >= CONFIG.STONE_BLOCK_PER_TILE;
    model.stones.slowed = model.stones.density >= CONFIG.STONE_SLOW_PER_TILE;

    return model;
  },

  _scanEntities: function(node, containerId, diet, model, isHere) {
    if (!diet) return;
    var entities = World.groupsInContainer(containerId);
    var myCategory = TEMPLATES[node.templateId].category;
    var myStrength = TEMPLATES[node.templateId].strength;
    var snap = Snapshot.active();

    for (var i = 0; i < entities.length; i++) {
      var other = entities[i];
      var otherAlive = snap ? Snapshot.alive(other.id) : other.alive;
      var otherCount = snap ? Snapshot.count(other.id) : other.count;
      if (other.id === node.id || !otherAlive || otherCount <= 0) continue;
      var otherTmpl = TEMPLATES[other.templateId];
      var cat = otherTmpl.category;

      // Signals: scan knowledge tokens from virtual items
      if (cat === 'signal' && other.traits.signal) {
        var tokens = other.traits.signal.tokens;
        for (var ti = 0; ti < tokens.length; ti++) {
          var tokType = tokens[ti].type;
          if (model.signals[tokType] !== undefined) model.signals[tokType]++;
        }
        continue;
      }

      // Allies: same species
      if (other.templateId === node.templateId) {
        if (isHere) model.allies.here += otherCount;
        else model.allies.nearby += otherCount;
      }

      // Food (plants/seeds I can eat)
      if (diet.eats.indexOf(cat) >= 0 && (cat === 'plant' || cat === 'seed')) {
        if (isHere) {
          if (!model.food.here) model.food.here = other;
          model.food.count += otherCount;
        } else if (!model.foodNearby) {
          model.foodNearby = containerId;
        }
      }

      // Prey (animals I can eat)
      if (diet.eats.indexOf(cat) >= 0 && cat !== 'plant' && cat !== 'seed' && cat !== 'item') {
        if (isHere) {
          if (!model.prey.here) model.prey.here = other;
          model.prey.count += otherCount;
        } else if (!model.preyNearby) {
          model.preyNearby = containerId;
        }
      }

      // Threats and bigger threats — current container only
      if (isHere) {
        if (diet.eatenBy && diet.eatenBy.indexOf(cat) >= 0 && other.traits.agency) {
          model.threats.here.push(other);
          model.threats.count++;
        }
        if (other.traits.agency) {
          var otherDiet = other.traits.diet;
          if (otherDiet && otherDiet.eats.indexOf(myCategory) >= 0 && otherTmpl.strength > myStrength) {
            model.biggerThreats.here.push(other);
            model.biggerThreats.count++;
          }
        }
      }
    }
  },
};

// === Rule condition evaluator (shared by Rules, Roles, and Planner engines) ===
// Evaluates an array of [field, op, value] conditions against vitals + sense model + node.
// Fields: 'hunger','thirst',etc (vitals), 'count', 'category', 'templateId',
//         'sense.X.Y' (sense model paths).
// Operators: >, <, >=, <=, ==, !=, in (value is array, checks membership).
// If a vital field is undefined on the entity, that condition is skipped (passes).

function evalRuleConditions(conditions, vitals, sense, count, node) {
  for (var i = 0; i < conditions.length; i++) {
    var field = conditions[i][0];
    var op = conditions[i][1];
    var expected = conditions[i][2];
    var actual = _resolveField(field, vitals, sense, count, node);
    // Missing vital → condition not applicable, skip it
    if (actual === undefined) continue;
    if (!_compareOp(actual, op, expected)) return false;
  }
  return true;
}

function _resolveField(field, vitals, sense, count, node) {
  if (field === 'count') {
    return (Snapshot.active() && node) ? Snapshot.count(node.id) : count;
  }
  if (field === 'category') return node ? TEMPLATES[node.templateId].category : undefined;
  if (field === 'templateId') return node ? node.templateId : undefined;
  if (field.indexOf('sense.') === 0) {
    var path = field.slice(6).split('.');
    var obj = sense;
    for (var i = 0; i < path.length; i++) {
      if (obj === undefined || obj === null) return undefined;
      obj = obj[path[i]];
    }
    return obj;
  }
  // Vitals: read from snapshot when active
  if (Snapshot.active() && node) {
    var snapV = Snapshot.vitals(node.id);
    if (snapV && snapV[field] !== undefined) return snapV[field];
  }
  return vitals ? vitals[field] : undefined;
}

function _compareOp(a, op, b) {
  switch (op) {
    case '>':  return a > b;
    case '<':  return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a == b;
    case '!=': return a != b;
    case 'in': return Array.isArray(b) && b.indexOf(a) >= 0;
    default:   return false;
  }
}
