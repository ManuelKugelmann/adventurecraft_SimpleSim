// rules.js — Scale-agnostic biology rules
// Same rules apply to count=1 or count=50. Count scales interaction magnitudes.
// Items (grains, seeds, stones) have no vitals — they just exist as bulk nodes.

var Rules = {
  biology: function(node) {
    var tmpl = TEMPLATES[node.templateId];

    // Items: no biology, just passive existence
    if (tmpl.category === 'seed' || tmpl.category === 'item') return;

    var v = node.traits.vitals;
    if (!v) return;

    if (tmpl.category === 'plant') {
      // Plant growth: count increases based on container fertility
      var group = World.groups.get(node.container);
      if (group) {
        var maxCount = CONFIG.PLANT_MAX_DENSITY * group.tileCount;
        if (node.count < maxCount) {
          node.count += CONFIG.PLANT_GROW_RATE * group.fertility;
          node.count = Math.min(node.count, maxCount);
        }
      }

      // Seed/grain drop: mature plants occasionally produce items
      if (node.count > 10 && Math.random() < CONFIG.SEED_DROP_RATE) {
        var itemType = node.templateId === 'grass' ? 'grains' : 'seeds';
        var dropCount = Math.max(1, Math.floor(node.count * 0.05));
        spawnItem(itemType, dropCount, node.container, node.center);
      }

      computeSpread(node);
      return;
    }

    // Animals: hunger/energy/thirst drain (scale-agnostic)
    v.hunger += CONFIG.HUNGER_RATE;
    v.energy -= CONFIG.ENERGY_DRAIN;
    if (v.thirst !== undefined) v.thirst += CONFIG.THIRST_RATE;

    if (v.hunger < 70 && v.energy < 100) {
      v.energy += 0.1;
    }

    // Thirst: drink from water neighbors, dehydration damage
    if (v.thirst !== undefined) {
      var group = World.groups.get(node.container);
      if (group && v.thirst > 40) {
        // Auto-drink if adjacent to water
        var neighbors = group.neighbors;
        for (var ni = 0; ni < neighbors.length; ni++) {
          var ng = World.groups.get(neighbors[ni]);
          if (ng && ng.type === 'water') {
            v.thirst = Math.max(0, v.thirst - 15);
            break;
          }
        }
      }
      // Dehydration: health damage
      if (v.thirst >= 80 && v.health !== undefined) {
        v.health -= 2;
      }
    }

    // Health: regen when well-fed and hydrated, die at 0
    if (v.health !== undefined) {
      if (v.hunger < 50 && (v.thirst === undefined || v.thirst < 50)) {
        v.health = Math.min(100, v.health + CONFIG.HEAL_RATE);
      }
      if (v.health <= 0) {
        var healthDeaths = Math.max(1, Math.ceil(node.count * 0.1));
        node.count -= healthDeaths;
        v.health = 20; // survivors recover slightly
      }
    }

    // Starvation: compound statistic
    if (v.hunger >= 90) {
      var deaths = Math.max(1, Math.ceil(node.count * CONFIG.STARVE_RATE));
      node.count -= deaths;
    }

    // Exhaustion
    if (v.energy <= 0) {
      v.energy = 0;
      node.count -= 1;
    }

    // Reproduction: compound statistic (requires good health)
    var healthOk = v.health === undefined || v.health > 50;
    var thirstOk = v.thirst === undefined || v.thirst < 50;
    if (v.hunger < 40 && v.energy > 30 && healthOk && thirstOk && node.count >= 2) {
      var births = Math.max(1, Math.floor(node.count * CONFIG.BIRTH_RATE));
      node.count += births;
      v.hunger += 12;
      v.energy -= 5;
    }

    // Death: drop contained items before dying
    if (node.count <= 0) {
      dropContained(node);
      node.alive = false;
    }

    computeSpread(node);
  },
};

// Spawn an item node in a container
function spawnItem(templateId, count, containerId, center) {
  var node = createNode(templateId);
  node.count = count;
  node.container = containerId;
  node.parent = containerId;
  node.center.x = center.x;
  node.center.y = center.y;
  computeSpread(node);
  World.nodes.set(node.id, node);
  if (!World.byGroup.has(containerId)) World.byGroup.set(containerId, new Set());
  World.byGroup.get(containerId).add(node.id);
}
