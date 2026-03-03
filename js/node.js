// node.js — Unified Node with count, container, rough position
// Every node has a count. Nodes with a group trait merge/split on homogeneity.
// Items (grains, seeds, stones) are nodes too — just no agency.
// container points to a tile or tilegroup (region)

var nextNodeId = 1;

function createNode(templateId) {
  var template = TEMPLATES[templateId];
  if (!template) throw new Error('Unknown template: ' + templateId);

  var node = {
    id: nextNodeId++,
    templateId: templateId,
    count: template.defaultCount || 1,
    container: null,        // tile or tilegroup (region) ID this node occupies
    center: { x: 0, y: 0 }, // rough center position (tile coords)
    spread: 1,              // radius in tiles (visual coverage)
    alive: true,
    parent: null,           // organizational hierarchy
    traits: {},
  };

  // Deep-copy default traits from template
  var tkeys = Object.keys(template.traits);
  for (var i = 0; i < tkeys.length; i++) {
    var traitName = tkeys[i];
    var src = template.traits[traitName];
    if (Array.isArray(src)) {
      node.traits[traitName] = src.slice();
    } else if (typeof src === 'object' && src !== null) {
      node.traits[traitName] = Object.assign({}, src);
    } else {
      node.traits[traitName] = src;
    }
  }

  computeSpread(node);
  return node;
}

function computeSpread(node) {
  node.spread = Math.max(1, Math.ceil(node.count / CONFIG.SPREAD_DENSITY));
}
