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
| Traits as composable structs | `node.traits` object with vitals, diet, agency, spatial, social, group, signal | simplified |
| Rules by layer (L0-L4) | L0 base (action costs), L1 bio (drains/damage), L2 reflex (auto-drink/reproduce), L3 roles, L4 plans | aligned |
| Roles (reactive behaviors) | roles.js: unified 'animal' role with priority-sorted rules; diet differentiates behavior | aligned |
| Plans (proactive sequences) | planner.js: PLAN_DEFS with step sequences + predict/risk; drive-based preemption each tick | aligned |
| Compound statistics (Weight>1) | Compound execution for large groups, placeholder sim for small | aligned |
| Split/merge on variance | groups.js: merge with maxSize cap, split prefers food-rich neighbors | improved |
| Read/write separation | snapshot.js: per-layer state snapshot; reads from snapshot, writes to live | aligned |
| Probabilistic rules (prob) | `prob` field on rules (0..1), checked after conditions pass | aligned |
| Seeded PRNG | Rng object (mulberry32), CONFIG.RNG_SEED, replaces all Math.random() | aligned |
| Signals / virtual items | Signal nodes: category 'signal', knowledge tokens, decay via bio rules | aligned |
| Social behavior | social trait (gregarious 0-1), alarm reflex, danger signal communication | aligned |
| Plan scoring | predict/risk on plan defs, intelligence-gated lookahead in Planner.scorePlan() | aligned |
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
| SpatialTrait | spatial trait | speed + intelligence (1-3, gates plan scoring depth) |
| VitalsTrait | vitals trait | hunger/energy/health/thirst; spec also has fatigue/mood/wounds/mana |
| DrivesTrait | — | Not implemented |
| AttributesTrait | — | Not implemented |
| SkillsTrait | — | Not implemented |
| AgencyTrait | agency trait | activeRole ('animal') + activePlan + lastAction |
| SocialTrait | social trait | gregarious (0-1): pack behavior, alarm communication |
| — | signal trait | Dynamic: kind, tokens[], emitter, emitterSpecies (set on creation) |

## Architecture

```
index.html          Entry point, grid container, controls
js/config.js        CONFIG constants, TILE_TYPES, TEMPLATES, Rng (seeded PRNG)
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
js/scenarios.js     SCENARIO_DEFS — toggleable test presets overriding CONFIG on reset
```

### Data / Code Separation — Rule Layers

All behavior is defined as **declarative data tables** (future .acf parsing targets)
evaluated by **engine code**, organized in layers:

| Layer | Data | Code | Location |
|---|---|---|---|
| L0 Base | `ACTION_DEFS` — action costs inline as `{type:'vital'}` effects | `Effects.executeAction()` | rules.js |
| L1 Bio | `BIO_RULE_DEFS` — passive drains, damage, death (no perception) | `Rules.biology()` | rules.js |
| L2 Reflex | `REFLEX_RULE_DEFS` — involuntary responses (auto-drink, reproduce, alarm signal) | `Rules.reflex()` | rules.js |
| L3 Roles | `ROLE_DEFS` — unified 'animal' role, diet-driven conditions | `Roles._matchRules/_execRule()` | roles.js |
| L3 Actions | `ACTION_DEFS` — effect descriptions per action (consume, combat, move) | `Effects.executeAction()` | rules.js |
| L4 Plans | `PLAN_DEFS` — step sequences (startmove, wait, action) | `Planner.start/executeStep()` | planner.js |

Rule conditions use `[field, op, value]` tuples evaluated by `evalRuleConditions()`.
Fields: vitals (`hunger`, `thirst`), `count`, `category`, `templateId`, sense paths (`sense.threats.count`, `sense.self.social`, `sense.signals.danger`).
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
  signals:       { danger, food, follow }  // nearby signal token counts
  allies:        { here, nearby }       // same-species entity counts
  self:          { social, intelligence, strength }  // own stats for conditions
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
    traits: {}      // vitals, diet, agency, spatial, social, group, signal
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

All templates define `weight` (heaviness per unit) and `bulk` (volume per unit) for the transport system.

- `terrain`: tile nodes (tile_grass, tile_water, tile_dirt, tile_rock) — w:0 b:0
- `tilegroup`: hierarchy group nodes at all levels — w:0 b:0
- `signal`: virtual items (sounds, scents, tracks, knowledge, contracts) — w:0 b:0
- `plant`: grass (w:0.1 b:0.2), bush (w:0.2 b:0.3), tree (w:0.5 b:0.5) — have vitals, group trait, no agency
- `seed`: grains (w:0.3 b:0.2), seeds (w:0.2 b:0.15) — edible bulk items, no vitals
- `item`: stone (w:3.0 b:2.0) — inert bulk, blocks movement at density
- `herbivore`: rabbit (str:1 w:1.0 b:0.8), deer (str:2 w:4.0 b:3.0) — unified 'animal' role, social trait
- `omnivore`: pig (str:2 w:5.0 b:3.5), bear (str:6 w:10.0 b:6.0) — unified 'animal' role, social trait
- `carnivore`: fox (str:3 w:3.0 b:2.0), wolf (str:5 w:6.0 b:3.5) — unified 'animal' role, social trait

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

