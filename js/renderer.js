// renderer.js — Region borders, group labels, spread tints

var Renderer = {
  cells: null,
  gridEl: null,
  statsEl: null,
  tickEl: null,
  inspectorEl: null,
  selectedNode: null,
  // Pre-computed: border info per tile (set once after region gen)
  borderInfo: null,  // flat array of {top,right,bottom,left} border flags + color

  init: function() {
    this.gridEl = document.getElementById('grid');
    this.statsEl = document.getElementById('stats');
    this.tickEl = document.getElementById('tick-count');
    this.inspectorEl = document.getElementById('inspector');

    var w = World.width, h = World.height;
    this.cells = new Array(w * h);
    this.gridEl.style.gridTemplateColumns = 'repeat(' + w + ', 12px)';

    var frag = document.createDocumentFragment();
    for (var i = 0; i < w * h; i++) {
      var span = document.createElement('span');
      span.className = 'cell';
      span.dataset.idx = i;
      frag.appendChild(span);
      this.cells[i] = span;
    }
    this.gridEl.appendChild(frag);

    // Pre-compute region borders (static after terrain gen)
    this.computeBorders();

    // Apply static borders to cells
    this.applyBorders();

    // Click handler
    var self = this;
    this.gridEl.addEventListener('click', function(e) {
      if (e.target.classList.contains('cell')) {
        var idx = parseInt(e.target.dataset.idx);
        var x = idx % World.width;
        var y = Math.floor(idx / World.width);
        self.inspect(x, y);
      }
    });
  },

  computeBorders: function() {
    var w = World.width, h = World.height;
    this.borderInfo = new Array(w * h);

    for (var i = 0; i < w * h; i++) {
      var x = i % w, y = Math.floor(i / w);
      var myRegion = World.regionOfTile[i];
      var info = { top: false, right: false, bottom: false, left: false, color: '#555' };

      // Check 4 neighbors
      if (y > 0 && World.regionOfTile[(y-1)*w+x] !== myRegion) info.top = true;
      if (x < w-1 && World.regionOfTile[y*w+x+1] !== myRegion) info.right = true;
      if (y < h-1 && World.regionOfTile[(y+1)*w+x] !== myRegion) info.bottom = true;
      if (x > 0 && World.regionOfTile[y*w+x-1] !== myRegion) info.left = true;

      // Border color based on region type
      var region = World.regions.get(myRegion);
      if (region) {
        if (region.type === 'water') info.color = '#2a5a8a';
        else if (region.type === 'rock') info.color = '#606060';
        else info.color = '#4a4a3a';
      }

      this.borderInfo[i] = info;
    }
  },

  applyBorders: function() {
    for (var i = 0; i < this.borderInfo.length; i++) {
      var info = this.borderInfo[i];
      var span = this.cells[i];
      var hasBorder = info.top || info.right || info.bottom || info.left;
      if (hasBorder) {
        span.style.borderTop = info.top ? '1px solid ' + info.color : 'none';
        span.style.borderRight = info.right ? '1px solid ' + info.color : 'none';
        span.style.borderBottom = info.bottom ? '1px solid ' + info.color : 'none';
        span.style.borderLeft = info.left ? '1px solid ' + info.color : 'none';
      }
    }
  },

  draw: function() {
    var w = World.width, h = World.height;

    // Build a map: tileIndex → list of groups whose spread covers this tile
    var tileGroups = {};  // tileIndex → [{node, tmpl}]
    World.nodes.forEach(function(node) {
      if (!node.alive) return;
      var tmpl = TEMPLATES[node.templateId];
      var cx = node.center.x, cy = node.center.y;
      var r = node.spread;
      var x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
      var y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          var idx = ty * w + tx;
          // Only tint tiles in the same region
          if (World.regionOfTile[idx] === node.region) {
            if (!tileGroups[idx]) tileGroups[idx] = [];
            tileGroups[idx].push({ node: node, tmpl: tmpl });
          }
        }
      }
    });

    // Render each tile
    for (var i = 0; i < w * h; i++) {
      var tile = World.tiles[i];
      var tileType = TILE_TYPES[tile.type];
      var span = this.cells[i];

      var groups = tileGroups[i];
      if (groups && groups.length > 0) {
        // Find highest priority group on this tile
        var best = groups[0];
        for (var g = 1; g < groups.length; g++) {
          if (groups[g].tmpl.renderPriority > best.tmpl.renderPriority) {
            best = groups[g];
          }
        }

        // Is this the center tile of the best group? Show icon + count
        var node = best.node;
        if (Math.abs(node.center.x - (i % w)) <= 0 && Math.abs(node.center.y - Math.floor(i / w)) <= 0) {
          span.textContent = best.tmpl.symbol + node.count;
          span.style.color = best.tmpl.color;
        } else {
          // Spread tile: just tint
          span.textContent = tileType.symbol;
          span.style.color = best.tmpl.color;
        }
        // Tinted background
        span.style.backgroundColor = this.tintColor(tileType.bg, best.tmpl.color, 0.25);
        span.style.opacity = 1;
      } else {
        span.textContent = tileType.symbol;
        span.style.color = tileType.color;
        span.style.backgroundColor = tileType.bg;
        span.style.opacity = 1;
      }
    }

    this.tickEl.textContent = World.tick;
    this.updateStats();
    if (this.selectedNode) this.updateInspector();
  },

  // Blend two hex colors
  tintColor: function(baseCss, tintCss, amount) {
    var b = this.parseHex(baseCss);
    var t = this.parseHex(tintCss);
    var r = Math.round(b.r * (1 - amount) + t.r * amount);
    var g = Math.round(b.g * (1 - amount) + t.g * amount);
    var bl = Math.round(b.b * (1 - amount) + t.b * amount);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  },

  parseHex: function(hex) {
    hex = hex.replace('#', '');
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
    };
  },

  updateStats: function() {
    var counts = {};
    var templateNames = Object.keys(TEMPLATES);
    for (var i = 0; i < templateNames.length; i++) counts[templateNames[i]] = 0;

    World.nodes.forEach(function(node) {
      if (node.alive) {
        counts[node.templateId] = (counts[node.templateId] || 0) + node.count;
      }
    });

    var parts = [];
    for (var i = 0; i < templateNames.length; i++) {
      var name = templateNames[i];
      var tmpl = TEMPLATES[name];
      parts.push('<span style="color:' + tmpl.color + '">' + tmpl.symbol + '</span>' + counts[name]);
    }
    this.statsEl.innerHTML = parts.join(' ');
  },

  inspect: function(x, y) {
    var tile = World.tileAt(x, y);
    var regionId = World.regionOfTile[y * World.width + x];
    var groups = World.groupsInRegion(regionId);

    if (groups.length > 0) {
      // Pick the group closest to clicked tile
      var best = groups[0];
      var bestDist = Math.abs(best.center.x - x) + Math.abs(best.center.y - y);
      for (var i = 1; i < groups.length; i++) {
        var d = Math.abs(groups[i].center.x - x) + Math.abs(groups[i].center.y - y);
        if (d < bestDist) { bestDist = d; best = groups[i]; }
      }
      this.selectedNode = best;
      this.updateInspector();
    } else {
      this.selectedNode = null;
      var region = World.regions.get(regionId);
      this.inspectorEl.innerHTML = '<b>Tile</b> (' + x + ',' + y + ') ' + tile.type +
        ' | region #' + regionId + ' (' + (region ? region.tileCount : '?') + ' tiles)' +
        ' | fertility: ' + tile.fertility.toFixed(2);
    }
  },

  updateInspector: function() {
    var n = this.selectedNode;
    if (!n || !n.alive) {
      this.selectedNode = null;
      this.inspectorEl.innerHTML = '';
      return;
    }
    var tmpl = TEMPLATES[n.templateId];
    var parts = ['<b>' + tmpl.symbol + ' ' + n.templateId + '</b> #' + n.id +
      ' | count:' + n.count + ' | region:' + n.region];

    if (n.traits.vitals) {
      var v = n.traits.vitals;
      parts.push('hunger:' + Math.round(v.hunger) + ' energy:' + Math.round(v.energy));
    }
    if (n.traits.agency) {
      var a = n.traits.agency;
      parts.push('role:' + a.activeRole);
      if (a.activePlan) parts.push('plan:' + a.activePlan.goal);
      if (a.lastAction) parts.push('action:' + a.lastAction);
    }

    this.inspectorEl.innerHTML = parts.join(' | ');
  },
};
