# Architecture: bifrost

The C4 model of bifrost, kept by [floorplan](https://github.com/21StarkCom/floorplan).

- `model/` holds the model. Edit these files.
- `kit/spec.c4` is a copy of the floorplan kit. `floorplan build` writes it again. Do not edit it.
- `proposals/` holds open proposals.
- `generated/` holds the outputs of `floorplan build`. Do not edit them.

Run `floorplan build` after each change to the model, and commit the outputs.
`floorplan check` fails when the outputs are older than the model.

## Views

<!-- floorplan:views:start -->
<!-- floorplan build writes this block. Do not edit it. -->

### Tech stack

![Tech stack](generated/png/stack.png)

### System Context: Bifröst

![System Context: Bifröst](generated/png/index.png)

### Containers: Bifröst, the skills, the mods and the fleet

![Containers: Bifröst, the skills, the mods and the fleet](generated/png/containers.png)

### Containers: Bifröst, the tools and the hooks

![Containers: Bifröst, the tools and the hooks](generated/png/tools.png)

<!-- floorplan:views:end -->