#### Weight & Bulk Capacity

Every template defines `weight` and `bulk` per unit count. Carrying capacity is strength-based:
- `maxWeight = strength * CONFIG.CARRY_WEIGHT_PER_STR` (default 5 per str)
- `maxBulk = strength * CONFIG.CARRY_BULK_PER_STR` (default 4 per str)

Pickup (`tryPickup`) clamps amount to remaining weight and bulk capacity.
Movement speed is reduced by carried load via `carrySpeedFactor()`:
- `speedFactor = 1 - max(weightRatio, bulkRatio) * CONFIG.CARRY_SPEED_PENALTY`
- Minimum speed factor: 0.1 (never fully immobilized by cargo)

Helper functions in node.js: `carriedLoad(node)`, `remainingCapacity(node)`, `carrySpeedFactor(node)`.
Sense model exposes `sense.self.load` with current weight/bulk/max values.

### Signals — Generalized Virtual Items

Signals are nodes with category `signal` — generalized virtual items that carry knowledge
tokens and decay naturally. Reusable for any information that exists in the world temporarily:

- **Sounds**: short decay (3-4 ticks), used for alarm calls (danger token)
- **Scents/tracks**: longer decay, emitted by world rules (future)
- **Knowledge**: arbitrary token payloads (danger, food location, follow commands)
- **Contracts/data**: any entity-to-entity information exchange

Signal lifecycle:
1. Created by `_signal` effect handler (L2 reflex alarm, future: voluntary signals)
2. Exist as nodes in the world — sensed by `Sense.scan()` via `model.signals`
3. Decay via bio rule `signalDecay` (destroy 1/tick, count = ticks remaining)
4. Die when count reaches 0 (standard death system)

Signal node structure:
```
node.traits.signal = {
  kind: 'sound'|'scent'|'track'|...,
  tokens: [{ type: 'danger'|'food'|'follow'|... }],
  emitter: nodeId,          // who created this signal
  emitterSpecies: templateId  // what species created it
}
```

Grid visualization: signal overlay as subtle color tint (red=danger, green=food, blue=follow)
on affected tiles, fading with remaining decay ticks.

### Plan Execution Model

Plans are just plans — not autonomous state machines. Each tick:
1. Hard rules (L1 bio, L2 reflex) always execute — dying, hunger, thirst happen regardless
2. `Roles.evaluate()` re-evaluates ALL role rules by priority
3. If the winning rule's plan matches the active plan → continue it
4. If a different drive won → abandon the old plan, execute the winning rule
5. Entities can't get stuck: biological drives naturally preempt any stale plan

Plan scoring (`Planner.scorePlan()`):
- `predict` on plan defs: estimated vital deltas ({ hunger: -15, energy: -1.5 })
- `risk` on plan defs: base danger level (0.4 for hunting)
- Intelligence gates depth: int 1 = no scoring, int 2 = vital urgency, int 3+ = risk assessment
- Used by compound evaluation when two close-priority plan rules compete

### Unified Animal Role

One `animal` role serves all species. Diet-driven sense model differentiates behavior:
- Herbivores never see prey (diet.eats has no animal categories) → hunt rules never match
- Carnivores never see plant food → graze rules never match
- Omnivores see both → thresholds and plan scoring determine choice

Social behavior: `social.gregarious` (0-1) enables:
- Alarm reflex (L2): social animals emit danger signals when threats detected
- fleeAlarm rule: flee when ally danger signals sensed nearby
- Future: pack coordination, follow behavior

### Seeded PRNG

`Rng` object (mulberry32 algorithm) replaces all `Math.random()` calls.
`Rng.seed(CONFIG.RNG_SEED)` called on init for deterministic, reproducible simulations.
Same seed → identical world generation and simulation outcomes.

## Commands

No build step. Open `index.html` in a browser. No dependencies.

### Setup (once per clone)

```
git config core.hooksPath .githooks
```

This enables the pre-commit hook that auto-updates `?v=SHA` cache-bust
markers in `index.html` and `README.md` whenever JS/CSS files are committed.
The hash is computed from the staged diff content.

## Style

- Plain ES5 JavaScript (no modules, no build, no transpile)
- Global vars, no classes
- `var` not `let`/`const`
- Functional style: plain objects + free functions
- No semicolon-free style — semicolons everywhere
- No backward compatibility — this is WIP, rename/remove freely
