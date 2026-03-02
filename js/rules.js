// rules.js — Scale-agnostic biology rules
// Same rules apply to count=1 or count=50. Count scales interaction magnitudes.

var Rules = {
  biology: function(node) {
    var v = node.traits.vitals;
    if (!v) return;
    var tmpl = TEMPLATES[node.templateId];

    if (tmpl.category === 'plant') {
      // Plant growth: count increases based on region fertility
      var region = World.regions.get(node.container);
      if (region) {
        var maxCount = CONFIG.PLANT_MAX_DENSITY * region.tileCount;
        if (node.count < maxCount) {
          node.count += CONFIG.PLANT_GROW_RATE * region.fertility;
          node.count = Math.min(node.count, maxCount);
        }
      }
      computeSpread(node);
      return;
    }

    // Animals: hunger/energy drain (scale-agnostic — same rate regardless of count)
    v.hunger += CONFIG.HUNGER_RATE;
    v.energy -= CONFIG.ENERGY_DRAIN;

    // Energy recovery when not starving
    if (v.hunger < 70 && v.energy < 100) {
      v.energy += 0.1;
    }

    // Starvation: compound statistic — fraction of group dies
    if (v.hunger >= 90) {
      var deaths = Math.max(1, Math.ceil(node.count * CONFIG.STARVE_RATE));
      node.count -= deaths;
    }

    // Exhaustion
    if (v.energy <= 0) {
      v.energy = 0;
      node.count -= 1; // lose one per tick from exhaustion
    }

    // Reproduction: compound statistic — fraction of group breeds
    if (v.hunger < 40 && v.energy > 30 && node.count >= 2) {
      var births = Math.max(1, Math.floor(node.count * CONFIG.BIRTH_RATE));
      node.count += births;
      v.hunger += 12; // cost of reproduction
      v.energy -= 5;
    }

    // Death: group eliminated when count drops to 0
    if (node.count <= 0) {
      node.alive = false;
    }

    computeSpread(node);
  },
};
