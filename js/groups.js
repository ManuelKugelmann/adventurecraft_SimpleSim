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

          // Agents/plants: merge if vital differences within threshold and result fits maxSize
          var va = a.traits.vitals, vb = b.traits.vitals;
          var thr = gt.mergeThreshold;
          var vitalsClose = Math.abs(va.hunger - vb.hunger) < thr &&
              Math.abs(va.energy - vb.energy) < thr &&
              (va.health === undefined || vb.health === undefined || Math.abs(va.health - vb.health) < thr) &&
              (va.thirst === undefined || vb.thirst === undefined || Math.abs(va.thirst - vb.thirst) < thr);
          if (vitalsClose && a.count + b.count <= gt.maxSize) {
            var totalCount = a.count + b.count;
            // Update diversity: pooled variance = (n1*(σ1²+d1²) + n2*(σ2²+d2²)) / (n1+n2)
            var da = (a.traits.group && a.traits.group.diversity) ? a.traits.group.diversity : null;
            var db = (b.traits.group && b.traits.group.diversity) ? b.traits.group.diversity : null;
            if (da) {
              var vitalKeys = ['hunger', 'energy', 'health', 'thirst'];
              for (var vi = 0; vi < vitalKeys.length; vi++) {
                var vk = vitalKeys[vi];
                if (va[vk] === undefined || vb[vk] === undefined) continue;
                var newMean = (va[vk] * a.count + vb[vk] * b.count) / totalCount;
                var varA = (da[vk] || 0) * (da[vk] || 0);
                var varB = db ? (db[vk] || 0) * (db[vk] || 0) : 0;
                var dA = va[vk] - newMean;
                var dB = vb[vk] - newMean;
                var pooled = (a.count * (varA + dA * dA) + b.count * (varB + dB * dB)) / totalCount;
                da[vk] = Math.sqrt(pooled);
              }
            }
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
            a.seed = Rng.random(); // new seed captures merged distribution
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
      if (!group) continue;
      newNode.center.x = group.center.x;
      newNode.center.y = group.center.y;
      computeSpread(newNode);

      // Preserve vitals from parent with diversity-scaled variation
      if (node.traits.vitals) {
        var nv = node.traits.vitals;
        var dv = (node.traits.group && node.traits.group.diversity) ? node.traits.group.diversity : null;
        var vitalKeys = ['hunger', 'energy', 'health', 'thirst'];
        for (var vi = 0; vi < vitalKeys.length; vi++) {
          var vk = vitalKeys[vi];
          if (nv[vk] === undefined) continue;
          var sigma = dv ? (dv[vk] || 0) : 2.5;
          newNode.traits.vitals[vk] = clampVital(nv[vk] + (Rng.random() - 0.5) * 2 * sigma);
        }
        // Inherit diversity with fresh seed; variance stays (split doesn't reduce spread)
        if (dv && newNode.traits.group) {
          newNode.traits.group.diversity = {
            hunger: dv.hunger || 0, energy: dv.energy || 0,
            health: dv.health || 0, thirst: dv.thirst || 0,
            seed: Math.floor(Rng.random() * 2147483647),
          };
        }
      }

      // Preserve agency role from parent
      if (node.traits.agency && newNode.traits.agency) {
        newNode.traits.agency.activeRole = node.traits.agency.activeRole;
      }

      newNode.splitParent = node.id;
      newNode.seed = Rng.random();
      node.seed = Rng.random(); // parent distribution changed too

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
