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

          // Agents/plants: merge if all vital differences within threshold and result fits maxSize
          var va = a.traits.vitals, vb = b.traits.vitals;
          var thr = gt.mergeThreshold;
          var vitalsClose = Math.abs(va.hunger - vb.hunger) < thr &&
              Math.abs(va.energy - vb.energy) < thr &&
              (va.health === undefined || vb.health === undefined || Math.abs(va.health - vb.health) < thr) &&
              (va.thirst === undefined || vb.thirst === undefined || Math.abs(va.thirst - vb.thirst) < thr);
          if (vitalsClose && a.count + b.count <= gt.maxSize) {
            var totalCount = a.count + b.count;
            va.hunger = (va.hunger * a.count + vb.hunger * b.count) / totalCount;
            va.energy = (va.energy * a.count + vb.energy * b.count) / totalCount;
            if (va.health !== undefined && vb.health !== undefined) {
              va.health = (va.health * a.count + vb.health * b.count) / totalCount;
            }
            if (va.thirst !== undefined && vb.thirst !== undefined) {
              va.thirst = (va.thirst * a.count + vb.thirst * b.count) / totalCount;
            }
            a.count = totalCount;
            // Transfer contained items from b to a
            for (var ci = 0; ci < b.contains.length; ci++) {
              var item = World.nodes.get(b.contains[ci]);
              if (item && item.alive) {
                item.containedBy = a.id;
                a.contains.push(item.id);
              }
            }
            b.contains = [];
            computeSpread(a);
            World.removeGroup(b);
          }
        }
      }
    }
  },

  // Split: nodes exceeding their group.maxSize → half moves to adjacent container
  // Prefers food-rich neighbors over random placement
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
      var targetGroup = node.container; // fallback: stay in same container
      if (neighbors.length > 0) {
        targetGroup = this.bestSplitNeighbor(node, neighbors);
      }

      var splitCount = Math.floor(node.count / 2);
      node.count -= splitCount;
      computeSpread(node);

      var newNode = createNode(node.templateId);
      newNode.count = splitCount;
      newNode.container = targetGroup;
      newNode.parent = targetGroup;
      var group = World.groups.get(targetGroup);
      if (!group) { node.count += splitCount; continue; }  // target gone, undo split
      newNode.center.x = group.center.x;
      newNode.center.y = group.center.y;
      computeSpread(newNode);

      // Preserve vitals from parent with slight variation
      if (node.traits.vitals) {
        var nv = node.traits.vitals;
        newNode.traits.vitals.hunger = clampVital(nv.hunger + (Rng.random() - 0.5) * 5);
        newNode.traits.vitals.energy = clampVital(nv.energy + (Rng.random() - 0.5) * 5);
        if (nv.health !== undefined) newNode.traits.vitals.health = clampVital(nv.health + (Rng.random() - 0.5) * 3);
        if (nv.thirst !== undefined) newNode.traits.vitals.thirst = clampVital(nv.thirst + (Rng.random() - 0.5) * 3);
      }

      // Preserve agency role from parent
      if (node.traits.agency && newNode.traits.agency) {
        newNode.traits.agency.activeRole = node.traits.agency.activeRole;
      }

      World.nodes.set(newNode.id, newNode);
      if (!World.byGroup.has(targetGroup)) World.byGroup.set(targetGroup, new Set());
      World.byGroup.get(targetGroup).add(newNode.id);
    }
  },

  // Score neighbors for split: prefer food-rich, low-threat, low-competition
  bestSplitNeighbor: function(node, neighbors) {
    var diet = node.traits.diet;
    var best = neighbors[0];
    var bestScore = -Infinity;

    for (var i = 0; i < neighbors.length; i++) {
      var nId = neighbors[i];
      var entities = World.groupsInContainer(nId);
      var food = 0;
      var competitors = 0;

      for (var j = 0; j < entities.length; j++) {
        var other = entities[j];
        if (!other.alive || other.count <= 0) continue;
        var cat = TEMPLATES[other.templateId].category;
        // Count food
        if (diet && diet.eats.indexOf(cat) >= 0) {
          food += other.count;
        }
        // Count same-species competitors
        if (other.templateId === node.templateId) {
          competitors += other.count;
        }
      }

      var score = food - competitors * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = nId;
      }
    }
    return best;
  },
};

function clampVital(v) { return Math.max(0, Math.min(100, v)); }
