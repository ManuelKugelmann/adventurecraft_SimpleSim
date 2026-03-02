// rules.js — Biology rules: vitals drain, plant growth, death

var Rules = {
  biology: function(node) {
    var v = node.traits.vitals;
    if (!v) return;

    // Age
    v.age += 1;

    // Death from old age
    if (v.age > v.maxAge) {
      node.alive = false;
      return;
    }

    // Animals: hunger/energy drain
    if (v.hunger !== undefined) {
      v.hunger += CONFIG.HUNGER_RATE;
      v.energy -= CONFIG.ENERGY_DRAIN;

      // Reproduction urge builds over time
      if (v.reproCooldown > 0) {
        v.reproCooldown--;
      } else {
        v.reproUrge += CONFIG.REPRO_URGE_RATE;
      }

      // Starvation
      if (v.hunger >= 100) {
        v.hp -= 1;
      }
      // Exhaustion
      if (v.energy <= 0) {
        v.energy = 0;
        v.hp -= 0.5;
      }
      // Energy recovery when resting (not starving)
      if (v.hunger < 80 && v.energy < 100) {
        v.energy += 0.05;
      }

      // Death
      if (v.hp <= 0) {
        node.alive = false;
        return;
      }
    }

    // Plants: growth and spreading
    var g = node.traits.growth;
    if (g) {
      // Grow toward maturity
      if (g.stage < g.maxStage) {
        g.stage += g.growRate;
        if (g.stage >= g.maxStage) g.stage = g.maxStage;
      }

      // Spread: mature plants can spawn on adjacent grass tiles
      if (g.stage >= g.maxStage && g.spreadCooldown <= 0) {
        if (Math.random() < g.spreadChance) {
          var tile = World.tileAt(node.x, node.y);
          if (tile && tile.fertility > 0.3) {
            Rules.trySpreadPlant(node);
          }
        }
        g.spreadCooldown = 10 + Math.floor(Math.random() * 20);
      }
      if (g.spreadCooldown > 0) g.spreadCooldown--;
    }
  },

  trySpreadPlant: function(plant) {
    // Try random adjacent tile
    var dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    var d = dirs[Math.floor(Math.random() * dirs.length)];
    var nx = plant.x + d[0];
    var ny = plant.y + d[1];

    if (!World.isWalkable(nx, ny)) return;
    if (World.countOnTile(nx, ny, 'plant') >= CONFIG.MAX_PLANTS_PER_TILE) return;

    var tile = World.tileAt(nx, ny);
    if (tile && tile.fertility > 0.2) {
      World.spawnNode(plant.templateId, nx, ny);
    }
  },
};
