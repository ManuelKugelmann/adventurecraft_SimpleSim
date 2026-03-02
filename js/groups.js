// groups.js — Merge/split on homogeneity
// Same-species groups in same region with similar traits merge.
// Oversized groups split: half stays, half moves to adjacent region.

var Groups = {
  update: function() {
    this.mergePass();
    this.splitPass();
  },

  // Merge: same species + same region + similar vitals → combine
  mergePass: function() {
    // Build per-region, per-species lists
    var regionSpecies = {};  // "regionId:templateId" → [node]
    World.nodes.forEach(function(node) {
      if (!node.alive || !node.traits.agency) return;
      var key = node.region + ':' + node.templateId;
      if (!regionSpecies[key]) regionSpecies[key] = [];
      regionSpecies[key].push(node);
    });

    var keys = Object.keys(regionSpecies);
    for (var k = 0; k < keys.length; k++) {
      var group = regionSpecies[keys[k]];
      if (group.length < 2) continue;

      // Try to merge pairs
      for (var i = 0; i < group.length; i++) {
        if (!group[i].alive) continue;
        for (var j = i + 1; j < group.length; j++) {
          if (!group[j].alive) continue;

          var a = group[i], b = group[j];
          var va = a.traits.vitals, vb = b.traits.vitals;
          if (!va || !vb) continue;

          // Check similarity: hunger difference within threshold
          if (Math.abs(va.hunger - vb.hunger) < CONFIG.MERGE_THRESHOLD) {
            // Merge b into a: weighted average vitals
            var totalCount = a.count + b.count;
            va.hunger = (va.hunger * a.count + vb.hunger * b.count) / totalCount;
            va.energy = (va.energy * a.count + vb.energy * b.count) / totalCount;
            a.count = totalCount;
            computeSpread(a);

            // Remove b
            World.removeGroup(b);
          }
        }
      }
    }
  },

  // Split: groups that exceed MAX_GROUP_SIZE → half moves to adjacent region
  splitPass: function() {
    var toSplit = [];
    World.nodes.forEach(function(node) {
      if (node.alive && node.traits.agency && node.count > CONFIG.MAX_GROUP_SIZE) {
        toSplit.push(node);
      }
    });

    for (var i = 0; i < toSplit.length; i++) {
      var node = toSplit[i];
      if (!node.alive) continue;

      // Find an adjacent walkable region for the split-off group
      var neighbors = World.walkableNeighbors(node.region);
      var targetRegion = neighbors.length > 0
        ? neighbors[Math.floor(Math.random() * neighbors.length)]
        : node.region;  // stay in same region if no neighbors

      var splitCount = Math.floor(node.count / 2);
      node.count -= splitCount;
      computeSpread(node);

      // Create new group with split-off members
      var newNode = createNode(node.templateId);
      newNode.count = splitCount;
      newNode.region = targetRegion;
      var region = World.regions.get(targetRegion);
      newNode.center.x = region.center.x;
      newNode.center.y = region.center.y;
      computeSpread(newNode);

      // Copy vitals with slight variation
      if (node.traits.vitals) {
        newNode.traits.vitals.hunger = node.traits.vitals.hunger + (Math.random() - 0.5) * 5;
        newNode.traits.vitals.energy = node.traits.vitals.energy + (Math.random() - 0.5) * 5;
        newNode.traits.vitals.hunger = Math.max(0, Math.min(100, newNode.traits.vitals.hunger));
        newNode.traits.vitals.energy = Math.max(0, Math.min(100, newNode.traits.vitals.energy));
      }

      // Register in world
      World.nodes.set(newNode.id, newNode);
      if (!World.byRegion.has(targetRegion)) World.byRegion.set(targetRegion, new Set());
      World.byRegion.get(targetRegion).add(newNode.id);
    }
  },
};
