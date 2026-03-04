// world.js — Tile grid + Recursive hierarchy + Group containment
// All entities are nodes. Two hierarchies:
//   parent:              grouping (multiscale sim) — tiles→L1 group→L2 group→...
//   contains/containedBy: structural (transport)   — animals containing carried items
//
// Spatial hierarchy (recursive tile grouping):
//   Level 0 = individual tiles (80x80)
//   Level 1 = tile groups (16-25 tiles each, same terrain type, flood-fill)
//   Level 2 = groups of 3-5 L1 groups
//   Level 3 = groups of 3-5 L2 groups ... until map is covered
//
// Entity container can point to any level. Position is always tile-level center:{x,y}.

var World = {
  width: 0,
  height: 0,
  tiles: null,           // flat array of tile nodes (80x80)
  groupOfTile: null,     // flat array: tileIndex → level-1 groupId
  groups: null,          // Map<groupId, groupNode> (all hierarchy levels)
  nodes: null,           // Map<nodeId, Node> (all nodes: tiles, groups, entities)
  byGroup: null,         // Map<groupId, Set<nodeId>> (entity index, any level)
  levels: null,          // Array of arrays: levels[1] = [groupId,...], levels[2] = [...]
  maxLevel: 0,           // highest level in hierarchy
  tick: 0,

  init: function(w, h) {
    this.width = w;
    this.height = h;
    this.tiles = new Array(w * h);
    this.groupOfTile = new Array(w * h);
    this.groups = new Map();
    this.nodes = new Map();
    this.byGroup = new Map();
    this.levels = [null]; // level 0 = tiles (not stored here)
    this.maxLevel = 0;
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
      this.groupOfTile[i] = -1;
    }

    this.generateTerrain();
    this.generateLevel1();
    this.buildLevel1Adjacency();
    this.generateHigherLevels();
    this.computeAllLinks();
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

  // --- Hierarchy queries ---

  // Get the group node for a container ID (works at any level)
  groupFor: function(containerId) {
    return this.groups.get(containerId);
  },

  // Get the level-1 group containing a tile position
  groupAtTile: function(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    var idx = y * this.width + x;
    var gId = this.groupOfTile[idx];
    return gId >= 0 ? this.groups.get(gId) : null;
  },

  // Walk up the hierarchy from a group to find its ancestor at a given level
  ancestorAtLevel: function(groupId, targetLevel) {
    var g = this.groups.get(groupId);
    if (!g) return null;
    while (g && g.level < targetLevel) {
      g = this.groups.get(g.parentGroup);
    }
    return g;
  },

  // Get the level-1 group for any entity (regardless of its container level)
  level1GroupOf: function(node) {
    var idx = node.center.y * this.width + node.center.x;
    if (idx < 0 || idx >= this.groupOfTile.length) return null;
    var gId = this.groupOfTile[idx];
    return gId >= 0 ? this.groups.get(gId) : null;
  },

  // Check if a tile belongs to a container group (at any level)
  tileInGroup: function(tileIdx, groupId) {
    var tileL1 = this.groupOfTile[tileIdx];
    if (tileL1 < 0) return false;
    if (tileL1 === groupId) return true;
    // Walk up the hierarchy from the tile's L1 group
    var g = this.groups.get(tileL1);
    while (g && g.parentGroup !== null) {
      if (g.parentGroup === groupId) return true;
      g = this.groups.get(g.parentGroup);
    }
    return false;
  },

  // --- Container queries (work at any level) ---

  // Entities directly in this container
  groupsInContainer: function(containerId) {
    var ids = this.byGroup.get(containerId);
    if (!ids) return [];
    var result = [];
    ids.forEach(function(id) {
      var n = World.nodes.get(id);
      if (n && n.alive) result.push(n);
    });
    return result;
  },

  // Entities in this container AND all descendant containers
  groupsInContainerDeep: function(containerId) {
    var result = this.groupsInContainer(containerId);
    var group = this.groups.get(containerId);
    if (group && group.children) {
      for (var i = 0; i < group.children.length; i++) {
        var childResults = this.groupsInContainerDeep(group.children[i]);
        for (var j = 0; j < childResults.length; j++) {
          result.push(childResults[j]);
        }
      }
    }
    return result;
  },


  neighborsOf: function(containerId) {
    var g = this.groups.get(containerId);
    return g ? g.neighbors : [];
  },

  // All entities in this container + all neighbor containers (deep)
  groupsNearContainer: function(containerId) {
    var result = this.groupsInContainerDeep(containerId);
    var neighbors = this.neighborsOf(containerId);
    for (var i = 0; i < neighbors.length; i++) {
      var nearby = this.groupsInContainerDeep(neighbors[i]);
      for (var j = 0; j < nearby.length; j++) {
        result.push(nearby[j]);
      }
    }
    return result;
  },


  // Walkable neighbor groups at same level as given container
  walkableNeighbors: function(containerId) {
    var neighbors = this.neighborsOf(containerId);
    var result = [];
    for (var i = 0; i < neighbors.length; i++) {
      var g = this.groups.get(neighbors[i]);
      if (g && g.type !== 'water' && g.type !== 'rock') {
        result.push(neighbors[i]);
      }
    }
    return result;
  },

  // --- Link graph: connection graph per group ---

  // Compute links for all groups at all levels
  computeAllLinks: function() {
    var self = this;
    this.groups.forEach(function(group) {
      self.computeGroupLinks(group);
    });
  },

  // Compute links for a single group: for each neighbor, find border tiles,
  // compute centroid position, distance from center, and effort
  computeGroupLinks: function(group) {
    group.links = {};
    var self = this;

    for (var ni = 0; ni < group.neighbors.length; ni++) {
      var neighborId = group.neighbors[ni];
      var neighbor = this.groups.get(neighborId);
      if (!neighbor) continue;

      // Find border tile pairs between this group and neighbor
      var borderTiles = [];
      var myTiles = group.tiles;
      var nTiles = neighbor.tiles;

      // Build a set of neighbor's tiles for quick lookup
      var nTileSet = {};
      for (var t = 0; t < nTiles.length; t++) {
        nTileSet[nTiles[t]] = true;
      }

      // Find tiles in this group that are adjacent to tiles in neighbor
      var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (var t = 0; t < myTiles.length; t++) {
        var ti = myTiles[t];
        var tx = ti % self.width;
        var ty = Math.floor(ti / self.width);
        for (var d = 0; d < dirs.length; d++) {
          var nx = tx + dirs[d][0], ny = ty + dirs[d][1];
          if (nx < 0 || nx >= self.width || ny < 0 || ny >= self.height) continue;
          var nIdx = ny * self.width + nx;
          if (nTileSet[nIdx]) {
            borderTiles.push(ti);
            break; // only add this tile once
          }
        }
      }

      if (borderTiles.length === 0) {
        // Higher-level groups: use centroid between group centers
        var lx = Math.round((group.center.x + neighbor.center.x) / 2);
        var ly = Math.round((group.center.y + neighbor.center.y) / 2);
        var dist = Math.abs(group.center.x - lx) + Math.abs(group.center.y - ly);
        group.links[neighborId] = {
          pos: { x: lx, y: ly },
          dist: Math.max(1, dist),
          effort: Math.max(1, dist)
        };
        continue;
      }

      // Centroid of border tiles
      var cx = 0, cy = 0;
      for (var b = 0; b < borderTiles.length; b++) {
        cx += borderTiles[b] % self.width;
        cy += Math.floor(borderTiles[b] / self.width);
      }
      cx = Math.round(cx / borderTiles.length);
      cy = Math.round(cy / borderTiles.length);

      // Distance from group center to link position
      var dist = Math.abs(group.center.x - cx) + Math.abs(group.center.y - cy);

      // Effort: base distance, increased for difficult terrain
      var effort = Math.max(1, dist);
      if (group.type === 'dirt') effort = Math.ceil(effort * 1.2);

      group.links[neighborId] = {
        pos: { x: cx, y: cy },
        dist: Math.max(1, dist),
        effort: effort
      };
    }
  },

  // Distance between two points on a group's graph (link or center)
  // fromId/toId: 'center' or neighborId
  groupDist: function(group, fromId, toId) {
    if (fromId === toId) return 0;
    if (fromId === 'center' && group.links[toId]) return group.links[toId].dist;
    if (toId === 'center' && group.links[fromId]) return group.links[fromId].dist;
    // Link-to-link: sum of distances through center
    var dFrom = group.links[fromId] ? group.links[fromId].dist : 1;
    var dTo = group.links[toId] ? group.links[toId].dist : 1;
    return dFrom + dTo;
  },

  // --- Gradual movement system ---

  // Initiate gradual movement toward a neighbor group
  startMove: function(node, neighborId) {
    var group = this.groups.get(node.container);
    if (!group || !group.links[neighborId]) return false;
    node.position.target = neighborId;
    // If at center, move toward the link; if at a link, move toward center first
    if (node.position.at !== 'center') {
      // At some link; need to go through center first
      node.position.target = 'center';
      node._pendingMove = neighborId; // remember final destination
    }
    node.position.progress = 0;
    return true;
  },

  // Per-tick: advance all moving entities along graph edges
  advancePositions: function() {
    var self = this;
    this.nodes.forEach(function(node) {
      if (!node.alive || node.position.target === null) return;
      var tmpl = TEMPLATES[node.templateId];
      if (tmpl.category === 'terrain' || tmpl.category === 'tilegroup') return;
      if (node.containedBy) return; // carried items don't move independently

      var group = self.groups.get(node.container);
      if (!group) { node.position.target = null; return; }

      var speed = (node.traits.spatial ? node.traits.spatial.speed : 1);
      var dist = self.groupDist(group, node.position.at, node.position.target);
      var step = speed / Math.max(1, dist);
      node.position.progress += step;

      if (node.position.progress >= 1.0) {
        // Arrived at target
        node.position.at = node.position.target;
        node.position.target = null;
        node.position.progress = 0;

        if (node.position.at === 'center') {
          // Arrived at center — drop carried items, check pending move
          if (node.contains && node.contains.length > 0) {
            dropContained(node);
          }
          if (node._pendingMove) {
            var pendingNeighbor = node._pendingMove;
            delete node._pendingMove;
            node.position.target = pendingNeighbor;
            node.position.progress = 0;
          }
        } else {
          // Arrived at a link to a neighbor — cross into that neighbor
          var neighborId = node.position.at;
          var myGroupId = node.container;
          self.transferToGroup(node, neighborId);
          // In the new group, position starts at the link back to old group, heading to center
          node.position.at = myGroupId;
          node.position.target = 'center';
          node.position.progress = 0;
        }

        self.updateNodeCenter(node);
      } else {
        self.updateNodeCenter(node);
      }
    });
  },

  // Transfer entity to a new container (used by movement system)
  transferToGroup: function(node, newContainerId) {
    // Remove from old container
    if (node.container !== null) {
      var oldSet = this.byGroup.get(node.container);
      if (oldSet) oldSet.delete(node.id);
    }
    // Add to new container
    node.container = newContainerId;
    node.parent = newContainerId;
    if (!this.byGroup.has(newContainerId)) this.byGroup.set(newContainerId, new Set());
    this.byGroup.get(newContainerId).add(node.id);
    // Contained items follow carrier
    for (var i = 0; i < node.contains.length; i++) {
      var item = this.nodes.get(node.contains[i]);
      if (item) item.container = newContainerId;
    }
  },

  // Interpolate center {x,y} from graph position (at, target, progress)
  updateNodeCenter: function(node) {
    var group = this.groups.get(node.container);
    if (!group) return;

    var fromPos, toPos;

    // Resolve 'from' position
    if (node.position.at === 'center') {
      fromPos = group.center;
    } else if (group.links[node.position.at]) {
      fromPos = group.links[node.position.at].pos;
    } else {
      fromPos = group.center;
    }

    // If not moving, snap to 'from'
    if (node.position.target === null) {
      node.center.x = fromPos.x;
      node.center.y = fromPos.y;
      return;
    }

    // Resolve 'to' position
    if (node.position.target === 'center') {
      toPos = group.center;
    } else if (group.links[node.position.target]) {
      toPos = group.links[node.position.target].pos;
    } else {
      toPos = group.center;
    }

    // Interpolate
    var p = node.position.progress;
    node.center.x = Math.round(fromPos.x + (toPos.x - fromPos.x) * p);
    node.center.y = Math.round(fromPos.y + (toPos.y - fromPos.y) * p);
  },

  // Check if entity is currently in transit
  isMoving: function(node) {
    return node.position.target !== null;
  },

  // --- Group operations ---

  spawnGroup: function(templateId, containerId) {
    var node = createNode(templateId);
    var group = this.groups.get(containerId);
    node.container = containerId;
    node.parent = containerId;
    node.center.x = group.center.x;
    node.center.y = group.center.y;
    computeSpread(node);
    this.nodes.set(node.id, node);
    if (!this.byGroup.has(containerId)) this.byGroup.set(containerId, new Set());
    this.byGroup.get(containerId).add(node.id);
    return node;
  },

  moveGroup: function(node, newContainerId) {
    // Remove from old container
    if (node.container !== null) {
      var oldSet = this.byGroup.get(node.container);
      if (oldSet) oldSet.delete(node.id);
    }
    // Add to new container
    node.container = newContainerId;
    node.parent = newContainerId;
    var group = this.groups.get(newContainerId);
    node.center.x = group.center.x;
    node.center.y = group.center.y;
    // Reset position to center (teleport)
    node.position.at = 'center';
    node.position.target = null;
    node.position.progress = 0;
    delete node._pendingMove;
    if (!this.byGroup.has(newContainerId)) this.byGroup.set(newContainerId, new Set());
    this.byGroup.get(newContainerId).add(node.id);
    // Contained items follow carrier's container
    for (var i = 0; i < node.contains.length; i++) {
      var item = this.nodes.get(node.contains[i]);
      if (item) item.container = newContainerId;
    }
  },

  removeGroup: function(node) {
    node.alive = false;
    if (node.container !== null) {
      var set = this.byGroup.get(node.container);
      if (set) set.delete(node.id);
    }
    this.nodes.delete(node.id);
  },

  removeDeadNodes: function() {
    var toRemove = [];
    this.nodes.forEach(function(node) {
      if (!node.alive || node.count <= 0) {
        var tmpl = TEMPLATES[node.templateId];
        // Don't remove structural nodes (terrain, regions, tilegroups)
        if (tmpl.category === 'terrain' || tmpl.category === 'tilegroup') return;
        toRemove.push(node);
      }
    });
    for (var i = 0; i < toRemove.length; i++) {
      this.removeGroup(toRemove[i]);
    }
  },

  // --- Terrain generation (unchanged) ---

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

  // --- Level 1: partition tiles into contiguous same-type groups (16-25 tiles) ---

  generateLevel1: function() {
    var self = this;
    var assigned = new Uint8Array(this.width * this.height);
    var level1Ids = [];

    function floodGroup(startIdx) {
      var startTile = self.tiles[startIdx];
      var type = startTile.type;
      var groupNode = createNode('tilegroup');
      var groupId = groupNode.id;
      groupNode.type = type;
      groupNode.level = 1;
      groupNode.children = [];
      groupNode.parentGroup = null;
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

      // Split if too large: keep up to max, rest stays unassigned
      if (tileIndices.length > CONFIG.HIERARCHY_L1_MAX) {
        var keep = tileIndices.slice(0, CONFIG.HIERARCHY_L1_MAX);
        for (var i = CONFIG.HIERARCHY_L1_MAX; i < tileIndices.length; i++) {
          assigned[tileIndices[i]] = 0;
        }
        tileIndices = keep;
      }

      // Compute center and fertility
      var cx = 0, cy = 0, totalFertility = 0;
      for (var i = 0; i < tileIndices.length; i++) {
        var ti = tileIndices[i];
        cx += ti % self.width;
        cy += Math.floor(ti / self.width);
        totalFertility += self.tiles[ti].fertility;
      }
      cx = Math.round(cx / tileIndices.length);
      cy = Math.round(cy / tileIndices.length);

      groupNode.count = tileIndices.length;
      groupNode.center.x = cx;
      groupNode.center.y = cy;
      groupNode.tiles = tileIndices;
      groupNode.tileCount = tileIndices.length;
      groupNode.neighbors = [];
      groupNode.fertility = totalFertility / tileIndices.length;
      computeSpread(groupNode);

      // Tiles parented to this group
      for (var i = 0; i < tileIndices.length; i++) {
        var tileNode = self.tiles[tileIndices[i]];
        tileNode.parent = groupId;
        tileNode.container = groupId;
      }

      self.groups.set(groupId, groupNode);
      self.nodes.set(groupId, groupNode);
      self.byGroup.set(groupId, new Set());

      for (var i = 0; i < tileIndices.length; i++) {
        self.groupOfTile[tileIndices[i]] = groupId;
      }

      level1Ids.push(groupId);
    }

    // Scan all tiles, flood-fill groups
    for (var i = 0; i < this.width * this.height; i++) {
      if (!assigned[i]) {
        floodGroup(i);
      }
    }

    this.levels.push(level1Ids); // levels[1]
  },

  // --- Build adjacency for level-1 groups (from tile adjacency) ---

  buildLevel1Adjacency: function() {
    var edgeSet = new Set();

    for (var y = 0; y < this.height; y++) {
      for (var x = 0; x < this.width; x++) {
        var idx = y * this.width + x;
        var gId = this.groupOfTile[idx];
        if (gId < 0) continue;

        var dirs = [[1, 0], [0, 1]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = x + dirs[d][0], ny = y + dirs[d][1];
          if (nx >= this.width || ny >= this.height) continue;
          var ni = ny * this.width + nx;
          var ngId = this.groupOfTile[ni];
          if (ngId >= 0 && ngId !== gId) {
            var lo = Math.min(gId, ngId), hi = Math.max(gId, ngId);
            var key = lo + ',' + hi;
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              var gA = this.groups.get(lo);
              var gB = this.groups.get(hi);
              if (gA && gB) {
                if (gA.neighbors.indexOf(hi) < 0) gA.neighbors.push(hi);
                if (gB.neighbors.indexOf(lo) < 0) gB.neighbors.push(lo);
              }
            }
          }
        }
      }
    }
  },

  // --- Higher levels: recursively group adjacent same-level groups ---

  generateHigherLevels: function() {
    var level = 1;
    while (this.levels[level].length > CONFIG.HIERARCHY_BRANCH_MAX) {
      level++;
      this.generateLevel(level);
    }
    this.maxLevel = level;
  },

  generateLevel: function(level) {
    var self = this;
    var prevIds = this.levels[level - 1];
    var assigned = {};
    var newIds = [];

    // Shuffle for variety
    var shuffled = prevIds.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }

    for (var si = 0; si < shuffled.length; si++) {
      var startId = shuffled[si];
      if (assigned[startId]) continue;

      // Flood-fill adjacent groups at prev level
      var cluster = [startId];
      assigned[startId] = true;
      var queue = [startId];

      while (queue.length > 0 && cluster.length < CONFIG.HIERARCHY_BRANCH_MAX) {
        var current = queue.shift();
        var currentGroup = self.groups.get(current);
        if (!currentGroup) continue;

        var neighbors = currentGroup.neighbors;
        for (var ni = 0; ni < neighbors.length; ni++) {
          var nid = neighbors[ni];
          if (assigned[nid] || cluster.length >= CONFIG.HIERARCHY_BRANCH_MAX) continue;
          // Only group things at the same level
          var ng = self.groups.get(nid);
          if (!ng || ng.level !== level - 1) continue;
          cluster.push(nid);
          assigned[nid] = true;
          queue.push(nid);
        }
      }

      // Create parent group
      var parentNode = createNode('tilegroup');
      parentNode.level = level;
      parentNode.children = cluster;
      parentNode.parentGroup = null;
      parentNode.neighbors = [];

      // Aggregate properties from children
      var allTiles = [];
      var cx = 0, cy = 0, totalFertility = 0;
      var typeCounts = {};

      for (var ci = 0; ci < cluster.length; ci++) {
        var child = self.groups.get(cluster[ci]);
        child.parentGroup = parentNode.id;

        for (var ti = 0; ti < child.tiles.length; ti++) {
          allTiles.push(child.tiles[ti]);
        }
        cx += child.center.x * child.tileCount;
        cy += child.center.y * child.tileCount;
        totalFertility += child.fertility * child.tileCount;
        typeCounts[child.type] = (typeCounts[child.type] || 0) + child.tileCount;
      }

      parentNode.tiles = allTiles;
      parentNode.tileCount = allTiles.length;
      parentNode.count = allTiles.length;
      parentNode.center.x = Math.round(cx / allTiles.length);
      parentNode.center.y = Math.round(cy / allTiles.length);
      parentNode.fertility = totalFertility / allTiles.length;
      computeSpread(parentNode);

      // Dominant type
      var bestType = 'mixed', bestCount = 0;
      var typeKeys = Object.keys(typeCounts);
      for (var tk = 0; tk < typeKeys.length; tk++) {
        if (typeCounts[typeKeys[tk]] > bestCount) {
          bestCount = typeCounts[typeKeys[tk]];
          bestType = typeKeys[tk];
        }
      }
      parentNode.type = bestType;

      self.groups.set(parentNode.id, parentNode);
      self.nodes.set(parentNode.id, parentNode);
      self.byGroup.set(parentNode.id, new Set());
      newIds.push(parentNode.id);
    }

    // Build adjacency for this level from children's adjacency
    for (var i = 0; i < newIds.length; i++) {
      var gA = self.groups.get(newIds[i]);
      var neighborSet = {};
      for (var ci = 0; ci < gA.children.length; ci++) {
        var child = self.groups.get(gA.children[ci]);
        if (!child) continue;
        for (var ni = 0; ni < child.neighbors.length; ni++) {
          var neighborChild = self.groups.get(child.neighbors[ni]);
          if (neighborChild && neighborChild.parentGroup !== gA.id && neighborChild.parentGroup !== null) {
            neighborSet[neighborChild.parentGroup] = true;
          }
        }
      }
      gA.neighbors = [];
      var nkeys = Object.keys(neighborSet);
      for (var nk = 0; nk < nkeys.length; nk++) {
        gA.neighbors.push(parseInt(nkeys[nk]));
      }
    }

    this.levels.push(newIds);
  },

  // --- Populate: spawn initial groups into walkable level-1 groups ---

  populate: function() {
    var walkableGroups = [];
    var self = this;
    var level1Ids = this.levels[1];
    for (var i = 0; i < level1Ids.length; i++) {
      var group = this.groups.get(level1Ids[i]);
      if (group && group.type !== 'water' && group.type !== 'rock') {
        walkableGroups.push(group.id);
      }
    }

    if (walkableGroups.length === 0) return;

    // Plants: one grass group per walkable group, bush in ~half, tree in ~quarter
    for (var i = 0; i < walkableGroups.length; i++) {
      var gId = walkableGroups[i];
      this.spawnGroup('grass', gId);
      if (Math.random() < 0.5) this.spawnGroup('bush', gId);
      if (Math.random() < 0.25) this.spawnGroup('tree', gId);
    }

    // Animals: spread across random walkable groups
    function spawnGroups(templateId, count) {
      for (var j = 0; j < count; j++) {
        var gId = walkableGroups[Math.floor(Math.random() * walkableGroups.length)];
        var node = self.spawnGroup(templateId, gId);
        if (node.traits.vitals) {
          node.traits.vitals.hunger = 10 + Math.random() * 25;
          node.traits.vitals.energy = 60 + Math.random() * 30;
        }
      }
    }

    spawnGroups('stone', CONFIG.INITIAL_STONE);
    spawnGroups('rabbit', CONFIG.INITIAL_RABBIT);
    spawnGroups('deer', CONFIG.INITIAL_DEER);
    spawnGroups('pig', CONFIG.INITIAL_PIG);
    spawnGroups('bear', CONFIG.INITIAL_BEAR);
    spawnGroups('fox', CONFIG.INITIAL_FOX);
    spawnGroups('wolf', CONFIG.INITIAL_WOLF);
  },
};
