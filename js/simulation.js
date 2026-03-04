// simulation.js — Tick loop, layer execution order

var Simulation = {
  running: false,
  tickInterval: null,
  speedMs: CONFIG.TICK_MS,

  start: function() {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  },

  stop: function() {
    this.running = false;
    if (this.tickInterval !== null) {
      clearTimeout(this.tickInterval);
      cancelAnimationFrame(this.tickInterval);
      this.tickInterval = null;
    }
  },

  step: function() {
    this.executeTick();
    Renderer.draw();
  },

  setSpeed: function(ms) {
    this.speedMs = ms;
    if (this.running) {
      clearTimeout(this.tickInterval);
      cancelAnimationFrame(this.tickInterval);
      this.scheduleNext();
    }
  },

  scheduleNext: function() {
    var self = this;
    if (this.speedMs === 0) {
      // Max speed: use requestAnimationFrame to batch ticks
      this.tickInterval = requestAnimationFrame(function loop() {
        if (!self.running) return;
        for (var i = 0; i < 5; i++) {
          self.executeTick();
        }
        Renderer.draw();
        self.tickInterval = requestAnimationFrame(loop);
      });
    } else {
      this.tickInterval = setTimeout(function tick() {
        if (!self.running) return;
        self.executeTick();
        Renderer.draw();
        self.tickInterval = setTimeout(tick, self.speedMs);
      }, this.speedMs);
    }
  },

  executeTick: function() {
    World.tick++;

    // === EARLY: World rules (biology, plant growth, passive effects) ===
    World.nodes.forEach(function(node) {
      if (!node.alive) return;
      Rules.biology(node);
    });

    // === Merge colocated same-species groups with similar state ===
    Groups.mergePass();

    // === Split oversized groups ===
    if (World.tick % 5 === 0) {
      Groups.splitPass();
    }

    // === LATE: Actor actions, ordered by initiative ===
    var actors = [];
    World.nodes.forEach(function(node) {
      if (node.alive && node.traits.agency) actors.push(node);
    });
    actors.sort(function(a, b) {
      var spdA = a.traits.spatial ? a.traits.spatial.speed : 0;
      var spdB = b.traits.spatial ? b.traits.spatial.speed : 0;
      if (spdB !== spdA) return spdB - spdA; // higher speed = earlier
      return a.id - b.id; // stable tiebreak
    });

    for (var i = 0; i < actors.length; i++) {
      if (actors[i].alive) {
        Roles.evaluate(actors[i]);
      }
    }

    // === Cleanup: remove dead groups ===
    World.removeDeadNodes();
  },
};
