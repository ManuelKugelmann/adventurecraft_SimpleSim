// renderer.js — Multi-level hierarchy borders, group labels, spread tints

var Renderer = {
  cells: null,
  gridEl: null,
  statsEl: null,
  tickEl: null,
  inspectorEl: null,
  selectedNode: null,
  showSense: false,
  // Pre-computed: border info per tile (set once after hierarchy gen)
  borderInfo: null,  // flat array of {top,right,bottom,left} border flags + level + color

  init: function() {
    this.gridEl = document.getElementById('grid');
    this.statsEl = document.getElementById('stats');
    this.tickEl = document.getElementById('tick-count');
    this.inspectorEl = document.getElementById('inspector');
    this.buildLegend();

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

    // Pre-compute hierarchy borders (static after terrain gen)
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

  buildLegend: function() {
    var legendEl = document.getElementById('legend');
    if (!legendEl) return;

    var categories = [
      { label: 'Terrain', items: [] },
      { label: 'Plants', items: [] },
      { label: 'Seeds', items: [] },
      { label: 'Items', items: [] },
      { label: 'Herbivores', items: [] },
      { label: 'Omnivores', items: [] },
      { label: 'Carnivores', items: [] },
    ];
    var catMap = { terrain: 0, plant: 1, seed: 2, item: 3, herbivore: 4, omnivore: 5, carnivore: 6 };

    var names = Object.keys(TEMPLATES);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var tmpl = TEMPLATES[name];
      if (tmpl.category === 'tilegroup') continue;
      var catIdx = catMap[tmpl.category];
      if (catIdx === undefined) continue;
      var displayName = name.replace(/^tile_/, '');

      // Build tooltip from template properties
      var tipParts = [displayName];
      if (tmpl.defaultCount > 1) tipParts.push('group size: ' + tmpl.defaultCount);
      if (tmpl.strength > 0) tipParts.push('strength: ' + tmpl.strength);
      if (tmpl.traits.diet) {
        if (tmpl.traits.diet.eats.length > 0) tipParts.push('eats: ' + tmpl.traits.diet.eats.join(', '));
        if (tmpl.traits.diet.eatenBy.length > 0) tipParts.push('eaten by: ' + tmpl.traits.diet.eatenBy.join(', '));
      }
      if (tmpl.traits.agency) tipParts.push('role: ' + tmpl.traits.agency.activeRole);
      if (tmpl.traits.spatial) tipParts.push('speed: ' + tmpl.traits.spatial.speed);
      if (tmpl.traits.group) tipParts.push('max group: ' + tmpl.traits.group.maxSize);

      categories[catIdx].items.push({
        name: displayName, symbol: tmpl.symbol, color: tmpl.color,
        tooltip: tipParts.join('\n')
      });
    }

    var html = [];
    for (var c = 0; c < categories.length; c++) {
      var cat = categories[c];
      if (cat.items.length === 0) continue;
      var parts = ['<span class="legend-label">' + cat.label + ':</span>'];
      for (var j = 0; j < cat.items.length; j++) {
        var it = cat.items[j];
        parts.push('<span class="legend-item" title="' + it.tooltip.replace(/"/g, '&quot;') +
          '"><span class="legend-icon" style="color:' +
          it.color + '">' + it.symbol + '</span><span class="legend-name">' +
          it.name + '</span></span>');
      }
      html.push('<span class="legend-group">' + parts.join('') + '</span>');
    }
    legendEl.innerHTML = html.join('<span class="legend-sep">|</span>');
  },

  // Compute borders at multiple hierarchy levels.
  // For each tile edge, find the highest level at which the two tiles diverge.
  // Higher-level borders are drawn thicker/darker.
  computeBorders: function() {
    var w = World.width, h = World.height;
    this.borderInfo = new Array(w * h);

    // Pre-compute: for each tile, its ancestor group at each level
    // tileAncestors[tileIdx][level] = groupId
    var maxLvl = World.maxLevel;

    for (var i = 0; i < w * h; i++) {
      var x = i % w, y = Math.floor(i / w);
      var info = { top: 0, right: 0, bottom: 0, left: 0 };
      var myL1 = World.groupOfTile[i];

      // Check each direction: find the highest divergence level
      var dirs = [
        { dx: 0, dy: -1, side: 'top' },
        { dx: 1, dy: 0, side: 'right' },
        { dx: 0, dy: 1, side: 'bottom' },
        { dx: -1, dy: 0, side: 'left' }
      ];

      for (var d = 0; d < dirs.length; d++) {
        var nx = x + dirs[d].dx, ny = y + dirs[d].dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        var ni = ny * w + nx;
        var nL1 = World.groupOfTile[ni];

        if (myL1 === nL1 || myL1 < 0 || nL1 < 0) continue;

        // Different L1 groups — find highest level where they diverge
        // (i.e., the lowest common ancestor level)
        var borderLevel = 1;
        var myG = World.groups.get(myL1);
        var nG = World.groups.get(nL1);
        for (var lvl = 2; lvl <= maxLvl; lvl++) {
          if (!myG || !nG) break;
          var myParent = myG.parentGroup;
          var nParent = nG.parentGroup;
          if (myParent !== nParent) {
            borderLevel = lvl;
          }
          myG = World.groups.get(myParent);
          nG = World.groups.get(nParent);
        }
        info[dirs[d].side] = borderLevel;
      }

      this.borderInfo[i] = info;
    }
  },

  applyBorders: function() {
    var maxLvl = World.maxLevel;
    for (var i = 0; i < this.borderInfo.length; i++) {
      var info = this.borderInfo[i];
      var span = this.cells[i];
      var hasBorder = info.top || info.right || info.bottom || info.left;
      if (hasBorder) {
        span.style.borderTop = info.top ? this.borderStyle(info.top, maxLvl) : 'none';
        span.style.borderRight = info.right ? this.borderStyle(info.right, maxLvl) : 'none';
        span.style.borderBottom = info.bottom ? this.borderStyle(info.bottom, maxLvl) : 'none';
        span.style.borderLeft = info.left ? this.borderStyle(info.left, maxLvl) : 'none';
      }
    }
  },

  // Border style by hierarchy level: higher level = thicker + darker
  borderStyle: function(level, maxLevel) {
    if (level <= 1) return '1px solid rgba(80,80,60,0.3)';
    if (level === 2) return '1px solid rgba(80,80,60,0.6)';
    if (level >= maxLevel) return '2px solid rgba(60,60,40,0.9)';
    return '1px solid rgba(70,70,50,0.75)';
  },

  draw: function() {
    var w = World.width, h = World.height;

    // Collect all visible groups with their spread tiles
    var allGroups = [];
    World.nodes.forEach(function(node) {
      if (!node.alive) return;
      var tmpl = TEMPLATES[node.templateId];
      if (tmpl.category === 'terrain' || tmpl.category === 'tilegroup') return;
      if (node.containedBy) return;
      var cx = node.center.x, cy = node.center.y;
      var r = node.spread;
      var x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
      var y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
      var tiles = [];
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          var idx = ty * w + tx;
          // Check if tile belongs to entity's container (works at any level)
          if (World.tileInGroup(idx, node.container)) {
            tiles.push(idx);
          }
        }
      }
      if (tiles.length > 0) {
        allGroups.push({ node: node, tmpl: tmpl, tiles: tiles, centerIdx: cy * w + cx });
      }
    });

    // Sort: biggest spread first (bottom layer), smallest on top
    allGroups.sort(function(a, b) { return b.node.spread - a.node.spread; });

    // Pick icon tiles for each group
    var iconAt = {};
    var tintAt = {};
    for (var gi = 0; gi < allGroups.length; gi++) {
      var g = allGroups[gi];
      var node = g.node, tmpl = g.tmpl, tiles = g.tiles;
      var cx = node.center.x, cy = node.center.y;

      for (var ti = 0; ti < tiles.length; ti++) {
        if (!tintAt[tiles[ti]]) tintAt[tiles[ti]] = { tmpl: tmpl };
      }

      iconAt[g.centerIdx] = { node: node, tmpl: tmpl, isCenter: true };

      var numExtra = Math.min(Math.floor(node.count) - 1, tiles.length - 1);
      if (numExtra > 0) {
        var nonCenter = [];
        for (var ti = 0; ti < tiles.length; ti++) {
          if (tiles[ti] !== g.centerIdx) nonCenter.push(tiles[ti]);
        }
        nonCenter.sort(function(a, b) {
          var ax = a % w - cx, ay = Math.floor(a / w) - cy;
          var bx = b % w - cx, by = Math.floor(b / w) - cy;
          return (ax * ax + ay * ay) - (bx * bx + by * by);
        });
        var step = nonCenter.length / numExtra;
        for (var ei = 0; ei < numExtra; ei++) {
          var idx = nonCenter[Math.floor(ei * step)];
          iconAt[idx] = { node: node, tmpl: tmpl, isCenter: false };
        }
      }
    }

    // Render each tile
    for (var i = 0; i < w * h; i++) {
      var tile = World.tiles[i];
      var tileType = TILE_TYPES[tile.type];
      var span = this.cells[i];
      var icon = iconAt[i];
      var tint = tintAt[i];

      if (icon && icon.isCenter) {
        var label = icon.tmpl.symbol + Math.floor(icon.node.count);
        for (var ci = 0; ci < icon.node.contains.length; ci++) {
          var carried = World.nodes.get(icon.node.contains[ci]);
          if (carried && carried.alive) {
            label += TEMPLATES[carried.templateId].symbol;
          }
        }
        span.textContent = label;
        span.style.color = icon.tmpl.color;
        span.style.backgroundColor = this.tintColor(tileType.bg, icon.tmpl.color, 0.25);
      } else if (icon) {
        span.textContent = icon.tmpl.symbol;
        span.style.color = icon.tmpl.color;
        span.style.backgroundColor = tint
          ? this.tintColor(tileType.bg, tint.tmpl.color, 0.25)
          : tileType.bg;
      } else if (tint) {
        span.textContent = tileType.symbol;
        span.style.color = tint.tmpl.color;
        span.style.backgroundColor = this.tintColor(tileType.bg, tint.tmpl.color, 0.25);
      } else {
        span.textContent = tileType.symbol;
        span.style.color = tileType.color;
        span.style.backgroundColor = tileType.bg;
      }
      span.style.opacity = 1;
    }

    this.tickEl.textContent = World.tick;
    this.updateStats();
    if (this.selectedNode) this.updateInspector();
  },

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
        var tmpl = TEMPLATES[node.templateId];
        if (tmpl.category !== 'terrain' && tmpl.category !== 'tilegroup') {
          counts[node.templateId] = (counts[node.templateId] || 0) + Math.floor(node.count);
        }
      }
    });

    var parts = [];
    for (var i = 0; i < templateNames.length; i++) {
      var name = templateNames[i];
      var tmpl = TEMPLATES[name];
      if (tmpl.category === 'terrain' || tmpl.category === 'tilegroup') continue;
      parts.push('<span style="color:' + tmpl.color + '">' + tmpl.symbol + '</span>' + counts[name]);
    }
    this.statsEl.innerHTML = parts.join(' ');
  },

  inspect: function(x, y) {
    var tile = World.tileAt(x, y);
    var groupId = World.groupOfTile[y * World.width + x];
    var groups = World.groupsInContainer(groupId);

    if (groups.length > 0) {
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
      var group = World.groups.get(groupId);
      var hierParts = [];
      var g = group;
      while (g) {
        hierParts.push('L' + g.level + '#' + g.id + '(' + g.tileCount + ')');
        g = g.parentGroup ? World.groups.get(g.parentGroup) : null;
      }
      var linkCount = group && group.links ? Object.keys(group.links).length : 0;
      this.inspectorEl.innerHTML = '<b>Tile</b> (' + x + ',' + y + ') ' + tile.type +
        ' | ' + hierParts.join(' → ') +
        ' | fertility: ' + tile.fertility.toFixed(2) +
        ' | links: ' + linkCount;
    }
  },

  _formatVal: function(val, depth) {
    if (val === null) return '<span class="insp-null">null</span>';
    if (val === undefined) return '<span class="insp-null">undefined</span>';
    if (typeof val === 'number') {
      var display = val === Math.floor(val) ? String(val) : val.toFixed(2);
      return '<span class="insp-val">' + display + '</span>';
    }
    if (typeof val === 'boolean' || typeof val === 'string') {
      return '<span class="insp-val">' + String(val) + '</span>';
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '<span class="insp-null">[]</span>';
      if (depth > 1) return '<span class="insp-val">[' + val.length + ']</span>';
      var items = [];
      for (var i = 0; i < val.length; i++) {
        items.push(this._formatVal(val[i], depth + 1));
      }
      return '[' + items.join(', ') + ']';
    }
    if (typeof val === 'object') {
      if (depth > 1) return '<span class="insp-val">{...}</span>';
      // For node references from sense, show a summary
      if (val.templateId && val.id !== undefined) {
        var t = TEMPLATES[val.templateId];
        return '<span class="insp-val">' + (t ? t.symbol : '?') + val.templateId + '#' + val.id +
          '(×' + Math.floor(val.count) + ')</span>';
      }
      var lines = [];
      var keys = Object.keys(val);
      for (var i = 0; i < keys.length; i++) {
        lines.push('<span class="insp-key">' + keys[i] + '</span>: ' +
          this._formatVal(val[keys[i]], depth + 1));
      }
      return lines.join('\n');
    }
    return '<span class="insp-val">' + String(val) + '</span>';
  },

  _buildSection: function(label, obj) {
    var html = '<span class="insp-label">' + label + '</span>';
    html += this._formatVal(obj, 0);
    return '<div class="insp-section">' + html + '</div>';
  },

  updateInspector: function() {
    var n = this.selectedNode;
    if (!n || !n.alive) {
      this.selectedNode = null;
      this.inspectorEl.innerHTML = '';
      return;
    }
    var tmpl = TEMPLATES[n.templateId];
    var self = this;

    // Header line
    var containerGroup = World.groups.get(n.container);
    var containerLabel = n.container;
    if (containerGroup) {
      containerLabel = 'L' + containerGroup.level + '#' + n.container + '(' + containerGroup.tileCount + 't)';
    }
    var header = '<b>' + tmpl.symbol + ' ' + n.templateId + '</b> #' + n.id +
      ' | count:' + Math.floor(n.count) + ' | container:' + containerLabel;
    if (n.traits.agency) {
      var a = n.traits.agency;
      if (a.lastAction) header += ' | action:' + a.lastAction;
      if (a.activePlan) header += ' | plan:' + a.activePlan.goal;
    }

    // Sense toggle button
    var senseBtn = '<button class="insp-toggle' + (this.showSense ? ' active' : '') +
      '" onclick="Renderer.showSense=!Renderer.showSense;Renderer.updateInspector()">Sense</button>';

    var html = '<div class="insp-header">' + header + ' ' + senseBtn + '</div>';
    html += '<div class="insp-body">';

    // Node section — core fields
    var core = {
      id: n.id,
      templateId: n.templateId,
      category: tmpl.category,
      count: n.count,
      alive: n.alive,
      container: n.container,
      parent: n.parent,
      center: n.center,
      spread: n.spread,
    };
    if (n.containedBy) core.containedBy = n.containedBy;
    if (n.contains && n.contains.length > 0) {
      var inv = [];
      for (var c = 0; c < n.contains.length; c++) {
        var item = World.nodes.get(n.contains[c]);
        if (item && item.alive) inv.push(item.templateId + '#' + item.id + '(×' + Math.floor(item.count) + ')');
      }
      core.contains = inv;
    }
    html += this._buildSection('node', core);

    // Position section
    if (n.position) {
      html += this._buildSection('position', n.position);
    }

    // Vitals section
    if (n.traits.vitals) {
      html += this._buildSection('vitals', n.traits.vitals);
    }

    // Agency section
    if (n.traits.agency) {
      var ag = n.traits.agency;
      var agencyView = {
        activeRole: ag.activeRole,
        lastAction: ag.lastAction,
      };
      if (ag.activePlan) {
        agencyView.activePlan = {
          goal: ag.activePlan.goal,
          stepIdx: ag.activePlan.stepIdx,
          target: ag.activePlan.target,
        };
      }
      if (ag.actionSpread) agencyView.actionSpread = ag.actionSpread;
      html += this._buildSection('agency', agencyView);
    }

    // Diet section
    if (n.traits.diet) {
      html += this._buildSection('diet', n.traits.diet);
    }

    // Group section
    if (n.traits.group) {
      var gv = {
        maxSize: n.traits.group.maxSize,
        mergeThreshold: n.traits.group.mergeThreshold,
      };
      var siblings = World.groupsInContainer(n.container);
      var sameSpecies = 0;
      for (var si = 0; si < siblings.length; si++) {
        if (siblings[si].templateId === n.templateId && siblings[si].alive) sameSpecies++;
      }
      if (sameSpecies > 1) gv.herdsHere = sameSpecies;
      html += this._buildSection('group', gv);
    }

    // Spatial section
    if (n.traits.spatial) {
      html += this._buildSection('spatial', n.traits.spatial);
    }

    // Sense model (filtered world model)
    if (this.showSense && n.traits.agency) {
      var sense = Sense.scan(n);
      var sv = {
        food: { here: sense.food.here, count: sense.food.count },
        prey: { here: sense.prey.here, count: sense.prey.count },
        threats: { count: sense.threats.count, here: sense.threats.here },
        biggerThreats: { count: sense.biggerThreats.count, here: sense.biggerThreats.here },
        water: sense.water,
        stones: sense.stones,
        neighbors: sense.neighbors.length,
        foodNearby: sense.foodNearby,
        preyNearby: sense.preyNearby,
        waterNearby: sense.waterNearby,
      };
      html += this._buildSection('sense (world model)', sv);
    }

    html += '</div>';
    this.inspectorEl.innerHTML = html;
  },
};
