// node.js — Unified Node with count, container, tile-level position
// Everything is a node: tiles, hierarchy groups, plants, animals, items.
// Two hierarchies on every node:
//   parent:              grouping (multiscale sim) — tiles→L1 group→L2 group→...
//   contains/containedBy: structural (transport)   — animals carrying items

var nextNodeId = 1;

function createNode(templateId) {
  var template = TEMPLATES[templateId];
  if (!template) throw new Error('Unknown template: ' + templateId);

  var node = {
    id: nextNodeId++,
    templateId: templateId,
    count: template.defaultCount || 1,
    container: null,        // group ID this node occupies (any hierarchy level)
    center: { x: 0, y: 0 }, // tile-level position (derived from position on graph)
    spread: 1,              // radius in tiles (visual coverage)
    alive: true,
    parent: null,           // organizational hierarchy
    contains: [],           // node IDs contained by this node (carried items)
    containedBy: null,      // node ID of carrier, or null if free
    position: { at: 'center', target: null, progress: 0 }, // graph position within container
    traits: {},
  };

  // Deep-copy default traits from template (2 levels deep for nested objects)
  var tkeys = Object.keys(template.traits);
  for (var i = 0; i < tkeys.length; i++) {
    var traitName = tkeys[i];
    var src = template.traits[traitName];
    if (Array.isArray(src)) {
      node.traits[traitName] = src.slice();
    } else if (typeof src === 'object' && src !== null) {
      var copy = {};
      var skeys = Object.keys(src);
      for (var j = 0; j < skeys.length; j++) {
        var v = src[skeys[j]];
        copy[skeys[j]] = (typeof v === 'object' && v !== null && !Array.isArray(v))
          ? Object.assign({}, v) : v;
      }
      node.traits[traitName] = copy;
    } else {
      node.traits[traitName] = src;
    }
  }

  // Assign a unique diversity seed for deterministic probabilistic sampling
  if (node.traits.group && node.traits.group.diversity) {
    node.traits.group.diversity.seed = Math.floor(Rng.random() * 2147483647);
  }

  computeSpread(node);
  return node;
}

function computeSpread(node) {
  node.spread = Math.max(1, Math.ceil(node.count / CONFIG.SPREAD_DENSITY));
}

// Compute total carried weight and bulk from contains[] list.
// Returns { weight, bulk, maxWeight, maxBulk } where max is strength-based capacity.
function carriedLoad(node) {
  var totalWeight = 0;
  var totalBulk = 0;
  for (var i = 0; i < node.contains.length; i++) {
    var item = World.nodes.get(node.contains[i]);
    if (!item || !item.alive) continue;
    var tmpl = TEMPLATES[item.templateId];
    totalWeight += (tmpl.weight || 0) * item.count;
    totalBulk += (tmpl.bulk || 0) * item.count;
  }
  var str = TEMPLATES[node.templateId].strength || 1;
  return {
    weight: totalWeight,
    bulk: totalBulk,
    maxWeight: str * CONFIG.CARRY_WEIGHT_PER_STR,
    maxBulk: str * CONFIG.CARRY_BULK_PER_STR,
  };
}

// Remaining capacity: how much more weight/bulk can this node carry?
function remainingCapacity(node) {
  var load = carriedLoad(node);
  return {
    weight: Math.max(0, load.maxWeight - load.weight),
    bulk: Math.max(0, load.maxBulk - load.bulk),
  };
}

// Speed factor from carried load: 1.0 = unencumbered, lower = slower.
// Uses the more constrained of weight or bulk ratio.
function carrySpeedFactor(node) {
  if (node.contains.length === 0) return 1.0;
  var load = carriedLoad(node);
  var wRatio = load.maxWeight > 0 ? load.weight / load.maxWeight : 0;
  var bRatio = load.maxBulk > 0 ? load.bulk / load.maxBulk : 0;
  var ratio = Math.max(wRatio, bRatio);
  return Math.max(0.1, 1.0 - ratio * CONFIG.CARRY_SPEED_PENALTY);
}
