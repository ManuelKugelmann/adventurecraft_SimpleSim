// world.js — Tile grid + Region graph + Group containment
// All entities are nodes. Two hierarchies:
//   parent:    grouping (multiscale sim) — tiles parented to regions, groups parented to regions
//   contains/containedBy: structural (transport) — animals containing carried items

var World = {
  width: 0,
  height: 0,
  tiles: null,           // flat array of tile nodes (80x80)
  regionOfTile: null,    // flat array: tileIndex → regionId (node ID)
  regions: null,         // Map<regionId, regionNode>
  nodes: null,           // Map<nodeId, Node> (all nodes: tiles, regions, groups)
  byRegion: null,        // Map<regionId, Set<nodeId>> (groups index)
  tick: 0,

  init: function(w, h) {
    this.width = w;
    this.height = h;
    this.tiles = new Array(w * h);
    this.regionOfTile = new Array(w * h);
    this.regions = new Map();
    this.nodes = new Map();
    this.byRegion = new Map();
    this.tick = 0;
    nextNodeId = 1;

    // Initialize all tiles as grass nodes
    for (var i = 0; i < w * h; i++) {
      var tile = createNode('tile_grass');
      tile.type = 'grass';
      tile.center.x = i % w;
      tile.center.y = Math.floor(i / w);
      tile.fertility = 0.5 + Math.random() * 0.5;
      this.tiles[i] = tile;
      this.nodes.set(tile.id, tile);
      this.regionOfTile[i] = -1;
    }

    this.generateTerrain();
    this.generateRegions();
    this.buildAdjacency();
  },

  tileIndex: function(x, y) { return y * this.width + x; },

  tileAt: function(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y * this.width + x];
  },

  isWalkable: function(x, y) {
    var tile = this.tileAt(x, y);
    return tile && tile.type !== 'water' && tile.type !== 'rock';
  },

  // --- Region queries ---

  groupsInRegion: function(regionId) {
    var ids = this.byRegion.get(regionId);
    if (!ids) return [];
    var result = [];
    ids.forEach(function(id) {
      var n = World.nodes.get(id);
      if (n && n.alive) result.push(n);
    });
    return result;
  },

  neighborsOf: function(regionId) {
    var r = this.regions.get(regionId);
    return r ? r.neighbors : [];
  },

  // All groups in this region + all neighbor regions
  groupsNearRegion: function(regionId) {
    var result = this.groupsInRegion(regionId);
    var neighbors = this.neighborsOf(regionId);
    for (var i = 0; i < neighbors.length; i++) {
      var nearby = this.groupsInRegion(neighbors[i]);
      for (var j = 0; j < nearby.length; j++) {
        result.push(nearby[j]);
      }
    }
    return result;
  },

  // Walkable neighbor regions
  walkableNeighbors: function(regionId) {
    var neighbors = this.neighborsOf(regionId);
    var result = [];
    for (var i = 0; i < neighbors.length; i++) {
      var r = this.regions.get(neighbors[i]);
      if (r && r.type !== 'water' && r.type !== 'rock') {
        result.push(neighbors[i]);
      }
    }
    return result;
  },

  // --- Group operations ---

  spawnGroup: function(templateId, regionId) {
    var node = createNode(templateId);
    var region = this.regions.get(regionId);
    node.container = regionId;
    node.parent = regionId;
    node.center.x = region.center.x;
    node.center.y = region.center.y;
    computeSpread(node);
    this.nodes.set(node.id, node);
    if (!this.byRegion.has(regionId)) this.byRegion.set(regionId, new Set());
    this.byRegion.get(regionId).add(node.id);
    return node;
  },

  moveGroup: function(node, newRegionId) {
    // Remove from old region
    if (node.container !== null) {
      var oldSet = this.byRegion.get(node.container);
      if (oldSet) oldSet.delete(node.id);
    }
    // Add to new region
    node.container = newRegionId;
    node.parent = newRegionId;
    var region = this.regions.get(newRegionId);
    node.center.x = region.center.x;
    node.center.y = region.center.y;
    if (!this.byRegion.has(newRegionId)) this.byRegion.set(newRegionId, new Set());
    this.byRegion.get(newRegionId).add(node.id);
    // Contained items follow carrier's region
    for (var i = 0; i < node.contains.length; i++) {
      var item = this.nodes.get(node.contains[i]);
      if (item) item.container = newRegionId;
    }
  },

  removeGroup: function(node) {
    node.alive = false;
    if (node.container !== null) {
      var set = this.byRegion.get(node.container);
      if (set) set.delete(node.id);
    }
    this.nodes.delete(node.id);
  },

  removeDeadNodes: function() {
    var toRemove = [];
    this.nodes.forEach(function(node) {
      if (!node.alive || node.count <= 0) {
        var tmpl = TEMPLATES[node.templateId];
        // Don't remove structural nodes (terrain, regions)
        if (tmpl.category === 'terrain' || tmpl.category === 'region') return;
        toRemove.push(node);
      }
    });
    for (var i = 0; i < toRemove.length; i++) {
      this.removeGroup(toRemove[i]);
    }
  },

  // --- Terrain generation ---

  generateTerrain: function() {
    var self = this;

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
        tile.templateId = 'tile_' + type;
        tile.fertility = type === 'water' ? 0 : (type === 'rock' ? 0.1 : tile.fertility);
        placed++;
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

    // Water blobs
    for (var w = 0; w < CONFIG.WATER_BLOBS; w++) {
      floodBlob(5 + Math.floor(Math.random() * (this.width - 10)),
                5 + Math.floor(Math.random() * (this.height - 10)),
                'water', CONFIG.WATER_BLOB_SIZE);
    }
    // Rock clusters
    for (var r = 0; r < CONFIG.ROCK_CLUSTERS; r++) {
      floodBlob(5 + Math.floor(Math.random() * (this.width - 10)),
                5 + Math.floor(Math.random() * (this.height - 10)),
                'rock', CONFIG.ROCK_CLUSTER_SIZE);
    }
    // Ring water with dirt
    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        if (this.tiles[y * this.width + x].type !== 'water') continue;
        var dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (var d = 0; d < dirs.length; d++) {
          var t = this.tileAt(x + dirs[d][0], y + dirs[d][1]);
          if (t && t.type === 'grass') {
            t.type = 'dirt';
            t.templateId = 'tile_dirt';
            t.fertility = 0.3 + Math.random() * 0.2;
          }
        }
      }
    }
  },

  // --- Region generation: partition tiles into contiguous blobs ---

  generateRegions: function() {
    var self = this;
    var assigned = new Uint8Array(this.width * this.height); // 0 = unassigned

    // Flood-fill from an unassigned tile of given type to form a region
    function floodRegion(startIdx) {
      var startTile = self.tiles[startIdx];
      var type = startTile.type;
      var regionNode = createNode('region');
      var regionId = regionNode.id;
      regionNode.type = type;
      var tileIndices = [];
      var queue = [startIdx];
      assigned[startIdx] = 1;

      while (queue.length > 0) {
        var idx = queue.shift();
        tileIndices.push(idx);
        var tx = idx % self.width;
        var ty = Math.floor(idx / self.width);
        var dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = tx + dirs[d][0], ny = ty + dirs[d][1];
          if (nx < 0 || nx >= self.width || ny < 0 || ny >= self.height) continue;
          var ni = ny * self.width + nx;
          if (assigned[ni]) continue;
          if (self.tiles[ni].type === type) {
            assigned[ni] = 1;
            queue.push(ni);
          }
        }
      }

      // Split if too large
      if (tileIndices.length > CONFIG.REGION_MAX_SIZE) {
        var keep = tileIndices.slice(0, CONFIG.REGION_MAX_SIZE);
        for (var i = CONFIG.REGION_MAX_SIZE; i < tileIndices.length; i++) {
          assigned[tileIndices[i]] = 0;
        }
        tileIndices = keep;
      }

      // Compute center
      var cx = 0, cy = 0;
      var totalFertility = 0;
      for (var i = 0; i < tileIndices.length; i++) {
        var ti = tileIndices[i];
        cx += ti % self.width;
        cy += Math.floor(ti / self.width);
        totalFertility += self.tiles[ti].fertility;
      }
      cx = Math.round(cx / tileIndices.length);
      cy = Math.round(cy / tileIndices.length);

      // Set region node properties
      regionNode.count = tileIndices.length;
      regionNode.center.x = cx;
      regionNode.center.y = cy;
      regionNode.tiles = tileIndices;
      regionNode.tileCount = tileIndices.length;
      regionNode.neighbors = [];
      regionNode.fertility = totalFertility / tileIndices.length;
      computeSpread(regionNode);

      // Grouping hierarchy: tiles parented to region
      for (var i = 0; i < tileIndices.length; i++) {
        var tileNode = self.tiles[tileIndices[i]];
        tileNode.parent = regionId;
        tileNode.container = regionId;
      }

      self.regions.set(regionId, regionNode);
      self.nodes.set(regionId, regionNode);
      self.byRegion.set(regionId, new Set());

      // Tag tiles with region index
      for (var i = 0; i < tileIndices.length; i++) {
        self.regionOfTile[tileIndices[i]] = regionId;
      }
    }

    // Scan all tiles, flood-fill regions
    for (var i = 0; i < this.width * this.height; i++) {
      if (!assigned[i]) {
        floodRegion(i);
      }
    }
  },

  // Build adjacency graph between regions
  buildAdjacency: function() {
    var self = this;
    var edgeSet = new Set(); // "a,b" strings to avoid duplicates

    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var idx = y * this.width + x;
        var rId = this.regionOfTile[idx];
        if (rId < 0) continue;

        // Check right and down neighbors
        var dirs = [[1, 0], [0, 1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = x + dirs[d][0], ny = y + dirs[d][1];
          if (nx >= this.width || ny >= this.height) continue;
          var ni = ny * this.width + nx;
          var nrId = this.regionOfTile[ni];
          if (nrId >= 0 && nrId !== rId) {
            var lo = Math.min(rId, nrId), hi = Math.max(rId, nrId);
            var key = lo + ',' + hi;
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              var rA = this.regions.get(lo);
              var rB = this.regions.get(hi);
              if (rA && rB) {
                if (rA.neighbors.indexOf(hi) < 0) rA.neighbors.push(hi);
                if (rB.neighbors.indexOf(lo) < 0) rB.neighbors.push(lo);
              }
            }
          }
        }
      }
    }
  },

  // --- Populate: spawn initial groups into walkable regions ---

  populate: function() {
    var walkableRegions = [];
    var self = this;
    this.regions.forEach(function(region) {
      if (region.type !== 'water' && region.type !== 'rock') {
        walkableRegions.push(region.id);
      }
    });

    if (walkableRegions.length === 0) return;

    // Plants: one grass group per walkable region, bush in ~half, tree in ~quarter
    for (var i = 0; i < walkableRegions.length; i++) {
      var rId = walkableRegions[i];
      this.spawnGroup('grass', rId);
      if (Math.random() < 0.5) this.spawnGroup('bush', rId);
      if (Math.random() < 0.25) this.spawnGroup('tree', rId);
    }

    // Animals: spread across random walkable regions
    function spawnGroups(templateId, count) {
      for (var j = 0; j < count; j++) {
        var rId = walkableRegions[Math.floor(Math.random() * walkableRegions.length)];
        var node = self.spawnGroup(templateId, rId);
        // Randomize starting state
        if (node.traits.vitals) {
          node.traits.vitals.hunger = 10 + Math.random() * 25;
          node.traits.vitals.energy = 60 + Math.random() * 30;
        }
      }
    }

    // Stones: spread across random walkable regions
    spawnGroups('stone', CONFIG.INITIAL_STONE);

    spawnGroups('rabbit', CONFIG.INITIAL_RABBIT);
    spawnGroups('deer', CONFIG.INITIAL_DEER);
    spawnGroups('pig', CONFIG.INITIAL_PIG);
    spawnGroups('bear', CONFIG.INITIAL_BEAR);
    spawnGroups('fox', CONFIG.INITIAL_FOX);
    spawnGroups('wolf', CONFIG.INITIAL_WOLF);
  },
};
