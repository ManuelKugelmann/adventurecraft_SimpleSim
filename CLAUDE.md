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
| Rules by layer (L0-L4) | L0 base (action costs), L1 bio (drains/damage), L2 reflex (auto-drink/reproduce), L3 roles, L4 plans | aligned |
| Roles (reactive behaviors) | roles.js: ROLE_DEFS with numeric priority (0-95), sorted by priority desc | aligned |
| Plans (proactive sequences) | planner.js: PLAN_DEFS with step sequences (flee, findFood, findWater, huntPrey); BFS multi-hop pathfinding | aligned |
| Compound statistics (Weight>1) | Compound execution for large groups, placeholder sim for small | aligned |
| Split/merge on variance | groups.js: merge with maxSize cap, split prefers food-rich neighbors | improved |
| Read/write separation | snapshot.js: per-layer state snapshot; reads from snapshot, writes to live | aligned |
| Probabilistic rules (prob) | `prob` field on rules (0..1), checked after conditions pass | aligned |
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
js/snapshot.js      Snapshot — read/write separation via state snapshots per rule layer
js/sense.js         Sense.scan() — range-limited world model per entity; evalRuleConditions()
js/rules.js         BIO_RULE_DEFS (data) + Rules engine (code) — biology as declarative rule table
js/roles.js         ROLE_DEFS (data) + Roles engine — behavior as declarative rules
js/planner.js       Planner + PLAN_DEFS — multi-step plans using sense model (no omniscient search)
js/groups.js        Groups — merge/split passes for nodes with group trait
js/renderer.js      Renderer — ASCII grid, spread tinting, multi-level hierarchy borders, inspector
js/simulation.js    Simulation — tick loop, layer execution order
```

### Data / Code Separation — Rule Layers

All behavior is defined as **declarative data tables** (future .acf parsing targets)
evaluated by **engine code**, organized in layers:

| Layer | Data | Code | Location |
|---|---|---|---|
| L0 Base | `ACTION_DEFS` — action costs inline as `{type:'vital'}` effects | `Effects.executeAction()` | rules.js |
| L1 Bio | `BIO_RULE_DEFS` — passive drains, damage, death (no perception) | `Rules.biology()` | rules.js |
| L2 Reflex | `REFLEX_RULE_DEFS` — involuntary responses (auto-drink, reproduce) | `Rules.reflex()` | rules.js |
| L3 Roles | `ROLE_DEFS` — condition→action mappings per archetype | `Roles._matchRules/_execRule()` | roles.js |
| L3 Actions | `ACTION_DEFS` — effect descriptions per action (consume, combat, move) | `Effects.executeAction()` | rules.js |
| L4 Plans | `PLAN_DEFS` — step sequences (startmove, wait, action) | `Planner.start/executeStep()` | planner.js |

Rule conditions use `[field, op, value]` tuples evaluated by `evalRuleConditions()`.
Fields: vitals (`hunger`, `thirst`), `count`, `category`, `templateId`, sense paths (`sense.threats.count`).
Operators: `>`, `<`, `>=`, `<=`, `==`, `!=`, `in` (array membership).
All filtering (including entity category) uses the same condition system — no special-case fields.

Rules may also have `prob` (0..1) — a probabilistic trigger checked after conditions pass.
Aligns with spec's `prob = <expr>` on rule entries (mutually exclusive with `rate`).

**Layer execution order per tick**: Snapshot → L1 Biology → Clamp → Snapshot → L2 Reflex → Clamp → Groups → Movement → Snapshot → L3/L4 Roles+Plans → Clamp → Cleanup

### Sense Model (Perception)

`Sense.scan(node)` builds a range-limited world model (1-hop perception):
```
{
  food:          { here, count }        // edible plants/seeds in my container
  prey:          { here, count }        // huntable animals in my container
  threats:       { here[], count }      // things that eat me
  biggerThreats: { here[], count }      // stronger predators
  water:         { adjacent }           // water tile neighbor
  neighbors:     [walkable group ids]   // walkable 1-hop neighbors
  stones:        { density, blocked, slowed }
  foodNearby:    neighborId | null      // first neighbor with food
  preyNearby:    neighborId | null      // first neighbor with prey
  waterNearby:   neighborId | null      // first neighbor near water
}
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

Each rule layer uses **read/write separation**: `Snapshot.capture()` before the layer,
rules read from the snapshot (via `Snapshot.active()`), effects write to live nodes,
`Snapshot.clear()` + `Snapshot.clampCounts()` after. This ensures iteration order
within a layer doesn't affect outcomes (parallel execution model).

1. **Snapshot** → **L1 Biology** (all nodes): passive drains, damage, death, plant growth, seed drop → **Clamp**
2. **Snapshot** → **L2 Reflex** (animals): involuntary responses — auto-drink near water, reproduction → **Clamp**
3. **Groups** (every 5 ticks): merge similar, split oversized
4. **Movement**: advance entities along graph edges
5. **Snapshot** → **L3/L4 Actors** (by speed desc): role evaluation → compound or placeholder sim → actions → **Clamp**
6. **Cleanup**: remove dead nodes

### Read/Write Separation (Snapshot)

`Snapshot.capture()` copies `{ vitals, count, alive }` for every living node.
While active, `evalRuleConditions()` reads vitals/count from snapshot,
`Sense.scan()` reads other nodes' count/alive from snapshot, and
`Effects._consume/_combat` reads source/prey counts from snapshot.
Effects write to live nodes — multiple actors may over-decrement the same source
(intentional parallel execution). `Snapshot.clampCounts()` post-layer clamps
counts to 0 and marks dead.

### Role Priority

Role entries have a numeric `priority` field (0-95). Higher = more involuntary.
Matched rules are sorted by priority descending. Rules at or above
`CONFIG.URGENT_PRIORITY` (80) cause the whole group to act in unison.

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
