// world.js — Grid, tiles, terrain generation, containment tree, spatial queries

var World = {
  width: 0,
  height: 0,
  tiles: null,        // flat array of tile objects
  nodes: null,        // Map<id, node>
  byContainer: null,  // Map<tileIndex, Set<nodeId>> — reverse containment index
  tick: 0,

  init: function(w, h) {
    this.width = w;
    this.height = h;
    this.tiles = new Array(w * h);
    this.nodes = new Map();
    this.byContainer = new Map();
    this.tick = 0;
    nextNodeId = 1;

    // Initialize all tiles as grass
    for (var i = 0; i < w * h; i++) {
      this.tiles[i] = {
        type: 'grass',
        x: i % w,
        y: Math.floor(i / w),
        fertility: 0.5 + Math.random() * 0.5,
      };
      this.byContainer.set(i, new Set());
    }

    this.generateTerrain();
  },

  tileIndex: function(x, y) {
    return y * this.width + x;
  },

  tileAt: function(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y * this.width + x];
  },

  // Get all node IDs at a tile position
  nodeIdsAt: function(x, y) {
    var idx = this.tileIndex(x, y);
    return this.byContainer.get(idx) || new Set();
  },

  // Get all live nodes at a tile position
  nodesAt: function(x, y) {
    var ids = this.nodeIdsAt(x, y);
    var result = [];
    ids.forEach(function(id) {
      var n = World.nodes.get(id);
      if (n && n.alive) result.push(n);
    });
    return result;
  },

  // Spatial query: all live nodes within Chebyshev radius r of (cx, cy)
  nodesInRadius: function(cx, cy, r) {
    var result = [];
    var x0 = Math.max(0, cx - r);
    var x1 = Math.min(this.width - 1, cx + r);
    var y0 = Math.max(0, cy - r);
    var y1 = Math.min(this.height - 1, cy + r);
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var ids = this.byContainer.get(this.tileIndex(x, y));
        if (ids) {
          var self = this;
          ids.forEach(function(id) {
            var n = self.nodes.get(id);
            if (n && n.alive) result.push(n);
          });
        }
      }
    }
    return result;
  },

  // Spawn a node from template at position (x, y)
  spawnNode: function(templateId, x, y) {
    var node = createNode(templateId);
    node.x = x;
    node.y = y;
    var idx = this.tileIndex(x, y);
    node.container = idx;
    this.nodes.set(node.id, node);
    this.byContainer.get(idx).add(node.id);
    return node;
  },

  // Move a node to a new tile
  moveNode: function(node, nx, ny) {
    // Remove from old container
    if (node.container !== null) {
      var oldSet = this.byContainer.get(node.container);
      if (oldSet) oldSet.delete(node.id);
    }
    // Set new position
    node.x = nx;
    node.y = ny;
    var idx = this.tileIndex(nx, ny);
    node.container = idx;
    this.byContainer.get(idx).add(node.id);
  },

  // Kill and remove a node
  removeNode: function(node) {
    node.alive = false;
    if (node.container !== null) {
      var set = this.byContainer.get(node.container);
      if (set) set.delete(node.id);
    }
    this.nodes.delete(node.id);
  },

  // Remove all dead nodes
  removeDeadNodes: function() {
    var toRemove = [];
    this.nodes.forEach(function(node) {
      if (!node.alive) toRemove.push(node);
    });
    for (var i = 0; i < toRemove.length; i++) {
      this.removeNode(toRemove[i]);
    }
  },

  // Check if tile is walkable (not water or rock)
  isWalkable: function(x, y) {
    var tile = this.tileAt(x, y);
    if (!tile) return false;
    return tile.type !== 'water' && tile.type !== 'rock';
  },

  // Count nodes of a given template on a tile
  countOnTile: function(x, y, category) {
    var nodes = this.nodesAt(x, y);
    var count = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (TEMPLATES[nodes[i].templateId].category === category) count++;
    }
    return count;
  },

  // Terrain generation: water blobs, rock clusters, dirt borders
  generateTerrain: function() {
    var self = this;

    // Helper: random flood-fill blob
    function floodBlob(sx, sy, type, maxSize) {
      var queue = [[sx, sy]];
      var visited = new Set();
      var placed = 0;
      visited.add(sx + ',' + sy);

      while (queue.length > 0 && placed < maxSize) {
        var ri = Math.floor(Math.random() * queue.length);
        var pos = queue.splice(ri, 1)[0];
        var px = pos[0], py = pos[1];
        var tile = self.tileAt(px, py);
        if (!tile) continue;

        tile.type = type;
        tile.fertility = type === 'water' ? 0 : (type === 'rock' ? 0.1 : tile.fertility);
        placed++;

        // Add neighbors
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = px + dirs[d][0], ny = py + dirs[d][1];
          var key = nx + ',' + ny;
          if (nx >= 1 && nx < self.width - 1 && ny >= 1 && ny < self.height - 1 && !visited.has(key)) {
            visited.add(key);
            if (Math.random() < 0.7) queue.push([nx, ny]);
          }
        }
      }
    }

    // Place water blobs
    for (var w = 0; w < CONFIG.WATER_BLOBS; w++) {
      var wx = 5 + Math.floor(Math.random() * (this.width - 10));
      var wy = 5 + Math.floor(Math.random() * (this.height - 10));
      floodBlob(wx, wy, 'water', CONFIG.WATER_BLOB_SIZE);
    }

    // Place rock clusters
    for (var r = 0; r < CONFIG.ROCK_CLUSTERS; r++) {
      var rx = 5 + Math.floor(Math.random() * (this.width - 10));
      var ry = 5 + Math.floor(Math.random() * (this.height - 10));
      floodBlob(rx, ry, 'rock', CONFIG.ROCK_CLUSTER_SIZE);
    }

    // Ring water with dirt
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        if (this.tiles[y * this.width + x].type !== 'water') continue;
        var dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = x + dirs[d][0], ny = y + dirs[d][1];
          var t = this.tileAt(nx, ny);
          if (t && t.type === 'grass') {
            t.type = 'dirt';
            t.fertility = 0.3 + Math.random() * 0.2;
          }
        }
      }
    }
  },

  // Populate world with initial entities
  populate: function() {
    var self = this;

    function spawnRandom(templateId, count) {
      var placed = 0;
      var attempts = 0;
      while (placed < count && attempts < count * 10) {
        attempts++;
        var x = Math.floor(Math.random() * self.width);
        var y = Math.floor(Math.random() * self.height);
        if (!self.isWalkable(x, y)) continue;
        // Plants: max 1 per tile
        var tmpl = TEMPLATES[templateId];
        if (tmpl.category === 'plant') {
          if (self.countOnTile(x, y, 'plant') >= CONFIG.MAX_PLANTS_PER_TILE) continue;
        }
        var node = self.spawnNode(templateId, x, y);
        // Mature plants start at stage 2
        if (node.traits.growth) {
          node.traits.growth.stage = 2;
        }
        // Randomize starting hunger/energy
        if (node.traits.vitals && node.traits.vitals.hunger !== undefined) {
          node.traits.vitals.hunger = 10 + Math.random() * 30;
          node.traits.vitals.energy = 60 + Math.random() * 30;
        }
        placed++;
      }
    }

    spawnRandom('grass', CONFIG.INITIAL_GRASS);
    spawnRandom('bush', CONFIG.INITIAL_BUSH);
    spawnRandom('tree', CONFIG.INITIAL_TREE);
    spawnRandom('rabbit', CONFIG.INITIAL_RABBIT);
    spawnRandom('deer', CONFIG.INITIAL_DEER);
    spawnRandom('pig', CONFIG.INITIAL_PIG);
    spawnRandom('bear', CONFIG.INITIAL_BEAR);
    spawnRandom('fox', CONFIG.INITIAL_FOX);
    spawnRandom('wolf', CONFIG.INITIAL_WOLF);
  },
};
