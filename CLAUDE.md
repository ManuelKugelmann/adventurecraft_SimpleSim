# CLAUDE.md -- AdventureCraft SimpleSim

## Sibling Repositories

https://github.com/ManuelKugelmann/adventurecraft_WIP
Master spec. All markdown, no code. Architecture, traits, rules, spatial hierarchy,
unified tree, scales, execution model. The authoritative design reference.

https://github.com/ManuelKugelmann/adventurecraft_HTN_GOAP
Behavior dataset. `.acf` files for rules, roles, plans. Extraction tooling (Python).
Has its own CLAUDE.md with expression language, plan format, validation rules.

This repo (`adventurecraft_SimpleSim`) is a playable JS prototype implementing a
subset of the WIP spec: unified node tree, region-graph simulation, compound group
statistics, and basic role/plan agency. Runs in a browser, no build step.

## Spec Alignment

The WIP spec defines the full architecture. This prototype implements:

| WIP Spec Concept | SimpleSim Implementation | Status |
|---|---|---|
| Node (Id, Template, Weight, ContainerNode, ParentNode) | `createNode()` in node.js — id, templateId, count, container, parent | aligned |
| Two trees: ContainerNode + ParentNode | `container`/`parent` (grouping), `contains`/`containedBy` (structural transport) | aligned |
| Weight (count) | `node.count` — 1=individual, >1=group/batch | aligned |
| Tiles and regions are nodes | tile_* and tilegroup templates in World.nodes, recursive hierarchy | aligned |
| Traits as composable structs | `node.traits` object with vitals, diet, agency, spatial, group | simplified |
| Rules by layer (L0-L4) | rules.js: biology only (L1). No L0/L2/L3/L4 yet | partial |
| Roles (reactive behaviors) | roles.js: ROLE_DEFS with condition/action priority lists | aligned |
| Plans (proactive sequences) | planner.js: PROCESSES with step sequences (flee, findFood, findWater, huntPrey); BFS multi-hop pathfinding | aligned |
| Compound statistics (Weight>1) | Compound execution for large groups, placeholder sim for small | aligned |
| Split/merge on variance | groups.js: merge with maxSize cap, split prefers food-rich neighbors | improved |
| Scale-adaptive dt | Single fixed dt, no adaptive scaling yet | not implemented |
| .acf rule format | Hardcoded JS, no parser | not implemented |
| Fixed-point Q16.16 | JS floats | not implemented |

### Key Terminology Mapping

| WIP Spec | SimpleSim | Notes |
|---|---|---|
| Weight | count | Same concept: 1=individual, >1=batch |
| ContainerNode | container | Group ID at any hierarchy level |
| ParentNode | parent | Grouping hierarchy (tiles→L1 group→L2 group→...) |
| ContainerIndex | contains[] | What's physically inside me (carried items) |
| SpatialTrait | spatial trait | Only has speed, no scale/capacity yet |
| VitalsTrait | vitals trait | hunger/energy/health/thirst; spec also has fatigue/mood/wounds/mana |
| DrivesTrait | — | Not implemented |
| AttributesTrait | — | Not implemented |
| SkillsTrait | — | Not implemented |
| AgencyTrait | agency trait | activeRole + activePlan + lastAction |

## Architecture

```
index.html          Entry point, grid container, controls
js/config.js        CONFIG constants, TILE_TYPES, TEMPLATES (all entity definitions)
js/node.js          createNode(), computeSpread() — node factory
js/world.js         World object: tile grid, recursive hierarchy, link graph, gradual movement
js/rules.js         Rules.biology() — hunger, growth, reproduction, starvation, seed drop
js/roles.js         Roles.evaluate() — role definitions, compound/placeholder execution
js/planner.js       Planner — multi-step processes (flee, findFood, huntPrey)
js/groups.js        Groups — merge/split passes for nodes with group trait
js/renderer.js      Renderer — ASCII grid, spread tinting, multi-level hierarchy borders, inspector
js/simulation.js    Simulation — tick loop, layer execution order
```

### Node Structure

Every entity is a node. Two hierarchies:
- **parent**: grouping for multiscale sim (tiles→L1 group→L2 group→...)
- **contains/containedBy**: structural transport (animals carrying items)

Spatial hierarchy (recursive tile grouping):
- Level 0 = individual tiles (80x80)
- Level 1 = tile groups (16-25 tiles each, same terrain type, flood-fill)
- Level 2 = groups of 3-5 L1 groups
- Level 3+ = continues recursively until map is covered (~4 levels for 80x80)

Entity container can point to any level. Position is graph-based within the container,
`center:{x,y}` is derived by interpolation.

```
Node {
    id, templateId, count,
    container,      // group ID at any hierarchy level
    parent,         // grouping hierarchy parent
    center: {x,y},  // tile-level position (derived from graph position)
    spread,         // visual radius in tiles
    alive,
    contains: [],   // IDs of nodes I carry
    containedBy,    // ID of node carrying me, or null
    position: {     // graph position within container
      at,           // 'center' or neighborId (current location on graph)
      target,       // null (stationary), 'center', or neighborId (destination)
      progress      // 0.0-1.0 (fraction of edge traversed)
    },
    traits: {}      // vitals, diet, agency, spatial, group
}
```

### Connection Graph (Links)

Each tile group has a `links` map connecting it to its neighbors:
```
group.links[neighborId] = {
    pos: {x,y},  // centroid of border tiles between groups
    dist,        // Manhattan distance from center to link
    effort       // traversal effort (dist * terrain modifier)
}
```

Movement is gradual: `startMove(node, neighborId)` initiates traversal along
graph edges. Direct link-to-link connections allow entities to skip center when
passing through a group:
- **Center route**: center→link→cross→link→center (entity stopping in a group)
- **Pass-through**: link_in→link_out→cross (entity transiting, skips center)

Link-to-link distance uses direct Manhattan distance between link positions
instead of summing through center. `_pendingMove` queues the next destination
so entities chain moves across multiple groups without stopping.
`advancePositions()` runs each tick to advance all moving entities.
Role evaluation is skipped while an entity is in transit.

### Template Categories

- `terrain`: tile nodes (tile_grass, tile_water, tile_dirt, tile_rock)
- `tilegroup`: hierarchy group nodes at all levels (L1 = same-type tile clusters, L2+ = recursive grouping)
- `plant`: grass, bush, tree (have vitals, group trait, no agency)
- `seed`: grains, seeds (edible bulk items, no vitals)
- `item`: stone (inert bulk, blocks movement at density)
- `herbivore`: rabbit, deer (grazer role)
- `omnivore`: pig, bear (forager role)
- `carnivore`: fox, wolf (hunter role)

### Execution Order (per tick)

1. **Biology** (all nodes): hunger drain, plant growth, seed drop, starvation, reproduction
2. **Groups** (every 5 ticks): merge similar, split oversized
3. **Actors** (by speed desc): role evaluation → compound or placeholder sim → actions

### Transport System

Animals pick up seeds/stones when moving (`tryPickup`), carry them via `contains`/`containedBy`,
and drop them in the new group (`dropContained`). Stones create movement penalties at high density.

## Commands

No build step. Open `index.html` in a browser. No dependencies.

## Style

- Plain ES5 JavaScript (no modules, no build, no transpile)
- Global vars, no classes
- `var` not `let`/`const`
- Functional style: plain objects + free functions
- No semicolon-free style — semicolons everywhere
- No backward compatibility — this is WIP, rename/remove freely
