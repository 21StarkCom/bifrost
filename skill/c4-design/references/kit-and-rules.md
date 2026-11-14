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

The five container kinds are `container`, `webApp`, `mobileApp`, `database` and `queue`. The kit sets the
colours: the C4 roles of the draupnir house theme, a blue scale with the theme's neutral for an external system,
not the classic C4 palette. A model sets no colour.

## Deployment node kinds

A node of a `deployment` block uses one of these kinds. `floorplan scan` writes them into
`model/scan/deployment.c4` from the `.tf` files of the `terraform` keys, all in one `environment` named `gcp`.

| Kind             | Shows                  | The scan makes it from                                                                              |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `environment`    | an environment         | the one environment `gcp`                                                                           |
| `gcpProject`     | a GCP project          | `google_project`; with none, a node named `project`                                                 |
| `network`        | a network              | `google_compute_network`                                                                            |
| `subnet`         | a subnet               | `google_compute_subnetwork`                                                                         |
| `cluster`        | a Kubernetes cluster   | `google_container_cluster`                                                                          |
| `vm`             | a virtual machine      | `google_compute_instance`                                                                           |
| `nat`            | a NAT                  | `google_compute_router_nat`                                                                         |
| `managedService` | a managed service      | `google_sql_database_instance`, `google_storage_bucket`, `google_pubsub_topic`, `google_kms_key_ring` |

A node goes in the subnet that one of its arguments names, else in the network, else in the project. A node that
names no project goes in the project of its own folder, or of the nearest parent folder.

From the inventory of an `infra` key, the scan uses these kinds too, with one `environment` for each inventory and
one `gcpProject` for each project ([code-keys.md](code-keys.md#show-the-deployments-from-the-cloud)).

## The infra kit

The infra kit adds the kinds and the tags of a deployment model that comes from an inventory. It is a second kit file
of the floorplan CLI, not a part of `kit/spec.c4`. The scan writes it into `model/scan/infra-kit.c4`, only for a
project with an `infra` key. The source is section 6 of `docs/specs/2026-11-14-deployment-and-network-views.md` in
the floorplan repo.

| Kind              | Shows                                                         | Its parent        |
| ----------------- | ------------------------------------------------------------- | ----------------- |
| `externalNetwork` | the internet, or the network of the peer of a VPN             | the environment   |
| `loadBalancer`    | a load balancer: its URL map, its proxy and its front end     | its project       |
| `vpnGateway`      | an HA VPN gateway and its tunnels                             | its network       |
| `namespace`       | a Kubernetes namespace                                        | its cluster       |

The scan gives each line between two nodes one topic tag. A view of a topic shows no line of another topic.

| Tag             | The lines of                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `topic-ingress` | the way in: the internet, the DNS, the load balancer, the backend service, the service                |
| `topic-network` | Cloud Run, the subnet, the NAT, the internet, the peering, the database, the VPN gateway, the network of its peer |
| `topic-data`    | a key, the registry, the secrets                                                                      |

The prefix `topic-` keeps these tags apart from a tag of the product, such as `data`.

## Relationship kinds

- `async`: a dotted line, for a message, an event or a queue.
- `sync`: a solid line, for a call that waits for its answer.

Write a kind as `a -[async]-> b 'publishes orders'`. A relationship with no kind gets a dashed line, which the key
does not explain. Give each relationship a kind.

## Rules of `floorplan check`

`floorplan check` first reports the language's own errors and warnings as rule `FLOORPLAN`. A proposal with an
entry that does not hold (a `remove` of an element that is not in the model, an `add` of one that is) is a
`FLOORPLAN` error.

| Rule | What it checks                                                                                 | Level   |
| ---- | ---------------------------------------------------------------------------------------------- | ------- |
| R1   | Every element and every deployment node uses a kind from the kit.                              | error   |
| R2   | A container kind is only inside a `softwareSystem`. A `component` is only inside a container kind. | error   |
| R3   | A `person` and an `externalSystem` have no children.                                           | error   |
| R4   | Each system, container and component has a description.                                       | warning |
| R5   | Each container and component has a technology.                                                 | warning |
| R6   | Each relationship has a title. A relationship between two containers has a technology.         | warning |
| R7   | The product has a context view. Each system with containers has a container view.              | warning |
| R8   | `generated/manifest.json` matches the inputs and the outputs.                                  | error   |
| R9   | A `code`, `deploy`, `terraform` or `infra` key is on its kinds. Its paths are in git. `model/scan/` is current. | error   |
| R14  | Each resource of the inventory that runs or holds data in an own project has a `deploy` key that names it. | warning |

- An error makes the check fail (exit 1, `ok: false`). A warning fails it only past `--max-warnings` (MCP
  `maxWarnings`). Aim for no warnings in a proposal: a warning is a gap the operator will ask about.
- R8 compares SHA-256 hashes and renders nothing again. Its inputs are `floorplan.config.json` and the files under
  `kit/`, `model/` and `.floorplan/`. Its outputs are the files under `generated/`, less `manifest.json`.
- `proposals/` and `README.md` are not inputs of R8. So a proposal edit needs no build, and R8 stays green while a
  proposal is open.
- A layout that the operator saves in the studio (a moved box) goes into `.floorplan/`, an input. R8 then fails until
  the next build. `floorplan accept` builds, so the loop's end clears it.
- R8 also fails when `kit/spec.c4` is not the kit of the CLI that runs the check. After a floorplan upgrade that
  changes the kit, run `floorplan build` again.
- R9's kinds: `code` goes on a `component` or a container kind, `deploy` on a container kind, and `terraform` and
  `infra` on a `softwareSystem`. Each path is a file or a folder that git tracks, relative to the repo root.
- R9's findings of the inventory, with their fixes, are in [code-keys.md](code-keys.md#r9-and-its-fixes).
- R9 also fails on a `deploy` value that the scan cannot place: a manifest with no workload, workloads with no
  cluster in the `terraform` folders, and a `tf:` address with no node.
- R9 runs `floorplan scan` in memory and fails when a file under `model/scan/` differs from it, is missing, or is
  extra. A project with none of the four keys runs no git command, and R9 passes.
- `model/scan/` is under `model/`, so it is an input of R8 too: a scan that changes a file makes R8 fail until the
  next build. `floorplan build` runs the scan first, so it clears both.
- R14 reports a Cloud Run service or job, a workload of an own namespace, a VM, a Cloud SQL instance, a bucket, a
  topic or a database of an own project that no `deploy` key names. The scan draws it as a node with no instance.
  It says: `this <resource> is in the project <project>, and no deploy key names it. Add deploy '<value>' to its
  container, or add the container to the model.` Its two fixes:
  - Add the `deploy` key that the finding names to the container that runs on the resource.
  - Add the container to the model when the model does not have it, then give it the `deploy` key.
