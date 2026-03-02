// groups.js — Spatial grouping with count-based effects
// Groups are formed by spatial proximity of same-species entities
// Each group gets a unique color tint for visual identification
// Hierarchy: parent node links members to a group leader

var Groups = {
  groups: [],        // array of { id, templateId, members: [nodeId], color }
  nextGroupId: 1,

  // Palette of group marker colors (applied as background tint)
  GROUP_COLORS: [
    '#3a2040', '#203a40', '#40203a', '#2a4020', '#40302a',
    '#2a2a40', '#402a2a', '#204030', '#302040', '#403020',
    '#2a3a2a', '#3a2a3a', '#2a403a', '#3a402a', '#402a3a',
    '#20302a', '#302a20', '#2a2030', '#30202a', '#203020',
  ],

  update: function() {
    this.groups = [];
    this.nextGroupId = 1;

    // Spatial hash: bucket animal nodes into cells
    var cellSize = CONFIG.GROUP_CELL_SIZE;
    var buckets = {};  // "cx,cy" → { templateId → [node] }

    World.nodes.forEach(function(node) {
      if (!node.alive || !node.traits.agency) return;
      var cx = Math.floor(node.x / cellSize);
      var cy = Math.floor(node.y / cellSize);
      var key = cx + ',' + cy;
      if (!buckets[key]) buckets[key] = {};
      var tmplId = node.templateId;
      if (!buckets[key][tmplId]) buckets[key][tmplId] = [];
      buckets[key][tmplId].push(node);
      // Clear previous group assignment
      node.parent = null;
    });

    // For each bucket, form groups of same-species entities
    var self = this;
    var bucketKeys = Object.keys(buckets);
    for (var b = 0; b < bucketKeys.length; b++) {
      var bk = bucketKeys[b];
      var species = buckets[bk];
      var speciesKeys = Object.keys(species);
      for (var s = 0; s < speciesKeys.length; s++) {
        var tmplId = speciesKeys[s];
        var members = species[tmplId];
        if (members.length < 2) continue;

        // Also check adjacent cells for same species to merge
        var parts = bk.split(',');
        var cx = parseInt(parts[0]), cy = parseInt(parts[1]);
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            var adjKey = (cx + dx) + ',' + (cy + dy);
            if (buckets[adjKey] && buckets[adjKey][tmplId]) {
              var adjMembers = buckets[adjKey][tmplId];
              for (var a = 0; a < adjMembers.length; a++) {
                if (members.indexOf(adjMembers[a]) < 0) {
                  members.push(adjMembers[a]);
                }
              }
            }
          }
        }

        if (members.length < 2) continue;

        var groupId = self.nextGroupId++;
        var colorIdx = groupId % self.GROUP_COLORS.length;
        var group = {
          id: groupId,
          templateId: tmplId,
          members: [],
          color: self.GROUP_COLORS[colorIdx],
          count: members.length,
        };

        // Pick leader (highest hp)
        var leader = members[0];
        for (var m = 1; m < members.length; m++) {
          if (members[m].traits.vitals.hp > leader.traits.vitals.hp) {
            leader = members[m];
          }
        }

        // Set hierarchy: all members point to leader via parent
        for (var m = 0; m < members.length; m++) {
          members[m].parent = leader.id;
          group.members.push(members[m].id);
        }
        leader.parent = null; // leader has no parent

        self.groups.push(group);
      }
    }

    // Apply count-based behavioral effects
    this.applyGroupEffects();
  },

  applyGroupEffects: function() {
    for (var g = 0; g < this.groups.length; g++) {
      var group = this.groups[g];
      var count = group.count;
      var tmpl = TEMPLATES[group.templateId];

      for (var m = 0; m < group.members.length; m++) {
        var node = World.nodes.get(group.members[m]);
        if (!node || !node.alive) continue;

        // Herd safety: herbivores in groups of 3+ are calmer
        if (tmpl.category === 'herbivore' && count >= CONFIG.HERD_THRESHOLD) {
          // Slight hunger reduction (less stress eating)
          node.traits.vitals.hunger = Math.max(0, node.traits.vitals.hunger - 0.1);
        }

        // Pack hunting: carnivores in groups of 2+ are more effective
        // (handled in combat — check group count when attacking)

        // Dispersion: large groups get slight outward wander bias
        // (this prevents all entities clumping into one tile)
      }
    }
  },

  // Get the group a node belongs to
  getGroupOf: function(node) {
    for (var g = 0; g < this.groups.length; g++) {
      if (this.groups[g].members.indexOf(node.id) >= 0) {
        return this.groups[g];
      }
    }
    return null;
  },

  // Get count of same-species nearby (for quick checks)
  getGroupCount: function(node) {
    var group = this.getGroupOf(node);
    return group ? group.count : 1;
  },
};
