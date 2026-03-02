// groups.js — Merge/split rules for nodes with the group trait
// Groups are just nodes with traits.group. Merge/split is trait-driven.
// Any node with count > 1 and traits.group participates.

var Groups = {
  update: function() {
    this.mergePass();
    this.splitPass();
  },

  // Merge: same species + same container + similar vitals → combine
  mergePass: function() {
    var containerSpecies = {};  // "containerId:templateId" → [node]
    World.nodes.forEach(function(node) {
      if (!node.alive || !node.traits.group) return;
      var key = node.container + ':' + node.templateId;
      if (!containerSpecies[key]) containerSpecies[key] = [];
      containerSpecies[key].push(node);
    });

    var keys = Object.keys(containerSpecies);
    for (var k = 0; k < keys.length; k++) {
      var group = containerSpecies[keys[k]];
      if (group.length < 2) continue;

      for (var i = 0; i < group.length; i++) {
        if (!group[i].alive) continue;
        for (var j = i + 1; j < group.length; j++) {
          if (!group[j].alive) continue;

          var a = group[i], b = group[j];
          var gt = a.traits.group;

          // Items (no vitals): always merge
          if (!a.traits.vitals || !b.traits.vitals) {
            a.count += b.count;
            computeSpread(a);
            World.removeGroup(b);
            continue;
          }

          // Agents/plants: merge if hunger difference within threshold
          var va = a.traits.vitals, vb = b.traits.vitals;
          if (Math.abs(va.hunger - vb.hunger) < gt.mergeThreshold) {
            var totalCount = a.count + b.count;
            va.hunger = (va.hunger * a.count + vb.hunger * b.count) / totalCount;
            va.energy = (va.energy * a.count + vb.energy * b.count) / totalCount;
            a.count = totalCount;
            computeSpread(a);
            World.removeGroup(b);
          }
        }
      }
    }
  },

  // Split: nodes exceeding their group.maxSize → half moves to adjacent container
  splitPass: function() {
    var toSplit = [];
    World.nodes.forEach(function(node) {
      if (!node.alive || !node.traits.group) return;
      if (node.count > node.traits.group.maxSize) {
        toSplit.push(node);
      }
    });

    for (var i = 0; i < toSplit.length; i++) {
      var node = toSplit[i];
      if (!node.alive) continue;

      var neighbors = World.walkableNeighbors(node.container);
      var targetRegion = neighbors.length > 0
        ? neighbors[Math.floor(Math.random() * neighbors.length)]
        : node.container;

      var splitCount = Math.floor(node.count / 2);
      node.count -= splitCount;
      computeSpread(node);

      var newNode = createNode(node.templateId);
      newNode.count = splitCount;
      newNode.container = targetRegion;
      var region = World.regions.get(targetRegion);
      newNode.center.x = region.center.x;
      newNode.center.y = region.center.y;
      computeSpread(newNode);

      // Copy vitals with slight variation
      if (node.traits.vitals) {
        newNode.traits.vitals.hunger = clampVital(node.traits.vitals.hunger + (Math.random() - 0.5) * 5);
        newNode.traits.vitals.energy = clampVital(node.traits.vitals.energy + (Math.random() - 0.5) * 5);
      }

      World.nodes.set(newNode.id, newNode);
      if (!World.byRegion.has(targetRegion)) World.byRegion.set(targetRegion, new Set());
      World.byRegion.get(targetRegion).add(newNode.id);
    }
  },
};

function clampVital(v) { return Math.max(0, Math.min(100, v)); }
