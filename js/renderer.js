// renderer.js — DOM-based grid renderer, stats, inspector

var Renderer = {
  cells: null,      // flat array of span elements
  gridEl: null,
  statsEl: null,
  tickEl: null,
  inspectorEl: null,
  selectedNode: null,

  init: function() {
    this.gridEl = document.getElementById('grid');
    this.statsEl = document.getElementById('stats');
    this.tickEl = document.getElementById('tick-count');
    this.inspectorEl = document.getElementById('inspector');

    // Create all cell spans
    var w = World.width;
    var h = World.height;
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

    // Click handler for inspector
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

  draw: function() {
    var w = World.width;
    var h = World.height;

    for (var i = 0; i < w * h; i++) {
      var tile = World.tiles[i];
      var tileType = TILE_TYPES[tile.type];
      var span = this.cells[i];

      // Find top-priority entity on this tile
      var nodeIds = World.byContainer.get(i);
      var topNode = null;
      var topPriority = -1;

      if (nodeIds && nodeIds.size > 0) {
        nodeIds.forEach(function(id) {
          var n = World.nodes.get(id);
          if (n && n.alive) {
            var tmpl = TEMPLATES[n.templateId];
            if (tmpl.renderPriority > topPriority) {
              topPriority = tmpl.renderPriority;
              topNode = n;
            }
          }
        });
      }

      if (topNode) {
        var tmpl = TEMPLATES[topNode.templateId];
        span.textContent = tmpl.symbol;
        span.style.color = tmpl.color;
        // Group members get tinted background to show group membership
        var group = (topNode.parent !== null || (topNode.traits.agency && Groups.getGroupOf(topNode)))
          ? Groups.getGroupOf(topNode) : null;
        span.style.backgroundColor = group ? group.color : tileType.bg;
        // Dim young plants
        if (topNode.traits.growth && topNode.traits.growth.stage < 2) {
          span.style.opacity = 0.4 + topNode.traits.growth.stage * 0.3;
        } else {
          span.style.opacity = 1;
        }
      } else {
        span.textContent = tileType.symbol;
        span.style.color = tileType.color;
        span.style.backgroundColor = tileType.bg;
        span.style.opacity = 1;
      }
    }

    // Update tick counter
    this.tickEl.textContent = World.tick;

    // Update population stats
    this.updateStats();

    // Update inspector if a node is selected
    if (this.selectedNode) {
      this.updateInspector();
    }
  },

  updateStats: function() {
    var counts = {};
    var templateNames = Object.keys(TEMPLATES);
    for (var i = 0; i < templateNames.length; i++) {
      counts[templateNames[i]] = 0;
    }

    World.nodes.forEach(function(node) {
      if (node.alive) {
        counts[node.templateId] = (counts[node.templateId] || 0) + 1;
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
    var nodes = World.nodesAt(x, y);
    var tile = World.tileAt(x, y);

    if (nodes.length > 0) {
      // Pick highest priority entity
      var best = nodes[0];
      for (var i = 1; i < nodes.length; i++) {
        if (TEMPLATES[nodes[i].templateId].renderPriority > TEMPLATES[best.templateId].renderPriority) {
          best = nodes[i];
        }
      }
      this.selectedNode = best;
      this.updateInspector();
    } else {
      this.selectedNode = null;
      this.inspectorEl.innerHTML = '<b>Tile</b> (' + x + ',' + y + ') ' + tile.type +
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
      ' (' + n.x + ',' + n.y + ')'];

    if (n.traits.vitals) {
      var v = n.traits.vitals;
      parts.push('hp:' + Math.round(v.hp) + '/' + v.maxHp);
      if (v.hunger !== undefined) {
        parts.push('hunger:' + Math.round(v.hunger) + ' energy:' + Math.round(v.energy));
        parts.push('reproUrge:' + Math.round(v.reproUrge));
      }
      parts.push('age:' + Math.round(v.age));
    }
    if (n.traits.agency) {
      var a = n.traits.agency;
      parts.push('role:' + a.activeRole);
      if (a.activePlan) {
        parts.push('plan:' + a.activePlan.goal + ' step ' + a.activePlanStep);
      }
      if (a.lastAction) {
        parts.push('action:' + a.lastAction);
      }
    }
    if (n.traits.growth) {
      parts.push('stage:' + n.traits.growth.stage + '/' + n.traits.growth.maxStage);
    }

    this.inspectorEl.innerHTML = parts.join(' | ');
  },
};
