// node.js — Unified Node class with trait composition

var nextNodeId = 1;

function createNode(templateId) {
  var template = TEMPLATES[templateId];
  if (!template) throw new Error('Unknown template: ' + templateId);

  var node = {
    id: nextNodeId++,
    templateId: templateId,
    container: null,    // tile index — physical containment
    parent: null,       // node id — organizational hierarchy (pack leader, herd)
    alive: true,
    x: 0,
    y: 0,
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

  return node;
}

function hasTrait(node, traitName) {
  return node.traits.hasOwnProperty(traitName);
}

function getTrait(node, traitName) {
  return node.traits[traitName] || null;
}
