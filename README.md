# AdventureCraft SimpleSim

Browser-based ecosystem simulation bootstrapping the core [adventurecraft](https://github.com/ManuelKugelmann/adventurecraft_WIP) architecture.

## Run

Open `index.html` in a browser. No build step, no dependencies.

## Architecture

Validates these adventurecraft primitives in a minimal food-chain sim:

- **Unified Nodes** — every entity (plant, animal) is a Node with id, template, container, parent
- **Trait composition** — behavior comes from composable traits (vitals, diet, agency, spatial, growth), not class hierarchy
- **ContainerNode tree** — tiles contain entities; reverse-indexed for O(1) spatial queries
- **Parent hierarchy** — group leaders linked via `node.parent` for organizational grouping
- **Roles + reusable processes** — reactive priority-sorted rules handle 95% of behavior; multi-step processes (flee, findFood, huntPrey, findMate) are invoked when needed
- **Initiative ordering** — world rules run early; actor actions run late, ordered by speed (initiative)
- **Count-based grouping** — nearby same-species entities form groups; count drives behavioral modifiers (herd safety, pack hunting)

## Species

| Symbol | Species | Category | Speed |
|--------|---------|----------|-------|
| ♣ | Grass | plant | — |
| ❀ | Bush | plant | — |
| ♠ | Tree | plant | — |
| ◆ | Rabbit | herbivore | 3 |
| ◇ | Deer | herbivore | 2 |
| ● | Pig | omnivore | 1 |
| ■ | Bear | omnivore | 1 |
| ▸ | Fox | carnivore | 3 |
| ▲ | Wolf | carnivore | 2 |

Group members are shown with tinted background colors.
