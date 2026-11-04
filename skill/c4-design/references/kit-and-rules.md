# The floorplan kit and the C4 rules

From section 6 of `docs/specs/2026-11-04-floorplan-tool-spec.md` in the floorplan repo. The kit itself is
`packages/floorplan/kit/c4/spec.c4` there; `floorplan build` writes a copy into each project as `kit/spec.c4`.
Do not edit that copy: the next build writes it again, and rule R8 fails on a changed copy.

## Element kinds

| Kind             | C4 level  | Shape   | Put it                                  |
| ---------------- | --------- | ------- | --------------------------------------- |
| `person`         | 1         | person  | at the top level of `model`             |
| `softwareSystem` | 1         | box     | at the top level of `model`             |
| `externalSystem` | 1         | box     | at the top level of `model`; grey       |
| `container`      | 2         | box     | inside a `softwareSystem`               |
| `webApp`         | 2         | browser | inside a `softwareSystem`               |
| `mobileApp`      | 2         | mobile  | inside a `softwareSystem`               |
| `database`       | 2         | storage | inside a `softwareSystem`               |
| `queue`          | 2         | queue   | inside a `softwareSystem`               |
| `component`      | 3         | box     | inside one of the five container kinds  |

The five container kinds are `container`, `webApp`, `mobileApp`, `database` and `queue`. The colours are the
classic C4 palette, set by the kit; a model sets no colour.

## Relationship kinds

- `async`: a dotted line, for a message, an event or a queue.
- `sync`: a solid line, for a call that waits for its answer.

Write a kind as `a -[async]-> b 'publishes orders'`. A relationship with no kind is a plain line.

## Rules of `floorplan check`

`floorplan check` first reports LikeC4's own errors and warnings as rule `LIKEC4`. A proposal with an entry that
does not hold (a `remove` of an element that is not in the model, an `add` of one that is) is a `LIKEC4` error.

| Rule | What it checks                                                                                 | Level   |
| ---- | ---------------------------------------------------------------------------------------------- | ------- |
| R1   | Every element uses a kind from the kit.                                                        | error   |
| R2   | A container kind is only inside a `softwareSystem`. A `component` is only inside a container kind. | error   |
| R3   | A `person` and an `externalSystem` have no children.                                           | error   |
| R4   | Each system, container and component has a description.                                       | warning |
| R5   | Each container and component has a technology.                                                 | warning |
| R6   | Each relationship has a title. A relationship between two containers has a technology.         | warning |
| R7   | The product has a context view. Each system with containers has a container view.              | warning |
| R8   | `generated/manifest.json` matches the inputs and the outputs.                                  | error   |

- An error makes the check fail (exit 1, `ok: false`). A warning fails it only past `--max-warnings` (MCP
  `maxWarnings`). Aim for no warnings in a proposal: a warning is a gap the operator will ask about.
- R8 compares SHA-256 hashes and renders nothing again. Its inputs are `likec4.config.json` and the files under
  `kit/`, `model/` and `.likec4/`. Its outputs are the files under `generated/`, less `manifest.json`.
- `proposals/` and `README.md` are not inputs of R8. So a proposal edit needs no build, and R8 stays green while a
  proposal is open.
- A layout that the operator saves in the studio (a moved box) goes into `.likec4/`, an input. R8 then fails until
  the next build. `floorplan accept` builds, so the loop's end clears it.
- R8 also fails when `kit/spec.c4` is not the kit of the CLI that runs the check. After a floorplan upgrade that
  changes the kit, run `floorplan build` again.
