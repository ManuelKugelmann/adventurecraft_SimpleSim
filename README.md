# AdventureCraft SimpleSim

Browser-based ecosystem simulation bootstrapping the core [adventurecraft](https://github.com/ManuelKugelmann/adventurecraft_WIP) architecture.

**[Live Demo](https://ManuelKugelmann.github.io/adventurecraft_SimpleSim/)**

## Run

Open `index.html` in a browser. No build step, no dependencies.

## Architecture

Multiscale region-graph simulation validating adventurecraft primitives:

- **Unified Nodes** — every entity (plant group, animal herd) is a Node with id, template, count, region, rough position
- **Trait composition** — behavior from composable traits (vitals, diet, agency, spatial), not class hierarchy
- **Region graph** — terrain partitioned into ~20-40 contiguous regions with adjacency graph; groups live in regions, move between connected regions
- **Scale-agnostic rules** — same rule applies whether count=1 or count=50; count scales interaction magnitudes
- **Compound statistics** — one aggregate outcome per group interaction (expected value + variance), not N individual rolls
- **Rough position** — groups have center + spread; detailed tile positions only generated on split
- **Merge/split on homogeneity** — same-species groups in same region with similar traits merge; oversized groups split
- **Roles + reusable processes** — reactive priority-sorted rules handle most behavior; multi-step processes (flee, findFood, huntPrey) invoked when needed
- **Initiative ordering** — world rules run early; actor actions run late, ordered by speed

## Species

| Symbol | Species | Category | Default Count | Strength |
|--------|---------|----------|---------------|----------|
| ♣ | Grass | plant | 20 | — |
| ❀ | Bush | plant | 12 | — |
| ♠ | Tree | plant | 5 | — |
| ◆ | Rabbit | herbivore | 10 | 1 |
| ◇ | Deer | herbivore | 8 | 2 |
| ● | Pig | omnivore | 6 | 2 |
| ■ | Bear | omnivore | 3 | 6 |
| ▸ | Fox | carnivore | 5 | 3 |
| ▲ | Wolf | carnivore | 4 | 5 |

Groups shown as icon + count at region center with tinted spread tiles.
